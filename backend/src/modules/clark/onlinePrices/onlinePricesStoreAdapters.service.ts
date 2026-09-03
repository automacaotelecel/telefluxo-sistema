import { getBaseModelFamily, extractStorage } from '../../productDictionary/productDictionary.utils';
import {
  OnlinePriceResult,
  OnlinePriceSearchStatus,
  OnlineStoreTarget,
} from './onlinePrices.types';

export type StoreAdapterStats = {
  httpRequests: number;
  adapter: string | null;
  candidatesFound: number;
};

export type StoreAdapterResponse = {
  result: OnlinePriceResult | null;
  stats: StoreAdapterStats;
};

type Network = '4G' | '5G' | null;
type AdapterAvailability = 'disponivel' | 'indisponivel' | 'desconhecido';

type ProductSignature = {
  normalized: string;
  family: string | null;
  storage: string | null;
  network: Network;
  coreToken: string | null;
};

type AdapterOffer = {
  title: string;
  url: string;
  seller: string | null;
  cashPrice: number | null;
  installmentCount: number | null;
  installmentValue: number | null;
  termTotal: number | null;
  installmentText: string | null;
  availability: AdapterAvailability;
  source: string;
  confidence: number;
  realTwelve: boolean;
};

type HttpPage = {
  html: string | null;
  status: number;
  finalUrl: string;
};

type JsonResponse = {
  data: any;
  ok: boolean;
  status: number;
};

const ENGINE_VERSION = '7.0.0';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_HTML_CHARS = 2_000_000;

const ACCESSORY_TERMS = [
  'CAPA',
  'CASE',
  'PELICULA',
  'CARTAO DE MEMORIA',
  'MICRO SD',
  'MICROSD',
  'CARREGADOR',
  'CABO',
  'FONE',
  'HEADPHONE',
  'EARBUD',
  'EARBUDS',
  'SMARTWATCH',
  'RELOGIO',
  'SUPORTE',
  'BATERIA',
  'POWER BANK',
  'POWERBANK',
  'DISPLAY',
  'TELA LCD',
  'TOUCH SCREEN',
  'LENTE CAMERA',
  'PECA',
  'PEÇAS',
];

const BAD_CONDITION_TERMS = [
  'USADO',
  'SEMINOVO',
  'SEMI NOVO',
  'RECONDICIONADO',
  'REFURBISHED',
  'OUTLET',
  'MOSTRUARIO',
  'MOSTRUÁRIO',
  'OPEN BOX',
];

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9+./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[^]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function toPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }

  let cleaned = String(value ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '')
    .trim();
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractNetwork(value: unknown): Network {
  const normalized = ` ${normalizeText(value)} `;
  if (normalized.includes(' 5G ')) return '5G';
  if (normalized.includes(' 4G ') || normalized.includes(' LTE ')) return '4G';
  return null;
}

function extractCoreToken(value: string): string | null {
  const match = normalizeText(value).match(/\b([A-Z]{1,3}\d{2,4})\b/);
  return match?.[1] || null;
}

