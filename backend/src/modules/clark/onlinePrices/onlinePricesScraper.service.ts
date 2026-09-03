import { getBaseModelFamily, extractStorage } from '../../productDictionary/productDictionary.utils';
import { pesquisarComAdapterDaLoja } from './onlinePricesStoreAdapters.service';
import {
  OnlinePriceResult,
  OnlinePriceSearchStatus,
  OnlineStoreTarget,
} from './onlinePrices.types';

type DirectLookupStats = {
  httpRequests: number;
  reusedUrl: boolean;
  discoveredUrl: boolean;
  tavilySearchRequests: number;
  tavilyExtractRequests: number;
  tavilyCreditsEstimated: number;
  offersDiscovered: number;
  offersValid: number;
  searchFailures: number;
};

type DirectLookupResponse = {
  result: OnlinePriceResult;
  stats: DirectLookupStats;
};

type OfferAvailability = 'disponivel' | 'indisponivel' | 'desconhecido';
type OfferCondition = 'novo' | 'indesejado' | 'desconhecido';

type ProductSignature = {
  family: string | null;
  storage: string | null;
  network: '4G' | '5G' | null;
  normalized: string;
  coreToken: string | null;
};

type OfferCandidate = {
  offerId: string;
  title: string;
  url: string;
  seller: string | null;
  cashPrice: number | null;
  installmentCount: number | null;
  installmentValue: number | null;
  termTotal: number | null;
  installmentText: string | null;
  availability: OfferAvailability;
  condition: OfferCondition;
  source: string;
  confidence: number;
  identityScore: number;
  detailUrl: boolean;
};

type HttpPage = {
  html: string | null;
  status: number;
  finalUrl: string;
};



type TavilySearchItem = {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  score?: number | null;
};

type TavilyState = {
  searchSucceeded: boolean;
  providerFailed: boolean;
  searchRequests: number;
  extractRequests: number;
  credits: number;
  httpRequests: number;
  offers: OfferCandidate[];
  exactCandidatesFound: number;
};

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_HTML_CHARS = 2_000_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SCRAPER_ENGINE_VERSION = '9.0.0';

const ACCESSORY_TERMS = [
  'CARTAO DE MEMORIA',
  'CARTAO MEMORIA',
  'MICRO SD',
  'MICROSD',
  'CAPA',
  'CASE',
  'PELICULA',
  'CARREGADOR',
  'CABO',
  'FONE',
  'FONES',
  'BATERIA',
  'SUPORTE',
  'PROTETOR',
  'ADAPTADOR',
  'POWER BANK',
  'POWERBANK',
  'DISPLAY',
  'TELA LCD',
  'TOUCH SCREEN',
  'PLACA',
  'LENTE CAMERA',
  'LENTE DE CAMERA',
  'HEADPHONE',
  'EARBUD',
  'EARBUDS',
  'SMARTWATCH',
  'RELOGIO',
  'RELÓGIO',
  'CARTEIRA',
  'ADESIVO',
  'SKIN',
  'PECA DE REPOSICAO',
  'PEÇA DE REPOSIÇÃO',
];

const BAD_CONDITION_TERMS = [
  'USADO',
  'SEMINOVO',
  'SEMI NOVO',
  'RECONDICIONADO',
  'REFURBISHED',
  'RENOVADO',
  'MOSTRUARIO',
  'MOSTRUÁRIO',
  'OUTLET',
  'OPEN BOX',
  'CAIXA ABERTA',
  'AVARIADO',
  'AVARIA',
  'TRINCO',
];

const UNAVAILABLE_TERMS = [
  'INDISPONIVEL',
  'INDISPONÍVEL',
  'SEM ESTOQUE',
  'ESGOTADO',
  'NAO DISPONIVEL',
  'NÃO DISPONÍVEL',
  'OUT OF STOCK',
  'SOLD OUT',
  'AVISE ME',
  'AVISE-ME',
];

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 's'].includes(raw);
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
    .replace(/(\d+)\s*(GB|TB)\b/g, '$1$2')
    .replace(/\b(GB|TB)\s*(\d+)\b/g, '$2$1')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.trim() || '';
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

function parseCompactPriceToken(raw: string, followingText: string): number | null {
  const token = String(raw || '').trim();
  if (!token) return null;

  if (/^\d{4,6}$/.test(token) && /^\s*\d{1,2}%\s*OFF/i.test(followingText)) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) return Math.round(numeric) / 100;
  }

  return toPrice(token);
}

