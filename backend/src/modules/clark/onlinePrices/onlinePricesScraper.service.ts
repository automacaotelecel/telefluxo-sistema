import { getBaseModelFamily, extractStorage } from '../../productDictionary/productDictionary.utils';
import { OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';

type DirectLookupStats = {
  httpRequests: number;
  reusedUrl: boolean;
  discoveredUrl: boolean;
  tavilySearchRequests: number;
  tavilyExtractRequests: number;
  tavilyCreditsEstimated: number;
};

type DirectLookupResponse = {
  result: OnlinePriceResult | null;
  stats: DirectLookupStats;
};

type PriceCandidate = {
  title: string | null;
  url: string | null;
  price: number | null;
  termPrice: number | null;
  installmentText: string | null;
  confidence: number;
  matchText?: string | null;
};

type JsonFetchResult = {
  data: any;
  status: number;
  ok: boolean;
};

type HtmlFetchResult = {
  html: string | null;
  status: number;
  finalUrl: string;
};

type ProductSignature = {
  family: string | null;
  storage: string | null;
  network: '4G' | '5G' | null;
  normalized: string;
};

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_HTML_CHARS = 2_400_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 's'].includes(raw);
}

function normalizeDomain(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  return (normalized.split('/')[0] || '').trim();
}

function normalizeProductText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/(\d+)\s*(GB|TB)\b/g, '$1$2')
    .replace(/\b(GB|TB)\s*(\d+)\b/g, '$2$1')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;|&\#x27;/gi, "'")
    .replace(/&lt;|&#60;/gi, '<')
    .replace(/&gt;|&#62;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function toPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let cleaned = raw.replace(/R\$/gi, '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!cleaned) return null;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/\.(?=\d{3}(\D|$))/g, '');
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) return null;
  return Math.round(parsed * 100) / 100;
}

