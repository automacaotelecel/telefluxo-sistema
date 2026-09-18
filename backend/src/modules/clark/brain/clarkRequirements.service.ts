import { ClarkFiltros } from '../clark.types';
import {
  extractColor,
  extractStorage,
  getBaseModelFamily,
  normalizeProductText,
} from '../../productDictionary/productDictionary.utils';

export type ClarkRequestedMetric =
  | 'sales_revenue'
  | 'sales_quantity'
  | 'average_ticket'
  | 'stock_quantity'
  | 'coverage'
  | 'insurance'
  | 'growth';

export type ClarkRequestedProduct = {
  raw: string;
  family: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  category: string | null;
};

export type ClarkQuestionRequirements = {
  products: ClarkRequestedProduct[];
  metrics: ClarkRequestedMetric[];
  groupBy: Array<'product' | 'store' | 'seller' | 'category' | 'month' | 'day'>;
  wantsSales: boolean;
  wantsStock: boolean;
  wantsInsurance: boolean;
  wantsComparison: boolean;
  wantsReport: boolean;
  wantsNavigation: boolean;
  navigationTarget: string | null;
  salesOnly: boolean;
  stockOnly: boolean;
  explicitProductCount: number;
  store: string | null;
  category: string | null;
};

function normalize(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const PRODUCT_PATTERN = /\b(?:GALAXY\s+)?(?:S\d{2}(?:\s*(?:ULTRA|PLUS|FE))?|A\d{2}|M\d{2}|Z\s*(?:FLIP|FOLD)\s*\d*|TAB\s*S\d+(?:\s*(?:ULTRA|PLUS|FE))?)(?:\s+5G)?(?:\s+(?:64|128|256|512)\s*GB|\s+[12]\s*TB)?(?:\s+(?:PRETO|BLACK|GRAFITE|GRAPHITE|CINZA|AZUL|BLUE|VERDE|GREEN|BRANCO|WHITE|VIOLETA|PURPLE|LILAS|LILÁS|CREME|PRATA|SILVER|ROSA|PINK))?\b/gi;
const REFERENCE_PATTERN = /\bSM-[A-Z0-9-]{4,}\b/gi;

function canonicalProduct(raw: string): ClarkRequestedProduct {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeProductText(clean);
  const family = getBaseModelFamily(normalized) || getBaseModelFamily(clean) || null;
  const storage = extractStorage(normalized) || extractStorage(clean) || null;
  const color = extractColor(normalized) || extractColor(clean) || null;
  const model = family ? String(family).replace(/^GALAXY\s+/i, '').trim() : null;

  return {
    raw: clean,
    family,
    model,
    storage,
    color,
    // A categoria só deve ser aplicada quando o usuário pedir explicitamente.
    // Forçar SMARTPHONES aqui fazia a busca de vendas rejeitar linhas cuja
    // categoria vinha como APARELHOS, SMARTPHONE, CELULAR etc.
    category: null,
  };
}

function productKey(product: ClarkRequestedProduct) {
  return [product.family || normalize(product.raw), product.storage || '', product.color || ''].join('|');
}

/**
 * Extrai TODOS os produtos citados pelo usuário. O planner antigo guardava apenas
 * um produto e, por isso, perguntas como "S26, A17 e A37" perdiam dois itens.
 */
export function extrairProdutosSolicitadosClark(pergunta: string): ClarkRequestedProduct[] {
  const text = String(pergunta || '');
  const matches = [
    ...(text.match(PRODUCT_PATTERN) || []),
    ...(text.match(REFERENCE_PATTERN) || []),
  ];

  const result: ClarkRequestedProduct[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const product = canonicalProduct(raw);
    const key = productKey(product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(product);
  }

  return result;
}

function detectNavigationTarget(question: string) {
  const text = normalize(question);
  if (!/(ME LEVE|ABRA|ABRIR|IR PARA|VA PARA|VÁ PARA|NAVEG)/.test(text)) return null;

  const targets: Array<[RegExp, string]> = [
    [/PONTO DE PEDIDO|ESTOQUE X VENDAS/, 'estoque_vendas'],
    [/PREVISAO ESTOQUE|PREVISÃO ESTOQUE|VISAO DETALHADA|VISÃO DETALHADA/, 'estoque_detalhado'],
    [/ALERTAS?/, 'alertas_inteligentes'],
    [/ESTOQUE INTELIGENTE/, 'estoque_inteligente'],
    [/STOCKOUT|RUPTURA/, 'stockout'],
    [/CONTROLE DE ESTOQUE|ESTOQUE$/, 'stock'],
    [/VENDAS? MENSAL|CONTROLE DE VENDAS|VENDAS$/, 'sales_dash'],
    [/VENDAS? ANUAIS?/, 'comparativo'],
    [/COMPARATIVO|MONTAR COMPARATIVO/, 'comparativos_pdf'],
    [/AGENDA/, 'agenda'],
    [/SOLICITACOES|SOLICITAÇÕES/, 'solicitacoes'],
    [/RH|RECURSOS HUMANOS/, 'rh'],
    [/INICIO|INÍCIO|HOME/, 'home'],
  ];

  for (const [pattern, view] of targets) {
    if (pattern.test(text)) return view;
  }

  return null;
}

export function extrairRequisitosClark(params: {
  perguntaOriginal: string;
  perguntaExpandida?: string;
  filtros?: ClarkFiltros;
}): ClarkQuestionRequirements {
  const original = String(params.perguntaOriginal || '').trim();
  const expanded = String(params.perguntaExpandida || '').trim();
  const text = normalize(original);

  // Sempre prioriza os produtos explicitamente escritos na pergunta atual.
  // Contexto/memória só entra quando a pergunta atual não nomeia nenhum.
  let products = extrairProdutosSolicitadosClark(original);
  if (!products.length && expanded && expanded !== original) {
    products = extrairProdutosSolicitadosClark(expanded);
  }

  const wantsSales = /\b(VENDA|VENDAS|VENDIDO|VENDIDOS|VENDEMOS|FATURAMENTO|FATURAMOS|RECEITA|SAIDA|SAÍDA)\b/.test(text);
  const wantsStock = /\b(ESTOQUE|SALDO|DISPONIVEL|DISPONÍVEL|PECAS EM ESTOQUE|PEÇAS EM ESTOQUE|COBERTURA|RUPTURA|STOCKOUT|EXCESSO|REDISTRIBUIR|REMANEJAR)\b/.test(text);
  const wantsInsurance = /\b(SEGURO|SEGUROS|PREMIO|PRÊMIO)\b/.test(text);
  const wantsComparison = /\b(COMPAR|COMPARE|COMPARAR|VERSUS|\bVS\b|DIFERENCA|DIFERENÇA)\b/.test(text);
  const wantsReport = /\b(RELATORIO|RELATÓRIO|EXECUTIVO|ANALISE COMPLETA|ANÁLISE COMPLETA)\b/.test(text);

  const metrics: ClarkRequestedMetric[] = [];
  if (wantsSales) {
    if (/\b(VALOR|FATURAMENTO|RECEITA|R\$)\b/.test(text)) metrics.push('sales_revenue');
    if (/\b(PECA|PECAS|PEÇA|PEÇAS|QTD|QUANTIDADE|UNIDADES?)\b/.test(text)) metrics.push('sales_quantity');
    if (/TICKET/.test(text)) metrics.push('average_ticket');
    if (!metrics.some((m) => m.startsWith('sales_'))) {
      // "vendas do S26" normalmente exige valor e quantidade para ser útil.
      metrics.push('sales_revenue', 'sales_quantity');
    }
  }
  if (wantsStock) metrics.push('stock_quantity');
  if (/COBERTURA/.test(text)) metrics.push('coverage');
  if (wantsInsurance) metrics.push('insurance');
  if (/CRESC|EVOLU|VARIACAO|VARIAÇÃO/.test(text)) metrics.push('growth');

  const groupBy: ClarkQuestionRequirements['groupBy'] = [];
  if (products.length) groupBy.push('product');
  if (/\bLOJA|LOJAS\b/.test(text)) groupBy.push('store');
  if (/\bVENDEDOR|VENDEDORES\b/.test(text)) groupBy.push('seller');
  if (/\bCATEGORIA|CATEGORIAS|FAMILIA|FAMÍLIA\b/.test(text)) groupBy.push('category');
  if (/\bMES A MES|MÊS A MÊS|MENSAL\b/.test(text)) groupBy.push('month');
  if (/\bPOR DIA|DIARIO|DIÁRIO\b/.test(text)) groupBy.push('day');

  const navigationTarget = detectNavigationTarget(original);

  return {
    products,
    metrics: Array.from(new Set(metrics)),
    groupBy: Array.from(new Set(groupBy)),
    wantsSales,
    wantsStock,
    wantsInsurance,
    wantsComparison,
    wantsReport,
    wantsNavigation: Boolean(navigationTarget),
    navigationTarget,
    salesOnly: wantsSales && !wantsStock && !wantsInsurance,
    stockOnly: wantsStock && !wantsSales && !wantsInsurance,
    explicitProductCount: extrairProdutosSolicitadosClark(original).length,
    store: params.filtros?.lojaCanonica || params.filtros?.lojaOriginal || null,
    category: params.filtros?.categoriaCanonica || params.filtros?.categoriaOriginal || null,
  };
}