function minimumPlausiblePrice(modelo: string): number {
  const normalized = normalizeText(modelo);

  // Piso de sanidade por família, não preço de mercado hardcoded. Serve apenas
  // para impedir que preço de capa/parcela/recomendação seja aceito como celular.
  if (/\bGALAXY S\d{2,3}\b/.test(normalized) && normalized.includes('ULTRA')) return 2500;
  if (/\bGALAXY S\d{2,3}\b/.test(normalized)) return 1500;
  if (/\bGALAXY Z\b/.test(normalized) || normalized.includes('FOLD') || normalized.includes('FLIP')) return 1800;
  if (/\bGALAXY [AMF]\d{2,3}\b/.test(normalized)) return 250;
  if (normalized.includes('IPHONE')) return 800;
  if (normalized.includes('SMARTPHONE')) return 250;
  return 20;
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
    return !!allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

function absolutizeUrl(href: string, baseUrl: string): string | null {
  try {
    const clean = decodeHtmlEntities(String(href || ''))
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .trim();
    if (!clean || clean.startsWith('javascript:') || clean.startsWith('#')) return null;
    return new URL(clean, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

function canonicalizeStoreUrl(rawUrl: string, loja: OnlineStoreTarget): string {
  let raw = String(rawUrl || '').trim();
  if (!raw) return raw;

  const store = normalizeText(loja.nome);

  if (store.includes('SAMSUNG')) {
    try {
      const parsed = new URL(raw);
      const routingMatch = parsed.pathname.match(
        /\/_v\/segment\/routing\/[^/]+\/product\/\d+\/([^/?#]+)\/p/i,
      );
      if (routingMatch?.[1]) {
        raw = `https://shop.samsung.com.br/${routingMatch[1]}/p`;
      }
    } catch (_) {
      // Mantém a URL original.
    }
  }

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const removable = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'source',
    ];
    removable.forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function isLikelyProductDetailUrl(url: string, loja: OnlineStoreTarget): boolean {
  const store = normalizeText(loja.nome);
  const lower = String(url || '').toLowerCase();

  if (store.includes('MERCADO LIVRE')) {
    return (
      lower.includes('/p/mlb') ||
      lower.includes('/up/mlbu') ||
      lower.includes('produto.mercadolivre.com.br/mlb-')
    );
  }
  if (store.includes('CARREFOUR')) return lower.includes('/produto/') || /-\d{6,}/.test(lower);
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return /\/p(?:\/|\?|#|$)/i.test(lower) || /\/te\//i.test(lower);
  }
  if (store.includes('AMAZON')) return lower.includes('/dp/') || lower.includes('/gp/product/');
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/produto/');
  }
  if (store.includes('SAMSUNG')) return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/smartphones/');
  return true;
}

function extractNetwork(value: unknown): '4G' | '5G' | null {
  const normalized = ` ${normalizeText(value)} `;
  if (normalized.includes(' 5G ')) return '5G';
  if (normalized.includes(' 4G ') || normalized.includes(' LTE ')) return '4G';
  return null;
}

function extractCoreModelToken(value: string): string | null {
  const normalized = normalizeText(value);
  const match = normalized.match(/\b([A-Z]{1,3}\d{2,4})\b/);
  return match?.[1] || null;
}

function buildProductSignature(value: string): ProductSignature {
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
    family: family || null,
    storage,
    network: extractNetwork(normalized),
    normalized,
    coreToken: extractCoreModelToken(normalized),
  };
}

function hasToken(haystack: string, token: string): boolean {
  return ` ${haystack} `.includes(` ${token} `);
}

function isAccessoryTitle(title: string): boolean {
  const normalized = normalizeText(title);
  return ACCESSORY_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function isBundleOrComboOffer(title: string, url: string): boolean {
  const normalizedTitle = normalizeText(title);
  const normalizedUrl = normalizeText(decodeURIComponentSafe(url).replace(/[+_\-]+/g, ' '));
  const combined = `${normalizedTitle} ${normalizedUrl}`;

  // Para comparação de preço do aparelho, ofertas que embutem outro produto
  // relevante (watch, buds, fone, kit/combo) não são equivalentes ao aparelho
  // sozinho. A URL ajuda somente a detectar o pacote; ela não participa da
  // identidade do modelo.
  const bundleSignals = [
    'SMARTWATCH',
    'GALAXY WATCH',
    'WATCH8',
    'WATCH7',
    'GALAXY BUDS',
    'BUDS',
    'FONE',
    'HEADPHONE',
    'EARBUD',
    'KIT ',
    'COMBO',
    'PACOTE',
  ];

  return bundleSignals.some((signal) => combined.includes(signal));
}

function determineCondition(title: string, content = '', url = ''): OfferCondition {
  const strong = normalizeText(`${title} ${url}`);
  if (BAD_CONDITION_TERMS.some((term) => strong.includes(normalizeText(term)))) return 'indesejado';

  const primaryContent = normalizeText(content).slice(0, 4000);
  const explicitContentTerms = [
    'PRODUTO USADO',
    'APARELHO USADO',
    'PRODUTO SEMINOVO',
    'PRODUTO SEMI NOVO',
    'PRODUTO RECONDICIONADO',
    'PRODUTO DE MOSTRUARIO',
    'PRODUTO OUTLET',
  ];
  if (explicitContentTerms.some((term) => primaryContent.includes(normalizeText(term)))) return 'indesejado';

  if (normalizeText(`${title} ${content}`).includes('NOVO')) return 'novo';
  return 'desconhecido';
}

function determineAvailability(value: string): OfferAvailability {
  const normalized = normalizeText(value);
  if (!normalized) return 'desconhecido';

  if (UNAVAILABLE_TERMS.some((term) => normalized.includes(normalizeText(term)))) {
    return 'indisponivel';
  }

  const positive = ['DISPONIVEL', 'EM ESTOQUE', 'COMPRAR AGORA', 'ADICIONAR AO CARRINHO', 'IN STOCK'];
  if (positive.some((term) => normalized.includes(normalizeText(term)))) return 'disponivel';
  return 'desconhecido';
}

function extractSamsungModelTokens(value: string): string[] {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();
  const pattern = /\b(?:GALAXY\s+)?([SAMF]\d{2,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    if (match[1]) tokens.add(match[1]);
  }
  return Array.from(tokens);
}

function looksLikeAccessoryRelation(title: string): boolean {
  const normalized = normalizeText(title);
  return (
    /\bPARA\s+(?:SAMSUNG\s+)?GALAXY\b/.test(normalized) ||
    /\bCOMPATIVEL\s+COM\s+(?:SAMSUNG\s+)?GALAXY\b/.test(normalized) ||
    /\bCOMPATIVEL\s+(?:SAMSUNG\s+)?GALAXY\b/.test(normalized)
  );
}

function evaluateIdentity(modelo: string, title: string, url: string): { valid: boolean; score: number } {
  const target = buildProductSignature(modelo);
  const titleText = normalizeText(title);
  if (!titleText || !title.trim()) return { valid: false, score: 0 };

  // A identidade do produto é decidida pelo TÍTULO da oferta. A URL pode ajudar a
  // localizar a página, mas não pode transformar S25/A15/fone em A07/A06/S26 Ultra.
  if (isAccessoryTitle(title) || looksLikeAccessoryRelation(title)) {
    return { valid: false, score: 0 };
  }

  const candidate = buildProductSignature(titleText);

  if (target.coreToken) {
    if (candidate.coreToken !== target.coreToken) return { valid: false, score: 0 };

    const modelTokens = extractSamsungModelTokens(titleText);
    if (modelTokens.some((token) => token !== target.coreToken)) {
      return { valid: false, score: 0 };
    }
  }

  if (target.family) {
    if (!candidate.family || candidate.family !== target.family) {
      return { valid: false, score: 0 };
    }
  }

  // Memória precisa pertencer ao próprio título da oferta. Não aceitamos 128GB
  // encontrado apenas na URL/snippet de uma página de busca.
  if (target.storage && candidate.storage !== target.storage) {
    return { valid: false, score: 0 };
  }

  // Se a planilha pede 5G, 4G ou ausência da rede não é equivalente.
  if (target.network === '5G' && candidate.network !== '5G') return { valid: false, score: 0 };
  if (target.network === '4G' && candidate.network === '5G') return { valid: false, score: 0 };

  // Modelos A/M/F sem rede explícita na planilha representam a variante comum/4G.
  if (
    !target.network &&
    target.family?.match(/^GALAXY [AMF]\d{2,3}$/) &&
    candidate.network === '5G'
  ) {
    return { valid: false, score: 0 };
  }

  const qualifiers = ['ULTRA', 'PLUS', 'PRO', 'FE', 'FOLD', 'FLIP'];
  for (const qualifier of qualifiers) {
    const targetHas = hasToken(target.normalized, qualifier);
    const candidateHas = hasToken(titleText, qualifier);
    if (targetHas !== candidateHas && (targetHas || target.family?.startsWith('GALAXY S'))) {
      return { valid: false, score: 0 };
    }
  }

  let score = 0.68;
  if (target.family && candidate.family === target.family) score += 0.14;
  if (target.storage && candidate.storage === target.storage) score += 0.10;
  if (target.network && candidate.network === target.network) score += 0.05;
  if (isLikelyLiteralProductTitle(title)) score += 0.02;

  const importantTokens = target.normalized
    .split(' ')
    .filter(Boolean)
    .filter((token) => !['SAMSUNG', 'GALAXY', 'SMARTPHONE', 'CELULAR', 'APARELHO'].includes(token));
  if (importantTokens.length > 0) {
    const matched = importantTokens.filter((token) => hasToken(titleText, token)).length;
    score += (matched / importantTokens.length) * 0.01;
  }

  // Mantemos o parâmetro URL para compatibilidade da assinatura e futuras regras
  // de host/canonicalização; ele deliberadamente NÃO participa da identidade.
  void url;
  return { valid: true, score: Math.min(1, score) };
}

export function validarCandidatoProdutoDescoberto(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  titulo: string;
  url: string;
}): boolean {
  if (!isAllowedStoreUrl(params.url, params.loja)) return false;
  if (!isLikelyProductDetailUrl(params.url, params.loja)) return false;
  return evaluateIdentity(params.modelo, params.titulo, params.url).valid;
}

export function validarPrecoPlausivelPorModelo(modelo: string, value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded < minimumPlausiblePrice(modelo) || rounded > 100_000) return null;
  return rounded;
}

function isLikelyLiteralProductTitle(title: string): boolean {
  const normalized = normalizeText(title);
  return normalized.includes('GALAXY') || normalized.includes('SMARTPHONE') || normalized.includes('CELULAR');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
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

function pageTitleFromHtml(html: string): string {
  const metaTitle =
    metaContent(html, 'property', 'og:title') ||
    metaContent(html, 'name', 'twitter:title') ||
    metaContent(html, 'name', 'title');
  if (metaTitle) return cleanText(metaTitle);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? stripHtml(titleMatch[1]) : '';
}

function sanitizeSeller(value: string | null | undefined): string | null {
  let seller = cleanText(value || '');
  if (!seller) return null;

  seller = seller
    .split(/\s+(?:o\s+carrefour\s+garante|entrega(?:\s+gr[aá]tis)?|frete|voltagem|cores?\s*:|ofertas?\s+dispon[ií]veis|prazo\s+de\s+entrega|em\s+estoque|ver\s+mais|r\$)\b/i)[0] || '';

  seller = cleanText(seller)
    .replace(/[\s\-–—:;,|•.]+$/g, '')
    .slice(0, 80)
    .trim();

  if (!seller || seller.length < 2) return null;

  const normalized = normalizeText(seller);
  if (
    ['VENDEDOR', 'SELLER', 'LOJA PARCEIRA', 'MARKETPLACE', 'FASTSHOP', 'FAST SHOP'].includes(normalized)
  ) {
    return null;
  }

  return seller;
}

function extractSeller(value: string): string | null {
  const text = cleanText(value);
  const patterns = [
    /vendido\s+por\s*[:\-]?\s*(.{2,100}?)\s+e\s+entregue\s+por\b/i,
    /vendido\s+e\s+entregue\s+por\s*[:\-]?\s*([^|•\n\r]{2,100})/i,
    /(?:vendido|vendedor|seller|sold)\s+(?:e\s+entregue\s+)?(?:por|by)\s*[:\-]?\s*([^|•\n\r]{2,100})/i,
    /(?:loja\s+parceira|marketplace)\s*[:\-]?\s*([^|•\n\r]{2,100})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const seller = sanitizeSeller(match[1]);
      if (seller) return seller;
    }
  }
  return null;
}

function extractSellerFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const seller =
      parsed.searchParams.get('seller_id') ||
      parsed.searchParams.get('sellerId') ||
      parsed.searchParams.get('seller');
    return sanitizeSeller(seller);
  } catch (_) {
    return null;
  }
}

function extractStructuredAvailability(html: string): OfferAvailability {
  const structured = [
    metaContent(html, 'property', 'product:availability'),
    metaContent(html, 'itemprop', 'availability'),
    ...Array.from(html.matchAll(/"availability"\s*:\s*"([^"]+)"/gi)).map((match) => match[1] || ''),
  ]
    .filter(Boolean)
    .join(' ');

  const normalized = normalizeText(structured);
  if (!normalized) return 'desconhecido';
  if (normalized.includes('OUTOFSTOCK') || normalized.includes('SOLDOUT') || normalized.includes('DISCONTINUED')) {
    return 'indisponivel';
  }
  if (normalized.includes('INSTOCK') || normalized.includes('LIMITEDAVAILABILITY')) return 'disponivel';
  return 'desconhecido';
}

function extractStructuredPrice(html: string): number | null {
  const meta =
    toPrice(metaContent(html, 'property', 'product:price:amount')) ||
    toPrice(metaContent(html, 'property', 'og:price:amount')) ||
    toPrice(metaContent(html, 'itemprop', 'price'));
  if (meta) return meta;

  // Não usamos o primeiro campo genérico "price" do HTML. Páginas de varejo
  // carregam recomendações e banners de outros itens; capturar esse campo pode
  // associar um preço lateral ao produto principal. Sem meta confiável, o parser
  // textual da própria página é mais seguro.
  return null;
}

function extractCommercialSignals(modelo: string, value: string): {
  cashPrice: number | null;
  installmentCount: number | null;
  installmentValue: number | null;
  termTotal: number | null;
  installmentText: string | null;
} {
  const source = cleanText(decodeHtmlEntities(value));
  if (!source) {
    return {
      cashPrice: null,
      installmentCount: null,
      installmentValue: null,
      termTotal: null,
      installmentText: null,
    };
  }

  const minPrice = minimumPlausiblePrice(modelo);
  const maxPrice = 100_000;

  let installmentValue: number | null = null;
  let termTotal: number | null = null;

  const installmentPatterns = [
    /(?:em\s+at[eé]\s+)?12\s*x\s*(?:sem\s+juros\s*)?(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi,
    /12\s*parcelas?\s*(?:sem\s+juros\s*)?(?:de\s*)?R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi,
  ];

  for (const pattern of installmentPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const amount = toPrice(match[1] ?? '');
      if (!amount) continue;
      const afterInstallment = source.slice(
        pattern.lastIndex,
        Math.min(source.length, pattern.lastIndex + 120),
      );
      const beforeNextInstallment = afterInstallment.split(/\b13\s*x\b/i)[0] || afterInstallment;
      const explicitTotalMatch = beforeNextInstallment.match(
        /(?:\btotal\s*[:\-]?\s*|\|\s*)R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/i,
      );
      const explicitTotal = explicitTotalMatch?.[1] ? toPrice(explicitTotalMatch[1]) : null;
      const calculatedTotal = Math.round(amount * 12 * 100) / 100;
      const total =
        explicitTotal &&
        explicitTotal >= minPrice &&
        explicitTotal <= maxPrice &&
        Math.abs(explicitTotal - calculatedTotal) <= Math.max(5, calculatedTotal * 0.2)
          ? explicitTotal
          : calculatedTotal;
      if (total < minPrice || total > maxPrice) continue;
      if (!termTotal || total < termTotal) {
        installmentValue = amount;
        termTotal = total;
      }
    }
  }

  const jsonInstallmentPatterns = [
    /["'](?:NumberOfInstallments|numberOfInstallments|quantity|installmentCount)["']\s*:\s*12\s*,[\s\S]{0,240}?["'](?:Value|value|amount|installmentValue|installmentAmount)["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)["']?/gi,
    /["'](?:Value|value|amount|installmentValue|installmentAmount)["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)["']?\s*,[\s\S]{0,240}?["'](?:NumberOfInstallments|numberOfInstallments|quantity|installmentCount)["']\s*:\s*12/gi,
  ];

  for (const pattern of jsonInstallmentPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const amount = toPrice(match[1] ?? '');
      if (!amount) continue;
      const total = Math.round(amount * 12 * 100) / 100;
      if (total < minPrice || total > maxPrice) continue;
      if (!termTotal || total < termTotal) {
        installmentValue = amount;
        termTotal = total;
      }
    }
  }

  type CashCandidate = { value: number; score: number; index: number };
  const cashCandidates: CashCandidate[] = [];
  const moneyRegex = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,\d{2})?|[0-9]{2,6}(?:,\d{2})?)/gi;
  let match: RegExpExecArray | null;

  while ((match = moneyRegex.exec(source)) !== null) {
    const before = source.slice(Math.max(0, match.index - 70), match.index);
    const after = source.slice(moneyRegex.lastIndex, Math.min(source.length, moneyRegex.lastIndex + 70));
    const nBefore = normalizeText(before);
    const nAfter = normalizeText(after);

    if (/12\s*X\s*(?:DE)?\s*$/i.test(nBefore) || nBefore.includes('PARCELA')) continue;

    const price = parseCompactPriceToken(match[1] ?? '', after);
    if (!price || price < minPrice || price > maxPrice) continue;

    let score = 0;
    if (nBefore.endsWith('POR')) score += 5;
    if (nBefore.includes('A VISTA') || nAfter.startsWith('A VISTA')) score += 8;
    if (nBefore.includes('NO PIX') || nAfter.startsWith('NO PIX') || nAfter.startsWith('PIX')) score += 9;
    if (nAfter.includes('OFF')) score += 4;
    if (nAfter.includes('DISPONIVEL')) score += 2;
    if (nBefore.endsWith('DE')) score -= 5;
    if (nBefore.includes('PARCEL')) score -= 8;
    if (termTotal && Math.abs(price - (installmentValue || 0)) < 1) score -= 10;

    cashCandidates.push({ value: price, score, index: match.index });
  }

  cashCandidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.value !== b.value) return a.value - b.value;
    return a.index - b.index;
  });

  let selectedCash: CashCandidate | null = cashCandidates[0] ?? null;

  if (termTotal) {
    const plausibleCashCandidates = cashCandidates.filter(
      (candidate) => candidate.value <= termTotal * 1.03,
    );

    if (plausibleCashCandidates.length > 0) {
      selectedCash = plausibleCashCandidates[0] || null;
    } else if (selectedCash && selectedCash.value > termTotal * 1.05) {
      selectedCash = null;
    }
  }

  let cashPrice = selectedCash?.value || null;
  const bestCashScore = selectedCash?.score ?? -999;
  if (cashPrice && bestCashScore <= 0 && minPrice >= 250 && cashPrice < 350) cashPrice = null;

  return {
    cashPrice,
    installmentCount: termTotal ? 12 : null,
    installmentValue,
    termTotal,
    installmentText:
      installmentValue && termTotal
        ? `12x de R$ ${installmentValue.toFixed(2).replace('.', ',')}`
        : null,
  };
}

