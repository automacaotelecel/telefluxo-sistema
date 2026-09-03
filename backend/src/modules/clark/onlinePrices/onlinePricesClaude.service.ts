import Anthropic from '@anthropic-ai/sdk';
import { OnlinePriceClaudeUsage, OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';
import {
  extrairResultadoDeHtmlProduto,
  validarCandidatoProdutoDescoberto,
  validarPaginaProdutoDescoberta,
  validarPrecoPlausivelPorModelo,
} from './onlinePricesScraper.service';
import { abrirPaginaProduto } from './onlinePricesBrowser.service';
import { criarIdentidadeProduto, validarCandidatoProduto } from './onlinePricesProductIdentity.service';

const DEFAULT_CLAUDE_ONLINE_PRICES_MODEL = 'claude-sonnet-5';
const ENGINE_VERSION = '10.0.0';

let anthropicClient: Anthropic | null = null;
let anthropicClientKey = '';

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeClaudeModel(rawModel: string | undefined | null): string {
  const model = String(rawModel || '').trim();
  if (!model || model === 'claude-sonnet-4-6') return DEFAULT_CLAUDE_ONLINE_PRICES_MODEL;
  return model;
}

function getClaudeModel(): string {
  return normalizeClaudeModel(process.env.CLAUDE_ONLINE_PRICES_MODEL || process.env.CLAUDE_MODEL);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeStoreName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
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

function safeUrl(value: unknown, loja: OnlineStoreTarget): string | null {
  const raw = sanitizeText(value, 1000);
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

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&lt;|&#60;/gi, '<')
    .replace(/&gt;|&#62;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitleFromHtml(html: string): string | null {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? sanitizeText(stripHtml(match[1]), 320) : null;
}

function collectWindows(text: string, patterns: RegExp[], radius: number, maxWindows: number): string[] {
  const source = String(text || '');
  const windows: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) && windows.length < maxWindows) {
      const start = Math.max(0, match.index - radius);
      const end = Math.min(source.length, match.index + match[0].length + radius);
      const piece = source.slice(start, end).replace(/\s+/g, ' ').trim();
      if (piece.length < 40) continue;
      const key = piece.slice(0, 220).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      windows.push(piece);
    }
    if (windows.length >= maxWindows) break;
  }

  return windows;
}