function getUrlHost(value: string | null): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function isAllowedStoreUrl(value: string | null, loja: OnlineStoreTarget): boolean {
  if (!value) return false;
  const host = getUrlHost(value);
  if (!host) return false;

  return loja.dominios.some((domain) => {
    const allowed = normalizeDomain(domain);
    return allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

function absolutizeUrl(href: string, baseUrl: string): string | null {
  try {
    const value = decodeHtmlEntities(href)
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .trim();
    if (!value || value.startsWith('javascript:') || value.startsWith('#')) return null;
    return new URL(value, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

function extractNetwork(value: unknown): '4G' | '5G' | null {
  const normalized = ` ${normalizeProductText(value)} `;
  if (normalized.includes(' 5G ')) return '5G';
  if (normalized.includes(' 4G ')) return '4G';
  return null;
}

function buildProductSignature(value: string): ProductSignature {
  const normalized = normalizeProductText(value);
  const family = getBaseModelFamily(normalized) || null;
  const storage = extractStorage(normalized) || null;
  const network = extractNetwork(normalized);

  return {
    family: family ? normalizeProductText(family) : null,
    storage: storage ? normalizeProductText(storage) : null,
    network,
    normalized,
  };
}

function hasExactToken(haystack: string, token: string): boolean {
  return ` ${haystack} `.includes(` ${token} `);
}

function modelMatchScore(modelo: string, candidateText: string): number {
  const target = buildProductSignature(modelo);
  const candidateNormalized = normalizeProductText(candidateText);
  if (!candidateNormalized) return 0;

  const candidateFamilyRaw = getBaseModelFamily(candidateNormalized) || '';
  const candidateFamily = normalizeProductText(candidateFamilyRaw);
  const candidateStorage = normalizeProductText(extractStorage(candidateNormalized) || '');
  const candidateNetwork = extractNetwork(candidateNormalized);

  if (target.family) {
    const familyMatches =
      candidateFamily === target.family ||
      candidateNormalized.includes(target.family);
    if (!familyMatches) return 0;
  }

  if (target.storage) {
    const storageMatches =
      candidateStorage === target.storage ||
      hasExactToken(candidateNormalized, target.storage);
    if (!storageMatches) return 0;
  }

  if (target.network === '5G' && candidateNetwork !== '5G') return 0;
  if (target.network === '4G' && candidateNetwork === '5G') return 0;

  // Na planilha do projeto existem, por exemplo, A06 e A06 5G como produtos distintos.
  // Se a consulta não fala 5G, não aceite silenciosamente a variante 5G.
  if (!target.network && target.family?.match(/^GALAXY [AMF]\d{2}$/) && candidateNetwork === '5G') {
    return 0;
  }

  const importantQualifiers = ['ULTRA', 'PLUS', 'PRO', 'FE', 'FOLD', 'FLIP'];
  for (const qualifier of importantQualifiers) {
    const targetHas = hasExactToken(target.normalized, qualifier);
    const candidateHas = hasExactToken(candidateNormalized, qualifier);
    if (targetHas && !candidateHas) return 0;
    if (!targetHas && candidateHas && ['ULTRA', 'PLUS', 'PRO', 'FE'].includes(qualifier)) {
      if (target.family?.startsWith('GALAXY S')) return 0;
    }
  }

  let score = 0.55;
  if (target.family) score += 0.2;
  if (target.storage) score += 0.15;
  if (target.network) score += 0.08;

  const rawTokens = target.normalized
    .split(' ')
    .filter(Boolean)
    .filter((token) => !['SAMSUNG', 'GALAXY', 'SMARTPHONE', 'CELULAR', 'APARELHO'].includes(token));

  let matched = 0;
  for (const token of rawTokens) {
    if (hasExactToken(candidateNormalized, token) || candidateNormalized.includes(token)) matched += 1;
  }

  if (rawTokens.length > 0) score += (matched / rawTokens.length) * 0.12;
  return Math.min(1, score);
}

function metaContent(html: string, attrName: string, attrValue: string): string | null {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\b[^>]*${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escaped}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim();
  }

  return null;
}

function getJsonLdBlocks(html: string): any[] {
  const blocks: any[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtmlEntities(match[1] || '').trim();
    if (!raw) continue;

    try {
      blocks.push(JSON.parse(raw));
    } catch (_) {
      const cleaned = raw
        .replace(/^\s*<!--/, '')
        .replace(/-->\s*$/, '')
        .replace(/\u0000/g, '')
        .trim();
      try {
        blocks.push(JSON.parse(cleaned));
      } catch (_) {
        // JSON-LD inválido não deve impedir as outras estratégias.
      }
    }
  }

  return blocks;
}

function firstPriceFromOffer(offer: any): number | null {
  if (!offer) return null;
  if (Array.isArray(offer)) {
    for (const item of offer) {
      const price = firstPriceFromOffer(item);
      if (price) return price;
    }
    return null;
  }

  return toPrice(
    offer.price ??
      offer.lowPrice ??
      offer.highPrice ??
      offer.priceSpecification?.price ??
      offer.priceSpecification?.minPrice ??
      null,
  );
}

function collectProductJson(value: any, out: any[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectProductJson(item, out));
    return;
  }
  if (typeof value !== 'object') return;

  const rawType = value['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some((type) => String(type || '').toLowerCase() === 'product')) {
    out.push(value);
  }

  if (Array.isArray(value['@graph'])) collectProductJson(value['@graph'], out);
  if (Array.isArray(value.itemListElement)) collectProductJson(value.itemListElement, out);
  if (value.item) collectProductJson(value.item, out);
}

function extractInstallment(html: string): { total: number | null; text: string | null } {
  const plain = stripHtml(html).slice(0, 900_000);
  const patterns = [
    /12\s*x\s*(?:de\s*)?R\$\s*([0-9.]+,[0-9]{2})/i,
    /12\s*parcelas?\s*(?:de\s*)?R\$\s*([0-9.]+,[0-9]{2})/i,
    /em\s+ate\s+12x\s+de\s+R\$\s*([0-9.]+,[0-9]{2})/i,
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (!match?.[1]) continue;
    const parcela = toPrice(match[1]);
    if (!parcela) continue;
    const total = Math.round(parcela * 12 * 100) / 100;
    return { total, text: `12x de R$ ${parcela.toFixed(2).replace('.', ',')}` };
  }

  return { total: null, text: null };
}

function structuredCandidates(html: string, pageUrl: string, modelo: string): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const products: any[] = [];
  getJsonLdBlocks(html).forEach((block) => collectProductJson(block, products));

  for (const product of products) {
    const title = String(product?.name || product?.headline || '').trim() || null;
    const url = absolutizeUrl(String(product?.url || product?.offers?.url || pageUrl), pageUrl);
    const price = firstPriceFromOffer(product?.offers ?? product?.aggregateOffer ?? product?.priceSpecification);
    const score = modelMatchScore(modelo, `${title || ''} ${url || ''}`);

    if (score >= 0.72 && (price || url)) {
      candidates.push({
        title,
        url,
        price,
        termPrice: null,
        installmentText: null,
        confidence: Math.round(Math.min(99, 72 + score * 26)),
      });
    }
  }

  const ogTitle =
    metaContent(html, 'property', 'og:title') ||
    metaContent(html, 'name', 'title') ||
    metaContent(html, 'name', 'twitter:title');
  const ogUrl = metaContent(html, 'property', 'og:url') || pageUrl;
  const metaPrice =
    toPrice(metaContent(html, 'property', 'product:price:amount')) ||
    toPrice(metaContent(html, 'itemprop', 'price')) ||
    toPrice(metaContent(html, 'property', 'og:price:amount'));
  const metaScore = modelMatchScore(modelo, `${ogTitle || ''} ${ogUrl || ''}`);

  if (metaScore >= 0.72 && (metaPrice || ogUrl)) {
    candidates.push({
      title: ogTitle,
      url: ogUrl,
      price: metaPrice,
      termPrice: null,
      installmentText: null,
      confidence: Math.round(Math.min(97, 70 + metaScore * 25)),
    });
  }

  return candidates;
}

function extractHrefCandidatesWithContext(
  html: string,
  pageUrl: string,
  modelo: string,
  loja: OnlineStoreTarget,
): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const regex = /<a\b[^>]*href=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let seen = 0;

  while ((match = regex.exec(html)) !== null && seen < 8000) {
    seen += 1;
    const href = absolutizeUrl(match[2] || '', pageUrl);
    if (!href || !isAllowedStoreUrl(href, loja)) continue;

    const inner = stripHtml(match[3] || '').slice(0, 500);
    const start = Math.max(0, match.index - 2400);
    const end = Math.min(html.length, regex.lastIndex + 2400);
    const context = stripHtml(html.slice(start, end)).slice(0, 5000);

    const scoreInner = modelMatchScore(modelo, `${inner} ${href}`);
    const scoreContext = modelMatchScore(modelo, `${context} ${href}`);
    const score = Math.max(scoreInner, scoreContext * 0.96);
    if (score < 0.72) continue;

    candidates.push({
      title: inner || null,
      url: href,
      price: null,
      termPrice: null,
      installmentText: null,
      confidence: Math.round(Math.min(94, 62 + score * 30)),
    });
  }

  return candidates;
}

function extractEmbeddedUrlCandidates(
  html: string,
  pageUrl: string,
  modelo: string,
  loja: OnlineStoreTarget,
): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const patterns = [
    /["'](?:permalink|canonical_url|product_url|url)["']\s*:\s*["'](https?:\\?\/\\?\/[^"']+)["']/gi,
    /https?:\\?\/\\?\/(?:www\.)?(?:produto\.)?mercadolivre\.com\.br\/[A-Za-z0-9_?=&%./\-\\]+/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let seen = 0;
    while ((match = pattern.exec(html)) !== null && seen < 2500) {
      seen += 1;
      const rawUrl = match[1] || match[0] || '';
      const href = absolutizeUrl(rawUrl, pageUrl);
      if (!href || !isAllowedStoreUrl(href, loja)) continue;

      const start = Math.max(0, match.index - 3500);
      const end = Math.min(html.length, pattern.lastIndex + 3500);
      const context = decodeHtmlEntities(html.slice(start, end))
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/\\u00([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

      const score = modelMatchScore(modelo, context);
      if (score < 0.72) continue;

      const titleMatch = context.match(/["'](?:title|name)["']\s*:\s*["']([^"']{3,240})["']/i);
      candidates.push({
        title: titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : null,
        url: href,
        price: null,
        termPrice: null,
        installmentText: null,
        confidence: Math.round(Math.min(92, 60 + score * 30)),
      });
    }
  }

  return candidates;
}

function rankCandidates(
  candidates: PriceCandidate[],
  modelo: string,
  loja: OnlineStoreTarget,
): PriceCandidate[] {
  const seen = new Set<string>();

  return candidates
    .filter((candidate) => !candidate.url || isAllowedStoreUrl(candidate.url, loja))
    .map((candidate) => ({
      candidate,
      score: modelMatchScore(modelo, candidate.matchText || `${candidate.title || ''} ${candidate.url || ''}`),
    }))
    .filter((item) => item.score >= 0.72)
    .sort((a, b) => {
      const aPrice = a.candidate.price ? 1 : 0;
      const bPrice = b.candidate.price ? 1 : 0;
      if (aPrice !== bPrice) return bPrice - aPrice;
      if (a.score !== b.score) return b.score - a.score;
      return b.candidate.confidence - a.candidate.confidence;
    })
    .map((item) => item.candidate)
    .filter((candidate) => {
      const key = candidate.url || `${candidate.title || ''}:${candidate.price || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function choosePricedCandidate(
  candidates: PriceCandidate[],
  modelo: string,
  loja: OnlineStoreTarget,
): PriceCandidate | null {
  const ranked = rankCandidates(candidates, modelo, loja)
    .filter((candidate) => candidate.price || candidate.termPrice)
    .sort((a, b) => {
      const priceA = a.price ?? a.termPrice ?? Number.MAX_SAFE_INTEGER;
      const priceB = b.price ?? b.termPrice ?? Number.MAX_SAFE_INTEGER;
      return priceA - priceB;
    });

  return ranked[0] || null;
}

function getStoreKey(loja: OnlineStoreTarget): string {
  return normalizeProductText(loja.nome);
}

function buildSearchUrl(modelo: string, loja: OnlineStoreTarget): string | null {
  const store = getStoreKey(loja);
  const query = modelo.trim();
  if (!query) return null;

  if (store.includes('MERCADO LIVRE')) {
    const slug = normalizeProductText(query).toLowerCase().replace(/\s+/g, '-');
    return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug).replace(/%2D/g, '-')}`;
  }
  if (store.includes('CARREFOUR')) {
    // É o formato atualmente utilizado pela busca web do Carrefour.
    return `https://www.carrefour.com.br/busca/${encodeURIComponent(query)}`;
  }
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query)}/`;
  }
  if (store.includes('AMAZON')) {
    return `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  }
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    return `https://www.fastshop.com.br/web/q/${encodeURIComponent(query)}`;
  }
  if (store.includes('SAMSUNG')) {
    return `https://shop.samsung.com.br/busca?q=${encodeURIComponent(query)}`;
  }

  const firstDomain = loja.dominios.map(normalizeDomain).find(Boolean);
  return firstDomain ? `https://${firstDomain}/search?q=${encodeURIComponent(query)}` : null;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<JsonFetchResult> {
  const timeoutMs = Math.max(2000, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
        ...headers,
      },
    });

    const data = await response.json().catch(() => null);
    return { data, status: response.status, ok: response.ok };
  } catch (_) {
    return { data: null, status: 0, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<HtmlFetchResult> {
  const timeoutMs = Math.max(2000, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const maxChars = Math.max(100_000, envNumber('ONLINE_PRICES_MAX_HTML_CHARS', DEFAULT_MAX_HTML_CHARS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'upgrade-insecure-requests': '1',
      },
    });

    if (!response.ok) return { html: null, status: response.status, finalUrl: response.url || url };
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { html: null, status: response.status, finalUrl: response.url || url };
    }

    const text = await response.text();
    return {
      html: text ? text.slice(0, maxChars) : null,
      status: response.status,
      finalUrl: response.url || url,
    };
  } catch (_) {
    return { html: null, status: 0, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function resultFromCandidate(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  candidate: PriceCandidate;
  html?: string | null;
  source: string;
}): OnlinePriceResult | null {
  const installment = params.html ? extractInstallment(params.html) : { total: null, text: null };
  const cash = toPrice(params.candidate.price);
  const term = toPrice(params.candidate.termPrice) || installment.total;

  if (!cash && !term) return null;

  return {
    modelo: params.modelo,
    loja: params.loja.nome,
    dominios: params.loja.dominios,
    disponibilidade: 'encontrado',
    precoAvistaOnline: cash,
    precoPrazo12xOnline: term,
    parcelasTexto: params.candidate.installmentText || installment.text,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: params.candidate.title,
    url: params.candidate.url,
    fonte: params.source,
    confianca: Math.max(0, Math.min(100, params.candidate.confidence)),
    observacao: null,
    pesquisadoEm: new Date().toISOString(),
  };
}



function isCompletePriceResult(result: OnlinePriceResult | null): boolean {
  return !!(
    result &&
    result.disponibilidade === 'encontrado' &&
    result.precoAvistaOnline &&
    result.precoPrazo12xOnline
  );
}

function mergeFoundResults(
  primary: OnlinePriceResult,
  secondary: OnlinePriceResult,
): OnlinePriceResult {
  if (primary.disponibilidade !== 'encontrado') return secondary;
  if (secondary.disponibilidade !== 'encontrado') return primary;

  const fontes = Array.from(
    new Set([primary.fonte, secondary.fonte].filter((value): value is string => !!value)),
  );

  return {
    ...primary,
    precoAvistaOnline: primary.precoAvistaOnline ?? secondary.precoAvistaOnline,
    precoPrazo12xOnline: primary.precoPrazo12xOnline ?? secondary.precoPrazo12xOnline,
    parcelasTexto: primary.parcelasTexto || secondary.parcelasTexto,
    titulo: primary.titulo || secondary.titulo,
    url: primary.url || secondary.url,
    fonte: fontes.length > 0 ? fontes.join('+') : null,
    confianca: Math.max(primary.confianca || 0, secondary.confianca || 0),
    observacao: null,
    pesquisadoEm: new Date().toISOString(),
  };
}

function resultUnavailableFromCandidate(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  candidate: PriceCandidate;
  source: string;
}): OnlinePriceResult {
  return {
    modelo: params.modelo,
    loja: params.loja.nome,
    dominios: params.loja.dominios,
    disponibilidade: 'indisponivel',
    precoAvistaOnline: null,
    precoPrazo12xOnline: null,
    parcelasTexto: null,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: params.candidate.title,
    url: params.candidate.url,
    fonte: params.source,
    confianca: Math.max(0, Math.min(100, params.candidate.confidence)),
    observacao: 'PRODUTO ENCONTRADO, MAS INDISPONÍVEL',
    pesquisadoEm: new Date().toISOString(),
  };
}

async function tryProductPage(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  url: string;
  source: string;
}): Promise<{ result: OnlinePriceResult | null; httpRequests: number }> {
  if (!isAllowedStoreUrl(params.url, params.loja)) return { result: null, httpRequests: 0 };

  const page = await fetchHtml(params.url);
  if (!page.html) return { result: null, httpRequests: 1 };

  const candidates = structuredCandidates(page.html, page.finalUrl || params.url, params.modelo);
  const candidate = choosePricedCandidate(candidates, params.modelo, params.loja);

  if (!candidate) {
    const ranked = rankCandidates(candidates, params.modelo, params.loja);
    const unavailableCandidate = ranked[0] || null;
    const pageText = stripHtml(page.html).slice(0, 500_000);
    if (
      unavailableCandidate &&
      detectAvailabilityFromText(pageText) === 'indisponivel'
    ) {
      return {
        result: resultUnavailableFromCandidate({
          modelo: params.modelo,
          loja: params.loja,
          candidate: {
            ...unavailableCandidate,
            url: unavailableCandidate.url || page.finalUrl || params.url,
          },
          source: params.source,
        }),
        httpRequests: 1,
      };
    }
    return { result: null, httpRequests: 1 };
  }

  const normalizedCandidate: PriceCandidate = {
    ...candidate,
    url: candidate.url || page.finalUrl || params.url,
  };

  return {
    result: resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate: normalizedCandidate,
      html: page.html,
      source: params.source,
    }),
    httpRequests: 1,
  };
}

function vtexInstallment(offer: any): { total: number | null; text: string | null } {
  const installments = Array.isArray(offer?.Installments)
    ? offer.Installments
    : Array.isArray(offer?.installments)
      ? offer.installments
      : [];

  const twelve = installments
    .filter((item: any) => Number(item?.NumberOfInstallments ?? item?.numberOfInstallments) === 12)
    .map((item: any) => {
      const quantity = Number(item?.NumberOfInstallments ?? item?.numberOfInstallments ?? 12);
      const amount = toPrice(item?.Value ?? item?.value ?? item?.InterestRateValue);
      const explicitTotal = toPrice(item?.TotalValuePlusInterestRate ?? item?.totalValuePlusInterestRate);
      const total = explicitTotal || (amount ? Math.round(quantity * amount * 100) / 100 : null);
      return { quantity, amount, total };
    })
    .filter((item: { total: number | null }) => !!item.total)
    .sort((a: { total: number | null }, b: { total: number | null }) => (a.total || 0) - (b.total || 0))[0];

  if (!twelve?.total) return { total: null, text: null };
  return {
    total: twelve.total,
    text: twelve.amount ? `12x de R$ ${twelve.amount.toFixed(2).replace('.', ',')}` : '12x',
  };
}

async function pesquisarCarrefourVtex(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ result: OnlinePriceResult | null; httpRequests: number }> {
  const endpoint = new URL('https://www.carrefour.com.br/api/catalog_system/pub/products/search');
  endpoint.searchParams.set('ft', params.modelo);
  endpoint.searchParams.set('_from', '0');
  endpoint.searchParams.set('_to', '29');

  const response = await fetchJson(endpoint.toString());
  if (!response.ok || !Array.isArray(response.data)) {
    return { result: null, httpRequests: 1 };
  }

  const candidates: PriceCandidate[] = [];

  for (const product of response.data) {
    const productName = String(product?.productName || product?.productTitle || product?.name || '').trim();
    const productUrl =
      absolutizeUrl(String(product?.link || ''), 'https://www.carrefour.com.br') ||
      (product?.linkText
        ? `https://www.carrefour.com.br/${String(product.linkText).replace(/^\/+/, '')}/p`
        : null);

    const items = Array.isArray(product?.items) ? product.items : [];
    if (items.length === 0) {
      const score = modelMatchScore(params.modelo, productName);
      if (score >= 0.72 && productUrl) {
        candidates.push({
          title: productName || null,
          url: productUrl,
          price: null,
          termPrice: null,
          installmentText: null,
          confidence: Math.round(72 + score * 24),
        });
      }
      continue;
    }

    for (const item of items) {
      const itemName = String(item?.nameComplete || item?.name || '').trim();
      const title = [productName, itemName].filter(Boolean).join(' - ');
      const score = modelMatchScore(params.modelo, title);
      if (score < 0.72) continue;

      const sellers = Array.isArray(item?.sellers) ? item.sellers : [];
      for (const seller of sellers) {
        const offer = seller?.commertialOffer || seller?.commercialOffer || {};
        const available = Number(offer?.AvailableQuantity ?? offer?.availableQuantity ?? 1);
        if (Number.isFinite(available) && available <= 0) continue;

        const price =
          toPrice(offer?.spotPrice) ||
          toPrice(offer?.Price) ||
          toPrice(offer?.price) ||
          toPrice(offer?.PriceWithoutDiscount);
        if (!price) continue;

        const installment = vtexInstallment(offer);
        candidates.push({
          title: title || productName || null,
          url: productUrl,
          price,
          termPrice: installment.total,
          installmentText: installment.text,
          confidence: Math.round(Math.min(99, 78 + score * 20)),
        });
      }
    }
  }

  const candidate = choosePricedCandidate(candidates, params.modelo, params.loja);
  if (!candidate) return { result: null, httpRequests: 1 };

  return {
    result: resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate,
      source: 'carrefour_vtex_api',
    }),
    httpRequests: 1,
  };
}