function offerKey(url: string, seller: string | null): string {
  return `${url.replace(/\/$/, '')}::${normalizeText(seller || '')}`;
}

function makeOffer(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  title: string;
  url: string;
  seller?: string | null;
  content?: string;
  cashPrice?: number | null;
  installmentCount?: number | null;
  installmentValue?: number | null;
  termTotal?: number | null;
  installmentText?: string | null;
  availability?: OfferAvailability;
  condition?: OfferCondition;
  source: string;
  confidence?: number;
}): OfferCandidate | null {
  const title = cleanText(params.title);
  const url = canonicalizeStoreUrl(params.url, params.loja);
  if (!title || !url || !isAllowedStoreUrl(url, params.loja)) return null;

  const identity = evaluateIdentity(params.modelo, title, url);
  if (!identity.valid) return null;
  if (isBundleOrComboOffer(title, url)) return null;

  const content = cleanText(params.content || '');
  const condition = params.condition || determineCondition(title, content, url);
  if (condition === 'indesejado') return null;

  const extracted = extractCommercialSignals(params.modelo, `${title}. ${content}`);
  let cashPrice = params.cashPrice ?? extracted.cashPrice;
  const installmentCount = params.installmentCount ?? extracted.installmentCount;
  const installmentValue = params.installmentValue ?? extracted.installmentValue;
  let termTotal = params.termTotal ?? extracted.termTotal;
  const installmentText = params.installmentText ?? extracted.installmentText;

  if (installmentCount === 12 && installmentValue) {
    // O campo de comparação é o TOTAL das 12 parcelas. Se a oferta informa
    // "12x de R$ X", o total precisa ser matematicamente X * 12. Isso evita
    // cachear totais arredondados ou outro preço capturado na mesma página.
    termTotal = Math.round(installmentValue * 12 * 100) / 100;
  }

  if (cashPrice && termTotal) {
    // Descontos à vista existem, mas uma diferença extrema (ex.: R$ 1.199 à
    // vista contra ~R$ 6.953 em 12x) indica preço de outro bloco/produto.
    const minCashToTermRatio = Math.max(0.4, Math.min(0.9, envNumber('ONLINE_PRICES_MIN_CASH_TO_12X_RATIO', 0.65)));
    if (termTotal < cashPrice * 0.95 || cashPrice < termTotal * minCashToTermRatio) {
      cashPrice = null;
    }
  }

  const inferredAvailability = params.availability || determineAvailability(`${title} ${content}`);
  const availability =
    inferredAvailability === 'desconhecido' && (cashPrice || termTotal)
      ? 'disponivel'
      : inferredAvailability;
  const seller = sanitizeSeller(params.seller || extractSeller(content) || extractSellerFromUrl(url));

  return {
    offerId: offerKey(url, seller),
    title,
    url,
    seller,
    cashPrice,
    installmentCount,
    installmentValue,
    termTotal,
    installmentText,
    availability,
    condition: condition === 'desconhecido' ? 'novo' : condition,
    source: params.source,
    confidence: Math.round(Math.max(0, Math.min(100, params.confidence ?? 90))),
    identityScore: identity.score,
    detailUrl: isLikelyProductDetailUrl(url, params.loja),
  };
}

