import { OnlineStoreTarget } from './onlinePrices.types';

export type OnlineProductCategory =
  | 'smartphone'
  | 'tablet'
  | 'notebook'
  | 'smartwatch'
  | 'earbuds'
  | 'ring'
  | 'wearable'
  | 'unknown';

export type OnlineProductIdentity = {
  raw: string;
  normalized: string;
  brand: string | null;
  category: OnlineProductCategory;
  modelKey: string | null;
  storage: string | null;
  ram: string | null;
  network: '4G' | '5G' | 'LTE' | 'WIFI' | 'BT' | null;
  sizeMm: number | null;
  ringSize: number | null;
  qualifiers: string[];
  cpuKey: string | null;
  anchors: string[];
};

export type ProductIdentityMatch = {
  valid: boolean;
  score: number;
  reason: string | null;
  target: OnlineProductIdentity;
  candidate: OnlineProductIdentity;
};

const BAD_CONDITION_TERMS = [
  'USADO',
  'SEMINOVO',
  'SEMI NOVO',
  'RECONDICIONADO',
  'REFURBISHED',
  'RENOVADO',
  'MOSTRUARIO',
  'OUTLET',
  'OPEN BOX',
  'CAIXA ABERTA',
  'AVARIADO',
  'AVARIA',
];

const GENERIC_ACCESSORY_TERMS = [
  'CAPA',
  'CASE',
  'PELICULA',
  'CARREGADOR',
  'CABO',
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
  'CARTEIRA',
  'ADESIVO',
  'SKIN',
  'PECA DE REPOSICAO',
];

const FILLER_TOKENS = new Set([
  'SAMSUNG',
  'GALAXY',
  'SMARTPHONE',
  'CELULAR',
  'APARELHO',
  'TABLET',
  'NOTEBOOK',
  'LAPTOP',
  'SMARTWATCH',
  'RELOGIO',
  'FONE',
  'FONES',
  'BLUETOOTH',
  'SEM',
  'COM',
  'DE',
  'DA',
  'DO',
  'E',
  'TELA',
  'CAMERA',
  'CAMERAS',
  'MEMORIA',
  'ARMAZENAMENTO',
  'SSD',
  'RAM',
  'WIFI',
  'WI',
  'FI',
]);

const QUALIFIERS = ['ULTRA', 'PLUS', 'PRO', 'FE', 'FOLD', 'FLIP', 'CLASSIC', 'EDGE', 'LITE', '360'];

export function normalizarIdentidadeProduto(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\+/g, ' PLUS ')
    .replace(/\b(6|8|12|16|24|32|64)G\b/g, '$1GB')
    .replace(/(\d+)\s*(GB|TB)\b/g, '$1$2')
    .replace(/\b(GB|TB)\s*(\d+)\b/g, '$2$1')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasToken(haystack: string, token: string): boolean {
  return ` ${haystack} `.includes(` ${token} `);
}

function detectCategory(normalized: string): OnlineProductCategory {
  if (/\bGALAXY\s+RING\b|\bRING\b/.test(normalized)) return 'ring';
  if (/\bGALAXY\s+BUDS\b|\bBUDS\d*\b|\bEARBUDS?\b/.test(normalized)) return 'earbuds';
  if (/\bGALAXY\s+WATCH\b|\bWATCH\d*\b|\bSMARTWATCH\b/.test(normalized)) return 'smartwatch';
  if (/\bGALAXY\s+BOOK\b|\bBOOK\d+\b|\bNOTEBOOK\b|\bLAPTOP\b/.test(normalized)) return 'notebook';
  if (/\bGALAXY\s+TAB\b|\bTAB\s+[A-Z0-9]/.test(normalized) || normalized.includes(' TABLET ')) return 'tablet';
  if (
    /\bGALAXY\s+[SAMFZ]\d{1,3}\b/.test(normalized) ||
    /\bGALAXY\s+Z\s+(?:FOLD|FLIP)\d*\b/.test(normalized) ||
    /\bSMARTPHONE\b|\bCELULAR\b/.test(normalized)
  ) {
    return 'smartphone';
  }
  if (/\bFIT\d*\b|\bWEARABLE\b/.test(normalized)) return 'wearable';
  return 'unknown';
}