async function pesquisarMercadoLivreApi(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ result: OnlinePriceResult | null; httpRequests: number }> {
  const endpoint = new URL('https://api.mercadolibre.com/sites/MLB/search');
  endpoint.searchParams.set('q', params.modelo);
  endpoint.searchParams.set('limit', '50');

  const accessToken = String(process.env.MERCADOLIVRE_ACCESS_TOKEN || '').trim();
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchJson(endpoint.toString(), headers);
  const items = Array.isArray(response.data?.results) ? response.data.results : [];
  if (!response.ok || items.length === 0) {
    return { result: null, httpRequests: 1 };
  }

  const candidates: PriceCandidate[] = [];
  for (const item of items) {
    const condition = String(item?.condition || '').trim().toLowerCase();
    if (condition && condition !== 'new') continue;

    const title = String(item?.title || '').trim();
    const url = String(item?.permalink || '').trim() || null;
    const score = modelMatchScore(params.modelo, title);
    if (score < 0.72 || !url || !isAllowedStoreUrl(url, params.loja)) continue;

    const price = toPrice(item?.price);
    if (!price) continue;

    const quantity = Number(item?.installments?.quantity || 0);
    const installmentAmount = toPrice(item?.installments?.amount);
    const termPrice = quantity === 12 && installmentAmount
      ? Math.round(quantity * installmentAmount * 100) / 100
      : null;

    candidates.push({
      title,
      url,
      price,
      termPrice,
      installmentText:
        quantity === 12 && installmentAmount
          ? `12x de R$ ${installmentAmount.toFixed(2).replace('.', ',')}`
          : null,
      confidence: Math.round(Math.min(99, 80 + score * 19)),
    });
  }

  const candidate = choosePricedCandidate(candidates, params.modelo, params.loja);
  if (!candidate) return { result: null, httpRequests: 1 };

  return {
    result: resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate,
      source: 'mercadolivre_api',
    }),
    httpRequests: 1,
  };
}