function mergeSameOffer(base: OfferCandidate, incoming: OfferCandidate): OfferCandidate {
  if (base.url !== incoming.url) return base;
  if (
    base.seller &&
    incoming.seller &&
    normalizeText(base.seller) !== normalizeText(incoming.seller)
  ) {
    return base;
  }

  const seller = base.seller || incoming.seller || null;

  const availability: OfferAvailability =
    base.availability === 'disponivel' || incoming.availability === 'disponivel'
      ? 'disponivel'
      : base.availability === 'indisponivel' || incoming.availability === 'indisponivel'
        ? 'indisponivel'
        : 'desconhecido';

  return {
    ...base,
    offerId: offerKey(base.url, seller),
    seller,
    title: incoming.title.length > base.title.length ? incoming.title : base.title,
    cashPrice: base.cashPrice ?? incoming.cashPrice,
    installmentCount: base.installmentCount ?? incoming.installmentCount,
    installmentValue: base.installmentValue ?? incoming.installmentValue,
    termTotal: base.termTotal ?? incoming.termTotal,
    installmentText: base.installmentText ?? incoming.installmentText,
    availability,
    source: Array.from(new Set(`${base.source}+${incoming.source}`.split('+'))).join('+'),
    confidence: Math.max(base.confidence, incoming.confidence),
    identityScore: Math.max(base.identityScore, incoming.identityScore),
    detailUrl: base.detailUrl || incoming.detailUrl,
  };
}