function extractModelKey(normalized: string, category: OnlineProductCategory): string | null {
  const byCategory: Record<OnlineProductCategory, RegExp[]> = {
    smartphone: [
      /\bGALAXY\s+Z\s+(FOLD|FLIP)\s*(\d*)\b/,
      /\b([SAMFZ]\d{2,3})\b/,
    ],
    tablet: [
      /\bTAB\s+([A-Z]\d{1,2}(?:\s+(?:ULTRA|PLUS|FE))?)\b/,
      /\bTAB\s+(S\d{1,2}(?:\s+(?:ULTRA|PLUS|FE))?)\b/,
    ],
    notebook: [
      /\bBOOK\s*(GO|\d+)\s*(360|ULTRA|PRO|EDGE)?\b/,
      /\bGALAXY\s+BOOK\s*(GO|\d+)\s*(360|ULTRA|PRO|EDGE)?\b/,
    ],
    smartwatch: [
      /\bWATCH\s*(ULTRA\s*\d*|\d+\s*(?:CLASSIC|ULTRA)?)\b/,
      /\bGALAXY\s+WATCH\s*(ULTRA\s*\d*|\d+\s*(?:CLASSIC|ULTRA)?)\b/,
    ],
    earbuds: [
      /\bBUDS\s*(CORE|\d+)?\s*(PRO|FE)?\b/,
      /\bGALAXY\s+BUDS\s*(CORE|\d+)?\s*(PRO|FE)?\b/,
    ],
    ring: [/\bGALAXY\s+RING\b/, /\bRING\b/],
    wearable: [/\bFIT\s*(\d+)?\b/],
    unknown: [],
  };

  for (const pattern of byCategory[category]) {
    const match = normalized.match(pattern);
    if (!match) continue;
    if (category === 'smartphone' && match[1] && /FOLD|FLIP/.test(match[1])) {
      return `Z ${match[1]}${match[2] || ''}`.trim();
    }
    const full = String(match[0] || '').replace(/^GALAXY\s+/, '').replace(/\s+/g, ' ').trim();
    if (full) return full;
  }

  const generic = normalized.match(/\b([A-Z]{1,4}\d{1,4})\b/);
  return generic?.[1] || null;
}

function extractRam(normalized: string, category: OnlineProductCategory): string | null {
  const patterns = [
    /\b(\d{1,3}GB)\s*(?:DE\s+)?RAM\b/,
    /\bRAM\s*(\d{1,3}GB)\b/,
    /\b(\d{1,3}GB)\s*(?:DE\s+)?MEMORIA\s+RAM\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Catálogos e planilhas frequentemente escrevem "16GB 512GB" sem a
  // palavra RAM. Com duas capacidades, a menor plausível é RAM e a maior é
  // armazenamento. Em notebooks, uma única capacidade <=64GB sem marcador de
  // SSD/UFS também é tratada como RAM (algumas descrições vêm truncadas).
  if (category === 'notebook' || category === 'tablet' || category === 'smartphone') {
    const capacities: string[] = Array.from(normalized.matchAll(/\b(\d{1,4}GB)\b/g))
      .flatMap((match) => (match[1] ? [match[1]] : []));
    const unique = Array.from(new Set(capacities));
    const sorted = unique
      .map((value) => ({ value, gb: Number(value.replace(/[^0-9]/g, '')) }))
      .filter((item) => Number.isFinite(item.gb) && item.gb > 0)
      .sort((a, b) => a.gb - b.gb);

    if (sorted.length >= 2) {
      const storageCandidate = sorted[sorted.length - 1];
      const ramCandidate = sorted.find((item) => item.gb <= 128 && item.gb < (storageCandidate?.gb || Infinity));
      if (ramCandidate) return ramCandidate.value;
    }

    const onlyCandidate = sorted[0];
    if (category === 'notebook' && sorted.length === 1 && onlyCandidate && onlyCandidate.gb <= 64) {
      const only = onlyCandidate.value;
      const explicitlyStorage = new RegExp(`(?:SSD|ARMAZENAMENTO|ROM|UFS)\\s*${only}|${only}\\s*(?:SSD|ARMAZENAMENTO|ROM|UFS)`).test(normalized);
      if (!explicitlyStorage) return only;
    }
  }

  return null;
}

function extractStorage(normalized: string, ram: string | null): string | null {
  const explicit = [
    /\b(?:SSD|ARMAZENAMENTO|ROM)\s*(\d+(?:GB|TB))\b/,
    /\b(\d+(?:GB|TB))\s*(?:SSD|DE\s+ARMAZENAMENTO|ROM)\b/,
  ];
  for (const pattern of explicit) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1];
  }

  const capacities: string[] = Array.from(normalized.matchAll(/\b(\d+(?:GB|TB))\b/g))
    .flatMap((match) => (match[1] ? [match[1]] : []));
  const filtered = capacities.filter((value) => value !== ram);
  if (filtered.length === 0) return null;

  const toGb = (value: string) => {
    const number = Number(value.replace(/[^0-9]/g, ''));
    return value.endsWith('TB') ? number * 1024 : number;
  };
  const sorted = [...filtered].sort((a, b) => toGb(b) - toGb(a));
  return sorted[0] ?? null;
}