type TavilySearchItem = {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  score?: number | null;
};

function isTavilyEnabled(): boolean {
  return envBoolean('ONLINE_PRICES_TAVILY_ENABLED', true);
}

function getTavilyMaxResults(): number {
  return Math.max(3, Math.min(20, envNumber('ONLINE_PRICES_TAVILY_MAX_RESULTS', 10)));
}

function isUndesiredCondition(title: string, content: string, url: string): boolean {
  const strongText = normalizeProductText(`${title} ${url}`);
  const contentText = normalizeProductText(content);
  const strongTerms = [
    'USADO',
    'SEMINOVO',
    'SEMI NOVO',
    'MOSTRUARIO',
    'RECONDICIONADO',
    'OUTLET',
    'TRINCO',
    'AVARIA',
    'AVARIADO',
    'OPEN BOX',
    'CAIXA ABERTA',
    'RENOVADO',
    'REFURBISHED',
  ];

  if (strongTerms.some((term) => strongText.includes(normalizeProductText(term)))) return true;

  const explicitContentTerms = [
    'PRODUTO DE MOSTRUARIO',
    'PRODUTO USADO',
    'APARELHO USADO',
    'PRODUTO SEMINOVO',
    'PRODUTO SEMI NOVO',
    'PRODUTO RECONDICIONADO',
    'COM AVARIA',
    'TRINCO NA TELA',
    'PRODUTO RENOVADO',
    'PRODUTO REFURBISHED',
  ];

  return explicitContentTerms.some((term) =>
    contentText.includes(normalizeProductText(term)),
  );
}


function detectAvailabilityFromText(value: string): 'disponivel' | 'indisponivel' | null {
  const text = normalizeProductText(value);
  if (!text) return null;

  const unavailableTerms = [
    'INDISPONIVEL',
    'SEM ESTOQUE',
    'ESGOTADO',
    'NAO DISPONIVEL',
    'PRODUTO INDISPONIVEL',
    'AVISE ME',
    'AVISE-ME',
    'FORA DE ESTOQUE',
    'OUT OF STOCK',
  ];
  if (unavailableTerms.some((term) => text.includes(normalizeProductText(term)))) {
    return 'indisponivel';
  }

  const availableTerms = ['DISPONIVEL', 'EM ESTOQUE', 'ESTOQUE DISPONIVEL', 'COMPRAR AGORA'];
  if (availableTerms.some((term) => text.includes(normalizeProductText(term)))) {
    return 'disponivel';
  }

  return null;
}

function getTavilyDomains(loja: OnlineStoreTarget): string[] {
  const domains = new Set(loja.dominios.map(normalizeDomain).filter(Boolean));
  const store = getStoreKey(loja);

  if (store.includes('MERCADO LIVRE')) {
    domains.add('mercadolivre.com.br');
    domains.add('www.mercadolivre.com.br');
    domains.add('produto.mercadolivre.com.br');
    domains.add('lista.mercadolivre.com.br');
  }
  if (store.includes('CARREFOUR')) {
    domains.add('carrefour.com.br');
    domains.add('www.carrefour.com.br');
  }
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    domains.add('magazineluiza.com.br');
    domains.add('www.magazineluiza.com.br');
    domains.add('magalu.com.br');
  }
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    domains.add('fastshop.com.br');
    domains.add('www.fastshop.com.br');
    domains.add('site.fastshop.com.br');
  }
  if (store.includes('AMAZON')) {
    domains.add('amazon.com.br');
    domains.add('www.amazon.com.br');
  }
  if (store.includes('SAMSUNG')) {
    domains.add('samsung.com.br');
    domains.add('www.samsung.com.br');
    domains.add('shop.samsung.com.br');
  }

  return Array.from(domains);
}

