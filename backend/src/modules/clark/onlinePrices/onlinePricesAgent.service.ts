import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { gerarRelatorioOnlinePricesExcel, parseOnlinePricesWorkbook } from './onlinePricesExcel.service';
import { pesquisarModeloEmLojasClaude } from './onlinePricesClaude.service';
import { pesquisarPrecoSemIa } from './onlinePricesScraper.service';
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
const ENGINE_VERSION = '6.0.0';
const CACHE_SCHEMA_VERSION = 11;

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
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_MODELS', 0);
}

function getDefaultMaxStores(): number {
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_STORES', 0);
}

function getDefaultMaxSearchUsesPerModel(): number {
  return Math.max(1, envNumber('ONLINE_PRICES_MAX_WEB_SEARCH_PER_MODEL', 2));
}

function getCacheTtlDays(): number {
  return Math.max(1, envNumber('ONLINE_PRICES_CACHE_TTL_DAYS', 7));
}

function getNegativeCacheTtlHours(): number {
  return Math.max(1, envNumber('ONLINE_PRICES_NEGATIVE_CACHE_TTL_HOURS', 12));
}

function getPartialCacheTtlHours(): number {
  // Resultado parcial (só à vista ou só 12x) não pode ficar congelado por 7 dias.
  // Guardamos por poucas horas para evitar custo repetido, mas permitimos nova tentativa.
  return Math.max(1, envNumber('ONLINE_PRICES_PARTIAL_CACHE_TTL_HOURS', 6));
}

function isCompleteFoundPriceResult(result: OnlinePriceResult): boolean {
  if (result.disponibilidade !== 'encontrado') return false;
  if (typeof result.ofertaCompleta === 'boolean') return result.ofertaCompleta;
  return !!(result.precoAvistaOnline && result.precoPrazo12xOnline);
}

function getStaleUrlRetentionDays(): number {
  return Math.max(getCacheTtlDays(), envNumber('ONLINE_PRICES_STALE_URL_RETENTION_DAYS', 45));
}

function isCacheEnabled(): boolean {
  return envBoolean('ONLINE_PRICES_CACHE_ENABLED', true);
}

function isDirectScrapeEnabled(): boolean {
  return envBoolean('ONLINE_PRICES_DIRECT_SCRAPE_ENABLED', true);
}

function isAiFallbackEnabled(): boolean {
  return envBoolean('ONLINE_PRICES_AI_FALLBACK_ENABLED', true);
}

function getAiMaxFallbacksPerRun(): number {
  const value = Math.floor(envNumber('ONLINE_PRICES_AI_MAX_FALLBACKS_PER_RUN', 2));
  return Math.max(0, Math.min(20, value));
}

function getAiFallbackScopes(): Set<string> {
  const raw = String(process.env.ONLINE_PRICES_AI_FALLBACK_ONLY_FOR || 'partial,seller');
  const scopes = raw
    .split(',')
    .map((item) => normalizar(item).replace(/ /g, '_'))
    .filter(Boolean);
  return new Set(scopes);
}

function hasSuspiciousSeller(result: OnlinePriceResult): boolean {
  const seller = normalizar(result.seller || '');
  if (!seller) return false;

  const suspicious = [
    'CAPA',
    'PELICULA',
    'CARREGADOR',
    'CABO',
    'FONE',
    'HEADPHONE',
    'EARBUD',
    'SMARTWATCH',
    'COMPATIVEL COM',
    'PARA SAMSUNG GALAXY',
  ];
  return suspicious.some((term) => seller.includes(normalizar(term)));
}

