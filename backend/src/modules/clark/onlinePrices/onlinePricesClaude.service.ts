import Anthropic from '@anthropic-ai/sdk';
import { OnlinePriceClaudeUsage, OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_ONLINE_PRICES_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const WEB_SEARCH_TOOL_VERSION = process.env.CLAUDE_WEB_SEARCH_TOOL || 'web_search_20250305';
const DEFAULT_LOCATION_COUNTRY = process.env.CLAUDE_SEARCH_COUNTRY || 'BR';

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '')
    .replace(/R\$/gi, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeText(value: unknown, max = 1000): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function extractText(response: any): string {
  const content = Array.isArray(response?.content) ? response.content : [];
  return content
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

function extractJsonArray(text: string): any[] {
  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.resultados)) return parsed.resultados;
  } catch (_) {
    // fallback abaixo
  }

  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const sliced = clean.slice(start, end + 1);
    const parsed = JSON.parse(sliced);
    if (Array.isArray(parsed)) return parsed;
  }

  return [];
}

function usageFromResponse(response: any): OnlinePriceClaudeUsage {
  const usage = response?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    webSearchRequests: Number(usage?.server_tool_use?.web_search_requests || 0),
  };
}

function calcularDiferenca(online: number | null, planilha: number | null): {
  diff: number | null;
  diffPct: number | null;
} {
  if (typeof online !== 'number' || typeof planilha !== 'number' || !Number.isFinite(planilha) || planilha === 0) {
    return { diff: null, diffPct: null };
  }

  const diff = online - planilha;
  return { diff, diffPct: diff / planilha };
}

function normalizarDisponibilidade(value: unknown): OnlinePriceResult['disponibilidade'] {
  const text = String(value || '').toLowerCase();
  if (text.includes('indis')) return 'indisponivel';
  if (text.includes('erro')) return 'erro';
  if (text.includes('nao') || text.includes('não')) return 'nao_encontrado';
  if (text.includes('encontr')) return 'encontrado';
  return 'nao_encontrado';
}

export async function pesquisarModeloEmLojasClaude(params: {
  modelo: string;
  lojas: OnlineStoreTarget[];
  valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }>;
  maxSearchUses: number;
}): Promise<{ results: OnlinePriceResult[]; usage: OnlinePriceClaudeUsage; rawText: string }> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY não configurada no backend. Configure no backend/.env para usar o agente Preços Online.');
  }

  const lojasComDominio = params.lojas.map((loja) => ({
    nome: loja.nome,
    dominios: loja.dominios,
  }));

  const allowedDomains = Array.from(
    new Set(params.lojas.flatMap((loja) => loja.dominios).filter((domain) => !!domain)),
  );

  const prompt = `
Você é o agente "Preços Online" da Clark IA para auditoria comercial.
Pesquise preços atuais no Brasil para o modelo: "${params.modelo}".

Lojas/domínios que devem ser pesquisados:
${lojasComDominio.map((loja) => `- ${loja.nome}: ${loja.dominios.join(', ') || 'sem domínio cadastrado'}`).join('\n')}

Regras críticas:
- Pesquise somente resultados das lojas listadas/domínios permitidos.
- Para cada loja, encontre preço à vista e preço a prazo/parcelado, principalmente 12x quando existir.
- Se não encontrar o produto, responda como "nao_encontrado".
- Se a página indicar indisponibilidade, responda como "indisponivel".
- Não invente preço. Se não houver preço visível, deixe null.
- Retorne somente JSON válido, sem markdown, no formato de array.

Formato obrigatório:
[
  {
    "loja": "MAGALU",
    "disponibilidade": "encontrado | indisponivel | nao_encontrado",
    "preco_avista": 1234.56,
    "preco_prazo_12x": 1399.90,
    "parcelas_texto": "12x de R$ 116,66",
    "titulo": "Título do produto encontrado",
    "url": "https://...",
    "fonte": "nome do site/domínio",
    "confianca": 0,
    "observacao": "resumo curto do que foi encontrado"
  }
]

Responda um item para CADA loja listada, mesmo quando não encontrar.
`;

  const tool: any = {
    type: WEB_SEARCH_TOOL_VERSION,
    name: 'web_search',
    max_uses: Math.max(1, Math.min(params.maxSearchUses, 20)),
    user_location: {
      type: 'approximate',
      country: DEFAULT_LOCATION_COUNTRY,
      timezone: 'America/Sao_Paulo',
    },
  };

  if (allowedDomains.length > 0) {
    tool.allowed_domains = allowedDomains;
  }

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3500,
    temperature: 0,
    system:
      'Você é um agente de pesquisa de preços online. Sua tarefa é pesquisar preços atuais, citar URLs dentro do JSON e nunca inventar valores. Retorne apenas JSON válido.',
    messages: [{ role: 'user', content: prompt }],
    tools: [tool],
  } as any);

  const rawText = extractText(response);
  const parsed = extractJsonArray(rawText);
  const usage = usageFromResponse(response);
  const pesquisadoEm = new Date().toISOString();

  const byStore = new Map<string, any>();
  parsed.forEach((item) => {
    const loja = sanitizeText(item?.loja || item?.store || item?.site, 200);
    if (loja) byStore.set(loja.toUpperCase(), item);
  });

  const results: OnlinePriceResult[] = params.lojas.map((loja) => {
    const found = byStore.get(loja.nome.toUpperCase()) ||
      parsed.find((item) => String(item?.loja || '').toUpperCase().includes(loja.nome.toUpperCase())) ||
      null;

    const precoAvistaOnline = toNumber(found?.preco_avista ?? found?.precoAvista ?? null);
    const precoPrazo12xOnline = toNumber(found?.preco_prazo_12x ?? found?.precoPrazo12x ?? null);
    const planilha = params.valoresPlanilhaPorLoja[loja.nomeNormalizado] || {};
    const precoAvistaPlanilha = toNumber(planilha.planilhaAvista ?? null);
    const precoPrazo12xPlanilha = toNumber(planilha.planilhaPrazo12x ?? null);
    const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
    const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);

    return {
      modelo: params.modelo,
      loja: loja.nome,
      dominios: loja.dominios,
      disponibilidade: normalizarDisponibilidade(found?.disponibilidade),
      precoAvistaOnline,
      precoPrazo12xOnline,
      parcelasTexto: sanitizeText(found?.parcelas_texto ?? found?.parcelasTexto, 300),
      precoAvistaPlanilha,
      precoPrazo12xPlanilha,
      diferencaAvista: diffAvista.diff,
      diferencaAvistaPercentual: diffAvista.diffPct,
      diferencaPrazo12x: diffPrazo.diff,
      diferencaPrazo12xPercentual: diffPrazo.diffPct,
      titulo: sanitizeText(found?.titulo ?? found?.title, 500),
      url: sanitizeText(found?.url, 1500),
      fonte: sanitizeText(found?.fonte ?? found?.source, 300),
      confianca: Math.max(0, Math.min(100, Number(found?.confianca || 0))),
      observacao: sanitizeText(found?.observacao ?? found?.notes, 1000),
      pesquisadoEm,
    };
  });

  return { results, usage, rawText };
}