function addOffer(map: Map<string, OfferCandidate>, offer: OfferCandidate | null): void {
  if (!offer) return;
  const existing = map.get(offer.offerId);
  if (existing) {
    map.set(offer.offerId, mergeSameOffer(existing, offer));
    return;
  }

  const sameUrl = Array.from(map.values()).filter((candidate) => candidate.url === offer.url);
  const compatible = sameUrl.filter(
    (candidate) =>
      !candidate.seller ||
      !offer.seller ||
      normalizeText(candidate.seller) === normalizeText(offer.seller),
  );
  const competingKnownSeller = sameUrl.some(
    (candidate) =>
      candidate.seller &&
      offer.seller &&
      normalizeText(candidate.seller) !== normalizeText(offer.seller),
  );

  // É seguro completar uma oferta de URL única quando uma das fontes ainda não
  // conseguiu identificar o seller. Se já existem sellers concorrentes para a
  // mesma URL, mantemos as ofertas separadas e nunca cruzamos valores entre eles.
  if (compatible.length === 1 && !competingKnownSeller) {
    const candidate = compatible[0];
    if (candidate) {
      map.delete(candidate.offerId);
      const merged = mergeSameOffer(candidate, offer);
      map.set(merged.offerId, merged);
      return;
    }
  }

  map.set(offer.offerId, offer);
}

function hasComplete12xOffer(offer: OfferCandidate): boolean {
  return !!(
    offer.cashPrice &&
    offer.termTotal &&
    offer.installmentCount === 12 &&
    offer.installmentValue &&
    offer.availability !== 'indisponivel'
  );
}

function rankOffers(offers: OfferCandidate[]): OfferCandidate[] {
  return [...offers].sort((a, b) => {
    const aAvailable = a.availability === 'disponivel' ? 1 : a.availability === 'desconhecido' ? 0 : -1;
    const bAvailable = b.availability === 'disponivel' ? 1 : b.availability === 'desconhecido' ? 0 : -1;
    if (aAvailable !== bAvailable) return bAvailable - aAvailable;

    const aComplete = hasComplete12xOffer(a) ? 1 : 0;
    const bComplete = hasComplete12xOffer(b) ? 1 : 0;
    if (aComplete !== bComplete) return bComplete - aComplete;

    const aHas12 = a.termTotal && a.installmentCount === 12 ? 1 : 0;
    const bHas12 = b.termTotal && b.installmentCount === 12 ? 1 : 0;
    if (aHas12 !== bHas12) return bHas12 - aHas12;

    if (aHas12 && bHas12 && a.termTotal !== b.termTotal) {
      return (a.termTotal || Number.MAX_SAFE_INTEGER) - (b.termTotal || Number.MAX_SAFE_INTEGER);
    }

    const aCash = a.cashPrice ?? Number.MAX_SAFE_INTEGER;
    const bCash = b.cashPrice ?? Number.MAX_SAFE_INTEGER;
    if (aCash !== bCash) return aCash - bCash;

    if (a.detailUrl !== b.detailUrl) return a.detailUrl ? -1 : 1;
    if (a.identityScore !== b.identityScore) return b.identityScore - a.identityScore;
    return b.confidence - a.confidence;
  });
}

function chooseWinningOffer(offers: OfferCandidate[]): OfferCandidate | null {
  const valid = offers.filter(
    (offer) =>
      offer.condition !== 'indesejado' &&
      offer.availability !== 'indisponivel' &&
      (offer.cashPrice || offer.termTotal),
  );
  return rankOffers(valid)[0] || null;
}

function chooseUnavailableOffer(offers: OfferCandidate[]): OfferCandidate | null {
  return rankOffers(offers.filter((offer) => offer.availability === 'indisponivel'))[0] || null;
}

function estimateTermFromCash(cashPrice: number): {
  total: number;
  installmentValue: number;
  installmentText: string;
} {
  const markupPct = Math.max(0, Math.min(1, envNumber('ONLINE_PRICES_ESTIMATED_TERM_MARKUP_PCT', 10) / 100));
  const total = Math.round(cashPrice * (1 + markupPct) * 100) / 100;
  const installmentValue = Math.round((total / 12) * 100) / 100;
  return {
    total,
    installmentValue,
    installmentText: `ESTIMADO: 12x de R$ ${installmentValue.toFixed(2).replace('.', ',')} (+10% sobre à vista)`,
  };
}