function commercialEvidence(html: string, modelo: string, maxChars: number): string {
  if (!html) return '';

  const visible = stripHtml(html).slice(0, 900_000);
  const raw = decodeHtmlEntities(String(html || '')).replace(/\\u002F/gi, '/').replace(/\\\//g, '/').slice(0, 1_200_000);
  const modelTokens = normalizeStoreName(modelo)
    .split(' ')
    .filter((token) => token.length >= 3 || /\d/.test(token))
    .slice(0, 6)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  const patterns: RegExp[] = [
    /12\s*x/gi,
    /12\s*parcelas?/gi,
    /parcelamento/gi,
    /valor\s+da\s+parcela/gi,
    /installment/gi,
    /numberOfInstallments/gi,
    /R\$\s*\d/gi,
    /\bpix\b/gi,
    /pre[cç]o\s+(?:à|a)\s+vista/gi,
    /spotPrice/gi,
    /sellingPrice/gi,
    /sellerName/gi,
    /vendido\s+(?:e\s+entregue\s+)?por/gi,
    /dispon[ií]vel/gi,
    /estoque/gi,
  ];
  modelTokens.forEach((token) => patterns.push(new RegExp(token, 'gi')));

  const visibleWindows = collectWindows(visible, patterns, 500, 10);
  const rawWindows = collectWindows(raw, patterns, 650, 8);
  const jsonLdBlocks = Array.from(String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => String(match[1] || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);

  const merged: string[] = [];
  const seen = new Set<string>();
  [...jsonLdBlocks, ...visibleWindows, ...rawWindows].forEach((piece) => {
    const clean = piece.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.slice(0, 240).toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(clean);
  });

  return merged.join('\n---\n').slice(0, maxChars);
}

type PageEvidence = {
  loja: string;
  url: string;
  pageTitle: string | null;
  httpStatus: number;
  evidence: string;
  base: OnlinePriceResult;
  evidenceSource: string;
  httpRequests: number;
  browserRequests: number;
};

async function fetchPageEvidence(loja: OnlineStoreTarget, base: OnlinePriceResult): Promise<PageEvidence | null> {
  const url = safeUrl(base.url, loja);
  if (!url) return null;

  const maxEvidenceChars = Math.max(1500, Math.min(20000, envNumber('ONLINE_PRICES_AI_EVIDENCE_MAX_CHARS_PER_STORE', 8500)));
  const page = await abrirPaginaProduto({ url, loja });
  const html = page.html || '';
  const finalUrl = safeUrl(page.finalUrl || url, loja) || url;
  const structured = html
    ? extrairResultadoDeHtmlProduto({
        modelo: base.modelo,
        loja,
        url: finalUrl,
        html,
        source: `v10_${page.source}_structured`,
      })
    : null;
  const evidenceBase = structured
    ? {
        ...base,
        ...structured,
        fonte: `${base.fonte ? `${base.fonte}+` : ''}${structured.fonte || `v10_${page.source}_structured`}`,
        url: finalUrl,
        titulo: structured.titulo || base.titulo,
        cacheHit: false,
      }
    : base;

  return {
    loja: loja.nome,
    url: finalUrl,
    pageTitle: page.title || (html ? pageTitleFromHtml(html) : null),
    httpStatus: page.status,
    evidence: html ? commercialEvidence(html, base.modelo, maxEvidenceChars) : '',
    base: evidenceBase,
    evidenceSource: structured ? `v10_${page.source}_structured` : page.source,
    httpRequests: page.httpRequests,
    browserRequests: page.browserRequests,
  };
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
    // tenta extrair o array abaixo
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
    webFetchRequests: Number(usage?.server_tool_use?.web_fetch_requests || 0),
    browserRequests: 0,
    evidenceHttpRequests: 0,
    candidatesConsidered: 0,
    candidatesRejected: 0,
  };
}

function sumUsage(usages: OnlinePriceClaudeUsage[]): OnlinePriceClaudeUsage {
  return usages.reduce(
    (acc, current) => ({
      inputTokens: acc.inputTokens + current.inputTokens,
      outputTokens: acc.outputTokens + current.outputTokens,
      webSearchRequests: acc.webSearchRequests + current.webSearchRequests,
      webFetchRequests: (acc.webFetchRequests || 0) + (current.webFetchRequests || 0),
      browserRequests: (acc.browserRequests || 0) + (current.browserRequests || 0),
      evidenceHttpRequests: (acc.evidenceHttpRequests || 0) + (current.evidenceHttpRequests || 0),
      candidatesConsidered: (acc.candidatesConsidered || 0) + (current.candidatesConsidered || 0),
      candidatesRejected: (acc.candidatesRejected || 0) + (current.candidatesRejected || 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
      webFetchRequests: 0,
      browserRequests: 0,
      evidenceHttpRequests: 0,
      candidatesConsidered: 0,
      candidatesRejected: 0,
    },
  );
}

type ClaudeUrlDiscovery = {
  url: string;
  title: string;
  score: number;
};

async function discoverExactProductUrls(params: {
  anthropic: Anthropic;
  model: string;
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ candidates: ClaudeUrlDiscovery[]; usage: OnlinePriceClaudeUsage }> {
  const allowedDomains = params.loja.dominios
    .map((domain) => normalizeDomain(domain))
    .filter((domain): domain is string => !!domain);

  if (allowedDomains.length === 0) {
    return {
      candidates: [],
      usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    };
  }

  const identity = criarIdentidadeProduto(params.modelo);
  const maxCandidates = Math.max(1, Math.min(5, Math.floor(envNumber('ONLINE_PRICES_V10_MAX_CANDIDATES_PER_STORE', 3))));
  const prompt = [
    `MODELO_ALVO=${params.modelo}`,
    `LOJA_ALVO=${params.loja.nome}`,
    `IDENTIDADE=${JSON.stringify({ categoria: identity.category, modelo: identity.modelKey, armazenamento: identity.storage, ram: identity.ram, rede: identity.network, tamanhoMm: identity.sizeMm, tamanhoAnel: identity.ringSize, qualificadores: identity.qualifiers, cpu: identity.cpuKey })}`,
    'Faça EXATAMENTE uma web_search restrita aos domínios permitidos e encontre páginas de produto que correspondam ao modelo alvo.',
    `Retorne até ${maxCandidates} candidatos de PÁGINA DE PRODUTO. Não retorne busca, categoria, lista, publicidade, acessório ou variante diferente.`,
    'Não use preço do resultado de busca e não devolva preço. Sua única saída comercialmente utilizável aqui é URL+título.',
    'Produto, capacidade, rede, tamanho, qualificadores e categoria precisam corresponder quando existirem no MODELO_ALVO.',
    'Retorne somente JSON array compacto. Se não houver candidato seguro, retorne [].',
    'Formato: [{"u":"https://...","t":"título da página"}]',
  ].join('\n');

  try {
    const response = await createClaudeMessageWithRetry(
      params.anthropic,
      {
        model: params.model,
        max_tokens: 420,
        system:
          'Você é o Search Planner do Clark. Descubra URLs exatas; não extraia preços de snippets e não invente dados.',
        messages: [{ role: 'user', content: prompt }],
        tools: [
          {
            type: 'web_search_20260318',
            name: 'web_search',
            max_uses: 1,
            allowed_domains: allowedDomains,
            allowed_callers: ['direct'],
            max_content_tokens: Math.max(2000, Math.min(12000, Math.floor(envNumber('ONLINE_PRICES_V10_WEB_FETCH_MAX_TOKENS', 8000)))),
            use_cache: false,
            user_location: {
              type: 'approximate',
              country: 'BR',
              timezone: 'America/Sao_Paulo',
            },
          },
        ],
      } as any,
      params.model,
    );

    const usage = usageFromResponse(response);
    if (usage.webSearchRequests < 1) return { candidates: [], usage };

    const parsed = extractJsonArray(extractText(response));
    const candidates: ClaudeUrlDiscovery[] = [];
    let rejected = 0;
    for (const item of parsed) {
      const url = safeUrl(item?.u ?? item?.url, params.loja);
      const title = sanitizeText(item?.t ?? item?.titulo ?? item?.title, 360);
      if (!url || !title) {
        rejected += 1;
        continue;
      }
      const match = validarCandidatoProduto({ modelo: params.modelo, loja: params.loja, titulo: title, url, allowIncomplete: true });
      if (!match.valid) {
        rejected += 1;
        continue;
      }
      candidates.push({ url, title, score: match.score });
    }

    const deduped = Array.from(new Map(candidates.map((item) => [item.url, item])).values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates);
    usage.candidatesConsidered = parsed.length;
    usage.candidatesRejected = rejected;
    return { candidates: deduped, usage };
  } catch (error: any) {
    console.warn(
      `[Preços Online ${ENGINE_VERSION}][Claude discovery] ${params.loja.nome}/${params.modelo}: ${String(error?.message || error)}`,
    );
    return {
      candidates: [],
      usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    };
  }
}

async function fetchEvidenceViaClaudeWebFetch(params: {
  anthropic: Anthropic;
  model: string;
  modelo: string;
  loja: OnlineStoreTarget;
  url: string;
  title: string | null;
}): Promise<{ evidence: string; usage: OnlinePriceClaudeUsage }> {
  const allowedDomains = params.loja.dominios
    .map((domain) => normalizeDomain(domain))
    .filter((domain): domain is string => !!domain);
  if (allowedDomains.length === 0) {
    return { evidence: '', usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 } };
  }

  const prompt = [
    `MODELO_ALVO=${params.modelo}`,
    `URL_EXATA=${params.url}`,
    `TITULO_CANDIDATO=${params.title || ''}`,
    'Use web_fetch EXATAMENTE nesta URL. Não faça web_search.',
    'Extraia somente evidências pertencentes ao produto principal desta URL: título, preço à vista/Pix, 12x real, seller e disponibilidade.',
    'Não use recomendações, carrosséis, produtos relacionados, snippets externos ou outra URL.',
    'Não estime. Se algo não estiver comprovado, use null.',
    'Retorne somente JSON compacto com chaves t,a,n,i,p,x,v,d. d deve ser disponivel|indisponivel|null.',
  ].join('\n');

  try {
    const response = await createClaudeMessageWithRetry(
      params.anthropic,
      {
        model: params.model,
        max_tokens: 340,
        system: 'Você é o Web Fetch de evidência do Clark. Uma URL, uma oferta, sem conhecimento externo e sem estimativas.',
        messages: [{ role: 'user', content: prompt }],
        tools: [
          {
            type: 'web_fetch_20260318',
            name: 'web_fetch',
            max_uses: 1,
            allowed_domains: allowedDomains,
            allowed_callers: ['direct'],
            max_content_tokens: Math.max(2000, Math.min(12000, Math.floor(envNumber('ONLINE_PRICES_V10_WEB_FETCH_MAX_TOKENS', 8000)))),
            use_cache: false,
          },
        ],
      } as any,
      params.model,
    );
    const usage = usageFromResponse(response);
    return { evidence: usage.webFetchRequests ? extractText(response).slice(0, 5000) : '', usage };
  } catch (error: any) {
    console.warn(`[Preços Online ${ENGINE_VERSION}][Claude web_fetch] ${params.loja.nome}/${params.modelo}: ${String(error?.message || error)}`);
    return { evidence: '', usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 } };
  }
}

function calcularDiferenca(online: number | null, planilha: number | null): { diff: number | null; diffPct: number | null } {
  if (typeof online !== 'number' || typeof planilha !== 'number' || !Number.isFinite(planilha) || planilha === 0) {
    return { diff: null, diffPct: null };
  }
  const diff = online - planilha;
  return { diff, diffPct: diff / planilha };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCommercialValues(params: {
  cash: number | null;
  term: number | null;
  installmentCount: number | null;
  installmentValue: number | null;
  installmentText: string | null;
}): { cash: number | null; term: number | null; installmentCount: number | null; installmentValue: number | null } {
  let cash = params.cash;
  let term = params.term;
  let installmentCount = params.installmentCount;
  let installmentValue = params.installmentValue;
  const text = String(params.installmentText || '').toLowerCase();

  if (!installmentCount && /(?:^|\D)12\s*x(?:\D|$)/i.test(text)) installmentCount = 12;

  if (installmentCount && installmentCount !== 12) {
    term = null;
    installmentValue = null;
  }

  if (installmentCount === 12 && installmentValue) {
    const calculated = round2(installmentValue * 12);
    if (!term || Math.abs(term - calculated) > Math.max(0.05, calculated * 0.015)) term = calculated;
  }

  if (term && installmentCount !== 12) term = null;

  if (cash && term) {
    const minCashToTermRatio = Math.max(0.4, Math.min(0.9, envNumber('ONLINE_PRICES_MIN_CASH_TO_12X_RATIO', 0.65)));
    if (cash < term * minCashToTermRatio || term < cash * 0.95) cash = null;
  }

  return { cash, term, installmentCount, installmentValue };
}

function getErrorStatus(error: any): number {
  const raw = Number(error?.status || error?.response?.status || error?.statusCode || 0);
  return Number.isFinite(raw) ? raw : 0;
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

function isRetryableAnthropicError(error: any): boolean {
  const status = getErrorStatus(error);
  const message = getAnthropicMessage(error).toLowerCase();
  return (
    [429, 500, 502, 503, 504, 529].includes(status) ||
    message.includes('overloaded') ||
    message.includes('rate limit') ||
    message.includes('too_many_requests') ||
    message.includes('temporarily unavailable') ||
    message.includes('timeout')
  );
}

function buildAnthropicFriendlyError(error: any, model: string): Error {
  const status = getErrorStatus(error);
  const message = getAnthropicMessage(error);
  const lower = message.toLowerCase();
  const hints: string[] = [];

  if (lower.includes('deprecated') || lower.includes('retired') || lower.includes('model')) {
    hints.push(`Modelo configurado: ${model}. Ajuste CLAUDE_ONLINE_PRICES_MODEL no backend.`);
  }
  if (status === 529 || lower.includes('overloaded')) {
    hints.push('A Anthropic está sobrecarregada; a V10 preserva o resultado determinístico após as tentativas automáticas.');
  }

  const prefix = status ? `Claude API ${status}: ` : 'Claude API: ';
  return new Error(`${prefix}${message}${hints.length ? ` | ${hints.join(' ')}` : ''}`);
}

async function createClaudeMessageWithRetry(anthropic: Anthropic, payload: any, model: string): Promise<any> {
  const attempts = Math.max(1, Math.min(4, Math.floor(envNumber('ONLINE_PRICES_AI_RETRY_ATTEMPTS', 3))));
  const baseDelay = Math.max(250, Math.min(5000, Math.floor(envNumber('ONLINE_PRICES_AI_RETRY_BASE_MS', 900))));
  let lastError: any = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await anthropic.messages.create(payload);
    } catch (error: any) {
      lastError = error;
      if (!isRetryableAnthropicError(error) || attempt >= attempts - 1) break;
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }

  throw buildAnthropicFriendlyError(lastError, model);
}

export async function pesquisarModeloEmLojasClaude(params: {
  modelo: string;
  lojas: OnlineStoreTarget[];
  valoresPlanilhaPorLoja: Record<string, { planilhaAvista?: number | null; planilhaPrazo12x?: number | null }>;
  maxSearchUses: number;
  resultadosBasePorLoja?: Record<string, OnlinePriceResult>;
}): Promise<{ results: OnlinePriceResult[]; usage: OnlinePriceClaudeUsage; rawText: string }> {
  const anthropic = getAnthropicClient();
  const claudeModel = getClaudeModel();
  const baseMap = params.resultadosBasePorLoja || {};

  const pipelineUsages: OnlinePriceClaudeUsage[] = [];
  const discoveryFallbackResults: OnlinePriceResult[] = [];
  let remainingSearchUses = Math.max(0, Math.floor(params.maxSearchUses || 0));

  const evidenceRows: Array<PageEvidence | null> = [];

  const tryCandidateBase = async (loja: OnlineStoreTarget, candidateBase: OnlinePriceResult): Promise<PageEvidence | null> => {
    let evidence = await fetchPageEvidence(loja, candidateBase);
    if (evidence) {
      pipelineUsages.push({
        inputTokens: 0,
        outputTokens: 0,
        webSearchRequests: 0,
        browserRequests: evidence.browserRequests,
        evidenceHttpRequests: evidence.httpRequests,
        candidatesConsidered: 1,
        candidatesRejected: 0,
      });
    }

    const identityTitle = candidateBase.titulo || evidence?.pageTitle || '';
    if (
      !identityTitle ||
      !validarCandidatoProdutoDescoberto({
        modelo: params.modelo,
        loja,
        titulo: identityTitle,
        url: candidateBase.url || evidence?.url || '',
      })
    ) {
      pipelineUsages.push({ inputTokens: 0, outputTokens: 0, webSearchRequests: 0, candidatesRejected: 1 });
      return null;
    }

    if (
      evidence?.pageTitle &&
      !validarPaginaProdutoDescoberta({
        modelo: params.modelo,
        loja,
        titulo: evidence.pageTitle,
        url: evidence.url,
      })
    ) {
      console.warn(
        `[Preços Online ${ENGINE_VERSION}][Evidence validator] título real diverge do modelo: ${loja.nome}/${params.modelo} -> ${evidence.url}`,
      );
      pipelineUsages.push({ inputTokens: 0, outputTokens: 0, webSearchRequests: 0, candidatesRejected: 1 });
      return null;
    }

    if (!evidence?.evidence) {
      const webFetched = await fetchEvidenceViaClaudeWebFetch({
        anthropic,
        model: claudeModel,
        modelo: params.modelo,
        loja,
        url: candidateBase.url || '',
        title: candidateBase.titulo || null,
      });
      pipelineUsages.push(webFetched.usage);
      if (webFetched.evidence) {
        evidence = {
          loja: loja.nome,
          url: candidateBase.url || '',
          pageTitle: candidateBase.titulo || null,
          httpStatus: evidence?.httpStatus || 0,
          evidence: webFetched.evidence,
          base: candidateBase,
          evidenceSource: 'claude_web_fetch',
          httpRequests: evidence?.httpRequests || 0,
          browserRequests: evidence?.browserRequests || 0,
        };
      }
    }

    return evidence?.evidence ? evidence : null;
  };

  for (const loja of params.lojas) {
    const originalBase = baseMap[normalizeStoreName(loja.nome)] || null;
    if (!originalBase) {
      evidenceRows.push(null);
      continue;
    }

    let discoveryAttempted = false;
    let acceptedEvidence: PageEvidence | null = null;
    const triedUrls = new Set<string>();

    if (originalBase.url) {
      triedUrls.add(originalBase.url);
      acceptedEvidence = await tryCandidateBase(loja, originalBase);
    }

    if (!acceptedEvidence && remainingSearchUses > 0) {
      const discovery = await discoverExactProductUrls({
        anthropic,
        model: claudeModel,
        modelo: params.modelo,
        loja,
      });
      pipelineUsages.push(discovery.usage);
      discoveryAttempted = discovery.usage.webSearchRequests > 0;
      remainingSearchUses = Math.max(0, remainingSearchUses - discovery.usage.webSearchRequests);

      for (const candidate of discovery.candidates) {
        if (triedUrls.has(candidate.url)) continue;
        triedUrls.add(candidate.url);
        const candidateBase: OnlinePriceResult = {
          ...originalBase,
          url: candidate.url,
          titulo: candidate.title,
          fonte: `${originalBase.fonte ? `${originalBase.fonte}+` : ''}claude_web_discovery_url`,
          offerId: `${candidate.url}::`,
          observacao:
            'URL CANDIDATA DESCOBERTA VIA CLAUDE WEB SEARCH; DADOS COMERCIAIS AINDA PRECISAM SER COMPROVADOS NA MESMA PÁGINA',
          productCategory: criarIdentidadeProduto(params.modelo).category,
        };
        acceptedEvidence = await tryCandidateBase(loja, candidateBase);
        if (acceptedEvidence) break;
      }
    }

    if (!acceptedEvidence && discoveryAttempted) {
      discoveryFallbackResults.push({
        ...originalBase,
        engineVersion: ENGINE_VERSION,
        fonte: `${originalBase.fonte ? `${originalBase.fonte}+` : ''}claude_web_discovery_sem_evidencia`,
        observacao: triedUrls.size > 0
          ? 'CANDIDATOS LOCALIZADOS, MAS NENHUMA OFERTA PÔDE SER COMPROVADA NA MESMA URL'
          : 'NÃO LOCALIZADO APÓS BUSCA WEB RESTRITA AO DOMÍNIO DA LOJA; NÃO SIGNIFICA QUE O PRODUTO NÃO EXISTA',
        cacheHit: false,
        productCategory: criarIdentidadeProduto(params.modelo).category,
      });
    }

    evidenceRows.push(acceptedEvidence);
  }

  const usableEvidence = evidenceRows.filter((item): item is PageEvidence => !!item && !!item.evidence);
  if (usableEvidence.length === 0) {
    return {
      results: discoveryFallbackResults,
      usage: sumUsage(pipelineUsages),
      rawText: '',
    };
  }

  const evidenceText = usableEvidence
    .map((item, index) => {
      const base = item.base;
      return [
        `#${index + 1} LOJA=${item.loja}`,
        `URL_FIXA=${item.url}`,
        `TITLE_BASE=${base.titulo || item.pageTitle || ''}`,
        `SELLER_BASE=${base.seller || ''}`,
        `CASH_BASE=${base.precoAvistaOnline ?? ''}`,
        `TERM12_BASE=${base.precoPrazo12xOnline ?? ''}`,
        `PARCELAS_BASE=${base.parcelasTexto || ''}`,
        `HTTP=${item.httpStatus}`,
        `EVIDENCE_SOURCE=${item.evidenceSource}`,
        'EVIDENCIA_PAGINA:',
        item.evidence,
      ].join('\n');
    })
    .join('\n\n===== OUTRA LOJA =====\n\n');

  const prompt = [
    `MODELO_ALVO=${params.modelo}`,
    'Você NÃO pode navegar na web e NÃO pode usar conhecimento externo.',
    'Sua única fonte é a evidência de HTML abaixo, coletada de uma URL fixa que já foi validada por domínio, formato de página e identidade do produto.',
    'Objetivo: completar a MESMA oferta/URL, nunca trocar de anúncio, seller ou produto.',
    'Se o campo ausente não estiver comprovado na evidência, devolva null. Nunca estime e nunca invente.',
    'Aceite somente preço à vista/Pix e parcelamento EXATAMENTE em 12x. Para 12x, devolva n=12 e i=valor da parcela quando visível.',
    'Se houver mais de um seller/oferta na página e não for possível vincular os valores ao SELLER_BASE, não complete os campos.',
    'Não altere URL_FIXA. Só marque dados comerciais quando a evidência da própria página comprovar os valores.',
    'Retorne somente JSON array compacto, um item por evidência.',
    'Chaves: l=loja,a=avista,p=total12x,x=texto12x,n=numeroParcelas,i=valorParcela,v=seller,t=titulo,d=disponivel|indisponivel|null.',
    'Campos não comprovados=null.',
    evidenceText,
  ].join('\n');

  const response = await createClaudeMessageWithRetry(
    anthropic,
    {
      model: claudeModel,
      max_tokens: Math.max(220, Math.min(700, 180 + usableEvidence.length * 130)),
      system: 'Atue somente como parser de evidência HTML. Sem web search. Sem conhecimento externo. Saída apenas JSON.',
      messages: [{ role: 'user', content: prompt }],
    } as any,
    claudeModel,
  );

  const rawText = extractText(response);
  const parsed = extractJsonArray(rawText);
  const usage = sumUsage([...pipelineUsages, usageFromResponse(response)]);
  const pesquisadoEm = new Date().toISOString();
  const byStore = new Map<string, any>();
  parsed.forEach((item) => {
    const loja = sanitizeText(item?.l ?? item?.loja ?? item?.store, 200);
    if (loja) byStore.set(normalizeStoreName(loja), item);
  });

  const results: OnlinePriceResult[] = usableEvidence.map((evidence) => {
    const loja = params.lojas.find((item) => normalizeStoreName(item.nome) === normalizeStoreName(evidence.loja))!;
    const base = evidence.base;
    const found = byStore.get(normalizeStoreName(loja.nome)) || null;

    const aiCash = validarPrecoPlausivelPorModelo(
      params.modelo,
      toNumber(found?.a ?? found?.preco_avista ?? found?.precoAvista ?? null),
    );
    const aiTerm = validarPrecoPlausivelPorModelo(
      params.modelo,
      toNumber(found?.p ?? found?.preco_prazo_12x ?? found?.precoPrazo12x ?? null),
    );
    const aiCountRaw = Number(found?.n ?? found?.numeroParcelas ?? found?.parcelas ?? 0);
    const aiCount = Number.isFinite(aiCountRaw) && aiCountRaw > 0 ? Math.floor(aiCountRaw) : null;
    const aiInstallmentValue = toNumber(found?.i ?? found?.valorParcela ?? found?.installmentValue ?? null);
    const aiInstallmentText = sanitizeText(found?.x ?? found?.parcelas_texto ?? found?.parcelasTexto, 120);
    const aiAvailabilityRaw = normalizeStoreName(found?.d ?? found?.disponibilidade ?? found?.availability ?? '');
    const aiAvailability = aiAvailabilityRaw.includes('INDISPON')
      ? 'indisponivel'
      : aiAvailabilityRaw.includes('DISPON')
        ? 'disponivel'
        : null;
    const aiTextHasTwelve = /(?:^|\D)12\s*x(?:\D|$)|12\s*parcelas?/i.test(aiInstallmentText || '');
    const aiHasRealTwelve =
      !!aiTerm || ((aiCount === 12 || aiTextHasTwelve) && !!aiInstallmentValue);

    // Mescla somente porque a URL é fixa e é exatamente a mesma oferta base.
    const commercial = normalizeCommercialValues({
      cash: aiCash ?? toNumber(base.precoAvistaOnline),
      term: aiTerm ?? toNumber(base.precoPrazo12xOnline),
      installmentCount: aiHasRealTwelve ? 12 : aiCount ?? (base.numeroParcelas || null),
      installmentValue: aiInstallmentValue ?? toNumber(base.valorParcela),
      installmentText: aiInstallmentText || base.parcelasTexto || null,
    });

    let precoAvistaOnline = validarPrecoPlausivelPorModelo(params.modelo, commercial.cash);
    let precoPrazo12xOnline = validarPrecoPlausivelPorModelo(params.modelo, commercial.term);
    let numeroParcelas = precoPrazo12xOnline ? commercial.installmentCount || 12 : null;
    let valorParcela = precoPrazo12xOnline
      ? commercial.installmentValue || round2(precoPrazo12xOnline / 12)
      : null;
    let parcelasTexto = precoPrazo12xOnline
      ? aiHasRealTwelve
        ? aiInstallmentText || (valorParcela ? `12x de R$ ${valorParcela.toFixed(2).replace('.', ',')}` : null)
        : aiInstallmentText || base.parcelasTexto || (valorParcela ? `12x de R$ ${valorParcela.toFixed(2).replace('.', ',')}` : null)
      : null;
    let prazoEstimado = !!base.prazoEstimado && !aiHasRealTwelve && !!precoPrazo12xOnline;

    // Se a URL foi descoberta pela IA e a página comprova apenas o valor à
    // vista, aplicamos a regra de negócio definitiva: +10%, marcado ESTIMADO.
    if (precoAvistaOnline && (!precoPrazo12xOnline || (!!base.prazoEstimado && !aiHasRealTwelve))) {
      const markupPct = Math.max(0, Math.min(1, envNumber('ONLINE_PRICES_ESTIMATED_TERM_MARKUP_PCT', 10) / 100));
      precoPrazo12xOnline = round2(precoAvistaOnline * (1 + markupPct));
      numeroParcelas = 12;
      valorParcela = round2(precoPrazo12xOnline / 12);
      parcelasTexto = `ESTIMADO: 12x de R$ ${valorParcela.toFixed(2).replace('.', ',')} (+10% sobre à vista)`;
      prazoEstimado = true;
    }

    const planilha = params.valoresPlanilhaPorLoja[loja.nomeNormalizado] || {};
    const precoAvistaPlanilha = toNumber(planilha.planilhaAvista ?? null);
    const precoPrazo12xPlanilha = toNumber(planilha.planilhaPrazo12x ?? null);
    const diffAvista = calcularDiferenca(precoAvistaOnline, precoAvistaPlanilha);
    const diffPrazo = calcularDiferenca(precoPrazo12xOnline, precoPrazo12xPlanilha);
    const seller = sanitizeText(found?.v ?? found?.seller ?? found?.vendedor, 120) || base.seller || null;
    const titulo = base.titulo || sanitizeText(found?.t ?? found?.titulo ?? found?.title, 260) || evidence.pageTitle;
    const ofertaCompleta = !!precoAvistaOnline && !!precoPrazo12xOnline;
    const hasCommercialValue = !!precoAvistaOnline || !!precoPrazo12xOnline;
    const productIdentity = criarIdentidadeProduto(params.modelo);
    const evidenceItems = [
      {
        field: 'url' as const,
        source: String(base.fonte || '').includes('claude_web_discovery') ? 'claude_web_search' : 'store_or_cache_discovery',
        url: evidence.url,
        value: evidence.url,
        capturedAt: pesquisadoEm,
      },
      {
        field: 'identity' as const,
        source: evidence.evidenceSource,
        url: evidence.url,
        value: titulo,
        capturedAt: pesquisadoEm,
      },
      ...(aiAvailability
        ? [{ field: 'availability' as const, source: evidence.evidenceSource, url: evidence.url, value: aiAvailability, capturedAt: pesquisadoEm }]
        : []),
      ...(precoAvistaOnline
        ? [{ field: 'cash_price' as const, source: evidence.evidenceSource, url: evidence.url, value: precoAvistaOnline, capturedAt: pesquisadoEm }]
        : []),
      ...(precoPrazo12xOnline
        ? [{
            field: 'installments_12x' as const,
            source: prazoEstimado ? 'regra_avista_mais_10_pct' : evidence.evidenceSource,
            url: evidence.url,
            value: parcelasTexto || precoPrazo12xOnline,
            capturedAt: pesquisadoEm,
          }]
        : []),
      ...(seller
        ? [{ field: 'seller' as const, source: evidence.evidenceSource, url: evidence.url, value: seller, capturedAt: pesquisadoEm }]
        : []),
    ];
    const finalAvailability = hasCommercialValue
      ? 'encontrado'
      : aiAvailability === 'indisponivel'
        ? 'indisponivel'
        : aiAvailability === 'disponivel'
          ? 'erro'
          : base.disponibilidade;
    const baseSearchStatus =
      finalAvailability === 'indisponivel'
        ? 'produto_indisponivel'
        : finalAvailability === 'erro'
          ? 'falha_pesquisa'
          : finalAvailability === 'nao_encontrado'
            ? 'nao_localizado'
            : base.pesquisaStatus || 'oferta_parcial';

    return {
      ...base,
      engineVersion: ENGINE_VERSION,
      modelo: params.modelo,
      loja: loja.nome,
      dominios: loja.dominios,
      disponibilidade: finalAvailability,
      precoAvistaOnline,
      precoPrazo12xOnline,
      parcelasTexto,
      precoAvistaPlanilha,
      precoPrazo12xPlanilha,
      diferencaAvista: precoAvistaOnline ? diffAvista.diff : null,
      diferencaAvistaPercentual: precoAvistaOnline ? diffAvista.diffPct : null,
      diferencaPrazo12x: precoPrazo12xOnline ? diffPrazo.diff : null,
      diferencaPrazo12xPercentual: precoPrazo12xOnline ? diffPrazo.diffPct : null,
      titulo,
      url: evidence.url,
      fonte: hasCommercialValue
        ? `${base.fonte || 'deterministico'}+claude_page_parser${prazoEstimado ? '+estimativa_12x_10pct' : aiHasRealTwelve ? '+12x_real' : ''}`
        : base.fonte,
      confianca: hasCommercialValue ? Math.max(90, Number(base.confianca || 0)) : base.confianca,
      observacao: prazoEstimado
        ? '12X ESTIMADO: preço à vista + 10% porque o 12x real não foi localizado na mesma oferta'
        : ofertaCompleta
          ? null
        : precoAvistaOnline && !precoPrazo12xOnline
          ? 'OFERTA ENCONTRADA; 12X NÃO LOCALIZADO NA MESMA OFERTA'
          : !precoAvistaOnline && precoPrazo12xOnline
            ? 'OFERTA ENCONTRADA; PREÇO À VISTA NÃO LOCALIZADO NA MESMA OFERTA'
            : base.observacao,
      pesquisadoEm,
      seller,
      numeroParcelas,
      valorParcela,
      ofertaCompleta,
      pesquisaStatus: prazoEstimado
        ? 'oferta_estimada'
        : ofertaCompleta
          ? 'oferta_valida'
          : hasCommercialValue
            ? 'oferta_parcial'
            : baseSearchStatus,
      offerId: `${evidence.url}::${normalizeStoreName(seller || '')}`,
      cacheHit: false,
      prazoEstimado,
      regraEstimativa: prazoEstimado ? 'avista_mais_10_pct' : null,
      evidence: evidenceItems,
      productCategory: productIdentity.category,
    };
  });

  return { results: [...results, ...discoveryFallbackResults], usage, rawText };
}