function buildSignature(value: string): ProductSignature {
  const normalized = normalizeText(value);
  const familyRaw = getBaseModelFamily(normalized) || '';
  const storageRaw = extractStorage(normalized) || '';
  const storage = storageRaw ? normalizeText(storageRaw) : null;
  const family = familyRaw
    ? normalizeText(familyRaw)
        .replace(/\b(?:4G|5G|LTE)\b/g, ' ')
        .replace(storage || '__NO_STORAGE__', ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : null;

  return {
    normalized,
    family: family || null,
    storage,
    network: extractNetwork(normalized),
    coreToken: extractCoreToken(normalized),
  };
}

function hasToken(haystack: string, token: string): boolean {
  return ` ${haystack} `.includes(` ${token} `);
}

function exactIdentity(modelo: string, title: string): boolean {
  const target = buildSignature(modelo);
  const candidate = buildSignature(title);
  const normalizedTitle = candidate.normalized;
  if (!normalizedTitle) return false;

  if (ACCESSORY_TERMS.some((term) => normalizedTitle.includes(normalizeText(term)))) return false;
  if (BAD_CONDITION_TERMS.some((term) => normalizedTitle.includes(normalizeText(term)))) return false;
  if (/\bPARA\s+(?:SAMSUNG\s+)?GALAXY\b/.test(normalizedTitle)) return false;
  if (/\bCOMPATIVEL\s+COM\s+(?:SAMSUNG\s+)?GALAXY\b/.test(normalizedTitle)) return false;

  if (target.coreToken && candidate.coreToken !== target.coreToken) return false;
  if (target.family && candidate.family !== target.family) return false;
  if (target.storage && candidate.storage !== target.storage) return false;

  if (target.network === '5G' && candidate.network !== '5G') return false;
  if (target.network === '4G' && candidate.network === '5G') return false;
  if (!target.network && target.family?.match(/^GALAXY [AMF]\d{2,3}$/) && candidate.network === '5G') {
    return false;
  }

  for (const qualifier of ['ULTRA', 'PLUS', 'PRO', 'FE', 'FOLD', 'FLIP']) {
    const targetHas = hasToken(target.normalized, qualifier);
    const candidateHas = hasToken(candidate.normalized, qualifier);
    if (targetHas !== candidateHas && (targetHas || target.family?.startsWith('GALAXY S'))) return false;
  }

  return true;
}

function minimumPlausiblePrice(modelo: string): number {
  const normalized = normalizeText(modelo);
  if (/\bGALAXY S\d{2,3}\b/.test(normalized) && normalized.includes('ULTRA')) return 2500;
  if (/\bGALAXY S\d{2,3}\b/.test(normalized)) return 1500;
  if (/\bGALAXY Z\b/.test(normalized) || normalized.includes('FOLD') || normalized.includes('FLIP')) return 1800;
  if (/\bGALAXY [AMF]\d{2,3}\b/.test(normalized)) return 250;
  if (normalized.includes('IPHONE')) return 800;
  return 100;
}

function validPriceForModel(modelo: string, price: number | null): number | null {
  if (!price) return null;
  if (price < minimumPlausiblePrice(modelo) || price > 100_000) return null;
  return round2(price);
}

function parseTwelveFromText(modelo: string, text: string): {
  count: number | null;
  value: number | null;
  total: number | null;
  text: string | null;
} {
  const source = cleanText(decodeHtmlEntities(text));
  const minTotal = minimumPlausiblePrice(modelo);
  const matches: Array<{ value: number; total: number }> = [];
  const patterns = [
    /(?:em\s+at[eé]\s+)?12\s*x\s*(?:sem\s+juros\s*)?(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi,
    /12\s*parcelas?\s*(?:sem\s+juros\s*)?(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const installmentValue = toPrice(match[1] || '');
      if (!installmentValue) continue;
      const calculated = round2(installmentValue * 12);
      const window = source.slice(pattern.lastIndex, Math.min(source.length, pattern.lastIndex + 160));
      const explicitMatch = window.match(
        /(?:\btotal\s*[:\-]?\s*|\|\s*)R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/i,
      );
      const explicit = explicitMatch?.[1] ? toPrice(explicitMatch[1]) : null;
      const total =
        explicit &&
        explicit >= minTotal &&
        Math.abs(explicit - calculated) <= Math.max(5, calculated * 0.03)
          ? explicit
          : calculated;
      if (total < minTotal || total > 100_000) continue;
      matches.push({ value: installmentValue, total });
    }
  }

  matches.sort((a, b) => a.total - b.total);
  const best = matches[0];
  if (!best) return { count: null, value: null, total: null, text: null };
  return {
    count: 12,
    value: best.value,
    total: best.total,
    text: `12x de R$ ${best.value.toFixed(2).replace('.', ',')}`,
  };
}

function extractMeta(html: string, attr: string, value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(`<meta[^>]*${attr}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const patternB = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escaped}["'][^>]*>`, 'i');
  return decodeHtmlEntities((html.match(patternA)?.[1] || html.match(patternB)?.[1] || '').trim()) || null;
}

function extractPageTitle(html: string): string | null {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const h1Text = h1 ? stripHtml(h1) : '';
  if (h1Text) return h1Text;
  const og = extractMeta(html, 'property', 'og:title');
  if (og) return cleanText(og);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? stripHtml(title) : null;
}

function structuredPrice(html: string): number | null {
  const metaCandidates = [
    extractMeta(html, 'property', 'product:price:amount'),
    extractMeta(html, 'property', 'og:price:amount'),
    extractMeta(html, 'itemprop', 'price'),
  ];
  for (const candidate of metaCandidates) {
    const price = toPrice(candidate);
    if (price) return price;
  }

  const scripts = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(script[1] || ''));
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        if (node['@graph'] && Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        if (node.offers) {
          const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
          for (const offer of offers) {
            const price = toPrice(offer?.price ?? offer?.lowPrice ?? offer?.highPrice);
            if (price) return price;
          }
        }
      }
    } catch (_) {
      // Ignora JSON-LD inválido.
    }
  }
  return null;
}