function samsungReferenceHint(modelo: string): string | null {
  const normalized = normalizeProductText(modelo);
  const family = normalizeProductText(getBaseModelFamily(normalized) || '');
  const network = extractNetwork(normalized);

  if (family === 'GALAXY A06') return network === '5G' ? 'SM-A066' : 'SM-A065';
  if (family === 'GALAXY S26 ULTRA') return 'SM-S948';
  if (family === 'GALAXY S26') return 'SM-S942';
  return null;
}

function buildTavilyQueryVariants(modelo: string, loja: OnlineStoreTarget): string[] {
  const normalized = normalizeProductText(modelo);
  const family = normalizeProductText(getBaseModelFamily(normalized) || modelo);
  const storage = normalizeProductText(extractStorage(normalized) || '');
  const network = extractNetwork(normalized);
  const store = getStoreKey(loja);
  const isGalaxyAmf = /^GALAXY [AMF]\d{2}$/.test(family);
  const effectiveNetwork = network || (isGalaxyAmf ? '4G' : null);

  const canonicalParts = ['Samsung', family, storage, effectiveNetwork].filter(Boolean);
  const canonical = canonicalParts.join(' ').replace(/\s+/g, ' ').trim();
  const queries = new Set<string>();

  queries.add(canonical || `Samsung ${modelo.trim()}`);

  if (store.includes('MERCADO LIVRE')) queries.add(`${canonical} novo`);
  if (store.includes('CARREFOUR')) queries.add(`${canonical} smartphone`);
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    queries.add(`${canonical} 4GB RAM`);
    queries.add(`${family} ${storage} Samsung`);
  }
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    queries.add(`${canonical} smartphone Samsung`);
    queries.add(`${family} ${storage} Samsung`);
  }
  if (store.includes('AMAZON')) {
    queries.add(`${canonical} novo smartphone`);
    queries.add(`${family} ${storage} Samsung novo`);
  }
  if (store.includes('SAMSUNG')) {
    const ref = samsungReferenceHint(modelo);
    if (ref) queries.add(`${canonical} ${ref}`);
    queries.add(`${family} ${storage}`);
  }

  return Array.from(queries)
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isLikelyProductDetailUrl(url: string, loja: OnlineStoreTarget): boolean {
  const store = getStoreKey(loja);
  const lower = String(url || '').toLowerCase();

  if (store.includes('MERCADO LIVRE')) {
    return (
      lower.includes('/p/mlb') ||
      lower.includes('/up/mlbu') ||
      lower.includes('produto.mercadolivre.com.br/mlb-')
    );
  }

  if (store.includes('CARREFOUR')) {
    return lower.includes('/produto/') || /\/[a-z0-9-]+-\d{6,}/i.test(lower);
  }

  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/produto/');
  }

  if (store.includes('AMAZON')) {
    return lower.includes('/dp/') || lower.includes('/gp/product/');
  }

  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/produto/');
  }

  if (store.includes('SAMSUNG')) {
    return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/smartphones/');
  }

  return true;
}

function minimumPlausiblePrice(modelo: string): number {
  const normalized = normalizeProductText(modelo);
  if (
    normalized.includes('GALAXY') ||
    normalized.includes('IPHONE') ||
    normalized.includes('SMARTPHONE')
  ) {
    return 250;
  }
  return 20;
}

function parseMoneyToken(raw: string, after: string): number | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;

  if (/^\d{4,6}$/.test(clean) && /^\s*\d{1,2}%\s*OFF/i.test(after)) {
    const numeric = Number(clean);
    if (Number.isFinite(numeric)) return Math.round(numeric) / 100;
  }

  return toPrice(clean);
}

function extractPriceSignalsFromText(
  modelo: string,
  text: string,
): {
  cash: number | null;
  termTotal: number | null;
  installmentText: string | null;
} {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) {
    return { cash: null, termTotal: null, installmentText: null };
  }

  const minPrice = minimumPlausiblePrice(modelo);
  const maxPrice = 100_000;

  let termTotal: number | null = null;
  let installmentText: string | null = null;

  const installmentRegex =
    /(?:em\s+at[eé]\s+)?12\s*x\s*(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi;

  let installmentMatch: RegExpExecArray | null;
  while ((installmentMatch = installmentRegex.exec(source)) !== null) {
    const amount = toPrice(installmentMatch[1]);
    if (!amount || amount <= 0) continue;

    const total = Math.round(amount * 12 * 100) / 100;
    if (total < minPrice || total > maxPrice) continue;

    if (!termTotal || total < termTotal) {
      termTotal = total;
      installmentText = `12x de R$ ${amount.toFixed(2).replace('.', ',')}`;
    }
  }

  type MoneyCandidate = {
    value: number;
    score: number;
    index: number;
  };

  const candidates: MoneyCandidate[] = [];
  const moneyRegex =
    /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi;

  let match: RegExpExecArray | null;
  while ((match = moneyRegex.exec(source)) !== null) {
    const before = source.slice(Math.max(0, match.index - 42), match.index);
    const after = source.slice(
      moneyRegex.lastIndex,
      Math.min(source.length, moneyRegex.lastIndex + 42),
    );
    const normalizedBefore = normalizeProductText(before);
    const normalizedAfter = normalizeProductText(after);

    if (
      /(?:^|\s)(?:10|12)\s*X\s*(?:DE)?\s*$/i.test(normalizedBefore) ||
      normalizedBefore.endsWith('PARCELA') ||
      normalizedBefore.endsWith('PARCELAS')
    ) {
      continue;
    }

    const value = parseMoneyToken(match[1] ?? '', after);
    if (!value || value < minPrice || value > maxPrice) continue;

    let score = 0;

    if (/\bPOR\s*$/i.test(normalizedBefore)) score += 4;
    if (
      normalizedAfter.startsWith('A VISTA') ||
      normalizedAfter.startsWith('NO PIX') ||
      normalizedAfter.startsWith('PIX')
    ) {
      score += 4;
    }
    if (normalizedAfter.includes('OFF')) score += 2;
    if (normalizedAfter.includes('DISPONIVEL')) score += 2;
    if (normalizedBefore.endsWith('DE')) score -= 3;
    if (normalizedBefore.includes('PARCEL')) score -= 6;

    candidates.push({
      value,
      score,
      index: match.index,
    });
  }

  if (candidates.length === 0) {
    return { cash: null, termTotal, installmentText };
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.value !== b.value) return a.value - b.value;
    return a.index - b.index;
  });

  const best = candidates[0];
  if (!best) {
    return { cash: null, termTotal, installmentText };
  }

  if (
    best.score <= 0 &&
    minimumPlausiblePrice(modelo) >= 250 &&
    best.value < 350
  ) {
    return { cash: null, termTotal, installmentText };
  }

  return {
    cash: best.value,
    termTotal,
    installmentText,
  };
}

