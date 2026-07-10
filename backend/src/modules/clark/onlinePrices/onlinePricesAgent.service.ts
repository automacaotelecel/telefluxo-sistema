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

const DEFAULT_MAX_MODELS = Number(process.env.ONLINE_PRICES_DEFAULT_MAX_MODELS || 0); // 0 = todos
const DEFAULT_MAX_STORES = Number(process.env.ONLINE_PRICES_DEFAULT_MAX_STORES || 0); // 0 = todas
const DEFAULT_MAX_SEARCH_USES_PER_MODEL = Number(process.env.ONLINE_PRICES_MAX_WEB_SEARCH_PER_MODEL || 8);
const WEB_SEARCH_UNIT_PRICE_USD = Number(process.env.CLAUDE_WEB_SEARCH_UNIT_PRICE_USD || 0.01);
const ROOT_DIR = process.cwd();
const REPORT_DIR = process.env.ONLINE_PRICES_REPORT_DIR || path.join(ROOT_DIR, 'uploads', 'online-prices');

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
    custoEstimadoWebSearchUsd: Number((params.usage.webSearchRequests * WEB_SEARCH_UNIT_PRICE_USD).toFixed(4)),
  };
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
  const maxModels = requestedMaxModels ?? (DEFAULT_MAX_MODELS > 0 ? DEFAULT_MAX_MODELS : input.produtos.length);
  const maxStores = requestedMaxStores ?? (DEFAULT_MAX_STORES > 0 ? DEFAULT_MAX_STORES : input.lojas.length);

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
        maxSearchUses: Math.max(1, Math.min(DEFAULT_MAX_SEARCH_USES_PER_MODEL, lojas.length * 2)),
      });

      allResults.push(...results);
      usages.push(usage);
    } catch (error: any) {
      const mensagem = error?.message || 'Erro desconhecido ao pesquisar preços online.';
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
    outputDir: REPORT_DIR,
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
  return path.join(REPORT_DIR, safeName);
}