function cashFromText(modelo: string, text: string, storeName: string): number | null {
  const source = cleanText(decodeHtmlEntities(text));
  const candidates: Array<{ value: number; score: number; index: number }> = [];
  const patterns: Array<{ regex: RegExp; score: number }> = [
    { regex: /R\$\s*([0-9][0-9.]*,\d{2})\s*(?:no\s+pix|à\s+vista|a\s+vista)/gi, score: 20 },
    { regex: /(?:no\s+pix|pix|à\s+vista|a\s+vista)[^R$]{0,45}R\$\s*([0-9][0-9.]*,\d{2})/gi, score: 20 },
    { regex: /(?:preço|preco)\s*R\$\s*([0-9][0-9.]*,\d{2})/gi, score: 12 },
    { regex: /R\$\s*([0-9][0-9.]*,\d{2})/gi, score: 2 },
  ];

  const store = normalizeText(storeName);
  for (const { regex, score } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const price = validPriceForModel(modelo, toPrice(match[1]));
      if (!price) continue;
      const before = normalizeText(source.slice(Math.max(0, match.index - 70), match.index));
      const after = normalizeText(source.slice(regex.lastIndex, Math.min(source.length, regex.lastIndex + 70)));
      if (/12\s*X\s*(?:DE)?\s*$/.test(before) || before.includes('PARCELA')) continue;
      let adjusted = score;
      if (before.includes('DE ')) adjusted -= 4;
      if (after.includes('OFF')) adjusted += 2;
      if (store.includes('FAST') && (after.includes('PIX') || before.includes('PIX'))) adjusted += 4;
      if (store.includes('MAGALU') && (after.includes('PIX') || before.includes('PIX'))) adjusted += 4;
      candidates.push({ value: price, score: adjusted, index: match.index });
    }
    if (candidates.some((item) => item.score >= 20)) break;
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.index - b.index;
  });
  return candidates[0]?.value || null;
}

function sellerFromText(text: string, storeName: string): string | null {
  const source = cleanText(decodeHtmlEntities(text));
  const store = normalizeText(storeName);
  const patterns = store.includes('MAGALU')
    ? [/Vendido\s+e\s+entregue\s+por\s+([^|•]{2,70})/i, /Informações\s+da\s+loja\s+([^|•]{2,60})/i]
    : store.includes('FAST')
      ? [/Vendido\s+e\s+entregue\s+por\s+([^|•]{2,70})/i]
      : store.includes('AMAZON')
        ? [/Vendido\s+por\s+([^|•]{2,70})/i, /Enviado\s+e\s+vendido\s+por\s+([^|•]{2,70})/i]
        : [/Vendido\s+e\s+entregue\s+por\s+([^|•]{2,70})/i, /Vendido\s+por\s+([^|•]{2,70})/i];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const seller = cleanText(match[1]).replace(/\s+(?:Entrega|Frete|Comprar|Adicionar).*$/i, '').slice(0, 80);
    if (seller) return seller;
  }
  return null;
}

