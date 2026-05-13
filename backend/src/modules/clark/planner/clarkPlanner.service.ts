import { GoogleGenAI } from '@google/genai';

import {
  ClarkPlan,
  ClarkPlannerResult,
} from './clarkPlanner.types';

import { montarPromptPlannerClark } from './clarkPlanner.prompt';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const genAI = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    })
  : null;

function extrairJsonSeguro(texto: string) {
  const raw = String(texto || '').trim();

  if (!raw) {
    throw new Error('Planner retornou vazio.');
  }

  const semFence = raw
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(semFence);
  } catch {
    const inicio = semFence.indexOf('{');
    const fim = semFence.lastIndexOf('}');

    if (inicio >= 0 && fim > inicio) {
      const recorte = semFence.slice(inicio, fim + 1);
      return JSON.parse(recorte);
    }

    throw new Error('Planner não retornou JSON válido.');
  }
}

function normalizarTexto(value: any) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarCor(cor: string) {
  const texto = normalizarTexto(cor);

  if (['BLACK', 'PRETO'].includes(texto)) return 'PRETO';
  if (['GRAPHITE', 'GRAFITE', 'CINZA'].includes(texto)) return 'GRAFITE';
  if (['BLUE', 'AZUL'].includes(texto)) return 'AZUL';
  if (['GREEN', 'VERDE'].includes(texto)) return 'VERDE';
  if (['WHITE', 'BRANCO'].includes(texto)) return 'BRANCO';
  if (['LILAS', 'LILÁS', 'VIOLETA', 'PURPLE'].includes(texto)) return 'VIOLETA';
  if (['CREAM', 'CREME', 'BEGE'].includes(texto)) return 'CREME';
  if (['SILVER', 'PRATA'].includes(texto)) return 'PRATA';
  if (['PINK', 'ROSA'].includes(texto)) return 'ROSA';

  return texto;
}

function pareceRankingEstoque(pergunta: string) {
  const texto = normalizarTexto(pergunta);

  const falaEstoque =
    texto.includes('ESTOQUE') ||
    texto.includes('MODELOS') ||
    texto.includes('PRODUTOS') ||
    texto.includes('CATEGORIA');

  const ranking =
    texto.includes('TOP') ||
    texto.includes('MAIORES') ||
    texto.includes('MELHORES') ||
    texto.includes('PIORES') ||
    texto.includes('RANKING');

  const temProdutoEspecifico =
    texto.includes('GALAXY S') ||
    texto.includes('GALAXY A') ||
    texto.includes('GALAXY M') ||
    texto.includes('GALAXY Z') ||
    texto.includes('IPHONE') ||
    texto.includes('SM-');

  return falaEstoque && ranking && !temProdutoEspecifico;
}

function inferirProdutoPorRegex(pergunta: string) {
  const texto = normalizarTexto(pergunta);

  const temBuscaEstoque =
    texto.includes('ONDE') ||
    texto.includes('LOJAS') ||
    texto.includes('ESTOQUE') ||
    texto.includes('POSSUEM') ||
    texto.includes('TEM') ||
    texto.includes('TÊM');

  const temProduto =
    texto.includes('GALAXY') ||
    texto.includes('SAMSUNG') ||
    texto.includes('IPHONE') ||
    texto.includes('MOTO') ||
    texto.includes('REDMI') ||
    texto.includes('POCO') ||
    texto.includes('SM-');

  if (!temBuscaEstoque || !temProduto) return null;

  const familyMatch =
    texto.match(/\bGALAXY\s+(S\d{2})\s+(ULTRA|PLUS|FE|PRO)?\b/) ||
    texto.match(/\bGALAXY\s+([AMF]\d{2})\b/) ||
    texto.match(/\bGALAXY\s+(Z\s?FLIP\s?\d|Z\s?FOLD\s?\d)\b/) ||
    texto.match(/\bIPHONE\s+(\d{1,2})\s?(PRO\sMAX|PRO|PLUS|MINI)?\b/);

  const storageMatch =
    texto.match(/\b(1TB|2TB)\b/) ||
    texto.match(/\b(64|128|256|512)\s?GB\b/);

  const colorMatch = texto.match(
    /\b(PRETO|BLACK|GRAFITE|GRAPHITE|AZUL|BLUE|VERDE|GREEN|BRANCO|WHITE|VIOLETA|LILAS|LILÁS|CREME|PRATA|SILVER|ROSA|PINK)\b/
  );

  let family: string | null = null;
  let model: string | null = null;
  let category: string | null = null;

  if (familyMatch) {
    if (texto.includes('IPHONE')) {
      model = `${familyMatch[1]}${
        familyMatch[2] ? ` ${familyMatch[2]}` : ''
      }`.replace(/\s+/g, ' ');

      family = `IPHONE ${model}`;
      category = 'SMARTPHONES';
    } else {
      model = `${familyMatch[1]}${
        familyMatch[2] ? ` ${familyMatch[2]}` : ''
      }`.replace(/\s+/g, ' ');

      family = `GALAXY ${model}`;
      category = 'SMARTPHONES';
    }
  }

  return {
    raw: pergunta,
    family,
    model,
    storage: storageMatch?.[0]?.replace(/\s+/g, '').toUpperCase() || null,
    color: colorMatch?.[0] ? normalizarCor(colorMatch[0]) : null,
    category,
  };
}