function shouldUseAiFallback(result: OnlinePriceResult): boolean {
  const scopes = getAiFallbackScopes();
  const hasKnownUrl = !!String(result.url || '').trim();

  // V6: Claude não faz mais busca aberta na internet. Ele só interpreta a
  // página/oferta exata que o motor determinístico já localizou. Sem URL
  // conhecida não há evidência segura para enviar ao modelo.
  if (!hasKnownUrl) return false;

  if (
    result.disponibilidade === 'encontrado' &&
    result.ofertaCompleta &&
    hasSuspiciousSeller(result)
  ) {
    return scopes.has('SELLER') || scopes.has('VENDEDOR');
  }

  if (result.disponibilidade === 'erro') {
    return scopes.has('ERROR') || scopes.has('ERRO') || scopes.has('FALHA_PESQUISA');
  }

  if (result.disponibilidade === 'encontrado' && !isCompleteFoundPriceResult(result)) {
    return scopes.has('PARTIAL') || scopes.has('PARCIAL') || scopes.has('OFERTA_PARCIAL');
  }

  // Não usamos IA para transformar "não encontrado" em "encontrado". Isso
  // elimina pesquisa aberta, falso positivo e custo desnecessário.
  return false;
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
  httpRequests: number;
  resolvidosSemIa: number;
  fallbacksIa: number;
  urlsReutilizadas: number;
  urlsDescobertas: number;
  tavilySearchRequests: number;
  tavilyExtractRequests: number;
  tavilyCreditsEstimated: number;
  ofertasDescobertas: number;
  ofertasValidas: number;
  falhasPesquisa: number;
}): OnlinePriceAnalysisSummary {
  const encontrados = params.results.filter((r) => r.disponibilidade === 'encontrado').length;
  const indisponiveis = params.results.filter((r) => r.disponibilidade === 'indisponivel').length;
  const naoEncontrados = params.results.filter((r) => r.disponibilidade === 'nao_encontrado').length;
  const erros = params.results.filter((r) => r.disponibilidade === 'erro').length;

  return {
    engineVersion: ENGINE_VERSION,
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
    httpRequests: params.httpRequests,
    resolvidosSemIa: params.resolvidosSemIa,
    fallbacksIa: params.fallbacksIa,
    urlsReutilizadas: params.urlsReutilizadas,
    urlsDescobertas: params.urlsDescobertas,
    tavilySearchRequests: params.tavilySearchRequests,
    tavilyExtractRequests: params.tavilyExtractRequests,
    tavilyCreditsEstimated: params.tavilyCreditsEstimated,
    ofertasDescobertas: params.ofertasDescobertas,
    ofertasValidas: params.ofertasValidas,
    falhasPesquisa: params.falhasPesquisa,
  };
}