function resultFromOffer(modelo: string, loja: OnlineStoreTarget, offer: OfferCandidate): OnlinePriceResult {
  let termTotal = offer.termTotal;
  let installmentCount = offer.installmentCount;
  let installmentValue = offer.installmentValue;
  let installmentText = offer.installmentText;
  let estimated = false;

  // Regra comercial definida: se o 12x REAL não foi localizado, usa-se
  // exatamente preço à vista + 10%, deixando explícito que é estimado.
  if (offer.cashPrice && !termTotal) {
    const estimation = estimateTermFromCash(offer.cashPrice);
    termTotal = estimation.total;
    installmentCount = 12;
    installmentValue = estimation.installmentValue;
    installmentText = estimation.installmentText;
    estimated = true;
  }

  const complete = !!offer.cashPrice && !!termTotal;
  const searchStatus: OnlinePriceSearchStatus = estimated
    ? 'oferta_estimada'
    : complete
      ? 'oferta_valida'
      : 'oferta_parcial';

  return {
    engineVersion: SCRAPER_ENGINE_VERSION,
    modelo,
    loja: loja.nome,
    dominios: loja.dominios,
    disponibilidade: 'encontrado',
    precoAvistaOnline: offer.cashPrice,
    precoPrazo12xOnline: termTotal,
    parcelasTexto: installmentText,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: offer.title,
    url: offer.url,
    fonte: estimated ? `${offer.source}+estimativa_12x_10pct` : offer.source,
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
    pesquisaStatus: searchStatus,
    offerId: offer.offerId,
    prazoEstimado: estimated,
    regraEstimativa: estimated ? 'avista_mais_10_pct' : null,
  };
}

function unavailableResult(modelo: string, loja: OnlineStoreTarget, offer: OfferCandidate): OnlinePriceResult {
  return {
    engineVersion: SCRAPER_ENGINE_VERSION,
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
    url: offer.url,
    fonte: offer.source,
    confianca: offer.confidence,
    observacao: 'PRODUTO EXATO LOCALIZADO, MAS INDISPONÍVEL',
    pesquisadoEm: new Date().toISOString(),
    seller: offer.seller,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'produto_indisponivel',
    offerId: offer.offerId,
  };
}

function notFoundResult(modelo: string, loja: OnlineStoreTarget): OnlinePriceResult {
  return {
    engineVersion: SCRAPER_ENGINE_VERSION,
    modelo,
    loja: loja.nome,
    dominios: loja.dominios,
    disponibilidade: 'nao_encontrado',
    precoAvistaOnline: null,
    precoPrazo12xOnline: null,
    parcelasTexto: null,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: null,
    url: null,
    fonte: 'busca_deterministica',
    confianca: 0,
    observacao: 'NÃO LOCALIZADO NAS FONTES CONSULTADAS; NÃO SIGNIFICA QUE O PRODUTO NÃO EXISTA',
    pesquisadoEm: new Date().toISOString(),
    seller: null,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'nao_localizado',
    offerId: null,
  };
}

function failureResult(modelo: string, loja: OnlineStoreTarget, message: string): OnlinePriceResult {
  return {
    engineVersion: SCRAPER_ENGINE_VERSION,
    modelo,
    loja: loja.nome,
    dominios: loja.dominios,
    disponibilidade: 'erro',
    precoAvistaOnline: null,
    precoPrazo12xOnline: null,
    parcelasTexto: null,
    precoAvistaPlanilha: null,
    precoPrazo12xPlanilha: null,
    diferencaAvista: null,
    diferencaAvistaPercentual: null,
    diferencaPrazo12x: null,
    diferencaPrazo12xPercentual: null,
    titulo: null,
    url: null,
    fonte: null,
    confianca: 0,
    observacao: message || 'FALHA DE PESQUISA',
    pesquisadoEm: new Date().toISOString(),
    seller: null,
    numeroParcelas: null,
    valorParcela: null,
    ofertaCompleta: false,
    pesquisaStatus: 'falha_pesquisa',
    offerId: null,
  };
}

async function fetchHtml(url: string): Promise<HttpPage> {
  const controller = new AbortController();
  const timeoutMs = Math.max(2000, envNumber('ONLINE_PRICES_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
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

    const finalUrl = response.url || url;
    if (!response.ok) return { html: null, status: response.status, finalUrl };

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { html: null, status: response.status, finalUrl };
    }

    const html = await response.text();
    return { html: html.slice(0, maxChars), status: response.status, finalUrl };
  } catch (_) {
    return { html: null, status: 0, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

function offerFromHtml(modelo: string, loja: OnlineStoreTarget, url: string, html: string, source: string): OfferCandidate | null {
  const title = pageTitleFromHtml(html);
  if (!title) return null;

  const identity = evaluateIdentity(modelo, title, url);
  if (!identity.valid) return null;

  const plain = stripHtml(html).slice(0, 900_000);
  const signals = extractCommercialSignals(modelo, `${title}. ${plain}`);
  const structuredPrice = extractStructuredPrice(html);
  const availability = extractStructuredAvailability(html);

  return makeOffer({
    modelo,
    loja,
    title,
    url,
    content: plain,
    cashPrice: structuredPrice ?? signals.cashPrice,
    installmentCount: signals.installmentCount,
    installmentValue: signals.installmentValue,
    termTotal: signals.termTotal,
    installmentText: signals.installmentText,
    availability,
    condition: determineCondition(title, plain, url),
    source,
    confidence: 96,
  });
}

async function collectPreferredUrlOffer(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  preferredUrl: string | null | undefined;
}): Promise<{ offer: OfferCandidate | null; httpRequests: number; reused: boolean }> {
  if (!params.preferredUrl || !isAllowedStoreUrl(params.preferredUrl, params.loja)) {
    return { offer: null, httpRequests: 0, reused: false };
  }

  const page = await fetchHtml(params.preferredUrl);
  if (!page.html) return { offer: null, httpRequests: 1, reused: true };

  return {
    offer: offerFromHtml(params.modelo, params.loja, page.finalUrl || params.preferredUrl, page.html, 'url_cache_http'),
    httpRequests: 1,
    reused: true,
  };
}

function tavilyDomains(loja: OnlineStoreTarget): string[] {
  const store = normalizeText(loja.nome);
  if (store.includes('MERCADO LIVRE')) return ['mercadolivre.com.br'];
  if (store.includes('CARREFOUR')) return ['carrefour.com.br'];
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    return ['magazineluiza.com.br', 'magalu.com.br'];
  }
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) return ['fastshop.com.br'];
  if (store.includes('AMAZON')) return ['amazon.com.br'];
  if (store.includes('SAMSUNG')) return ['samsung.com.br'];
  return Array.from(new Set(loja.dominios.map(normalizeDomain).filter(Boolean)));
}

