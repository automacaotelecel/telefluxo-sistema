import { ClarkHistoricoMensagem, ClarkModo } from '../clark.types';

export type ClarkToolName =
  | 'resolver_produto'
  | 'consultar_estoque_produto'
  | 'consultar_ranking_estoque'
  | 'consultar_vendas_resumo'
  | 'consultar_vendas_por_loja'
  | 'consultar_vendas_por_vendedor'
  | 'consultar_vendas_por_categoria'
  | 'consultar_crescimento_mensal'
  | 'consultar_relatorio_vendas'
  | 'consultar_seguros_por_vendedor'
  | 'consultar_seguros_por_loja'
  | 'executar_sql_analitico'
  | 'gerar_relatorio_executivo'
  | 'responder_ajuda';

export type ClarkToolCall = {
  tool: ClarkToolName;
  reason: string;
  args: Record<string, any>;
};

export type ClarkAgentTaskType =
  | 'stock_product_search'
  | 'stock_ranking'
  | 'sales_summary'
  | 'sales_by_store'
  | 'sales_by_seller'
  | 'sales_by_category'
  | 'sales_report'
  | 'sales_growth'
  | 'insurance_by_seller'
  | 'insurance_by_store'
  // aliases usados pelo service atual/patches anteriores
  | 'sales_store_ranking'
  | 'sales_seller_ranking'
  | 'sales_category_ranking'
  | 'insurance_seller_ranking'
  | 'insurance_store_ranking'
  | 'sql_analytics'
  | 'help';

export type ClarkAgentPlan = {
  understoodQuestion: string;
  taskType: ClarkAgentTaskType;
  mode: ClarkModo;
  confidence: number;
  entities: {
    product?: {
      raw?: string | null;
      family?: string | null;
      model?: string | null;
      storage?: string | null;
      color?: string | null;
      category?: string | null;
    } | null;
    store?: string | null;
    seller?: string | null;
    category?: string | null;
    period?: {
      startDate?: string | null;
      endDate?: string | null;
      label?: string | null;
      inicio?: string | null;
      fim?: string | null;
      descricao?: string | null;
    } | null;
    limit?: number;
  };
  toolCalls: ClarkToolCall[];
  validationRules: string[];
  answerStyle: {
    shouldExplainUncertainty: boolean;
    shouldIncludeTables: boolean;
    shouldIncludeInsights: boolean;
    shouldIncludeSuggestions: boolean;
  };
};

export type ClarkToolResult = {
  tool: ClarkToolName;
  ok: boolean;
  args: Record<string, any>;
  result: any;
  error?: string;
};

export type ClarkVerificationResult = {
  ok: boolean;
  verdict:
    | 'answered'
    | 'missing_data'
    | 'wrong_product'
    | 'wrong_intent'
    | 'needs_retry'
    | 'tool_error';
  problems: string[];
  retrySuggestion?: string;
};

export type ClarkAgentTrace = {
  question: string;
  plan: ClarkAgentPlan | null;
  toolResults: ClarkToolResult[];
  verifier: ClarkVerificationResult | null;
  finalAnswer: string;
};

export type ClarkAgentInput = {
  userId: string;
  pergunta: string;
  historico?: ClarkHistoricoMensagem[];
};

export type ClarkAgentOutput = {
  ok: boolean;
  clark: string;
  trace: ClarkAgentTrace;
};