function isProviderFatalError(message: string): boolean {
  const lower = String(message || '').toLowerCase();

  // 429/5xx/529/overloaded são transitórios. O Claude service já tenta
  // novamente; se ainda falhar, preservamos o resultado determinístico em vez
  // de derrubar o agente inteiro.
  if (
    lower.includes('429') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('529') ||
    lower.includes('overloaded') ||
    lower.includes('rate limit') ||
    lower.includes('too_many_requests') ||
    lower.includes('timeout')
  ) {
    return false;
  }

  return (
    lower.includes('anthropic_api_key') ||
    lower.includes('modelo configurado') ||
    lower.includes('deprecated') ||
    lower.includes('retired') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid x-api-key') ||
    lower.includes('api key') ||
    lower.includes('forbidden') ||
    lower.includes('permission')
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
    .replace(/(\d+)\s*(GB|TB)\b/g, '$1$2')
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

  if (
    !cache ||
    cache.version !== CACHE_SCHEMA_VERSION ||
    !cache.entries ||
    typeof cache.entries !== 'object'
  ) {
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


function isCachedResultCommerciallyReliable(result: OnlinePriceResult): boolean {
  const observacaoNormalizada = normalizar(result.observacao || '');
  const fonteNormalizada = normalizar(result.fonte || '');

  // Invalida decisões negativas/positivas geradas pelo antigo Claude com web
  // search. A V6 usa Claude apenas como parser da URL já descoberta.
  if (observacaoNormalizada.includes('NAO ENCONTRADO PELA IA')) return false;
  if (fonteNormalizada.includes('CLAUDE_WEB_SEARCH')) return false;
  if (result.disponibilidade !== 'encontrado') return true;

  // Resultado parcial pode ser reaproveitado como fallback seguro. Quando a IA
  // estiver habilitada, o V5 usa esse cache como ponto de partida e tenta apenas
  // completar os campos faltantes, sem refazer Tavily/HTTP desnecessariamente.
  if (!result.ofertaCompleta) return true;

  const cash = toPositiveNumber(result.precoAvistaOnline);
  const term = toPositiveNumber(result.precoPrazo12xOnline);
  const installmentValue = toPositiveNumber(result.valorParcela);
  const count = Number(result.numeroParcelas || 0);

  if (count === 12 && installmentValue && term) {
    const calculated = Math.round(installmentValue * 12 * 100) / 100;
    if (Math.abs(term - calculated) > 0.05) return false;
  }

  if (cash && term) {
    const minCashToTermRatio = Math.max(0.4, Math.min(0.9, envNumber('ONLINE_PRICES_MIN_CASH_TO_12X_RATIO', 0.65)));
    if (term < cash * 0.95 || cash < term * minCashToTermRatio) return false;
  }

  return true;
}

function isStaleUrlReusable(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry?.result?.url) return false;
  const createdAt = new Date(entry.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const maxAge = getStaleUrlRetentionDays() * 24 * 60 * 60 * 1000;
  return createdAt + maxAge > Date.now();
}

function pruneDeadCache(cache: CacheStore) {
  const maxAge = getStaleUrlRetentionDays() * 24 * 60 * 60 * 1000;
  Object.keys(cache.entries).forEach((key) => {
    const entry = cache.entries[key];
    const createdAt = new Date(entry?.createdAt || 0).getTime();
    if (!Number.isFinite(createdAt) || createdAt + maxAge <= Date.now()) {
      delete cache.entries[key];
    }
  });
}

function getPlanilhaPoint(
  produto: { valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }> },
  loja: OnlineStoreTarget,
) {
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
  const precoAvistaOnline =
    params.result.disponibilidade === 'encontrado' ? toPositiveNumber(params.result.precoAvistaOnline) : null;
  const precoPrazo12xOnline =
    params.result.disponibilidade === 'encontrado' ? toPositiveNumber(params.result.precoPrazo12xOnline) : null;
  const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
  const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);

  const finalResult: OnlinePriceResult = {
    ...params.result,
    engineVersion: ENGINE_VERSION,
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
    observacao:
      params.result.observacao ||
      (params.result.disponibilidade === 'encontrado'
        ? null
        : params.result.disponibilidade === 'nao_encontrado'
          ? 'NÃO ENCONTRADO'
          : params.result.disponibilidade === 'erro'
            ? 'FALHA DE PESQUISA'
            : 'INDISPONÍVEL'),
  };

  if (typeof params.cacheHit === 'boolean') finalResult.cacheHit = params.cacheHit;
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
    seller: null,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'produto_indisponivel',
    offerId: null,
  };

  return aplicarValoresPlanilha({
    result: base,
    loja: params.loja,
    planilha: params.planilha,
    cacheHit: false,
  });
}