async function pesquisarTavily(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{
  result: OnlinePriceResult | null;
  httpRequests: number;
  discoveredUrl: boolean;
  searchRequests: number;
  extractRequests: number;
  creditsEstimated: number;
}> {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim();
  const empty = {
    result: null as OnlinePriceResult | null,
    httpRequests: 0,
    discoveredUrl: false,
    searchRequests: 0,
    extractRequests: 0,
    creditsEstimated: 0,
  };

  if (!isTavilyEnabled() || !apiKey) return empty;

  const domains = getTavilyDomains(params.loja);
  if (domains.length === 0) return empty;

  const queries = buildTavilyQueryVariants(params.modelo, params.loja);
  const maxAttempts = Math.max(
    1,
    Math.min(3, envNumber('ONLINE_PRICES_TAVILY_MAX_SEARCH_ATTEMPTS', 2)),
  );
  const timeoutMs = Math.max(
    3000,
    envNumber('ONLINE_PRICES_TAVILY_TIMEOUT_MS', 12000),
  );

  let httpRequests = 0;
  let searchRequests = 0;
  let extractRequests = 0;
  const collected = new Map<string, TavilySearchItem>();

  type RankedTavily = {
    candidate: PriceCandidate;
    matchScore: number;
    tavilyScore: number;
    detailUrl: boolean;
    availability: 'disponivel' | 'indisponivel' | null;
  };

  const buildRanked = (): RankedTavily[] => {
    const ranked: RankedTavily[] = [];

    for (const item of collected.values()) {
      const url = String(item?.url || '').trim();
      const title = String(item?.title || '').trim();
      const content = String(item?.content || '').trim();

      if (!url || !isAllowedStoreUrl(url, params.loja)) continue;
      if (isUndesiredCondition(title, content, url)) continue;

      const combined = `${title} ${content} ${url}`;
      const matchScore = modelMatchScore(params.modelo, combined);
      if (matchScore < 0.72) continue;

      const prices = extractPriceSignalsFromText(
        params.modelo,
        `${title}. ${content}`,
      );
      const tavilyScore = Number(item?.score || 0);
      const detailUrl = isLikelyProductDetailUrl(url, params.loja);

      ranked.push({
        matchScore,
        tavilyScore,
        detailUrl,
        availability: detectAvailabilityFromText(`${title} ${content}`),
        candidate: {
          title: title || null,
          url,
          price: prices.cash,
          termPrice: prices.termTotal,
          installmentText: prices.installmentText,
          matchText: combined,
          confidence: Math.round(
            Math.min(
              99,
              72 +
                matchScore * 17 +
                Math.max(0, Math.min(1, tavilyScore)) * 6 +
                (detailUrl ? 4 : 0),
            ),
          ),
        },
      });
    }

    ranked.sort((a, b) => {
      if (a.detailUrl !== b.detailUrl) return a.detailUrl ? -1 : 1;

      const aHasPrice = a.candidate.price || a.candidate.termPrice ? 1 : 0;
      const bHasPrice = b.candidate.price || b.candidate.termPrice ? 1 : 0;
      if (aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;

      if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
      return b.tavilyScore - a.tavilyScore;
    });

    return ranked;
  };

  for (const query of queries.slice(0, maxAttempts)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          topic: 'general',
          search_depth: 'basic',
          max_results: getTavilyMaxResults(),
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_favicon: false,
          include_domains: domains,
          country: 'brazil',
          language: 'pt',
          filter_by_language: false,
          auto_parameters: false,
          exact_match: false,
          include_usage: true,
          safe_search: false,
        }),
      });

      httpRequests += 1;
      searchRequests += 1;
      const payload: any = await response.json().catch(() => null);

      if (!response.ok) {
        console.warn(
          `[Preços Online][Tavily] Busca falhou para ${params.modelo} / ${params.loja.nome}: HTTP ${response.status}`,
        );
        continue;
      }

      const items: TavilySearchItem[] = Array.isArray(payload?.results)
        ? payload.results
        : [];

      for (const item of items) {
        const url = String(item?.url || '').trim();
        if (!url || !isAllowedStoreUrl(url, params.loja)) continue;

        const existing = collected.get(url);
        if (!existing || Number(item?.score || 0) > Number(existing?.score || 0)) {
          collected.set(url, item);
        }
      }

      const currentRanked = buildRanked();
      const detailCount = currentRanked.filter((entry) => entry.detailUrl).length;
      console.log(
        `[Preços Online][Tavily] ${params.loja.nome} / ${params.modelo}: query="${query}" resultados=${items.length} validos=${currentRanked.length} detalhe=${detailCount}`,
      );

      // Se já descobrimos uma página de produto compatível, não gastamos outro crédito de Search.
      if (detailCount > 0) break;
    } catch (error: any) {
      httpRequests += 1;
      searchRequests += 1;
      console.warn(
        `[Preços Online][Tavily] Erro para ${params.modelo} / ${params.loja.nome}: ${String(error?.message || error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const ranked = buildRanked();
  if (ranked.length === 0) {
    return {
      ...empty,
      httpRequests,
      searchRequests,
      creditsEstimated: searchRequests,
    };
  }

  const discoveredUrl = ranked.some((item) => !!item.candidate.url);
  const detailRanked = ranked.filter((item) => item.detailUrl);
  const maxPages = Math.max(
    1,
    Math.min(5, envNumber('ONLINE_PRICES_TAVILY_MAX_PRODUCT_PAGES', 3)),
  );

  // Primeiro tentamos abrir a URL encontrada. Quando a loja permite GET normal,
  // isso evita consumir crédito adicional de Extract. Se vier só um dos preços,
  // guardamos o parcial e usamos o Extract apenas para completar o que faltou.
  let tavilyPartialResult: OnlinePriceResult | null = null;

  for (const entry of detailRanked.slice(0, maxPages)) {
    const url = entry.candidate.url;
    if (!url) continue;

    const productAttempt = await tryProductPage({
      modelo: params.modelo,
      loja: params.loja,
      url,
      source: 'tavily_url_http',
    });

    httpRequests += productAttempt.httpRequests;
    if (productAttempt.result) {
      if (productAttempt.result.disponibilidade !== 'encontrado') {
        return {
          result: productAttempt.result,
          httpRequests,
          discoveredUrl: true,
          searchRequests,
          extractRequests,
          creditsEstimated: searchRequests + extractRequests,
        };
      }

      tavilyPartialResult = tavilyPartialResult
        ? mergeFoundResults(tavilyPartialResult, productAttempt.result)
        : productAttempt.result;

      if (isCompletePriceResult(tavilyPartialResult)) {
        return {
          result: tavilyPartialResult,
          httpRequests,
          discoveredUrl: true,
          searchRequests,
          extractRequests,
          creditsEstimated: searchRequests + extractRequests,
        };
      }
    }
  }

  if (envBoolean('ONLINE_PRICES_TAVILY_EXTRACT_ENABLED', true)) {
    // Damos prioridade absoluta a páginas de produto. Só usamos uma listagem quando
    // a Tavily não conseguiu descobrir nenhuma URL de detalhe.
    const sourceForExtract = detailRanked.length > 0 ? detailRanked : ranked.slice(0, 1);
    const extractUrls = sourceForExtract
      .map((item) => item.candidate.url)
      .filter((url): url is string => !!url)
      .slice(
        0,
        Math.max(
          1,
          Math.min(5, envNumber('ONLINE_PRICES_TAVILY_EXTRACT_MAX_URLS', 3)),
        ),
      );

    if (extractUrls.length > 0) {
      const extractController = new AbortController();
      const extractTimeoutMs = Math.max(
        3000,
        envNumber('ONLINE_PRICES_TAVILY_EXTRACT_TIMEOUT_MS', 15000),
      );
      const extractTimer = setTimeout(
        () => extractController.abort(),
        extractTimeoutMs,
      );

      try {
        const extractResponse = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          signal: extractController.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            urls: extractUrls,
            query: `${params.modelo} preço atual à vista pix parcelamento 12x disponibilidade estoque`,
            chunks_per_source: 5,
            extract_depth: 'basic',
            include_images: false,
            include_favicon: false,
            format: 'text',
            include_usage: true,
          }),
        });

        httpRequests += 1;
        extractRequests += 1;
        const extractPayload = await extractResponse.json().catch(() => null);

        if (extractResponse.ok) {
          const extractedResults = Array.isArray(extractPayload?.results)
            ? extractPayload.results
            : [];
          const extractedCandidates: PriceCandidate[] = [];
          const unavailableCandidates: PriceCandidate[] = [];

          for (const extracted of extractedResults) {
            const url = String(extracted?.url || '').trim();
            const rawContent = String(extracted?.raw_content || '').trim();
            if (!url || !rawContent || !isAllowedStoreUrl(url, params.loja)) continue;

            const base = ranked.find(
              (entry) => String(entry.candidate.url || '') === url,
            );
            const title = base?.candidate.title || null;
            const matchText = `${title || ''} ${rawContent} ${url}`;

            if (isUndesiredCondition(String(title || ''), rawContent, url)) continue;
            if (modelMatchScore(params.modelo, matchText) < 0.72) continue;

            const prices = extractPriceSignalsFromText(
              params.modelo,
              `${title || ''}. ${rawContent}`,
            );
            const candidate: PriceCandidate = {
              title,
              url,
              price: prices.cash,
              termPrice: prices.termTotal,
              installmentText: prices.installmentText,
              matchText,
              confidence: Math.min(
                99,
                Math.max(90, (base?.candidate.confidence || 86) + 3),
              ),
            };

            if (prices.cash || prices.termTotal) {
              extractedCandidates.push(candidate);
            } else if (detectAvailabilityFromText(rawContent) === 'indisponivel') {
              unavailableCandidates.push(candidate);
            }
          }

          const extractedCandidate = choosePricedCandidate(
            extractedCandidates,
            params.modelo,
            params.loja,
          );

          if (extractedCandidate) {
            const result = resultFromCandidate({
              modelo: params.modelo,
              loja: params.loja,
              candidate: extractedCandidate,
              source: 'tavily_extract',
            });

            if (result) {
              const merged = tavilyPartialResult
                ? mergeFoundResults(tavilyPartialResult, result)
                : result;
              return {
                result: merged,
                httpRequests,
                discoveredUrl: true,
                searchRequests,
                extractRequests,
                creditsEstimated: searchRequests + extractRequests,
              };
            }
          }

          const unavailableCandidate = rankCandidates(
            unavailableCandidates,
            params.modelo,
            params.loja,
          )[0];
          if (unavailableCandidate) {
            return {
              result: resultUnavailableFromCandidate({
                modelo: params.modelo,
                loja: params.loja,
                candidate: unavailableCandidate,
                source: 'tavily_extract_status',
              }),
              httpRequests,
              discoveredUrl: true,
              searchRequests,
              extractRequests,
              creditsEstimated: searchRequests + extractRequests,
            };
          }
        } else {
          console.warn(
            `[Preços Online][Tavily Extract] Falhou para ${params.modelo} / ${params.loja.nome}: HTTP ${extractResponse.status}`,
          );
        }
      } catch (error: any) {
        httpRequests += 1;
        extractRequests += 1;
        console.warn(
          `[Preços Online][Tavily Extract] Erro para ${params.modelo} / ${params.loja.nome}: ${String(error?.message || error)}`,
        );
      } finally {
        clearTimeout(extractTimer);
      }
    }
  }

  // Último fallback sem IA: usamos o snippet da Tavily. Se já existem páginas de
  // detalhe, nunca preferimos uma página de lista apenas por ela ter preço no snippet.
  const pricedPool = detailRanked.length > 0 ? detailRanked : ranked;
  const pricedEntry = pricedPool
    .filter((item) => item.candidate.price || item.candidate.termPrice)
    .sort((a, b) => {
      if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
      const priceA = a.candidate.price ?? a.candidate.termPrice ?? Number.MAX_SAFE_INTEGER;
      const priceB = b.candidate.price ?? b.candidate.termPrice ?? Number.MAX_SAFE_INTEGER;
      return priceA - priceB;
    })[0];

  if (pricedEntry) {
    const result = resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate: pricedEntry.candidate,
      source: 'tavily_search',
    });
    if (result) {
      const merged = tavilyPartialResult
        ? mergeFoundResults(tavilyPartialResult, result)
        : result;
      return {
        result: merged,
        httpRequests,
        discoveredUrl: true,
        searchRequests,
        extractRequests,
        creditsEstimated: searchRequests + extractRequests,
      };
    }
  }

  if (tavilyPartialResult) {
    return {
      result: tavilyPartialResult,
      httpRequests,
      discoveredUrl: true,
      searchRequests,
      extractRequests,
      creditsEstimated: searchRequests + extractRequests,
    };
  }

  const unavailableEntry = detailRanked.find(
    (entry) => entry.availability === 'indisponivel',
  );
  if (unavailableEntry) {
    return {
      result: resultUnavailableFromCandidate({
        modelo: params.modelo,
        loja: params.loja,
        candidate: unavailableEntry.candidate,
        source: 'tavily_search_status',
      }),
      httpRequests,
      discoveredUrl: true,
      searchRequests,
      extractRequests,
      creditsEstimated: searchRequests + extractRequests,
    };
  }

  return {
    result: null,
    httpRequests,
    discoveredUrl,
    searchRequests,
    extractRequests,
    creditsEstimated: searchRequests + extractRequests,
  };
}

async function discoverWithGoogleCse(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ url: string | null; httpRequests: number }> {
  const apiKey = String(process.env.GOOGLE_CSE_API_KEY || '').trim();
  const cx = String(process.env.GOOGLE_CSE_CX || '').trim();
  if (!apiKey || !cx || params.loja.dominios.length === 0) {
    return { url: null, httpRequests: 0 };
  }

  const domains = params.loja.dominios.map(normalizeDomain).filter(Boolean);
  const siteQuery = domains.map((domain) => `site:${domain}`).join(' OR ');
  const query = `"${params.modelo}" (${siteQuery})`;
  const endpoint = new URL('https://www.googleapis.com/customsearch/v1');
  endpoint.searchParams.set('key', apiKey);
  endpoint.searchParams.set('cx', cx);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('num', '5');
  endpoint.searchParams.set('gl', 'br');
  endpoint.searchParams.set('hl', 'pt-BR');

  const response = await fetchJson(endpoint.toString());
  if (!response.ok) return { url: null, httpRequests: 1 };

  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  const ranked = items
    .map((item: any) => {
      const link = String(item?.link || '').trim();
      const text = `${item?.title || ''} ${item?.snippet || ''} ${link}`;
      return { link, score: modelMatchScore(params.modelo, text) };
    })
    .filter(
      (item: { link: string; score: number }) =>
        item.score >= 0.72 && isAllowedStoreUrl(item.link, params.loja),
    )
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  return { url: ranked[0]?.link || null, httpRequests: 1 };
}

async function pesquisarBuscaHtml(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<{ result: OnlinePriceResult | null; httpRequests: number; discoveredUrl: boolean }> {
  const searchUrl = buildSearchUrl(params.modelo, params.loja);
  if (!searchUrl || !isAllowedStoreUrl(searchUrl, params.loja)) {
    return { result: null, httpRequests: 0, discoveredUrl: false };
  }

  const searchPage = await fetchHtml(searchUrl);
  let httpRequests = 1;
  if (!searchPage.html) return { result: null, httpRequests, discoveredUrl: false };

  const structured = structuredCandidates(searchPage.html, searchPage.finalUrl || searchUrl, params.modelo);
  const directCandidate = choosePricedCandidate(structured, params.modelo, params.loja);
  if (directCandidate?.price) {
    const result = resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate: directCandidate,
      html: searchPage.html,
      source: 'http_search_structured',
    });
    if (result) return { result, httpRequests, discoveredUrl: !!result.url };
  }

  const hrefCandidates = extractHrefCandidatesWithContext(
    searchPage.html,
    searchPage.finalUrl || searchUrl,
    params.modelo,
    params.loja,
  );
  const embeddedCandidates = extractEmbeddedUrlCandidates(
    searchPage.html,
    searchPage.finalUrl || searchUrl,
    params.modelo,
    params.loja,
  );

  const ranked = rankCandidates(
    [...structured, ...hrefCandidates, ...embeddedCandidates],
    params.modelo,
    params.loja,
  ).filter((candidate) => candidate.url && candidate.url !== searchPage.finalUrl && candidate.url !== searchUrl);

  const maxProductPages = Math.max(1, Math.min(8, envNumber('ONLINE_PRICES_MAX_PRODUCT_PAGES_PER_STORE', 5)));
  let discoveredUrl = ranked.length > 0;

  for (const candidate of ranked.slice(0, maxProductPages)) {
    if (!candidate.url) continue;
    const productAttempt = await tryProductPage({
      modelo: params.modelo,
      loja: params.loja,
      url: candidate.url,
      source: 'http_store_search',
    });
    httpRequests += productAttempt.httpRequests;
    if (productAttempt.result) {
      return { result: productAttempt.result, httpRequests, discoveredUrl: true };
    }
  }

  return { result: null, httpRequests, discoveredUrl };
}

export async function pesquisarPrecoSemIa(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  preferredUrl?: string | null;
}): Promise<DirectLookupResponse> {
  const stats: DirectLookupStats = {
    httpRequests: 0,
    reusedUrl: false,
    discoveredUrl: false,
    tavilySearchRequests: 0,
    tavilyExtractRequests: 0,
    tavilyCreditsEstimated: 0,
  };

  if (!params.loja.dominios.length) return { result: null, stats };

  let partialResult: OnlinePriceResult | null = null;

  if (params.preferredUrl && isAllowedStoreUrl(params.preferredUrl, params.loja)) {
    const cachedUrlAttempt = await tryProductPage({
      modelo: params.modelo,
      loja: params.loja,
      url: params.preferredUrl,
      source: 'http_url_cache',
    });
    stats.httpRequests += cachedUrlAttempt.httpRequests;
    stats.reusedUrl = cachedUrlAttempt.httpRequests > 0;
    if (cachedUrlAttempt.result) {
      if (cachedUrlAttempt.result.disponibilidade !== 'encontrado' || isCompletePriceResult(cachedUrlAttempt.result)) {
        return { result: cachedUrlAttempt.result, stats };
      }
      partialResult = cachedUrlAttempt.result;
    }
  }

  const store = getStoreKey(params.loja);

  // Carrefour usa VTEX. Consultar o catálogo JSON evita HTML/JS e é muito mais barato e estável.
  if (store.includes('CARREFOUR')) {
    const vtex = await pesquisarCarrefourVtex({ modelo: params.modelo, loja: params.loja });
    stats.httpRequests += vtex.httpRequests;
    if (vtex.result) {
      stats.discoveredUrl = !!vtex.result.url;
      if (vtex.result.disponibilidade !== 'encontrado' || isCompletePriceResult(vtex.result)) {
        return { result: vtex.result, stats };
      }
      partialResult = partialResult ? mergeFoundResults(partialResult, vtex.result) : vtex.result;
    }
  }

  // Mercado Livre: tenta a API oficial primeiro. Se o endpoint não estiver liberado para a aplicação,
  // cai automaticamente para a página pública de busca, sem consumir tokens de IA.
  if (store.includes('MERCADO LIVRE')) {
    const mercadoLivre = await pesquisarMercadoLivreApi({ modelo: params.modelo, loja: params.loja });
    stats.httpRequests += mercadoLivre.httpRequests;
    if (mercadoLivre.result) {
      stats.discoveredUrl = !!mercadoLivre.result.url;
      if (mercadoLivre.result.disponibilidade !== 'encontrado' || isCompletePriceResult(mercadoLivre.result)) {
        return { result: mercadoLivre.result, stats };
      }
      partialResult = partialResult ? mergeFoundResults(partialResult, mercadoLivre.result) : mercadoLivre.result;
    }
  }

  // Tavily descobre URLs restritas ao domínio da loja e não consome tokens do Claude.
  const tavily = await pesquisarTavily({ modelo: params.modelo, loja: params.loja });
  stats.httpRequests += tavily.httpRequests;
  stats.tavilySearchRequests += tavily.searchRequests;
  stats.tavilyExtractRequests += tavily.extractRequests;
  stats.tavilyCreditsEstimated += tavily.creditsEstimated;
  stats.discoveredUrl = stats.discoveredUrl || tavily.discoveredUrl;
  if (tavily.result) {
    if (partialResult && tavily.result.disponibilidade === 'encontrado') {
      return { result: mergeFoundResults(partialResult, tavily.result), stats };
    }
    if (partialResult && tavily.result.disponibilidade !== 'encontrado') {
      return { result: partialResult, stats };
    }
    return { result: tavily.result, stats };
  }

  const googleDiscovery = await discoverWithGoogleCse({ modelo: params.modelo, loja: params.loja });
  stats.httpRequests += googleDiscovery.httpRequests;
  if (googleDiscovery.url) {
    stats.discoveredUrl = true;
    const googleProductAttempt = await tryProductPage({
      modelo: params.modelo,
      loja: params.loja,
      url: googleDiscovery.url,
      source: 'google_cse_http',
    });
    stats.httpRequests += googleProductAttempt.httpRequests;
    if (googleProductAttempt.result) {
      if (partialResult && googleProductAttempt.result.disponibilidade === 'encontrado') {
        return { result: mergeFoundResults(partialResult, googleProductAttempt.result), stats };
      }
      return { result: googleProductAttempt.result, stats };
    }
  }

  const htmlSearch = await pesquisarBuscaHtml({ modelo: params.modelo, loja: params.loja });
  stats.httpRequests += htmlSearch.httpRequests;
  stats.discoveredUrl = stats.discoveredUrl || htmlSearch.discoveredUrl;
  if (htmlSearch.result) {
    if (partialResult && htmlSearch.result.disponibilidade === 'encontrado') {
      return { result: mergeFoundResults(partialResult, htmlSearch.result), stats };
    }
    return { result: htmlSearch.result, stats };
  }

  if (partialResult) return { result: partialResult, stats };
  return { result: null, stats };
}
