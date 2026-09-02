import { getBaseModelFamily, extractStorage } from '../../productDictionary/productDictionary.utils';
import { OnlinePriceResult, OnlineStoreTarget } from './onlinePrices.types';

type DirectLookupStats = {
  httpRequests: number;
  reusedUrl: boolean;
  discoveredUrl: boolean;
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
      score: modelMatchScore(modelo, `${candidate.title || ''} ${candidate.url || ''}`),
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
  if (!candidate) return { result: null, httpRequests: 1 };

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
  };

  if (!params.loja.dominios.length) return { result: null, stats };

  if (params.preferredUrl && isAllowedStoreUrl(params.preferredUrl, params.loja)) {
    const cachedUrlAttempt = await tryProductPage({
      modelo: params.modelo,
      loja: params.loja,
      url: params.preferredUrl,
      source: 'http_url_cache',
    });
    stats.httpRequests += cachedUrlAttempt.httpRequests;
    stats.reusedUrl = cachedUrlAttempt.httpRequests > 0;
    if (cachedUrlAttempt.result) return { result: cachedUrlAttempt.result, stats };
  }

  const store = getStoreKey(params.loja);

  // Carrefour usa VTEX. Consultar o catálogo JSON evita HTML/JS e é muito mais barato e estável.
  if (store.includes('CARREFOUR')) {
    const vtex = await pesquisarCarrefourVtex({ modelo: params.modelo, loja: params.loja });
    stats.httpRequests += vtex.httpRequests;
    if (vtex.result) {
      stats.discoveredUrl = !!vtex.result.url;
      return { result: vtex.result, stats };
    }
  }

  // Mercado Livre: tenta a API oficial primeiro. Se o endpoint não estiver liberado para a aplicação,
  // cai automaticamente para a página pública de busca, sem consumir tokens de IA.
  if (store.includes('MERCADO LIVRE')) {
    const mercadoLivre = await pesquisarMercadoLivreApi({ modelo: params.modelo, loja: params.loja });
    stats.httpRequests += mercadoLivre.httpRequests;
    if (mercadoLivre.result) {
      stats.discoveredUrl = !!mercadoLivre.result.url;
      return { result: mercadoLivre.result, stats };
    }
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
    if (googleProductAttempt.result) return { result: googleProductAttempt.result, stats };
  }

  const htmlSearch = await pesquisarBuscaHtml({ modelo: params.modelo, loja: params.loja });
  stats.httpRequests += htmlSearch.httpRequests;
  stats.discoveredUrl = stats.discoveredUrl || htmlSearch.discoveredUrl;
  if (htmlSearch.result) return { result: htmlSearch.result, stats };

  return { result: null, stats };
}
