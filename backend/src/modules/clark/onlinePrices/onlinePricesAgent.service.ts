import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { gerarRelatorioOnlinePricesExcel, parseOnlinePricesWorkbook } from './onlinePricesExcel.service';
import { pesquisarModeloEmLojasClaude } from './onlinePricesClaude.service';
import {
  OnlinePriceAnalysisSummary,
  OnlinePriceAnalyzeOptions,
  OnlinePriceAnalyzeResponse,
  OnlinePriceClaudeUsage,
  OnlinePriceHistoryEntry,
  OnlinePriceResult,
  OnlineStoreTarget,
} from './onlinePrices.types';

const ROOT_DIR = process.cwd();
const CACHE_SCHEMA_VERSION = 2;

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 's'].includes(raw);
}

function getDefaultMaxModels(): number {
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_MODELS', 0); // 0 = todos
}

function getDefaultMaxStores(): number {
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_STORES', 0); // 0 = todas
}

function getDefaultMaxSearchUsesPerModel(): number {
  // Antes o padrão era 8. Para o volume real do usuário, 3 reduz muito custo.
  return envNumber('ONLINE_PRICES_MAX_WEB_SEARCH_PER_MODEL', 3);
}

function getCacheTtlDays(): number {
  return Math.max(1, envNumber('ONLINE_PRICES_CACHE_TTL_DAYS', 7));
}

function isCacheEnabled(): boolean {
  return envBoolean('ONLINE_PRICES_CACHE_ENABLED', true);
}

function getWebSearchUnitPriceUsd(): number {
  return envNumber('CLAUDE_WEB_SEARCH_UNIT_PRICE_USD', 0.01);
}

function getReportDir(): string {
  return process.env.ONLINE_PRICES_REPORT_DIR || path.join(ROOT_DIR, 'uploads', 'online-prices');
}

function getCachePath(): string {
  return process.env.ONLINE_PRICES_CACHE_FILE || path.join(getReportDir(), 'online-prices-cache.json');
}

function getHistoryPath(): string {
  return process.env.ONLINE_PRICES_HISTORY_FILE || path.join(getReportDir(), 'online-prices-history.json');
}

function ensureReportDir() {
  fs.mkdirSync(getReportDir(), { recursive: true });
}

