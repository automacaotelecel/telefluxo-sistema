import Anthropic from '@anthropic-ai/sdk';
import { OnlinePriceClaudeUsage, OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';

const DEFAULT_CLAUDE_ONLINE_PRICES_MODEL = 'claude-sonnet-5';
const DEFAULT_WEB_SEARCH_TOOL_VERSION = 'web_search_20260318';
const DEFAULT_LOCATION_COUNTRY = process.env.CLAUDE_SEARCH_COUNTRY || 'BR';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey = '';

function normalizeClaudeModel(rawModel: string | undefined | null): string {
  const model = String(rawModel || '').trim();

  if (!model || model === 'claude-sonnet-4-6') {
    return DEFAULT_CLAUDE_ONLINE_PRICES_MODEL;
  }

  return model;
}

function getClaudeModel(): string {
  return normalizeClaudeModel(process.env.CLAUDE_ONLINE_PRICES_MODEL || process.env.CLAUDE_MODEL);
}

function getWebSearchToolVersion(): string {
  const toolVersion = String(process.env.CLAUDE_WEB_SEARCH_TOOL || DEFAULT_WEB_SEARCH_TOOL_VERSION).trim();

  if (!toolVersion || toolVersion === 'web_search_20250305') {
    return DEFAULT_WEB_SEARCH_TOOL_VERSION;
  }

  return toolVersion;
}

function getAnthropicClient(): Anthropic {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada no backend. Configure a chave no ambiente do backend e reinicie o servidor.');
  }

  if (!anthropicClient || anthropicClientKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey });
    anthropicClientKey = apiKey;
  }

  return anthropicClient;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;

  const text = String(value)
    .replace(/R\$/gi, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .trim();

  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeText(value: unknown, max = 240): string | null {
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
    if (Array.isArray(parsed?.results)) return parsed.results;
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
  if (text.includes('erro')) return 'erro';
  if (text.includes('encontr') && !text.includes('nao') && !text.includes('não')) return 'encontrado';
  return 'indisponivel';
}

function normalizeDomain(domain: string): string | null {
  const normalized = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');

  const clean = (normalized.split('/')[0] || '').trim();
  return clean && clean.includes('.') ? clean : null;
}

function getAnthropicMessage(error: any): string {
  return String(
    error?.error?.message ||
      error?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      'Erro desconhecido na API da Anthropic.',
  );
}

function buildAnthropicFriendlyError(error: any, model: string): Error {
  const status = error?.status || error?.response?.status || error?.statusCode || '';
  const message = getAnthropicMessage(error);
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('deprecated') || lower.includes('retired') || lower.includes('model')) {
    hints.push(`Modelo configurado: ${model}. Use CLAUDE_ONLINE_PRICES_MODEL=claude-sonnet-5 no backend.`);
  }

  if (lower.includes('temperature') || lower.includes('top_p') || lower.includes('top_k') || lower.includes('sampling')) {
    hints.push('A chamada de Preços Online não envia parâmetros de amostragem. Reinicie o backend para garantir que o arquivo novo carregou.');
  }

  if (lower.includes('web search') || lower.includes('web_search')) {
    hints.push('Verifique se o web search está habilitado na conta Anthropic. Para Sonnet 5, use CLAUDE_WEB_SEARCH_TOOL=web_search_20260318 ou remova essa variável para usar o padrão corrigido.');
  }

  if (lower.includes('country') || lower.includes('user_location')) {
    hints.push('Use CLAUDE_SEARCH_COUNTRY=BR, com código ISO de 2 letras.');
  }

  const prefix = status ? `Claude API ${status}: ` : 'Claude API: ';
  return new Error(`${prefix}${message}${hints.length ? ` | ${hints.join(' ')}` : ''}`);
}

