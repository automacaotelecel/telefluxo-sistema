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

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_HTML_CHARS = 1_800_000;
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
    const value = decodeHtmlEntities(href).trim();
    if (!value || value.startsWith('javascript:') || value.startsWith('#')) return null;
    return new URL(value, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

function getModelTokens(modelo: string): string[] {
  const stop = new Set([
    'SMARTPHONE',
    'CELULAR',
    'APARELHO',
    'SAMSUNG',
    'GALAXY',
    'APPLE',
    'MOTOROLA',
    'XIAOMI',
    'MOTO',
    'COM',
    'DUAL',
    'CHIP',
    'ANDROID',
    '5G',
  ]);

  return normalizeProductText(modelo)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !stop.has(token) && (token.length >= 2 || /\d/.test(token)));
}

function modelMatchScore(modelo: string, candidateText: string): number {
  const tokens = getModelTokens(modelo);
  if (tokens.length === 0) return 0;

  const haystack = ` ${normalizeProductText(candidateText)} `;
  const numericTokens = tokens.filter((token) => /\d/.test(token));

  for (const token of numericTokens) {
    if (!haystack.includes(` ${token} `) && !haystack.includes(token)) {
      return 0;
    }
  }

  let matched = 0;
  let weight = 0;
  for (const token of tokens) {
    const tokenWeight = /\d/.test(token) ? 2 : 1;
    weight += tokenWeight;
    if (haystack.includes(` ${token} `) || haystack.includes(token)) matched += tokenWeight;
  }

  return weight > 0 ? matched / weight : 0;
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
  const plain = stripHtml(html).slice(0, 600_000);
  const patterns = [
    /12\s*x\s*(?:de\s*)?R\$\s*([0-9.]+,[0-9]{2})/i,
    /12\s*parcelas?\s*(?:de\s*)?R\$\s*([0-9.]+,[0-9]{2})/i,
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

    if (score >= 0.55 && (price || url)) {
      candidates.push({
        title,
        url,
        price,
        termPrice: null,
        installmentText: null,
        confidence: Math.round(Math.min(98, 72 + score * 24)),
      });
    }
  }

  const ogTitle = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'title');
  const ogUrl = metaContent(html, 'property', 'og:url') || pageUrl;
  const metaPrice =
    toPrice(metaContent(html, 'property', 'product:price:amount')) ||
    toPrice(metaContent(html, 'itemprop', 'price')) ||
    toPrice(metaContent(html, 'property', 'og:price:amount'));
  const metaScore = modelMatchScore(modelo, `${ogTitle || ''} ${ogUrl || ''}`);

  if (metaScore >= 0.55 && (metaPrice || ogUrl)) {
    candidates.push({
      title: ogTitle,
      url: ogUrl,
      price: metaPrice,
      termPrice: null,
      installmentText: null,
      confidence: Math.round(Math.min(94, 68 + metaScore * 22)),
    });
  }

  return candidates;
}

function anchorCandidates(html: string, pageUrl: string, modelo: string, loja: OnlineStoreTarget): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,1600}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let seen = 0;

  while ((match = regex.exec(html)) !== null && seen < 5000) {
    seen += 1;
    const href = absolutizeUrl(match[1] || '', pageUrl);
    if (!href || !isAllowedStoreUrl(href, loja)) continue;

    const text = stripHtml(match[2] || '').slice(0, 400);
    const score = modelMatchScore(modelo, `${text} ${href}`);
    if (score < 0.68) continue;

    candidates.push({
      title: text || null,
      url: href,
      price: null,
      termPrice: null,
      installmentText: null,
      confidence: Math.round(Math.min(90, 60 + score * 28)),
    });
  }

  return candidates;
}