function clampPositive(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function sumUsage(usages: OnlinePriceClaudeUsage[]): OnlinePriceClaudeUsage {
  return usages.reduce(
    (acc, item) => ({
      inputTokens: acc.inputTokens + item.inputTokens,
      outputTokens: acc.outputTokens + item.outputTokens,
      webSearchRequests: acc.webSearchRequests + item.webSearchRequests,
    }),
    { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
  );
}

function montarResumo(params: {
  produtosDetectados: number;
  lojasDetectadas: number;
  consultasPlanejadas: number;
  results: OnlinePriceResult[];
  usage: OnlinePriceClaudeUsage;
  cacheHits: number;
  cacheMisses: number;
  modelosPesquisadosNaApi: number;
}): OnlinePriceAnalysisSummary {
  const encontrados = params.results.filter((r) => r.disponibilidade === 'encontrado').length;
  const indisponiveis = params.results.filter((r) => r.disponibilidade === 'indisponivel').length;
  const naoEncontrados = params.results.filter((r) => r.disponibilidade === 'nao_encontrado').length;
  const erros = params.results.filter((r) => r.disponibilidade === 'erro').length;

  return {
    produtosDetectados: params.produtosDetectados,
    lojasDetectadas: params.lojasDetectadas,
    consultasPlanejadas: params.consultasPlanejadas,
    consultasExecutadas: params.results.length,
    encontrados,
    indisponiveis,
    naoEncontrados,
    erros,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    webSearchRequests: params.usage.webSearchRequests,
    custoEstimadoWebSearchUsd: Number((params.usage.webSearchRequests * getWebSearchUnitPriceUsd()).toFixed(4)),
    cacheHits: params.cacheHits,
    cacheMisses: params.cacheMisses,
    modelosPesquisadosNaApi: params.modelosPesquisadosNaApi,
    cacheTtlDias: getCacheTtlDays(),
  };
}

function isProviderFatalError(message: string): boolean {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('anthropic_api_key') ||
    lower.includes('claude api') ||
    lower.includes('modelo configurado') ||
    lower.includes('web search') ||
    lower.includes('web_search') ||
    lower.includes('deprecated') ||
    lower.includes('retired') ||
    lower.includes('rate limit') ||
    lower.includes('too_many_requests') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('api key')
  );
}

function texto(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizar(value: unknown): string {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cacheKey(modelo: string, loja: OnlineStoreTarget | string): string {
  const lojaNome = typeof loja === 'string' ? loja : loja.nomeNormalizado || loja.nome;
  const raw = `${CACHE_SCHEMA_VERSION}::${normalizar(modelo)}::${normalizar(lojaNome)}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

type CacheEntry = {
  key: string;
  modelo: string;
  loja: string;
  createdAt: string;
  expiresAt: string;
  result: OnlinePriceResult;
};

type CacheStore = {
  version: number;
  updatedAt: string;
  entries: Record<string, CacheEntry>;
};

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[Preços Online] Não consegui ler JSON em ${filePath}:`, error);
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown) {
  ensureReportDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function loadCache(): CacheStore {
  const cache = readJsonFile<CacheStore>(getCachePath(), {
    version: CACHE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: {},
  });

  if (!cache || cache.version !== CACHE_SCHEMA_VERSION || !cache.entries) {
    return { version: CACHE_SCHEMA_VERSION, updatedAt: new Date().toISOString(), entries: {} };
  }

  return cache;
}

function saveCache(cache: CacheStore) {
  cache.updatedAt = new Date().toISOString();
  writeJsonFile(getCachePath(), cache);
}

function isFreshCache(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  const expires = new Date(entry.expiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

function pruneExpiredCache(cache: CacheStore) {
  Object.keys(cache.entries).forEach((key) => {
    if (!isFreshCache(cache.entries[key])) {
      delete cache.entries[key];
    }
  });
}

function getPlanilhaPoint(produto: { valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }> }, loja: OnlineStoreTarget) {
  return produto.valoresPlanilhaPorLoja[loja.nomeNormalizado] || {};
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function calcularDiferenca(online: number | null, planilha: number | null) {
  if (typeof online !== 'number' || typeof planilha !== 'number' || !Number.isFinite(planilha) || planilha === 0) {
    return { diff: null, diffPct: null };
  }

  const diff = online - planilha;
  return { diff, diffPct: diff / planilha };
}

function aplicarValoresPlanilha(params: {
  result: OnlinePriceResult;
  loja: OnlineStoreTarget;
  planilha: { planilhaAvista?: number | null; planilhaPrazo12x?: number | null };
  cacheHit?: boolean;
}): OnlinePriceResult {
  const precoAvistaPlanilha = toPositiveNumber(params.planilha.planilhaAvista ?? null);
  const precoPrazo12xPlanilha = toPositiveNumber(params.planilha.planilhaPrazo12x ?? null);
  const precoAvistaOnline = params.result.disponibilidade === 'encontrado' ? toPositiveNumber(params.result.precoAvistaOnline) : null;
  const precoPrazo12xOnline = params.result.disponibilidade === 'encontrado' ? toPositiveNumber(params.result.precoPrazo12xOnline) : null;
  const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
  const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);

  const finalResult: OnlinePriceResult = {
    ...params.result,
    loja: params.loja.nome,
    dominios: params.loja.dominios,
    precoAvistaOnline,
    precoPrazo12xOnline,
    precoAvistaPlanilha,
    precoPrazo12xPlanilha,
    diferencaAvista: diffAvista.diff,
    diferencaAvistaPercentual: diffAvista.diffPct,
    diferencaPrazo12x: diffPrazo.diff,
    diferencaPrazo12xPercentual: diffPrazo.diffPct,
    titulo: null,
    url: null,
    fonte: null,
    observacao: params.result.disponibilidade === 'encontrado' ? null : 'INDISPONÍVEL',
  };

  if (typeof params.cacheHit === 'boolean') {
    finalResult.cacheHit = params.cacheHit;
  }

  return finalResult;
}

function criarResultadoIndisponivel(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  planilha: { planilhaAvista?: number | null; planilhaPrazo12x?: number | null };
  mensagem?: string;
}): OnlinePriceResult {
  const base: OnlinePriceResult = {
    modelo: params.modelo,
    loja: params.loja.nome,
    dominios: params.loja.dominios,
    disponibilidade: 'indisponivel',
    precoAvistaOnline: null,
    precoPrazo12xOnline: null,
    parcelasTexto: null,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: null,
    url: null,
    fonte: null,
    confianca: 0,
    observacao: params.mensagem || 'INDISPONÍVEL',
    pesquisadoEm: new Date().toISOString(),
  };

  return aplicarValoresPlanilha({
    result: base,
    loja: params.loja,
    planilha: params.planilha,
    cacheHit: false,
  });
}

function cacheResult(params: {
  cache: CacheStore;
  modelo: string;
  loja: OnlineStoreTarget;
  result: OnlinePriceResult;
}) {
  const key = cacheKey(params.modelo, params.loja);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getCacheTtlDays() * 24 * 60 * 60 * 1000);

  const stored: OnlinePriceResult = {
    ...params.result,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: null,
    url: null,
    fonte: null,
    observacao: params.result.disponibilidade === 'encontrado' ? null : 'INDISPONÍVEL',
    cacheHit: false,
  };

  params.cache.entries[key] = {
    key,
    modelo: params.modelo,
    loja: params.loja.nome,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    result: stored,
  };
}

function carregarHistorico(): OnlinePriceHistoryEntry[] {
  const history = readJsonFile<OnlinePriceHistoryEntry[]>(getHistoryPath(), []);
  return Array.isArray(history) ? history : [];
}

function salvarHistorico(history: OnlinePriceHistoryEntry[]) {
  const maxItems = Math.max(10, envNumber('ONLINE_PRICES_HISTORY_MAX_ITEMS', 50));
  writeJsonFile(getHistoryPath(), history.slice(0, maxItems));
}

function adicionarHistorico(entry: OnlinePriceHistoryEntry) {
  const history = carregarHistorico();
  const next = [entry, ...history.filter((item) => item.id !== entry.id)];
  salvarHistorico(next);
}

export function listarHistoricoPrecosOnline(limit = 20): OnlinePriceHistoryEntry[] {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit || 20), 100));
  return carregarHistorico().slice(0, safeLimit);
}