function tavilyQueries(modelo: string, loja: OnlineStoreTarget): string[] {
  const signature = buildProductSignature(modelo);
  const brandPrefix = signature.normalized.includes('SAMSUNG') ? '' : 'Samsung ';
  const primary = `${brandPrefix}${modelo}`.replace(/\s+/g, ' ').trim();
  const store = normalizeText(loja.nome);
  const variants = new Set<string>([primary]);

  const family = signature.family || modelo;
  const storage = signature.storage || '';
  const network = signature.network || '';

  if (store.includes('SAMSUNG')) {
    variants.add(`${family} ${storage} ${network} Samsung Brasil`.replace(/\s+/g, ' ').trim());
  } else if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) {
    variants.add(`${family} ${storage} ${network} smartphone`.replace(/\s+/g, ' ').trim());
  } else if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) {
    variants.add(`${family} ${storage} ${network} 12x pix Magazine Luiza`.replace(/\s+/g, ' ').trim());
  } else if (store.includes('MERCADO LIVRE')) {
    variants.add(`${family} ${storage} ${network} 12x pix Mercado Livre`.replace(/\s+/g, ' ').trim());
  } else if (store.includes('AMAZON')) {
    variants.add(`${family} ${storage} ${network} smartphone Samsung novo`.replace(/\s+/g, ' ').trim());
  } else {
    variants.add(`${family} ${storage} ${network}`.replace(/\s+/g, ' ').trim());
  }

  // V8: a segunda consulta privilegia páginas de produto, não listagens.
  // Aspas aumentam a chance de o provedor devolver o SKU exato quando a busca
  // principal retorna apenas /busca/, /lista/ ou páginas de categoria.
  if (family && storage) {
    variants.add(`"${family}" "${storage}" ${network || ''}`.replace(/\s+/g, ' ').trim());
  }

  return Array.from(variants).filter(Boolean);
}