function criarResultadoErro(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  planilha: { planilhaAvista?: number | null; planilhaPrazo12x?: number | null };
  mensagem?: string;
}): OnlinePriceResult {
  const base: OnlinePriceResult = {
    modelo: params.modelo,
    loja: params.loja.nome,
    dominios: params.loja.dominios,
    disponibilidade: 'erro',
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
    observacao: params.mensagem || 'FALHA DE PESQUISA',
    pesquisadoEm: new Date().toISOString(),
    seller: null,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'falha_pesquisa',
    offerId: null,
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
  // Erro técnico / falha de pesquisa não prova ausência do produto.
  // Não persistimos esse estado para não transformar timeout/bloqueio em falso negativo.
  if (params.result.disponibilidade === 'erro') return;

  const key = cacheKey(params.modelo, params.loja);
  const now = new Date();
  const ttlMs =
    params.result.disponibilidade === 'encontrado'
      ? isCompleteFoundPriceResult(params.result)
        ? getCacheTtlDays() * 24 * 60 * 60 * 1000
        : getPartialCacheTtlHours() * 60 * 60 * 1000
      : getNegativeCacheTtlHours() * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs);

  const stored: OnlinePriceResult = {
    ...params.result,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
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

function resultInformationScore(result: OnlinePriceResult | null): number {
  if (!result) return -1;
  if (result.disponibilidade === 'encontrado') {
    let score = 10;
    if (result.precoAvistaOnline) score += 3;
    if (result.precoPrazo12xOnline) score += 4;
    if (result.numeroParcelas === 12) score += 1;
    if (result.valorParcela) score += 1;
    if (result.url) score += 1;
    if (result.ofertaCompleta) score += 5;
    return score;
  }
  if (result.disponibilidade === 'indisponivel') return 3;
  if (result.disponibilidade === 'nao_encontrado') return 2;
  return 0;
}

function chooseAiOrDirectResult(params: {
  claudeResult: OnlinePriceResult | null;
  directFallback: OnlinePriceResult | null;
}): OnlinePriceResult | null {
  const { claudeResult, directFallback } = params;
  if (!claudeResult) return directFallback;
  if (!directFallback) return claudeResult;

  // O Claude V6 só pode ENRIQUECER a oferta determinística da mesma URL. Uma
  // resposta negativa da IA nunca rebaixa um resultado real encontrado.
  if (claudeResult.disponibilidade !== 'encontrado') return directFallback;

  // Nunca misturamos campos de URLs/ofertas diferentes.
  const claudeScore = resultInformationScore(claudeResult);
  const directScore = resultInformationScore(directFallback);

  if (claudeScore > directScore) return claudeResult;
  if (directScore > claudeScore) return directFallback;

  // Em empate entre duas ofertas completas, preferimos o menor total em 12x.
  if (claudeResult.ofertaCompleta && directFallback.ofertaCompleta) {
    const claudeTerm = toPositiveNumber(claudeResult.precoPrazo12xOnline);
    const directTerm = toPositiveNumber(directFallback.precoPrazo12xOnline);
    if (claudeTerm && directTerm && claudeTerm !== directTerm) {
      return claudeTerm < directTerm ? claudeResult : directFallback;
    }
  }

  // Em empate de informação, preservamos o resultado determinístico.
  return directFallback;
}

export async function analisarPrecosOnline(params: OnlinePriceAnalyzeOptions): Promise<OnlinePriceAnalyzeResponse> {
  ensureReportDir();
  console.log(
    `[Preços Online ${ENGINE_VERSION}] início da análise; cache schema=${CACHE_SCHEMA_VERSION}; IA=${isAiFallbackEnabled() ? 'ON' : 'OFF'}; limite IA=${getAiMaxFallbacksPerRun()}; escopo=${Array.from(getAiFallbackScopes()).join(',')}; modoIA=parser_url`,
  );

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
  pruneDeadCache(cache);

  const cacheEnabled = isCacheEnabled() && !params.bypassCache;
  const directEnabled = isDirectScrapeEnabled();
  const aiEnabled = isAiFallbackEnabled();
  const aiMaxFallbacksPerRun = aiEnabled ? getAiMaxFallbacksPerRun() : 0;
  let aiFallbackBudgetRemaining = aiMaxFallbacksPerRun;
  const allResults: OnlinePriceResult[] = [];
  const usages: OnlinePriceClaudeUsage[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let modelosPesquisadosNaApi = 0;
  let httpRequests = 0;
  let resolvidosSemIa = 0;
  let fallbacksIa = 0;
  let urlsReutilizadas = 0;
  let urlsDescobertas = 0;
  let tavilySearchRequests = 0;
  let tavilyExtractRequests = 0;
  let tavilyCreditsEstimated = 0;
  let ofertasDescobertas = 0;
  let ofertasValidas = 0;
  let falhasPesquisa = 0;

  for (const produto of produtos) {
    const unresolvedForAi: OnlineStoreTarget[] = [];
    const directFallbackByStore = new Map<string, OnlinePriceResult>();
    const directCandidates: Array<{
      loja: OnlineStoreTarget;
      planilha: { planilhaAvista?: number | null; planilhaPrazo12x?: number | null };
      cached: CacheEntry | undefined;
    }> = [];

    for (const loja of lojas) {
      const planilha = getPlanilhaPoint(produto, loja);
      const key = cacheKey(produto.modelo, loja);
      const cached = cache.entries[key];

      if (cacheEnabled && isFreshCache(cached) && isCachedResultCommerciallyReliable(cached.result)) {
        cacheHits += 1;
        const cachedResult = aplicarValoresPlanilha({
          result: cached.result,
          loja,
          planilha,
          cacheHit: true,
        });

        // O V5 consegue enriquecer um cache parcial diretamente com Claude. Isso
        // evita gastar Tavily novamente só porque falta à vista ou 12x.
        if (
          aiEnabled &&
          aiFallbackBudgetRemaining > 0 &&
          shouldUseAiFallback(cachedResult)
        ) {
          directFallbackByStore.set(normalizar(loja.nome), cachedResult);
          unresolvedForAi.push(loja);
          aiFallbackBudgetRemaining -= 1;
        } else {
          allResults.push(cachedResult);
        }
        continue;
      }

      if (cacheEnabled && cached && isFreshCache(cached) && !isCachedResultCommerciallyReliable(cached.result)) {
        console.warn(
          `[Preços Online ${ENGINE_VERSION}] cache rejeitado por inconsistência comercial: ${produto.modelo}/${loja.nome}`,
        );
        delete cache.entries[key];
      }

      cacheMisses += 1;
      directCandidates.push({ loja, planilha, cached });
    }

    if (directEnabled && directCandidates.length > 0) {
      const directResults = await Promise.all(
        directCandidates.map(async ({ loja, planilha, cached }) => {
          const preferredUrl = cacheEnabled && isStaleUrlReusable(cached) ? cached.result.url : null;
          const direct = await pesquisarPrecoSemIa({
            modelo: produto.modelo,
            loja,
            preferredUrl,
          });
          return { loja, planilha, direct };
        }),
      );

      directResults.forEach(({ loja, planilha, direct }) => {
        httpRequests += direct.stats.httpRequests;
        tavilySearchRequests += direct.stats.tavilySearchRequests;
        tavilyExtractRequests += direct.stats.tavilyExtractRequests;
        tavilyCreditsEstimated += direct.stats.tavilyCreditsEstimated;
        ofertasDescobertas += direct.stats.offersDiscovered;
        ofertasValidas += direct.stats.offersValid;
        falhasPesquisa += direct.stats.searchFailures;
        if (direct.stats.reusedUrl) urlsReutilizadas += 1;
        if (direct.stats.discoveredUrl) urlsDescobertas += 1;

        const directResult = aplicarValoresPlanilha({
          result: direct.result,
          loja,
          planilha,
          cacheHit: false,
        });

        const needsAi =
          aiEnabled &&
          aiFallbackBudgetRemaining > 0 &&
          shouldUseAiFallback(directResult);

        if (needsAi) {
          directFallbackByStore.set(normalizar(loja.nome), directResult);
          unresolvedForAi.push(loja);
          aiFallbackBudgetRemaining -= 1;
          return;
        }

        allResults.push(directResult);
        if (directResult.disponibilidade !== 'erro') resolvidosSemIa += 1;
        if (cacheEnabled) cacheResult({ cache, modelo: produto.modelo, loja, result: directResult });
      });
    } else {
      directCandidates.forEach(({ loja }) => unresolvedForAi.push(loja));
    }

    if (unresolvedForAi.length === 0) continue;

    if (!aiEnabled) {
      // Com o motor V4, a pesquisa sem IA sempre retorna um estado explícito
      // (encontrado, indisponível, não encontrado confirmado ou erro técnico).
      // Este bloco só existe como proteção para um caminho inesperado.
      unresolvedForAi.forEach((loja) => {
        const fallback = directFallbackByStore.get(normalizar(loja.nome));
        if (fallback) {
          allResults.push(fallback);
          if (cacheEnabled) cacheResult({ cache, modelo: produto.modelo, loja, result: fallback });
        } else {
          allResults.push(
            criarResultadoErro({
              modelo: produto.modelo,
              loja,
              planilha: getPlanilhaPoint(produto, loja),
              mensagem: 'PESQUISA DIRETA DESATIVADA E FALLBACK DE IA DESATIVADO',
            }),
          );
        }
      });
      continue;
    }

    fallbacksIa += unresolvedForAi.length;

    try {
      modelosPesquisadosNaApi += 1;
      const maxSearchUses = Math.max(
        1,
        Math.min(getDefaultMaxSearchUsesPerModel(), Math.max(1, unresolvedForAi.length)),
      );
      const resultadosBasePorLoja: Record<string, OnlinePriceResult> = {};
      unresolvedForAi.forEach((loja) => {
        const base = directFallbackByStore.get(normalizar(loja.nome));
        if (base) resultadosBasePorLoja[normalizar(loja.nome)] = base;
      });

      const { results, usage } = await pesquisarModeloEmLojasClaude({
        modelo: produto.modelo,
        lojas: unresolvedForAi,
        valoresPlanilhaPorLoja: produto.valoresPlanilhaPorLoja,
        maxSearchUses,
        resultadosBasePorLoja,
      });

      usages.push(usage);

      const resultsByStore = new Map<string, OnlinePriceResult>();
      results.forEach((result) => resultsByStore.set(normalizar(result.loja), result));

      unresolvedForAi.forEach((loja) => {
        const found = resultsByStore.get(normalizar(loja.nome)) || null;
        const planilha = getPlanilhaPoint(produto, loja);
        const directFallback = directFallbackByStore.get(normalizar(loja.nome)) || null;
        const claudeResult = found
          ? aplicarValoresPlanilha({ result: found, loja, planilha, cacheHit: false })
          : null;

        const chosen = chooseAiOrDirectResult({ claudeResult, directFallback });
        const finalResult =
          chosen ||
          criarResultadoIndisponivel({ modelo: produto.modelo, loja, planilha });

        allResults.push(finalResult);
        if (cacheEnabled) cacheResult({ cache, modelo: produto.modelo, loja, result: finalResult });
      });
    } catch (error: any) {
      const mensagem = error?.message || 'Erro desconhecido ao pesquisar preços online.';
      if (isProviderFatalError(mensagem)) throw new Error(mensagem);

      unresolvedForAi.forEach((loja) => {
        const planilha = getPlanilhaPoint(produto, loja);
        const finalResult =
          directFallbackByStore.get(normalizar(loja.nome)) ||
          criarResultadoErro({
            modelo: produto.modelo,
            loja,
            planilha,
            mensagem: 'FALHA DE PESQUISA',
          });
        allResults.push(finalResult);
        if (cacheEnabled) cacheResult({ cache, modelo: produto.modelo, loja, result: finalResult });
      });
    }
  }

  if (cacheEnabled) saveCache(cache);

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
        orderedResults.push(
          criarResultadoErro({
            modelo: produto.modelo,
            loja,
            planilha: getPlanilhaPoint(produto, loja),
            mensagem: 'RESULTADO AUSENTE APÓS A EXECUÇÃO DO MOTOR DE PESQUISA',
          }),
        );
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
    httpRequests,
    resolvidosSemIa,
    fallbacksIa,
    urlsReutilizadas,
    urlsDescobertas,
    tavilySearchRequests,
    tavilyExtractRequests,
    tavilyCreditsEstimated,
    ofertasDescobertas,
    ofertasValidas,
    falhasPesquisa,
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
    results: orderedResults.slice(0, 5000),
  };

  adicionarHistorico(historyEntry);

  return {
    ok: true,
    engineVersion: ENGINE_VERSION,
    agent: 'precos_online',
    message: `Preços Online ${ENGINE_VERSION}: ${resumo.consultasExecutadas} combinações. Cache ${cacheHits}, sem IA ${resolvidosSemIa}, fallback IA ${fallbacksIa}.`,
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