export function obterUltimaConsultaPrecosOnline(): OnlinePriceHistoryEntry | null {
  return carregarHistorico()[0] || null;
}

export async function analisarPrecosOnline(params: OnlinePriceAnalyzeOptions): Promise<OnlinePriceAnalyzeResponse> {
  ensureReportDir();

  const input = parseOnlinePricesWorkbook({
    fileBuffer: params.fileBuffer,
    originalName: params.originalName,
  });

  const requestedMaxModels = clampPositive(params.maxModels);
  const requestedMaxStores = clampPositive(params.maxStores);
  const defaultMaxModels = getDefaultMaxModels();
  const defaultMaxStores = getDefaultMaxStores();
  const maxModels = requestedMaxModels ?? (defaultMaxModels > 0 ? defaultMaxModels : input.produtos.length);
  const maxStores = requestedMaxStores ?? (defaultMaxStores > 0 ? defaultMaxStores : input.lojas.length);

  const produtos = input.produtos.slice(0, maxModels);
  const lojas = input.lojas.slice(0, maxStores);
  const consultasPlanejadas = produtos.length * lojas.length;

  const cache = loadCache();
  pruneExpiredCache(cache);

  const cacheEnabled = isCacheEnabled() && !params.bypassCache;
  const allResults: OnlinePriceResult[] = [];
  const usages: OnlinePriceClaudeUsage[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let modelosPesquisadosNaApi = 0;

  for (const produto of produtos) {
    const missingStores: OnlineStoreTarget[] = [];

    for (const loja of lojas) {
      const planilha = getPlanilhaPoint(produto, loja);
      const key = cacheKey(produto.modelo, loja);
      const cached = cacheEnabled ? cache.entries[key] : undefined;

      if (isFreshCache(cached)) {
        cacheHits += 1;
        allResults.push(aplicarValoresPlanilha({
          result: cached.result,
          loja,
          planilha,
          cacheHit: true,
        }));
      } else {
        cacheMisses += 1;
        missingStores.push(loja);
      }
    }

    if (missingStores.length === 0) continue;

    try {
      modelosPesquisadosNaApi += 1;
      const maxSearchUses = Math.max(1, Math.min(getDefaultMaxSearchUsesPerModel(), Math.max(1, missingStores.length)));
      const { results, usage } = await pesquisarModeloEmLojasClaude({
        modelo: produto.modelo,
        lojas: missingStores,
        valoresPlanilhaPorLoja: produto.valoresPlanilhaPorLoja,
        maxSearchUses,
      });

      usages.push(usage);

      const resultsByStore = new Map<string, OnlinePriceResult>();
      results.forEach((result) => {
        resultsByStore.set(normalizar(result.loja), result);
      });

      missingStores.forEach((loja) => {
        const found = resultsByStore.get(normalizar(loja.nome)) || null;
        const planilha = getPlanilhaPoint(produto, loja);
        const finalResult = found
          ? aplicarValoresPlanilha({ result: found, loja, planilha, cacheHit: false })
          : criarResultadoIndisponivel({ modelo: produto.modelo, loja, planilha });

        allResults.push(finalResult);
        if (cacheEnabled) {
          cacheResult({ cache, modelo: produto.modelo, loja, result: finalResult });
        }
      });
    } catch (error: any) {
      const mensagem = error?.message || 'Erro desconhecido ao pesquisar preços online.';

      if (isProviderFatalError(mensagem)) {
        throw new Error(mensagem);
      }

      missingStores.forEach((loja) => {
        const planilha = getPlanilhaPoint(produto, loja);
        const finalResult = criarResultadoIndisponivel({
          modelo: produto.modelo,
          loja,
          planilha,
          mensagem: 'INDISPONÍVEL',
        });
        allResults.push(finalResult);
        if (cacheEnabled) {
          cacheResult({ cache, modelo: produto.modelo, loja, result: finalResult });
        }
      });
    }
  }

  if (cacheEnabled) {
    saveCache(cache);
  }

  // Garante a ordem original: modelo da planilha e loja da planilha.
  const resultMap = new Map<string, OnlinePriceResult>();
  allResults.forEach((result) => {
    resultMap.set(`${normalizar(result.modelo)}::${normalizar(result.loja)}`, result);
  });

  const orderedResults: OnlinePriceResult[] = [];
  produtos.forEach((produto) => {
    lojas.forEach((loja) => {
      const existing = resultMap.get(`${normalizar(produto.modelo)}::${normalizar(loja.nome)}`);
      if (existing) {
        orderedResults.push(existing);
      } else {
        orderedResults.push(criarResultadoIndisponivel({
          modelo: produto.modelo,
          loja,
          planilha: getPlanilhaPoint(produto, loja),
        }));
      }
    });
  });

  const usage = sumUsage(usages);
  const resumo = montarResumo({
    produtosDetectados: input.produtos.length,
    lojasDetectadas: input.lojas.length,
    consultasPlanejadas,
    results: orderedResults,
    usage,
    cacheHits,
    cacheMisses,
    modelosPesquisadosNaApi,
  });

  const report = await gerarRelatorioOnlinePricesExcel({
    input: {
      ...input,
      produtos,
      lojas,
    },
    results: orderedResults,
    resumo,
    outputDir: getReportDir(),
  });

  const generatedAt = new Date().toISOString();
  const historyId = crypto
    .createHash('sha1')
    .update(`${generatedAt}::${params.userId}::${input.originalName}::${report.fileName}`)
    .digest('hex')
    .slice(0, 16);
  const downloadUrl = `/api/online-prices/report/${encodeURIComponent(report.fileName)}`;

  const historyEntry: OnlinePriceHistoryEntry = {
    id: historyId,
    userId: params.userId,
    originalName: input.originalName,
    sheetName: input.sheetName,
    createdAt: generatedAt,
    produtosDetectados: input.produtos.length,
    lojasDetectadas: input.lojas.length,
    produtosProcessados: produtos.length,
    lojasProcessadas: lojas.length,
    lojas: lojas.map((loja) => loja.nome),
    resumo,
    reportFileName: report.fileName,
    downloadUrl,
  };

  adicionarHistorico(historyEntry);

  return {
    ok: true,
    agent: 'precos_online',
    message: `Pesquisa concluída: ${resumo.consultasExecutadas} consultas em ${produtos.length} modelos e ${lojas.length} lojas. Cache: ${cacheHits} reutilizadas, ${cacheMisses} novas.`,
    planilha: {
      nomeArquivo: input.originalName,
      aba: input.sheetName,
      produtosDetectados: input.produtos.length,
      lojasDetectadas: input.lojas.length,
      produtosProcessados: produtos.length,
      lojasProcessadas: lojas.length,
      lojas: lojas.map((loja) => loja.nome),
    },
    resumo,
    results: orderedResults.slice(0, 300),
    reportFileName: report.fileName,
    downloadUrl,
    generatedAt,
    historyId,
  };
}

export function getOnlinePricesReportPath(fileName: string): string {
  const safeName = path.basename(String(fileName || '').trim());
  return path.join(getReportDir(), safeName);
}