function availabilityFromText(text: string): AdapterAvailability {
  const normalized = normalizeText(text);
  const bad = ['INDISPONIVEL', 'FORA DE ESTOQUE', 'ESGOTADO', 'PRODUTO INDISPONIVEL', 'SEM ESTOQUE'];
  if (bad.some((term) => normalized.includes(term))) return 'indisponivel';
  const good = ['COMPRAR AGORA', 'ADICIONAR A SACOLA', 'ADICIONAR AO CARRINHO', 'EM ESTOQUE', 'COMPRAR'];
  if (good.some((term) => normalized.includes(term))) return 'disponivel';
  return 'desconhecido';
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch (_) {
    return value;
  }
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<JsonResponse> {
  const controller = new AbortController();
  const timeoutMs = Math.max(2500, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(headers || {}),
      },
    });
    return {
      data: await response.json().catch(() => null),
      ok: response.ok,
      status: response.status,
    };
  } catch (_) {
    return { data: null, ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<HttpPage> {
  const controller = new AbortController();
  const timeoutMs = Math.max(2500, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const maxChars = Math.max(100_000, envNumber('ONLINE_PRICES_MAX_HTML_CHARS', DEFAULT_MAX_HTML_CHARS));
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
    if (!response.ok) return { html: null, status: response.status, finalUrl: response.url || url };
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { html: null, status: response.status, finalUrl: response.url || url };
    }
    const html = await response.text();
    return { html: html.slice(0, maxChars), status: response.status, finalUrl: response.url || url };
  } catch (_) {
    return { html: null, status: 0, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function makeEstimatedTerm(cash: number): { total: number; installmentValue: number; text: string } {
  const pct = Math.max(0, Math.min(1, envNumber('ONLINE_PRICES_ESTIMATED_TERM_MARKUP_PCT', 10) / 100));
  const total = round2(cash * (1 + pct));
  const installmentValue = round2(total / 12);
  return {
    total,
    installmentValue,
    text: `ESTIMADO: 12x de R$ ${installmentValue.toFixed(2).replace('.', ',')} (+10% sobre à vista)`,
  };
}

function offerToResult(modelo: string, loja: OnlineStoreTarget, offer: AdapterOffer): OnlinePriceResult | null {
  let cash = validPriceForModel(modelo, offer.cashPrice);
  let term = validPriceForModel(modelo, offer.termTotal);
  let installmentValue = toPrice(offer.installmentValue);
  let installmentCount = offer.installmentCount;
  let installmentText = offer.installmentText;
  let estimated = false;

  if (term && installmentCount === 12 && installmentValue) {
    const calculated = round2(installmentValue * 12);
    if (Math.abs(term - calculated) > Math.max(5, calculated * 0.04)) term = calculated;
  }

  if (cash && term) {
    if (term < cash * 0.85 || cash < term * 0.55) {
      // Preferimos preservar o preço que veio do canal mais confiável. Em adapter
      // estruturado, o à vista é normalmente mais seguro que um parcelamento
      // textual contaminado. O 12x será estimado se o real for descartado.
      term = null;
      installmentValue = null;
      installmentCount = null;
      installmentText = null;
    }
  }

  if (cash && !term) {
    const estimation = makeEstimatedTerm(cash);
    term = estimation.total;
    installmentCount = 12;
    installmentValue = estimation.installmentValue;
    installmentText = estimation.text;
    estimated = true;
  }

  if (!cash && !term) return null;

  const complete = !!cash && !!term;
  const pesquisaStatus: OnlinePriceSearchStatus = estimated
    ? 'oferta_estimada'
    : complete
      ? 'oferta_valida'
      : 'oferta_parcial';

  const source = estimated ? `${offer.source}+estimativa_12x_10pct` : offer.source;
  return {
    engineVersion: ENGINE_VERSION,
    modelo,
    loja: loja.nome,
    dominios: loja.dominios,
    disponibilidade: 'encontrado',
    precoAvistaOnline: cash,
    precoPrazo12xOnline: term,
    parcelasTexto: installmentText,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: offer.title,
    url: canonicalUrl(offer.url),
    fonte: source,
    confianca: estimated ? Math.min(94, offer.confidence) : offer.confidence,
    observacao: estimated
      ? '12X ESTIMADO: preço à vista + 10% porque o 12x real não foi localizado na mesma oferta'
      : complete
        ? null
        : 'OFERTA ENCONTRADA; PREÇO À VISTA NÃO LOCALIZADO NA MESMA OFERTA',
    pesquisadoEm: new Date().toISOString(),
    seller: offer.seller,
    numeroParcelas: installmentCount,
    valorParcela: installmentValue,
    ofertaCompleta: complete,
    pesquisaStatus,
    offerId: `${canonicalUrl(offer.url).replace(/\/$/, '')}::${normalizeText(offer.seller || '')}`,
    prazoEstimado: estimated,
    regraEstimativa: estimated ? 'avista_mais_10_pct' : null,
  };
}

function unavailableResult(modelo: string, loja: OnlineStoreTarget, offer: AdapterOffer): OnlinePriceResult {
  return {
    engineVersion: ENGINE_VERSION,
    modelo,
    loja: loja.nome,
    dominios: loja.dominios,
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
    titulo: offer.title,
    url: canonicalUrl(offer.url),
    fonte: offer.source,
    confianca: offer.confidence,
    observacao: 'PRODUTO EXATO LOCALIZADO, MAS INDISPONÍVEL',
    pesquisadoEm: new Date().toISOString(),
    seller: offer.seller,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'produto_indisponivel',
    offerId: `${canonicalUrl(offer.url).replace(/\/$/, '')}::${normalizeText(offer.seller || '')}`,
    prazoEstimado: false,
    regraEstimativa: null,
  };
}

function rankOffers(offers: AdapterOffer[]): AdapterOffer[] {
  return [...offers].sort((a, b) => {
    const aAvailable = a.availability === 'disponivel' ? 2 : a.availability === 'desconhecido' ? 1 : 0;
    const bAvailable = b.availability === 'disponivel' ? 2 : b.availability === 'desconhecido' ? 1 : 0;
    if (aAvailable !== bAvailable) return bAvailable - aAvailable;
    if (a.realTwelve !== b.realTwelve) return a.realTwelve ? -1 : 1;
    const aTerm = a.termTotal || (a.cashPrice ? a.cashPrice * 1.1 : Number.MAX_SAFE_INTEGER);
    const bTerm = b.termTotal || (b.cashPrice ? b.cashPrice * 1.1 : Number.MAX_SAFE_INTEGER);
    if (aTerm !== bTerm) return aTerm - bTerm;
    return (a.cashPrice || Number.MAX_SAFE_INTEGER) - (b.cashPrice || Number.MAX_SAFE_INTEGER);
  });
}

function vtexTwelve(offer: any): { count: number | null; value: number | null; total: number | null; text: string | null } {
  const installments = Array.isArray(offer?.Installments)
    ? offer.Installments
    : Array.isArray(offer?.installments)
      ? offer.installments
      : [];

  const matches = installments
    .filter((item: any) => Number(item?.NumberOfInstallments ?? item?.numberOfInstallments) === 12)
    .map((item: any) => {
      const value = toPrice(item?.Value ?? item?.value ?? item?.installmentValue);
      const explicit = toPrice(item?.TotalValuePlusInterestRate ?? item?.totalValuePlusInterestRate);
      return { value, total: explicit || (value ? round2(value * 12) : null) };
    })
    .filter((item: { total: number | null }) => !!item.total)
    .sort((a: { total: number | null }, b: { total: number | null }) => (a.total || 0) - (b.total || 0));

  const best = matches[0];
  if (!best?.total) return { count: null, value: null, total: null, text: null };
  return {
    count: 12,
    value: best.value,
    total: best.total,
    text: best.value ? `12x de R$ ${best.value.toFixed(2).replace('.', ',')}` : '12x',
  };
}

async function vtexAdapter(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  endpointBase: string;
  source: string;
  adapterName: string;
}): Promise<StoreAdapterResponse> {
  const endpoint = new URL(`${params.endpointBase.replace(/\/$/, '')}/api/catalog_system/pub/products/search`);
  endpoint.searchParams.set('ft', params.modelo);
  endpoint.searchParams.set('_from', '0');
  endpoint.searchParams.set('_to', '49');
  const response = await fetchJson(endpoint.toString());
  const stats: StoreAdapterStats = { httpRequests: 1, adapter: params.adapterName, candidatesFound: 0 };
  if (!response.ok || !Array.isArray(response.data)) return { result: null, stats };

  const offers: AdapterOffer[] = [];
  for (const product of response.data) {
    const productName = cleanText(product?.productName || product?.productTitle || product?.name || '');
    const productUrl =
      cleanText(product?.link || '') ||
      (product?.linkText ? `${params.endpointBase.replace(/\/$/, '')}/${String(product.linkText).replace(/^\/+/, '')}/p` : '');
    if (!productName || !productUrl) continue;

    const items = Array.isArray(product?.items) ? product.items : [];
    for (const item of items) {
      const itemName = cleanText(item?.nameComplete || item?.name || '');
      const title = [productName, itemName].filter(Boolean).join(' - ');
      if (!exactIdentity(params.modelo, title)) continue;
      stats.candidatesFound += 1;

      const sellers = Array.isArray(item?.sellers) ? item.sellers : [];
      for (const seller of sellers) {
        const commercial = seller?.commertialOffer || seller?.commercialOffer || {};
        const quantity = Number(commercial?.AvailableQuantity ?? commercial?.availableQuantity ?? 0);
        const availability: AdapterAvailability = quantity > 0 ? 'disponivel' : 'indisponivel';
        const cash = validPriceForModel(
          params.modelo,
          toPrice(commercial?.spotPrice) || toPrice(commercial?.Price) || toPrice(commercial?.price),
        );
        const twelve = vtexTwelve(commercial);
        offers.push({
          title,
          url: productUrl,
          seller: cleanText(seller?.sellerName || seller?.sellerId || '') || null,
          cashPrice: cash,
          installmentCount: twelve.count,
          installmentValue: twelve.value,
          termTotal: validPriceForModel(params.modelo, twelve.total),
          installmentText: twelve.text,
          availability,
          source: params.source,
          confidence: 99,
          realTwelve: !!twelve.total,
        });
      }
    }
  }

  const available = rankOffers(offers.filter((offer) => offer.availability !== 'indisponivel' && (offer.cashPrice || offer.termTotal)));
  const winner = available[0];
  if (winner) return { result: offerToResult(params.modelo, params.loja, winner), stats };
  const unavailable = rankOffers(offers.filter((offer) => offer.availability === 'indisponivel'))[0];
  if (unavailable) return { result: unavailableResult(params.modelo, params.loja, unavailable), stats };
  return { result: null, stats };
}

async function mercadoLivreAdapter(modelo: string, loja: OnlineStoreTarget): Promise<StoreAdapterResponse> {
  const endpoint = new URL('https://api.mercadolibre.com/sites/MLB/search');
  endpoint.searchParams.set('q', modelo);
  endpoint.searchParams.set('limit', '50');
  const headers: Record<string, string> = {};
  const token = String(process.env.MERCADOLIVRE_ACCESS_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchJson(endpoint.toString(), headers);
  const stats: StoreAdapterStats = { httpRequests: 1, adapter: 'mercado_livre', candidatesFound: 0 };
  if (!response.ok) return { result: null, stats };
  const items = Array.isArray(response.data?.results) ? response.data.results : [];
  const offers: AdapterOffer[] = [];

  for (const item of items) {
    if (String(item?.condition || '').toLowerCase() && String(item?.condition || '').toLowerCase() !== 'new') continue;
    const title = cleanText(item?.title || '');
    const url = cleanText(item?.permalink || '');
    if (!title || !url || !exactIdentity(modelo, title)) continue;
    stats.candidatesFound += 1;

    const cash = validPriceForModel(modelo, toPrice(item?.price));
    const quantity = Number(item?.installments?.quantity || 0);
    const installmentValue = quantity === 12 ? toPrice(item?.installments?.amount) : null;
    const termTotal = installmentValue ? round2(installmentValue * 12) : null;
    const availableQuantity = Number(item?.available_quantity ?? 0);
    const availability: AdapterAvailability = availableQuantity === 0 ? 'desconhecido' : 'disponivel';

    offers.push({
      title,
      url,
      seller: cleanText(item?.seller?.nickname || item?.seller?.id || '') || null,
      cashPrice: cash,
      installmentCount: termTotal ? 12 : null,
      installmentValue,
      termTotal: validPriceForModel(modelo, termTotal),
      installmentText: installmentValue ? `12x de R$ ${installmentValue.toFixed(2).replace('.', ',')}` : null,
      availability,
      source: 'mercadolivre_api',
      confidence: 99,
      realTwelve: !!termTotal,
    });
  }

  const winner = rankOffers(offers.filter((offer) => offer.cashPrice || offer.termTotal))[0];
  return { result: winner ? offerToResult(modelo, loja, winner) : null, stats };
}

function extractCandidateLinks(html: string, baseUrl: string, matcher: (url: string) => boolean): Array<{ url: string; title: string }> {
  const out = new Map<string, { url: string; title: string }>();
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    try {
      const url = new URL(decodeHtmlEntities(match[1] || ''), baseUrl).toString();
      if (!matcher(url)) continue;
      const title = stripHtml(match[2] || '');
      if (!title) continue;
      const current = out.get(url);
      if (!current || title.length > current.title.length) out.set(url, { url, title });
    } catch (_) {
      // Ignora href inválido.
    }
  }
  return Array.from(out.values());
}

function parseOfferPage(modelo: string, loja: OnlineStoreTarget, url: string, html: string, source: string): AdapterOffer | null {
  const title = extractPageTitle(html);
  if (!title || !exactIdentity(modelo, title)) return null;
  const plain = stripHtml(html).slice(0, 900_000);
  const structured = validPriceForModel(modelo, structuredPrice(html));
  const labeledCash = cashFromText(modelo, plain, loja.nome);
  const twelve = parseTwelveFromText(modelo, plain);
  let cash = labeledCash || structured;

  if (cash && twelve.total && (twelve.total < cash * 0.85 || cash < twelve.total * 0.55)) {
    // Se o texto da página mistura produtos/recomendações, o 12x é descartado;
    // o valor à vista só é mantido se veio de meta/JSON-LD ou rótulo Pix/à vista.
    if (!structured && !labeledCash) cash = null;
  }

  const availability = availabilityFromText(plain);
  return {
    title,
    url,
    seller: sellerFromText(plain, loja.nome),
    cashPrice: cash,
    installmentCount: twelve.count,
    installmentValue: twelve.value,
    termTotal: twelve.total,
    installmentText: twelve.text,
    availability: availability === 'desconhecido' && (cash || twelve.total) ? 'disponivel' : availability,
    source,
    confidence: 98,
    realTwelve: !!twelve.total,
  };
}

async function searchPageAdapter(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  adapterName: string;
  searchUrls: string[];
  linkMatcher: (url: string) => boolean;
  maxProductPages?: number;
}): Promise<StoreAdapterResponse> {
  const stats: StoreAdapterStats = { httpRequests: 0, adapter: params.adapterName, candidatesFound: 0 };
  const candidates = new Map<string, { url: string; title: string }>();

  for (const searchUrl of params.searchUrls) {
    const searchPage = await fetchHtml(searchUrl);
    stats.httpRequests += 1;
    if (!searchPage.html) continue;
    const links = extractCandidateLinks(searchPage.html, searchPage.finalUrl || searchUrl, params.linkMatcher);
    for (const candidate of links) {
      if (!exactIdentity(params.modelo, candidate.title)) continue;
      candidates.set(canonicalUrl(candidate.url), { url: canonicalUrl(candidate.url), title: candidate.title });
    }
    if (candidates.size > 0) break;
  }

  stats.candidatesFound = candidates.size;
  const maxPages = Math.max(1, Math.min(5, params.maxProductPages ?? envNumber('ONLINE_PRICES_ADAPTER_MAX_PRODUCT_PAGES', 3)));
  const offers: AdapterOffer[] = [];
  for (const candidate of Array.from(candidates.values()).slice(0, maxPages)) {
    const page = await fetchHtml(candidate.url);
    stats.httpRequests += 1;
    if (!page.html) continue;
    const offer = parseOfferPage(params.modelo, params.loja, page.finalUrl || candidate.url, page.html, `${params.adapterName}_html`);
    if (offer) offers.push(offer);
  }

  const winner = rankOffers(offers.filter((offer) => offer.availability !== 'indisponivel' && (offer.cashPrice || offer.termTotal)))[0];
  if (winner) return { result: offerToResult(params.modelo, params.loja, winner), stats };
  const unavailable = rankOffers(offers.filter((offer) => offer.availability === 'indisponivel'))[0];
  if (unavailable) return { result: unavailableResult(params.modelo, params.loja, unavailable), stats };
  return { result: null, stats };
}

function querySlug(modelo: string): string {
  return normalizeText(modelo).toLowerCase().replace(/[^a-z0-9]+/g, '+').replace(/^\+|\+$/g, '');
}

async function magaluAdapter(modelo: string, loja: OnlineStoreTarget): Promise<StoreAdapterResponse> {
  const slug = querySlug(modelo);
  return searchPageAdapter({
    modelo,
    loja,
    adapterName: 'magalu',
    searchUrls: [
      `https://www.magazineluiza.com.br/busca/${encodeURIComponent(slug).replace(/%2B/gi, '+')}/`,
      `https://www.magazineluiza.com.br/busca/${encodeURIComponent(modelo)}/`,
    ],
    linkMatcher: (url) => /magazineluiza\.com\.br\/[^?#]+\/p\//i.test(url),
  });
}

async function amazonAdapter(modelo: string, loja: OnlineStoreTarget): Promise<StoreAdapterResponse> {
  return searchPageAdapter({
    modelo,
    loja,
    adapterName: 'amazon',
    searchUrls: [`https://www.amazon.com.br/s?k=${encodeURIComponent(modelo)}`],
    linkMatcher: (url) => /amazon\.com\.br\/[^?#]*\/(?:dp|gp\/product)\//i.test(url),
  });
}

async function fastShopAdapter(modelo: string, loja: OnlineStoreTarget): Promise<StoreAdapterResponse> {
  const slug = querySlug(modelo);
  return searchPageAdapter({
    modelo,
    loja,
    adapterName: 'fastshop',
    searchUrls: [
      `https://site.fastshop.com.br/web/q/${encodeURIComponent(slug)}`,
      `https://site.fastshop.com.br/busca?q=${encodeURIComponent(modelo)}`,
      `https://site.fastshop.com.br/search?q=${encodeURIComponent(modelo)}`,
    ],
    linkMatcher: (url) => /fastshop\.com\.br\/[^?#]+\/p(?:\?|#|$)/i.test(url),
  });
}

export async function pesquisarComAdapterDaLoja(params: {
  modelo: string;
  loja: OnlineStoreTarget;
}): Promise<StoreAdapterResponse> {
  const store = normalizeText(params.loja.nome);

  if (store.includes('MERCADO LIVRE') || store === 'MERCADOLIVRE') {
    return mercadoLivreAdapter(params.modelo, params.loja);
  }

  if (store.includes('CARREFOUR')) {
    return vtexAdapter({
      modelo: params.modelo,
      loja: params.loja,
      endpointBase: 'https://www.carrefour.com.br',
      source: 'carrefour_vtex_adapter',
      adapterName: 'carrefour',
    });
  }

  if (store.includes('SAMSUNG')) {
    return vtexAdapter({
      modelo: params.modelo,
      loja: params.loja,
      endpointBase: 'https://shop.samsung.com.br',
      source: 'samsung_vtex_adapter',
      adapterName: 'samsung',
    });
  }

  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return magaluAdapter(params.modelo, params.loja);
  }

  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    return fastShopAdapter(params.modelo, params.loja);
  }

  if (store.includes('AMAZON')) {
    return amazonAdapter(params.modelo, params.loja);
  }

  return {
    result: null,
    stats: { httpRequests: 0, adapter: null, candidatesFound: 0 },
  };
}