function extractNetwork(normalized: string): '4G' | '5G' | 'LTE' | 'WIFI' | 'BT' | null {
  if (hasToken(normalized, '5G')) return '5G';
  if (hasToken(normalized, '4G')) return '4G';
  if (hasToken(normalized, 'LTE')) return 'LTE';
  if (normalized.includes('WI FI') || hasToken(normalized, 'WIFI')) return 'WIFI';
  if (hasToken(normalized, 'BT') || hasToken(normalized, 'BLUETOOTH')) return 'BT';
  return null;
}

function extractSizeMm(normalized: string): number | null {
  const match = normalized.match(/\b(\d{2})\s*MM\b/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 30 && value <= 60 ? value : null;
}

function extractRingSize(normalized: string): number | null {
  const match = normalized.match(/\b(?:TAMANHO|SIZE)\s*(\d{1,2})\b/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 4 && value <= 20 ? value : null;
}

function extractCpuKey(normalized: string): string | null {
  const patterns: Array<{ pattern: RegExp; build: (match: RegExpMatchArray) => string }> = [
    { pattern: /\b(?:INTEL\s+)?CORE\s+ULTRA\s+([3579])\b/, build: (m) => `CORE ULTRA ${m[1]}` },
    { pattern: /\b(?:INTEL\s+)?CORE\s+(I[3579])\s+(\d{4}[A-Z]?)\b/, build: (m) => `CORE ${m[1]} ${m[2]}` },
    { pattern: /\b(?:INTEL\s+)?CORE\s+(I[3579])\b/, build: (m) => `CORE ${m[1]}` },
    { pattern: /\b(?:INTEL\s+)?CORE\s+([3579])\s+(\d{3}[A-Z]?)\b/, build: (m) => `CORE ${m[1]} ${m[2]}` },
    { pattern: /\b(?:INTEL\s+)?CORE\s+([3579])\b/, build: (m) => `CORE ${m[1]}` },
    { pattern: /\bSNAPDRAGON\s+X\s+PLUS\b/, build: () => 'SNAPDRAGON X PLUS' },
    { pattern: /\bSNAPDRAGON\s+(7C|8CX|X)\b/, build: (m) => `SNAPDRAGON ${m[1]}` },
    { pattern: /\bPENTIUM\s+(U?\d{3,4})\b/, build: (m) => `PENTIUM ${m[1]}` },
    { pattern: /\bRYZEN\s+([3579])\b/, build: (m) => `RYZEN ${m[1]}` },
  ];
  for (const item of patterns) {
    const match = normalized.match(item.pattern);
    if (match) return item.build(match);
  }
  return null;
}

function extractQualifiers(normalized: string, category: OnlineProductCategory, modelKey: string | null): string[] {
  if (category === 'notebook') {
    const model = normalizarIdentidadeProduto(modelKey || '');
    return ['ULTRA', 'PRO', 'EDGE', '360'].filter((qualifier) => hasToken(model, qualifier));
  }
  if (category === 'smartwatch') {
    const model = normalizarIdentidadeProduto(modelKey || '');
    return ['ULTRA', 'CLASSIC'].filter((qualifier) => hasToken(model, qualifier) || hasToken(normalized, qualifier));
  }
  if (category === 'earbuds') {
    return ['PRO', 'FE'].filter((qualifier) => hasToken(normalized, qualifier));
  }
  return QUALIFIERS.filter((qualifier) => hasToken(normalized, qualifier));
}

function buildAnchors(identity: Omit<OnlineProductIdentity, 'anchors'>): string[] {
  const anchors = new Set<string>();
  if (identity.modelKey) anchors.add(identity.modelKey);
  identity.qualifiers.forEach((item) => anchors.add(item));
  if (identity.sizeMm) anchors.add(`${identity.sizeMm}MM`);
  if (identity.ringSize) anchors.add(`TAMANHO ${identity.ringSize}`);
  if (identity.cpuKey) anchors.add(identity.cpuKey);
  if (identity.ram) anchors.add(identity.ram);

  const tokens = identity.normalized.split(' ').filter(Boolean);
  for (const token of tokens) {
    if (FILLER_TOKENS.has(token)) continue;
    if (/^\d+(?:GB|TB)$/.test(token)) continue;
    if (/^(?:4G|5G|LTE)$/.test(token)) continue;
    if (/^\d{2}MM$/.test(token)) continue;
    if (token.length <= 1) continue;
    if (/^(?:PRETO|BRANCO|AZUL|PRATA|CINZA|GRAFITE|VERDE|ROSA|VIOLETA|BEGE)$/.test(token)) continue;
    anchors.add(token);
    if (anchors.size >= 8) break;
  }
  return Array.from(anchors);
}

export function criarIdentidadeProduto(value: string): OnlineProductIdentity {
  const normalized = normalizarIdentidadeProduto(value);
  const category = detectCategory(` ${normalized} `);
  const ram = extractRam(normalized, category);
  const modelKey = extractModelKey(normalized, category);
  const qualifiers = extractQualifiers(normalized, category, modelKey);
  const partial: Omit<OnlineProductIdentity, 'anchors'> = {
    raw: String(value || ''),
    normalized,
    brand: hasToken(normalized, 'SAMSUNG') || hasToken(normalized, 'GALAXY') ? 'SAMSUNG' : null,
    category,
    modelKey,
    storage: extractStorage(normalized, ram),
    ram,
    network: extractNetwork(normalized),
    sizeMm: extractSizeMm(normalized),
    ringSize: category === 'ring' ? extractRingSize(normalized) : null,
    qualifiers,
    cpuKey: extractCpuKey(normalized),
  };
  return { ...partial, anchors: buildAnchors(partial) };
}

function isAccessoryForTarget(target: OnlineProductIdentity, candidateNormalized: string): boolean {
  if (GENERIC_ACCESSORY_TERMS.some((term) => candidateNormalized.includes(normalizarIdentidadeProduto(term)))) return true;
  if (/\bPARA\s+(?:SAMSUNG\s+)?GALAXY\b/.test(candidateNormalized)) return true;
  if (/\bCOMPATIVEL\s+COM\s+(?:SAMSUNG\s+)?GALAXY\b/.test(candidateNormalized)) return true;

  if (target.category === 'smartphone' || target.category === 'tablet' || target.category === 'notebook') {
    if (/\bGALAXY\s+BUDS\b|\bSMARTWATCH\b|\bGALAXY\s+WATCH\b/.test(candidateNormalized)) return true;
  }
  return false;
}

function fail(target: OnlineProductIdentity, candidate: OnlineProductIdentity, reason: string): ProductIdentityMatch {
  return { valid: false, score: 0, reason, target, candidate };
}

export function compararIdentidadeProduto(
  targetValue: string,
  candidateValue: string,
  options: { allowIncomplete?: boolean } = {},
): ProductIdentityMatch {
  const allowIncomplete = !!options.allowIncomplete;
  const target = criarIdentidadeProduto(targetValue);
  const candidate = criarIdentidadeProduto(candidateValue);
  const title = candidate.normalized;

  if (!title) return fail(target, candidate, 'titulo_vazio');
  if (BAD_CONDITION_TERMS.some((term) => title.includes(normalizarIdentidadeProduto(term)))) {
    return fail(target, candidate, 'condicao_indesejada');
  }
  if (isAccessoryForTarget(target, title)) return fail(target, candidate, 'acessorio_ou_relacao');

  if (target.category !== 'unknown') {
    if (candidate.category === 'unknown' && !allowIncomplete) return fail(target, candidate, 'categoria_nao_comprovada');
    if (candidate.category !== 'unknown' && candidate.category !== target.category) return fail(target, candidate, 'categoria_divergente');
  }

  // O modelo-base nunca pode ser diferente. Mesmo no ranking parcial de busca,
  // precisamos de pelo menos A06/S26/BOOK4/WATCH8/etc. antes de abrir a URL.
  if (target.modelKey) {
    if (!candidate.modelKey) return fail(target, candidate, 'modelo_nao_comprovado');
    if (normalizarIdentidadeProduto(candidate.modelKey) !== normalizarIdentidadeProduto(target.modelKey)) {
      return fail(target, candidate, 'modelo_divergente');
    }
  }

  const differs = (targetValue: unknown, candidateValue: unknown): boolean =>
    targetValue !== null && targetValue !== undefined &&
    candidateValue !== null && candidateValue !== undefined &&
    targetValue !== candidateValue;
  const missingRequired = (targetValue: unknown, candidateValue: unknown): boolean =>
    !allowIncomplete && targetValue !== null && targetValue !== undefined && (candidateValue === null || candidateValue === undefined);

  if (differs(target.storage, candidate.storage) || missingRequired(target.storage, candidate.storage)) {
    return fail(target, candidate, 'armazenamento_divergente');
  }
  if (differs(target.ram, candidate.ram) || missingRequired(target.ram, candidate.ram)) return fail(target, candidate, 'ram_divergente');
  if (differs(target.sizeMm, candidate.sizeMm) || missingRequired(target.sizeMm, candidate.sizeMm)) return fail(target, candidate, 'tamanho_divergente');
  if (differs(target.ringSize, candidate.ringSize) || missingRequired(target.ringSize, candidate.ringSize)) return fail(target, candidate, 'tamanho_anel_divergente');
  if (differs(target.cpuKey, candidate.cpuKey) || missingRequired(target.cpuKey, candidate.cpuKey)) return fail(target, candidate, 'cpu_divergente');

  if (target.network === '5G') {
    if (candidate.network && candidate.network !== '5G') return fail(target, candidate, 'rede_divergente');
    if (!candidate.network && !allowIncomplete) return fail(target, candidate, 'rede_5g_nao_comprovada');
  }
  if (target.network === '4G' || target.network === 'LTE') {
    if (candidate.network && !['4G', 'LTE'].includes(candidate.network)) return fail(target, candidate, 'rede_divergente');
    if (!candidate.network && !allowIncomplete) return fail(target, candidate, 'rede_nao_comprovada');
  }
  if (target.network === 'WIFI' || target.network === 'BT') {
    if (candidate.network && candidate.network !== target.network) return fail(target, candidate, 'conectividade_divergente');
    if (!candidate.network && !allowIncomplete) return fail(target, candidate, 'conectividade_nao_comprovada');
  }
  if (
    !target.network &&
    target.category === 'smartphone' &&
    /^GALAXY\s+[AMF]\d{2,3}$/.test(`GALAXY ${target.modelKey || ''}`) &&
    candidate.network === '5G'
  ) {
    return fail(target, candidate, 'variante_5g_nao_solicitada');
  }

  for (const qualifier of QUALIFIERS) {
    const targetHas = target.qualifiers.includes(qualifier);
    const candidateHas = candidate.qualifiers.includes(qualifier);
    if (targetHas === candidateHas) continue;

    // Um qualificador EXTRA no candidato é sempre contradição (ex.: S26 PLUS
    // quando o alvo é S26). Um qualificador ausente no título curto de busca
    // pode ser tolerado apenas até abrirmos a página real.
    if (!targetHas && candidateHas) {
      return fail(target, candidate, `qualificador_${qualifier.toLowerCase()}_divergente`);
    }
    if (targetHas && !candidateHas && !allowIncomplete) {
      return fail(target, candidate, `qualificador_${qualifier.toLowerCase()}_nao_comprovado`);
    }
  }

  let score = 0.62;
  if (target.category !== 'unknown' && candidate.category === target.category) score += 0.10;
  if (target.modelKey && candidate.modelKey === target.modelKey) score += 0.14;
  if (target.storage && candidate.storage === target.storage) score += 0.06;
  if (target.ram && candidate.ram === target.ram) score += 0.03;
  if (target.network && candidate.network === target.network) score += 0.02;
  if (target.sizeMm && candidate.sizeMm === target.sizeMm) score += 0.02;
  if (target.ringSize && candidate.ringSize === target.ringSize) score += 0.02;
  if (target.cpuKey && candidate.cpuKey === target.cpuKey) score += 0.02;

  const matchedAnchors = target.anchors.filter((anchor) => candidate.normalized.includes(anchor)).length;
  if (target.anchors.length > 0) score += Math.min(0.04, (matchedAnchors / target.anchors.length) * 0.04);

  return { valid: true, score: Math.min(1, score), reason: null, target, candidate };
}

function normalizeDomain(domain: string): string {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] || '';
}

export function urlPertenceALoja(value: string | null | undefined, loja: OnlineStoreTarget): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return loja.dominios.some((domain) => {
      const allowed = normalizeDomain(domain);
      return !!allowed && (host === allowed || host.endsWith(`.${allowed}`));
    });
  } catch (_) {
    return false;
  }
}