function criarPlanoRankingEstoque(pergunta: string): ClarkPlan {
  const texto = normalizarTexto(pergunta);

  const limiteMatch =
    texto.match(/\bTOP\s+(\d{1,3})\b/) ||
    texto.match(/\b(\d{1,3})\s+MAIORES\b/) ||
    texto.match(/\bLISTE\s+OS?\s+(\d{1,3})\b/);

  const limite = limiteMatch?.[1] ? Number(limiteMatch[1]) : 10;

  const categoria = texto.includes('SMARTPHONE')
    ? 'SMARTPHONES'
    : texto.includes('ACESSORIO')
      ? 'ACESSÓRIOS'
      : texto.includes('WEARABLE')
        ? 'WEARABLES'
        : texto.includes('TABLET')
          ? 'TABLETS'
          : null;

  return {
    intent: 'stock_ranking',
    subject: 'stock',
    mode: 'simple',
    confidence: 0.9,
    filters: {
      dateRange: null,
      storeName: null,
      sellerName: null,
      categoryName: categoria,
      product: null,
      limit: limite,
    },
    output: {
      groupBy: ['product', 'store'],
      metrics: ['stock_quantity'],
      needsStoresBreakdown: true,
      needsProductBreakdown: true,
      needsMonthlyGrowth: false,
      needsStrategicInsights: false,
    },
    userQuestion: pergunta,
    reasoningSummary:
      'Backend classificou como ranking de estoque por categoria/top/maiores.',
  };
}

function criarPlanoFallback(pergunta: string): ClarkPlan {
  if (pareceRankingEstoque(pergunta)) {
    return criarPlanoRankingEstoque(pergunta);
  }

  const produto = inferirProdutoPorRegex(pergunta);

  if (produto) {
    return {
      intent: 'stock_product_search',
      subject: 'stock',
      mode: 'simple',
      confidence: 0.82,
      filters: {
        dateRange: null,
        storeName: null,
        sellerName: null,
        categoryName: produto.category,
        product: produto,
        limit: 50,
      },
      output: {
        groupBy: ['product', 'store'],
        metrics: ['stock_quantity'],
        needsStoresBreakdown: true,
        needsProductBreakdown: true,
        needsMonthlyGrowth: false,
        needsStrategicInsights: false,
      },
      userQuestion: pergunta,
      reasoningSummary:
        'Fallback por regex: pergunta aparenta ser busca de produto específico em estoque.',
    };
  }

  const texto = normalizarTexto(pergunta);

  if (
    texto.includes('QUANTO VENDEMOS') ||
    texto.includes('VENDAS') ||
    texto.includes('FATURAMENTO')
  ) {
    return {
      intent: 'sales_summary',
      subject: 'sales',
      mode: 'simple',
      confidence: 0.65,
      filters: {
        dateRange: null,
        storeName: null,
        sellerName: null,
        categoryName: null,
        product: null,
        limit: 10,
      },
      output: {
        groupBy: [],
        metrics: ['revenue', 'quantity', 'average_ticket'],
        needsStoresBreakdown: false,
        needsProductBreakdown: false,
        needsMonthlyGrowth: false,
        needsStrategicInsights: false,
      },
      userQuestion: pergunta,
      reasoningSummary:
        'Fallback por regex: pergunta aparenta ser resumo de vendas.',
    };
  }

  return {
    intent: 'help',
    subject: 'help',
    mode: 'simple',
    confidence: 0.3,
    filters: {
      dateRange: null,
      storeName: null,
      sellerName: null,
      categoryName: null,
      product: null,
      limit: 10,
    },
    output: {
      groupBy: [],
      metrics: [],
      needsStoresBreakdown: false,
      needsProductBreakdown: false,
      needsMonthlyGrowth: false,
      needsStrategicInsights: false,
    },
    userQuestion: pergunta,
    reasoningSummary: 'Fallback: não consegui classificar a pergunta.',
  };
}

