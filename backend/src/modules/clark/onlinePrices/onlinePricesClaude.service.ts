import Anthropic from '@anthropic-ai/sdk';
import { OnlinePriceClaudeUsage, OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';
import {
  validarCandidatoProdutoDescoberto,
  validarPrecoPlausivelPorModelo,
} from './onlinePricesScraper.service';

const DEFAULT_CLAUDE_ONLINE_PRICES_MODEL = 'claude-sonnet-5';
const ENGINE_VERSION = '9.0.0';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

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
};

async function fetchPageEvidence(loja: OnlineStoreTarget, base: OnlinePriceResult): Promise<PageEvidence | null> {
  const url = safeUrl(base.url, loja);
  if (!url) return null;

  const controller = new AbortController();
  const timeoutMs = Math.max(2500, Math.min(20000, envNumber('ONLINE_PRICES_AI_EVIDENCE_HTTP_TIMEOUT_MS', 10000)));
  const maxHtmlChars = Math.max(150_000, Math.min(2_000_000, envNumber('ONLINE_PRICES_AI_EVIDENCE_MAX_HTML_CHARS', 1_200_000)));
  const maxEvidenceChars = Math.max(1500, Math.min(20000, envNumber('ONLINE_PRICES_AI_EVIDENCE_MAX_CHARS_PER_STORE', 8500)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
    });

    const finalUrl = safeUrl(response.url || url, loja) || url;
    if (!response.ok) {
      return { loja: loja.nome, url: finalUrl, pageTitle: null, httpStatus: response.status, evidence: '', base };
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { loja: loja.nome, url: finalUrl, pageTitle: null, httpStatus: response.status, evidence: '', base };
    }

    const html = (await response.text()).slice(0, maxHtmlChars);
    return {
      loja: loja.nome,
      url: finalUrl,
      pageTitle: pageTitleFromHtml(html),
      httpStatus: response.status,
      evidence: commercialEvidence(html, base.modelo, maxEvidenceChars),
      base,
    };
  } catch (_) {
    return { loja: loja.nome, url, pageTitle: null, httpStatus: 0, evidence: '', base };
  } finally {
    clearTimeout(timer);
  }
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
  };
}