async function tavilySearch(
  modelo: string,
  loja: OnlineStoreTarget,
): Promise<TavilyState> {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim();
  const enabled = envBoolean('ONLINE_PRICES_TAVILY_ENABLED', true);
  const state: TavilyState = {
    searchSucceeded: false,
    providerFailed: false,
    searchRequests: 0,
    extractRequests: 0,
    credits: 0,
    httpRequests: 0,
    offers: [],
    exactCandidatesFound: 0,
  };

  if (!enabled || !apiKey) {
    state.providerFailed = true;
    return state;
  }

  const domains = tavilyDomains(loja);
  if (domains.length === 0) {
    state.providerFailed = true;
    return state;
  }

  const maxAttempts = Math.max(1, Math.min(2, envNumber('ONLINE_PRICES_TAVILY_MAX_SEARCH_ATTEMPTS', 2)));
  const maxResults = Math.max(3, Math.min(20, envNumber('ONLINE_PRICES_TAVILY_MAX_RESULTS', 10)));
  const timeoutMs = Math.max(3000, envNumber('ONLINE_PRICES_TAVILY_TIMEOUT_MS', 12000));
  const exactItems = new Map<string, TavilySearchItem>();

  for (const query of tavilyQueries(modelo, loja).slice(0, maxAttempts)) {
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
          search_depth: 'basic',
          chunks_per_source: 3,
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_favicon: false,
          include_domains: domains,
          include_usage: true,
          auto_parameters: false,
        }),
      });

      state.httpRequests += 1;
      state.searchRequests += 1;
      const payload: any = await response.json().catch(() => null);
      state.credits += Number(payload?.usage?.credits || (response.ok ? 1 : 0));

      if (!response.ok) {
        state.providerFailed = true;
        console.warn(`[Preços Online ${SCRAPER_ENGINE_VERSION}][Tavily] ${loja.nome}/${modelo}: HTTP ${response.status}`);
        continue;
      }

      state.searchSucceeded = true;
      const items: TavilySearchItem[] = Array.isArray(payload?.results) ? payload.results : [];
      let exactInThisQuery = 0;
      let detailInThisQuery = 0;

      for (const item of items) {
        const rawUrl = cleanText(item?.url || '');
        const title = cleanText(item?.title || '');
        const content = cleanText(item?.content || '');
        if (!rawUrl || !title || !isAllowedStoreUrl(rawUrl, loja)) continue;

        const url = canonicalizeStoreUrl(rawUrl, loja);
        const identity = evaluateIdentity(modelo, title, url);
        if (!identity.valid) continue;
        if (determineCondition(title, content, url) === 'indesejado') continue;

        exactInThisQuery += 1;

        // V8: uma página de busca/listagem pode ter exatamente o nome do modelo,
        // mas NÃO é uma oferta. Na V7 isso encerrava a pesquisa cedo e deixava
        // Magalu/Mercado Livre como "não localizado" mesmo com produtos reais.
        if (!isLikelyProductDetailUrl(url, loja)) continue;

        detailInThisQuery += 1;
        state.exactCandidatesFound += 1;
        const existing = exactItems.get(url);
        if (!existing || Number(item?.score || 0) > Number(existing?.score || 0)) exactItems.set(url, item);
      }

      console.log(
        `[Preços Online ${SCRAPER_ENGINE_VERSION}][Tavily] ${loja.nome}/${modelo}: query="${query}" resultados=${items.length} exatos=${exactInThisQuery} paginasProduto=${detailInThisQuery}`,
      );

      // Um único candidato pode ser uma página bloqueada, redirecionada ou sem
      // dados comerciais. A V9 só encerra cedo quando já há diversidade mínima
      // de páginas de produto. Isso custa no máximo a segunda busca configurada,
      // mas evita que um único candidato ruim mate a cobertura da loja.
      const minDetailCandidates = Math.max(
        1,
        Math.min(3, envNumber('ONLINE_PRICES_TAVILY_MIN_DETAIL_CANDIDATES', 2)),
      );
      if (exactItems.size >= minDetailCandidates) break;
    } catch (error: any) {
      state.httpRequests += 1;
      state.searchRequests += 1;
      state.providerFailed = true;
      console.warn(`[Preços Online ${SCRAPER_ENGINE_VERSION}][Tavily] ${loja.nome}/${modelo}: ${String(error?.message || error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const detailItems = Array.from(exactItems.entries())
    .map(([url, item]) => ({ url, item }))
    .filter(({ url }) => isLikelyProductDetailUrl(url, loja))
    .slice(0, Math.max(1, Math.min(5, envNumber('ONLINE_PRICES_V4_MAX_PRODUCT_PAGES', 3))));

  if (detailItems.length === 0) return state;

  const httpOffers = await Promise.all(
    detailItems.map(async ({ url }) => {
      const page = await fetchHtml(url);
      state.httpRequests += 1;
      if (!page.html) return null;
      return offerFromHtml(modelo, loja, page.finalUrl || url, page.html, 'tavily_url_http');
    }),
  );
  httpOffers.forEach((offer) => {
    if (offer) state.offers.push(offer);
  });

  const offerMap = new Map<string, OfferCandidate>();
  state.offers.forEach((offer) => addOffer(offerMap, offer));
  state.offers = Array.from(offerMap.values());

  if (state.offers.some((offer) => !!offer.cashPrice || !!offer.termTotal)) return state;
  if (!envBoolean('ONLINE_PRICES_TAVILY_EXTRACT_ENABLED', true)) return state;

  const urlsForExtract = detailItems
    .map(({ url }) => url)
    .slice(0, Math.max(1, Math.min(5, envNumber('ONLINE_PRICES_TAVILY_EXTRACT_MAX_URLS', 3))));
  if (urlsForExtract.length === 0) return state;

  const extractController = new AbortController();
  const extractTimeoutMs = Math.max(3000, envNumber('ONLINE_PRICES_TAVILY_EXTRACT_TIMEOUT_MS', 15000));
  const extractTimer = setTimeout(() => extractController.abort(), extractTimeoutMs);

  try {
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      signal: extractController.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        urls: urlsForExtract,
        query: `${modelo}: preço à vista ou Pix, parcelamento exatamente em 12x, valor da parcela, vendedor, disponibilidade e condição do MESMO produto`,
        chunks_per_source: 5,
        extract_depth: 'basic',
        include_images: false,
        include_favicon: false,
        format: 'markdown',
        include_usage: true,
      }),
    });

    state.httpRequests += 1;
    state.extractRequests += 1;
    const payload: any = await response.json().catch(() => null);
    const reportedCredits = Number(payload?.usage?.credits || 0);
    const successfulExtractions = Array.isArray(payload?.results) ? payload.results.length : 0;
    state.credits += reportedCredits > 0
      ? reportedCredits
      : response.ok && successfulExtractions > 0
        ? Math.ceil(successfulExtractions / 5)
        : 0;

    if (!response.ok) {
      state.providerFailed = true;
      console.warn(`[Preços Online ${SCRAPER_ENGINE_VERSION}][Tavily Extract] ${loja.nome}/${modelo}: HTTP ${response.status}`);
      return state;
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    for (const extracted of results) {
      const rawUrl = cleanText(extracted?.url || '');
      const content = cleanText(extracted?.raw_content || '');
      if (!rawUrl || !content || !isAllowedStoreUrl(rawUrl, loja)) continue;

      const url = canonicalizeStoreUrl(rawUrl, loja);
      const searchItem = exactItems.get(url) || Array.from(exactItems.entries()).find(([candidateUrl]) => canonicalizeStoreUrl(candidateUrl, loja) === url)?.[1];
      const title = cleanText(searchItem?.title || '');
      if (!title || !evaluateIdentity(modelo, title, url).valid) continue;

      const offer = makeOffer({
        modelo,
        loja,
        title,
        url,
        content,
        availability: determineAvailability(content),
        condition: determineCondition(title, content, url),
        source: 'tavily_extract',
        confidence: 99,
      });
      if (offer) state.offers.push(offer);
    }
  } catch (error: any) {
    state.httpRequests += 1;
    state.extractRequests += 1;
    state.providerFailed = true;
    console.warn(`[Preços Online ${SCRAPER_ENGINE_VERSION}][Tavily Extract] ${loja.nome}/${modelo}: ${String(error?.message || error)}`);
  } finally {
    clearTimeout(extractTimer);
  }

  const finalMap = new Map<string, OfferCandidate>();
  state.offers.forEach((offer) => addOffer(finalMap, offer));
  state.offers = Array.from(finalMap.values());
  return state;
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
    offersDiscovered: 0,
    offersValid: 0,
    searchFailures: 0,
  };


  // V7: cada loja tenta primeiro o seu adapter dedicado. O scraper genérico e
  // Tavily ficam como camada de descoberta/fallback, não como fonte primária.
  const adapter = await pesquisarComAdapterDaLoja({ modelo: params.modelo, loja: params.loja });
  stats.httpRequests += adapter.stats.httpRequests;
  stats.offersDiscovered += adapter.stats.candidatesFound;
  if (adapter.result) {
    stats.offersValid += adapter.result.disponibilidade === 'encontrado' ? 1 : 0;
    stats.discoveredUrl = !!adapter.result.url;
    return { result: adapter.result, stats };
  }

  if (!params.loja.dominios.length) {
    stats.searchFailures += 1;
    return {
      result: failureResult(params.modelo, params.loja, 'LOJA SEM DOMÍNIO CONFIGURADO'),
      stats,
    };
  }

  const offers = new Map<string, OfferCandidate>();
  let atLeastOneSearchSourceSucceeded = false;

  const preferred = await collectPreferredUrlOffer({
    modelo: params.modelo,
    loja: params.loja,
    preferredUrl: params.preferredUrl,
  });
  stats.httpRequests += preferred.httpRequests;
  stats.reusedUrl = preferred.reused;
  if (preferred.offer) {
    addOffer(offers, preferred.offer);
    stats.discoveredUrl = true;
  }

  // Os adapters dedicados já executaram as integrações diretas de loja.
  // Daqui em diante usamos apenas URL reaproveitada + discovery Tavily.

  const earlyWinner = chooseWinningOffer(Array.from(offers.values()));
  if (earlyWinner && hasComplete12xOffer(earlyWinner)) {
    stats.offersDiscovered = offers.size;
    stats.offersValid = Array.from(offers.values()).filter((offer) => offer.condition !== 'indesejado').length;
    stats.discoveredUrl = true;
    return { result: resultFromOffer(params.modelo, params.loja, earlyWinner), stats };
  }

  const tavily = await tavilySearch(params.modelo, params.loja);
  stats.httpRequests += tavily.httpRequests;
  stats.tavilySearchRequests += tavily.searchRequests;
  stats.tavilyExtractRequests += tavily.extractRequests;
  stats.tavilyCreditsEstimated += tavily.credits;
  if (tavily.searchSucceeded) atLeastOneSearchSourceSucceeded = true;
  tavily.offers.forEach((offer) => addOffer(offers, offer));

  stats.offersDiscovered = offers.size;
  stats.offersValid = Array.from(offers.values()).filter((offer) => offer.condition !== 'indesejado').length;
  stats.discoveredUrl = Array.from(offers.values()).some((offer) => !!offer.url);

  const winner = chooseWinningOffer(Array.from(offers.values()));
  if (winner) {
    return { result: resultFromOffer(params.modelo, params.loja, winner), stats };
  }

  const unavailable = chooseUnavailableOffer(Array.from(offers.values()));
  if (unavailable) {
    return { result: unavailableResult(params.modelo, params.loja, unavailable), stats };
  }

  if (offers.size > 0 || tavily.exactCandidatesFound > 0) {
    stats.searchFailures += 1;
    return {
      result: failureResult(
        params.modelo,
        params.loja,
        'PRODUTO EXATO LOCALIZADO, MAS NÃO FOI POSSÍVEL EXTRAIR UMA OFERTA CONFIÁVEL COM PREÇO/12X',
      ),
      stats,
    };
  }

  if (atLeastOneSearchSourceSucceeded) {
    return { result: notFoundResult(params.modelo, params.loja), stats };
  }

  stats.searchFailures += 1;
  return {
    result: failureResult(
      params.modelo,
      params.loja,
      'FALHA DE PESQUISA: nenhuma fonte respondeu com sucesso; resultado não será tratado como produto inexistente',
    ),
    stats,
  };
}