function validarPlanBruto(plan: any, pergunta: string): ClarkPlan {
  const fallback = criarPlanoFallback(pergunta);

  if (!plan || typeof plan !== 'object') {
    return fallback;
  }

  const safe: ClarkPlan = {
    intent: plan.intent || fallback.intent,
    subject: plan.subject || fallback.subject,
    mode: plan.mode || fallback.mode,
    confidence:
      typeof plan.confidence === 'number'
        ? Math.max(0, Math.min(1, plan.confidence))
        : fallback.confidence,
    filters: {
      dateRange: plan.filters?.dateRange ?? fallback.filters.dateRange,
      storeName: plan.filters?.storeName ?? null,
      sellerName: plan.filters?.sellerName ?? null,
      categoryName: plan.filters?.categoryName ?? fallback.filters.categoryName,
      product: plan.filters?.product ?? fallback.filters.product,
      limit:
        typeof plan.filters?.limit === 'number'
          ? plan.filters.limit
          : fallback.filters.limit,
    },
    output: {
      groupBy: Array.isArray(plan.output?.groupBy)
        ? plan.output.groupBy
        : fallback.output.groupBy,
      metrics: Array.isArray(plan.output?.metrics)
        ? plan.output.metrics
        : fallback.output.metrics,
      needsStoresBreakdown: Boolean(plan.output?.needsStoresBreakdown),
      needsProductBreakdown: Boolean(plan.output?.needsProductBreakdown),
      needsMonthlyGrowth: Boolean(plan.output?.needsMonthlyGrowth),
      needsStrategicInsights: Boolean(plan.output?.needsStrategicInsights),
    },
    userQuestion: pergunta,
    reasoningSummary:
      String(plan.reasoningSummary || fallback.reasoningSummary || '').slice(
        0,
        500
      ),
  };

  if (pareceRankingEstoque(pergunta)) {
    return criarPlanoRankingEstoque(pergunta);
  }

  const produtoFallback = inferirProdutoPorRegex(pergunta);

  if (
    produtoFallback &&
    safe.subject === 'stock' &&
    safe.intent !== 'stock_product_search'
  ) {
    safe.intent = 'stock_product_search';
    safe.filters.product = {
      ...produtoFallback,
      ...safe.filters.product,
      raw: safe.filters.product?.raw || produtoFallback.raw,
      family: safe.filters.product?.family || produtoFallback.family,
      model: safe.filters.product?.model || produtoFallback.model,
      storage: safe.filters.product?.storage || produtoFallback.storage,
      color: safe.filters.product?.color || produtoFallback.color,
      category: safe.filters.product?.category || produtoFallback.category,
    };
    safe.filters.categoryName = safe.filters.categoryName || 'SMARTPHONES';
    safe.output.needsStoresBreakdown = true;
    safe.output.needsProductBreakdown = true;
    safe.output.metrics = ['stock_quantity'];
    safe.output.groupBy = ['product', 'store'];
    safe.reasoningSummary =
      'Plano ajustado pelo backend: pergunta é busca de produto específico em estoque.';
  }

  return safe;
}

export async function gerarPlanoClark(
  pergunta: string
): Promise<ClarkPlannerResult> {
  const fallback = criarPlanoFallback(pergunta);

  if (pareceRankingEstoque(pergunta)) {
    return {
      ok: true,
      plan: fallback,
      rawText: '',
    };
  }

  if (!genAI) {
    return {
      ok: true,
      plan: fallback,
      rawText: '',
    };
  }

  try {
    const prompt = montarPromptPlannerClark(pergunta);

    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const rawText = response.text || '';
    const parsed = extrairJsonSeguro(rawText);
    const plan = validarPlanBruto(parsed, pergunta);

    return {
      ok: true,
      plan,
      rawText,
    };
  } catch (error: any) {
    console.error('❌ Erro no Planner da Clark:', error);

    return {
      ok: true,
      plan: fallback,
      rawText: '',
      error: error?.message || 'Erro ao gerar plano.',
    };
  }
}