function chooseCandidate(candidates: PriceCandidate[], modelo: string, loja: OnlineStoreTarget): PriceCandidate | null {
  const valid = candidates
    .filter((candidate) => !candidate.url || isAllowedStoreUrl(candidate.url, loja))
    .map((candidate) => ({
      candidate,
      score: modelMatchScore(modelo, `${candidate.title || ''} ${candidate.url || ''}`),
    }))
    .filter((item) => item.score >= 0.55)
    .sort((a, b) => {
      const aPrice = a.candidate.price ? 1 : 0;
      const bPrice = b.candidate.price ? 1 : 0;
      if (aPrice !== bPrice) return bPrice - aPrice;
      if (a.score !== b.score) return b.score - a.score;
      return b.candidate.confidence - a.candidate.confidence;
    });

  return valid[0]?.candidate || null;
}

function buildSearchUrl(modelo: string, loja: OnlineStoreTarget): string | null {
  const store = normalizeProductText(loja.nome);
  const query = modelo.trim();
  if (!query) return null;

  if (store.includes('MERCADO LIVRE')) {
    const slug = encodeURIComponent(query).replace(/%20/g, '-');
    return `https://lista.mercadolivre.com.br/${slug}`;
  }
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query)}/`;
  }
  if (store.includes('AMAZON')) {
    return `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}`;
  }
  if (store.includes('CARREFOUR')) {
    return `https://www.carrefour.com.br/busca?q=${encodeURIComponent(query)}`;
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

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(2000, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)),
  );

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { url: null, httpRequests: 1 };

    const payload: any = await response.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const ranked = items
      .map((item: any) => {
        const link = String(item?.link || '').trim();
        const text = `${item?.title || ''} ${item?.snippet || ''} ${link}`;
        return { link, score: modelMatchScore(params.modelo, text) };
      })
      .filter((item: { link: string; score: number }) => item.score >= 0.62 && isAllowedStoreUrl(item.link, params.loja))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    return { url: ranked[0]?.link || null, httpRequests: 1 };
  } catch (_) {
    return { url: null, httpRequests: 1 };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<string | null> {
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
      },
    });

    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const text = await response.text();
    return text ? text.slice(0, maxChars) : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resultFromCandidate(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  candidate: PriceCandidate;
  html: string;
  source: string;
}): OnlinePriceResult | null {
  const installment = extractInstallment(params.html);
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

  const html = await fetchHtml(params.url);
  if (!html) return { result: null, httpRequests: 1 };

  const candidate = chooseCandidate(
    structuredCandidates(html, params.url, params.modelo),
    params.modelo,
    params.loja,
  );

  if (!candidate) return { result: null, httpRequests: 1 };

  const normalizedCandidate: PriceCandidate = {
    ...candidate,
    url: candidate.url || params.url,
  };

  return {
    result: resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate: normalizedCandidate,
      html,
      source: params.source,
    }),
    httpRequests: 1,
  };
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

  const searchUrl = buildSearchUrl(params.modelo, params.loja);
  if (!searchUrl || !isAllowedStoreUrl(searchUrl, params.loja)) return { result: null, stats };

  const searchHtml = await fetchHtml(searchUrl);
  stats.httpRequests += 1;
  if (!searchHtml) return { result: null, stats };

  const structured = structuredCandidates(searchHtml, searchUrl, params.modelo);
  const directCandidate = chooseCandidate(structured, params.modelo, params.loja);
  if (directCandidate?.price) {
    const result = resultFromCandidate({
      modelo: params.modelo,
      loja: params.loja,
      candidate: directCandidate,
      html: searchHtml,
      source: 'http_search_structured',
    });
    if (result) {
      stats.discoveredUrl = !!result.url;
      return { result, stats };
    }
  }

  const links = anchorCandidates(searchHtml, searchUrl, params.modelo, params.loja);
  const candidate = chooseCandidate([...structured, ...links], params.modelo, params.loja);
  if (!candidate?.url || candidate.url === searchUrl) return { result: null, stats };

  stats.discoveredUrl = true;
  const productAttempt = await tryProductPage({
    modelo: params.modelo,
    loja: params.loja,
    url: candidate.url,
    source: 'http_store_search',
  });
  stats.httpRequests += productAttempt.httpRequests;

  return { result: productAttempt.result, stats };
}