function normalizeStoreName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export async function pesquisarModeloEmLojasClaude(params: {
  modelo: string;
  lojas: OnlineStoreTarget[];
  valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }>;
  maxSearchUses: number;
}): Promise<{ results: OnlinePriceResult[]; usage: OnlinePriceClaudeUsage; rawText: string }> {
  const anthropic = getAnthropicClient();
  const claudeModel = getClaudeModel();

  const lojasComDominio = params.lojas.map((loja) => ({
    nome: loja.nome,
    dominios: loja.dominios,
  }));

  const allowedDomains = Array.from(
    new Set(
      params.lojas
        .flatMap((loja) => loja.dominios)
        .map((domain) => normalizeDomain(domain))
        .filter((domain): domain is string => !!domain),
    ),
  );

  const prompt = `
Você é o agente "Preços Online" da Clark IA para auditoria comercial.
Pesquise preços atuais no Brasil para UM modelo: "${params.modelo}".

Lojas obrigatórias/domínios permitidos:
${lojasComDominio.map((loja) => `- ${loja.nome}: ${loja.dominios.join(', ') || 'sem domínio cadastrado'}`).join('\n')}

Regras de custo e resposta:
- Faça a menor quantidade possível de buscas.
- Responda TODAS as lojas listadas.
- Não inclua fonte, URL, título, observação longa, markdown ou texto fora do JSON.
- Se não houver preço real visível para a loja, use disponibilidade "indisponivel" e preços null.
- Nunca invente preço. Nunca use 0 como preço.
- Retorne JSON válido e curto, em array.

Formato obrigatório:
[
  {"loja":"MAGALU","disponibilidade":"encontrado","preco_avista":1234.56,"preco_prazo_12x":1399.90,"parcelas_texto":"12x de R$ 116,66"},
  {"loja":"AMAZON","disponibilidade":"indisponivel","preco_avista":null,"preco_prazo_12x":null,"parcelas_texto":null}
]
`;

  const maxUses = Math.max(1, Math.min(Math.floor(params.maxSearchUses || 1), 20));
  const tool: any = {
    type: getWebSearchToolVersion(),
    name: 'web_search',
    max_uses: maxUses,
    allowed_callers: ['direct'],
    user_location: {
      type: 'approximate',
      country: DEFAULT_LOCATION_COUNTRY,
      timezone: 'America/Sao_Paulo',
    },
  };

  if (allowedDomains.length > 0) {
    tool.allowed_domains = allowedDomains;
  }

  let response: any;

  try {
    response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: 1000,
      system:
        'Você é um agente econômico de pesquisa de preços. Retorne somente JSON válido e curto. Nunca inclua fonte, URL, markdown, texto bruto ou justificativas.',
      messages: [{ role: 'user', content: prompt }],
      tools: [tool],
    } as any);
  } catch (error: any) {
    throw buildAnthropicFriendlyError(error, claudeModel);
  }

  const rawText = extractText(response);
  const parsed = extractJsonArray(rawText);
  const usage = usageFromResponse(response);
  const pesquisadoEm = new Date().toISOString();

  const byStore = new Map<string, any>();
  parsed.forEach((item) => {
    const loja = sanitizeText(item?.loja || item?.store || item?.site, 200);
    if (loja) byStore.set(normalizeStoreName(loja), item);
  });

  const results: OnlinePriceResult[] = params.lojas.map((loja) => {
    const lojaNormalizada = normalizeStoreName(loja.nome);
    const found = byStore.get(lojaNormalizada) ||
      parsed.find((item) => {
        const parsedStore = normalizeStoreName(item?.loja || item?.store || item?.site);
        return parsedStore.includes(lojaNormalizada) || lojaNormalizada.includes(parsedStore);
      }) ||
      null;

    const precoAvistaOnline = toNumber(found?.preco_avista ?? found?.precoAvista ?? null);
    const precoPrazo12xOnline = toNumber(found?.preco_prazo_12x ?? found?.precoPrazo12x ?? null);
    const planilha = params.valoresPlanilhaPorLoja[loja.nomeNormalizado] || {};
    const precoAvistaPlanilha = toNumber(planilha.planilhaAvista ?? null);
    const precoPrazo12xPlanilha = toNumber(planilha.planilhaPrazo12x ?? null);
    const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
    const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);

    const disponibilidadeBase = normalizarDisponibilidade(found?.disponibilidade);
    const disponibilidade = disponibilidadeBase === 'encontrado' && (precoAvistaOnline || precoPrazo12xOnline)
      ? 'encontrado'
      : disponibilidadeBase === 'erro'
        ? 'erro'
        : 'indisponivel';

    return {
      modelo: params.modelo,
      loja: loja.nome,
      dominios: loja.dominios,
      disponibilidade,
      precoAvistaOnline: disponibilidade === 'encontrado' ? precoAvistaOnline : null,
      precoPrazo12xOnline: disponibilidade === 'encontrado' ? precoPrazo12xOnline : null,
      parcelasTexto: disponibilidade === 'encontrado' ? sanitizeText(found?.parcelas_texto ?? found?.parcelasTexto, 120) : null,
      precoAvistaPlanilha,
      precoPrazo12xPlanilha,
      diferencaAvista: disponibilidade === 'encontrado' ? diffAvista.diff : null,
      diferencaAvistaPercentual: disponibilidade === 'encontrado' ? diffAvista.diffPct : null,
      diferencaPrazo12x: disponibilidade === 'encontrado' ? diffPrazo.diff : null,
      diferencaPrazo12xPercentual: disponibilidade === 'encontrado' ? diffPrazo.diffPct : null,
      titulo: null,
      url: null,
      fonte: null,
      confianca: disponibilidade === 'encontrado' ? Math.max(0, Math.min(100, Number(found?.confianca || 0))) : 0,
      observacao: disponibilidade === 'encontrado' ? null : 'INDISPONÍVEL',
      pesquisadoEm,
    };
  });

  return { results, usage, rawText };
}