export function pareceUrlDetalheProduto(value: string, loja: OnlineStoreTarget): boolean {
  const lower = String(value || '').toLowerCase();
  const store = normalizarIdentidadeProduto(loja.nome);
  if (store.includes('MERCADO LIVRE')) return lower.includes('/p/mlb') || lower.includes('/up/mlbu') || lower.includes('produto.mercadolivre.com.br/mlb-');
  if (store.includes('CARREFOUR')) return lower.includes('/produto/') || /-\d{6,}/.test(lower);
  if (store.includes('MAGALU') || store.includes('MAGAZINE LUIZA')) return /\/p(?:\/|\?|#|$)/i.test(lower) || /\/te\//i.test(lower);
  if (store.includes('AMAZON')) return lower.includes('/dp/') || lower.includes('/gp/product/');
  if (store.includes('FAST SHOP') || store.includes('FASTSHOP')) return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/produto/');
  if (store.includes('SAMSUNG')) return /\/p(?:\/|\?|#|$)/i.test(lower) || lower.includes('/smartphones/') || lower.includes('/tablets/') || lower.includes('/watches/') || lower.includes('/computers/');
  return true;
}

export function validarCandidatoProduto(params: {
  modelo: string;
  loja: OnlineStoreTarget;
  titulo: string;
  url: string;
  allowIncomplete?: boolean;
}): ProductIdentityMatch {
  const target = criarIdentidadeProduto(params.modelo);
  const candidate = criarIdentidadeProduto(params.titulo);
  if (!urlPertenceALoja(params.url, params.loja)) return fail(target, candidate, 'dominio_divergente');
  if (!pareceUrlDetalheProduto(params.url, params.loja)) return fail(target, candidate, 'url_nao_eh_detalhe');
  const options = params.allowIncomplete === undefined
    ? {}
    : { allowIncomplete: params.allowIncomplete };
  return compararIdentidadeProduto(params.modelo, params.titulo, options);
}

export function precoMinimoPlausivel(modelo: string): number {
  const identity = criarIdentidadeProduto(modelo);
  if (identity.category === 'notebook') return 900;
  if (identity.category === 'tablet') return 250;
  if (identity.category === 'smartwatch') return 180;
  if (identity.category === 'earbuds') return 80;
  if (identity.category === 'ring') return 250;
  if (identity.category === 'wearable') return 100;

  const normalized = identity.normalized;
  if (/\bS\d{2,3}\b/.test(normalized) && identity.qualifiers.includes('ULTRA')) return 2500;
  if (/\bS\d{2,3}\b/.test(normalized)) return 1200;
  if (identity.qualifiers.includes('FOLD') || identity.qualifiers.includes('FLIP')) return 1500;
  if (/\b[AMF]\d{2,3}\b/.test(normalized)) return 200;
  return 100;
}

export function validarPrecoPlausivel(modelo: string, value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded < precoMinimoPlausivel(modelo) || rounded > 100_000) return null;
  return rounded;
}
