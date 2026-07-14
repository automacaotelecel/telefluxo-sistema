import path from 'path';
import { gerarRelatorioOnlinePricesExcel, parseOnlinePricesWorkbook } from './onlinePricesExcel.service';
import { pesquisarModeloEmLojasClaude } from './onlinePricesClaude.service';
import {
  OnlinePriceAnalysisSummary,
  OnlinePriceAnalyzeOptions,
  OnlinePriceAnalyzeResponse,
  OnlinePriceClaudeUsage,
  OnlinePriceResult,
} from './onlinePrices.types';

const ROOT_DIR = process.cwd();

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultMaxModels(): number {
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_MODELS', 0); // 0 = todos
}

function getDefaultMaxStores(): number {
  return envNumber('ONLINE_PRICES_DEFAULT_MAX_STORES', 0); // 0 = todas
}

function getDefaultMaxSearchUsesPerModel(): number {
  return envNumber('ONLINE_PRICES_MAX_WEB_SEARCH_PER_MODEL', 8);
}

function getWebSearchUnitPriceUsd(): number {
  return envNumber('CLAUDE_WEB_SEARCH_UNIT_PRICE_USD', 0.01);
}

function getReportDir(): string {
  return process.env.ONLINE_PRICES_REPORT_DIR || path.join(ROOT_DIR, 'uploads', 'online-prices');
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

function criarResultadoErro(params: {
  modelo: string;
  lojaNome: string;
  dominios: string[];
  mensagem: string;
}): OnlinePriceResult {
  return {
    modelo: params.modelo,
    loja: params.lojaNome,
    dominios: params.dominios,
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
    observacao: params.mensagem,
    pesquisadoEm: new Date().toISOString(),
  };
}

export async function analisarPrecosOnline(params: OnlinePriceAnalyzeOptions): Promise<OnlinePriceAnalyzeResponse> {
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

  const allResults: OnlinePriceResult[] = [];
  const usages: OnlinePriceClaudeUsage[] = [];

  for (const produto of produtos) {
    try {
      const { results, usage } = await pesquisarModeloEmLojasClaude({
        modelo: produto.modelo,
        lojas,
        valoresPlanilhaPorLoja: produto.valoresPlanilhaPorLoja,
        maxSearchUses: Math.max(1, Math.min(getDefaultMaxSearchUsesPerModel(), lojas.length * 2)),
      });

      allResults.push(...results);
      usages.push(usage);
    } catch (error: any) {
      const mensagem = error?.message || 'Erro desconhecido ao pesquisar preços online.';

      // Erros de configuração/API do provedor afetam todos os modelos e lojas.
      // Nesse caso, parar a execução evita gerar uma planilha inteira marcada como ERRO.
      if (isProviderFatalError(mensagem)) {
        throw new Error(mensagem);
      }

      lojas.forEach((loja) => {
        allResults.push(criarResultadoErro({
          modelo: produto.modelo,
          lojaNome: loja.nome,
          dominios: loja.dominios,
          mensagem,
        }));
      });
    }
  }

  const usage = sumUsage(usages);
  const resumo = montarResumo({
    produtosDetectados: input.produtos.length,
    lojasDetectadas: input.lojas.length,
    consultasPlanejadas,
    results: allResults,
    usage,
  });

  const report = await gerarRelatorioOnlinePricesExcel({
    input: {
      ...input,
      produtos,
      lojas,
    },
    results: allResults,
    resumo,
    outputDir: getReportDir(),
  });

  return {
    ok: true,
    agent: 'precos_online',
    message: `Pesquisa concluída: ${resumo.consultasExecutadas} consultas em ${produtos.length} modelos e ${lojas.length} lojas.`,
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
    results: allResults.slice(0, 300),
    reportFileName: report.fileName,
    downloadUrl: `/api/online-prices/report/${encodeURIComponent(report.fileName)}`,
    generatedAt: new Date().toISOString(),
  };
}

export function getOnlinePricesReportPath(fileName: string): string {
  const safeName = path.basename(String(fileName || '').trim());
  return path.join(getReportDir(), safeName);
}
