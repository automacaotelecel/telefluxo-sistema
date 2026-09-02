import Anthropic from '@anthropic-ai/sdk';
import { OnlinePriceClaudeUsage, OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';

const DEFAULT_CLAUDE_ONLINE_PRICES_MODEL = 'claude-sonnet-5';
const DEFAULT_WEB_SEARCH_TOOL_VERSION = 'web_search_20260318';
const DEFAULT_LOCATION_COUNTRY = process.env.CLAUDE_SEARCH_COUNTRY || 'BR';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey = '';

function normalizeClaudeModel(rawModel: string | undefined | null): string {
  const model = String(rawModel || '').trim();
  if (!model || model === 'claude-sonnet-4-6') return DEFAULT_CLAUDE_ONLINE_PRICES_MODEL;
  return model;
}

function getClaudeModel(): string {
  return normalizeClaudeModel(process.env.CLAUDE_ONLINE_PRICES_MODEL || process.env.CLAUDE_MODEL);
}

function getWebSearchToolVersion(): string {
  const toolVersion = String(process.env.CLAUDE_WEB_SEARCH_TOOL || DEFAULT_WEB_SEARCH_TOOL_VERSION).trim();
  if (!toolVersion || toolVersion === 'web_search_20250305') return DEFAULT_WEB_SEARCH_TOOL_VERSION;
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
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;

  const raw = String(value).trim();
  if (!raw) return null;

  let text = raw.replace(/R\$/gi, '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!text) return null;

  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    text = text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  } else {
    text = text.replace(/\.(?=\d{3}(\D|$))/g, '');
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
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
    if (Array.isArray(parsed?.r)) return parsed.r;
    if (Array.isArray(parsed?.resultados)) return parsed.resultados;
    if (Array.isArray(parsed?.results)) return parsed.results;
  } catch (_) {
    // Tenta extrair somente o array abaixo.
  }

  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
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

function calcularDiferenca(online: number | null, planilha: number | null): { diff: number | null; diffPct: number | null } {
  if (typeof online !== 'number' || typeof planilha !== 'number' || !Number.isFinite(planilha) || planilha === 0) {
    return { diff: null, diffPct: null };
  }

  const diff = online - planilha;
  return { diff, diffPct: diff / planilha };
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

function normalizeStoreName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeStatus(value: unknown): OnlinePriceResult['disponibilidade'] {
  const text = String(value ?? '').trim().toLowerCase();
  if (value === 1 || text === '1' || text === 'ok' || text === 'encontrado' || text === 'found') return 'encontrado';
  if (text.includes('erro')) return 'erro';
  return 'indisponivel';
}

function safeUrl(value: unknown, loja: OnlineStoreTarget): string | null {
  const raw = sanitizeText(value, 800);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const allowed = loja.dominios
      .map((domain) => normalizeDomain(domain))
      .filter((domain): domain is string => !!domain)
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
    return allowed ? url.toString() : null;
  } catch (_) {
    return null;
  }
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
    hints.push(`Modelo configurado: ${model}. Ajuste CLAUDE_ONLINE_PRICES_MODEL no backend.`);
  }
  if (lower.includes('web search') || lower.includes('web_search')) {
    hints.push('Verifique se o web search está habilitado na conta Anthropic e se CLAUDE_WEB_SEARCH_TOOL está válido.');
  }
  if (lower.includes('country') || lower.includes('user_location')) {
    hints.push('Use CLAUDE_SEARCH_COUNTRY=BR.');
  }

  const prefix = status ? `Claude API ${status}: ` : 'Claude API: ';
  return new Error(`${prefix}${message}${hints.length ? ` | ${hints.join(' ')}` : ''}`);
}

export async function pesquisarModeloEmLojasClaude(params: {
  modelo: string;
  lojas: OnlineStoreTarget[];
  valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }>;
  maxSearchUses: number;
}): Promise<{ results: OnlinePriceResult[]; usage: OnlinePriceClaudeUsage; rawText: string }> {
  const anthropic = getAnthropicClient();
  const claudeModel = getClaudeModel();

  const allowedDomains = Array.from(
    new Set(
      params.lojas
        .flatMap((loja) => loja.dominios)
        .map((domain) => normalizeDomain(domain))
        .filter((domain): domain is string => !!domain),
    ),
  );

  const storeLines = params.lojas
    .map((loja, index) => `${index + 1}|${loja.nome}|${loja.dominios.join(',')}`)
    .join('\n');

  const prompt = [
    `M=${params.modelo}`,
    'Pesquise preço atual no Brasil SOMENTE nas lojas abaixo.',
    storeLines,
    'Retorne 1 item por loja, só JSON array, sem markdown.',
    'Chaves: l=loja,s=1 achou/0 não achou,a=à vista,p=total em 12x,x=texto 12x,u=URL do produto.',
    'Preço ausente=null. Nunca invente. URL deve ser do domínio da loja.',
    'Ex: [{"l":"MAGALU","s":1,"a":1999.9,"p":2199.9,"x":"12x de R$ 183,33","u":"https://..."}]',
  ].join('\n');

  const maxUses = Math.max(1, Math.min(Math.floor(params.maxSearchUses || 1), 12));
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

  if (allowedDomains.length > 0) tool.allowed_domains = allowedDomains;

  let response: any;
  try {
    response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: Math.max(220, Math.min(700, 120 + params.lojas.length * 90)),
      system: 'Pesquise preço com precisão. Saída exclusivamente JSON compacto. Sem explicações.',
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
    const loja = sanitizeText(item?.l ?? item?.loja ?? item?.store ?? item?.site, 200);
    if (loja) byStore.set(normalizeStoreName(loja), item);
  });

  const results: OnlinePriceResult[] = params.lojas.map((loja) => {
    const lojaNormalizada = normalizeStoreName(loja.nome);
    const found =
      byStore.get(lojaNormalizada) ||
      parsed.find((item) => {
        const parsedStore = normalizeStoreName(item?.l ?? item?.loja ?? item?.store ?? item?.site);
        return parsedStore && (parsedStore.includes(lojaNormalizada) || lojaNormalizada.includes(parsedStore));
      }) ||
      null;

    const precoAvistaOnline = toNumber(found?.a ?? found?.preco_avista ?? found?.precoAvista ?? null);
    const precoPrazo12xOnline = toNumber(found?.p ?? found?.preco_prazo_12x ?? found?.precoPrazo12x ?? null);
    const planilha = params.valoresPlanilhaPorLoja[loja.nomeNormalizado] || {};
    const precoAvistaPlanilha = toNumber(planilha.planilhaAvista ?? null);
    const precoPrazo12xPlanilha = toNumber(planilha.planilhaPrazo12x ?? null);
    const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
    const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);

    const disponibilidadeBase = normalizeStatus(found?.s ?? found?.disponibilidade ?? found?.status);
    const disponibilidade =
      disponibilidadeBase === 'encontrado' && (precoAvistaOnline || precoPrazo12xOnline)
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
      parcelasTexto:
        disponibilidade === 'encontrado'
          ? sanitizeText(found?.x ?? found?.parcelas_texto ?? found?.parcelasTexto, 120)
          : null,
      precoAvistaPlanilha,
      precoPrazo12xPlanilha,
      diferencaAvista: disponibilidade === 'encontrado' ? diffAvista.diff : null,
      diferencaAvistaPercentual: disponibilidade === 'encontrado' ? diffAvista.diffPct : null,
      diferencaPrazo12x: disponibilidade === 'encontrado' ? diffPrazo.diff : null,
      diferencaPrazo12xPercentual: disponibilidade === 'encontrado' ? diffPrazo.diffPct : null,
      titulo: null,
      url: disponibilidade === 'encontrado' ? safeUrl(found?.u ?? found?.url, loja) : null,
      fonte: disponibilidade === 'encontrado' ? 'claude_web_search' : null,
      confianca: disponibilidade === 'encontrado' ? 85 : 0,
      observacao: disponibilidade === 'encontrado' ? null : 'INDISPONÍVEL',
      pesquisadoEm,
    };
  });

  return { results, usage, rawText };
}