function sumUsage(usages: OnlinePriceClaudeUsage[]): OnlinePriceClaudeUsage {
  return usages.reduce(
    (acc, current) => ({
      inputTokens: acc.inputTokens + current.inputTokens,
      outputTokens: acc.outputTokens + current.outputTokens,
      webSearchRequests: acc.webSearchRequests + current.webSearchRequests,
    }),
    { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
  );
}

type ClaudeUrlDiscovery = {
  url: string;
  title: string;
};

async function discoverExactProductUrl(params: {
  anthropic: Anthropic;
  model: string;
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ candidate: ClaudeUrlDiscovery | null; usage: OnlinePriceClaudeUsage }> {
  const allowedDomains = params.loja.dominios
    .map((domain) => normalizeDomain(domain))
    .filter((domain): domain is string => !!domain);

  if (allowedDomains.length === 0) {
    return {
      candidate: null,
      usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    };
  }

  const prompt = [
    `MODELO_ALVO=${params.modelo}`,
    `LOJA_ALVO=${params.loja.nome}`,
    'Use obrigatoriamente a ferramenta web_search uma única vez para localizar uma PÁGINA DE PRODUTO EXATA dentro dos domínios permitidos.',
    'Sua função aqui é SOMENTE descobrir URL e título. Não extraia, não estime e não devolva preço.',
    'Rejeite página de busca, categoria, lista, acessório, kit, combo, usado, seminovo, outlet, recondicionado e variante diferente.',
    'Memória, rede 4G/5G e qualificadores Ultra/Plus/FE/Fold/Flip precisam corresponder exatamente ao modelo alvo.',
    'Retorne somente JSON array compacto. Se não houver página de produto exata, retorne [].',
    'Formato: [{"u":"https://...","t":"título exato da oferta"}]',
  ].join('\n');

  try {
    const response = await createClaudeMessageWithRetry(
      params.anthropic,
      {
        model: params.model,
        max_tokens: 220,
        system:
          'Atue como descobridor de URL de e-commerce. Use a busca apenas para achar a página exata; nunca use preço de snippet como dado comercial.',
        messages: [{ role: 'user', content: prompt }],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 1,
            allowed_domains: allowedDomains,
          },
        ],
      } as any,
      params.model,
    );

    const usage = usageFromResponse(response);
    if (usage.webSearchRequests < 1) {
      return { candidate: null, usage };
    }
    const parsed = extractJsonArray(extractText(response));

    for (const item of parsed) {
      const url = safeUrl(item?.u ?? item?.url, params.loja);
      const title = sanitizeText(item?.t ?? item?.titulo ?? item?.title, 360);
      if (!url || !title) continue;
      if (
        !validarCandidatoProdutoDescoberto({
          modelo: params.modelo,
          loja: params.loja,
          titulo: title,
          url,
        })
      ) {
        continue;
      }

      return { candidate: { url, title }, usage };
    }

    return { candidate: null, usage };
  } catch (error: any) {
    console.warn(
      `[Preços Online ${ENGINE_VERSION}][Claude discovery] ${params.loja.nome}/${params.modelo}: ${String(error?.message || error)}`,
    );
    return {
      candidate: null,
      usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    };
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
    hints.push('A Anthropic está sobrecarregada; a V9 preserva o resultado determinístico após as tentativas automáticas.');
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

  const discoveryUsages: OnlinePriceClaudeUsage[] = [];
  const discoveryFallbackResults: OnlinePriceResult[] = [];
  let remainingSearchUses = Math.max(0, Math.floor(params.maxSearchUses || 0));

  const evidenceRows: Array<PageEvidence | null> = [];
  for (const loja of params.lojas) {
    let base = baseMap[normalizeStoreName(loja.nome)] || null;
    let discoveryAttempted = false;
    if (!base) {
      evidenceRows.push(null);
      continue;
    }

    if (!base.url && remainingSearchUses > 0) {
      const discovery = await discoverExactProductUrl({
        anthropic,
        model: claudeModel,
        modelo: params.modelo,
        loja,
      });
      discoveryUsages.push(discovery.usage);
      discoveryAttempted = discovery.usage.webSearchRequests > 0;
      remainingSearchUses = Math.max(0, remainingSearchUses - discovery.usage.webSearchRequests);

      if (discovery.candidate) {
        base = {
          ...base,
          url: discovery.candidate.url,
          titulo: discovery.candidate.title,
          fonte: `${base.fonte ? `${base.fonte}+` : ''}claude_web_discovery_url`,
          offerId: `${discovery.candidate.url}::`,
          observacao:
            'URL EXATA DESCOBERTA VIA CLAUDE WEB SEARCH; PREÇO AINDA PRECISA SER COMPROVADO NA PÁGINA DA LOJA',
        };
      }
    }

    if (!base.url) {
      if (discoveryAttempted) {
        discoveryFallbackResults.push({
          ...base,
          engineVersion: ENGINE_VERSION,
          fonte: `${base.fonte ? `${base.fonte}+` : ''}claude_web_discovery_sem_resultado`,
          observacao:
            'NÃO LOCALIZADO APÓS BUSCA WEB RESTRITA AO DOMÍNIO DA LOJA; NÃO SIGNIFICA QUE O PRODUTO NÃO EXISTA',
          cacheHit: false,
        });
      }
      evidenceRows.push(null);
      continue;
    }

    const evidence = await fetchPageEvidence(loja, base);
    if (!evidence?.evidence) {
      evidenceRows.push(null);
      continue;
    }

    const identityTitle = base.titulo || evidence.pageTitle || '';
    if (
      !identityTitle ||
      !validarCandidatoProdutoDescoberto({
        modelo: params.modelo,
        loja,
        titulo: identityTitle,
        url: evidence.url,
      })
    ) {
      console.warn(
        `[Preços Online ${ENGINE_VERSION}][Claude parser] candidato rejeitado por identidade/URL: ${loja.nome}/${params.modelo} -> ${evidence.url}`,
      );
      evidenceRows.push(null);
      continue;
    }

    if (
      evidence.pageTitle &&
      !validarCandidatoProdutoDescoberto({
        modelo: params.modelo,
        loja,
        titulo: evidence.pageTitle,
        url: evidence.url,
      })
    ) {
      console.warn(
        `[Preços Online ${ENGINE_VERSION}][Claude parser] título real da página diverge do modelo: ${loja.nome}/${params.modelo} -> ${evidence.pageTitle}`,
      );
      evidenceRows.push(null);
      continue;
    }

    evidenceRows.push(evidence);
  }

  const usableEvidence = evidenceRows.filter((item): item is PageEvidence => !!item && !!item.evidence);
  if (usableEvidence.length === 0) {
    return {
      results: discoveryFallbackResults,
      usage: sumUsage(discoveryUsages),
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
    'Chaves: l=loja,a=avista,p=total12x,x=texto12x,n=numeroParcelas,i=valorParcela,v=seller,t=titulo.',
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
  const usage = sumUsage([...discoveryUsages, usageFromResponse(response)]);
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
    const baseSearchStatus =
      base.pesquisaStatus ||
      (base.disponibilidade === 'encontrado'
        ? base.ofertaCompleta
          ? 'oferta_valida'
          : 'oferta_parcial'
        : base.disponibilidade === 'indisponivel'
          ? 'produto_indisponivel'
          : base.disponibilidade === 'erro'
            ? 'falha_pesquisa'
            : 'nao_encontrado_confirmado');

    return {
      ...base,
      engineVersion: ENGINE_VERSION,
      modelo: params.modelo,
      loja: loja.nome,
      dominios: loja.dominios,
      disponibilidade: hasCommercialValue ? 'encontrado' : base.disponibilidade,
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
    };
  });

  return { results: [...results, ...discoveryFallbackResults], usage, rawText };
}
