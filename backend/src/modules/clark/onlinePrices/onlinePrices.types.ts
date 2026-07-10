export type OnlinePriceAvailability =
  | 'encontrado'
  | 'indisponivel'
  | 'nao_encontrado'
  | 'erro';

export type OnlinePricePoint = {
  cashColIndex?: number;
  termColIndex?: number;
  planilhaAvista?: number | null;
  planilhaPrazo12x?: number | null;
};

export type OnlineStoreTarget = {
  nome: string;
  nomeNormalizado: string;
  dominios: string[];
  cashColIndex?: number;
  termColIndex?: number;
};

export type OnlineInputProduct = {
  modelo: string;
  rowIndex: number;
  valoresPlanilhaPorLoja: Record<string, OnlinePricePoint>;
};

export type OnlineInputWorkbook = {
  sheetName: string;
  produtos: OnlineInputProduct[];
  lojas: OnlineStoreTarget[];
  originalName: string;
};

export type OnlinePriceResult = {
  modelo: string;
  loja: string;
  dominios: string[];
  disponibilidade: OnlinePriceAvailability;
  precoAvistaOnline: number | null;
  precoPrazo12xOnline: number | null;
  parcelasTexto: string | null;
  precoAvistaPlanilha: number | null;
  precoPrazo12xPlanilha: number | null;
  diferencaAvista: number | null;
  diferencaAvistaPercentual: number | null;
  diferencaPrazo12x: number | null;
  diferencaPrazo12xPercentual: number | null;
  titulo: string | null;
  url: string | null;
  fonte: string | null;
  confianca: number;
  observacao: string | null;
  pesquisadoEm: string;
};

export type OnlinePriceClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
};

export type OnlinePriceAnalysisSummary = {
  produtosDetectados: number;
  lojasDetectadas: number;
  consultasPlanejadas: number;
  consultasExecutadas: number;
  encontrados: number;
  indisponiveis: number;
  naoEncontrados: number;
  erros: number;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  custoEstimadoWebSearchUsd: number;
};

export type OnlinePriceAnalyzeOptions = {
  userId: string;
  fileBuffer: Buffer;
  originalName: string;
  maxModels?: number | null;
  maxStores?: number | null;
  forceFullRun?: boolean;
};

export type OnlinePriceAnalyzeResponse = {
  ok: boolean;
  agent: 'precos_online';
  message: string;
  planilha: {
    nomeArquivo: string;
    aba: string;
    produtosDetectados: number;
    lojasDetectadas: number;
    produtosProcessados: number;
    lojasProcessadas: number;
    lojas: string[];
  };
  resumo: OnlinePriceAnalysisSummary;
  results: OnlinePriceResult[];
  reportFileName: string;
  downloadUrl: string;
  generatedAt: string;
};
