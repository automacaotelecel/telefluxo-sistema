import {
  ProductDictionaryEntry,
  ProductSearchIntent,
} from './productDictionary.types';

export function normalizeProductText(value: any) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[‐-‒–—−]/g, '-')
    .replace(/[^\w\s\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeProductCompact(value: any) {
  return normalizeProductText(value)
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9\-\/]/g, '')
    .trim();
}

export function normalizeReference(value: any) {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐-‒–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function familyFromReference(value: any) {
  const ref = normalizeReference(value);

  const samsungFull = ref.match(/^(SM-[A-Z]?\d{3})/i);

  if (samsungFull?.[1]) {
    return samsungFull[1].toUpperCase();
  }

  const bsmSamsung = ref.match(/BSM-([A-Z]\d{3})/i);

  if (bsmSamsung?.[1]) {
    return `SM-${bsmSamsung[1].toUpperCase()}`;
  }

  return ref;
}

export function getBaseModelFamily(value: any) {
  let str = normalizeProductText(value);

  str = str.replace(/\+/g, ' PLUS ');

  let m = str.match(/\bGALAXY\s+(S[0-9]{2})\s?(ULTRA|PLUS|FE|PRO)?\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1]}${m[2] ? ` ${m[2]}` : ''}`.replace(/\s+/g, ' ');
  }

  m = str.match(/\b(S[0-9]{2})\s?(ULTRA|PLUS|FE|PRO)?\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1]}${m[2] ? ` ${m[2]}` : ''}`.replace(/\s+/g, ' ');
  }

  m = str.match(/\bGALAXY\s+([AMF][0-9]{2})\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1]}`.trim();
  }

  m = str.match(/\b([AMF][0-9]{2})\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1]}`.trim();
  }

  m = str.match(/\bGALAXY\s+(Z\s?FLIP\s?[0-9]|Z\s?FOLD\s?[0-9])\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1].replace(/\s+/g, ' ').trim()}`;
  }

  m = str.match(/\b(Z\s?FLIP\s?[0-9]|Z\s?FOLD\s?[0-9]|FLIP\s?[0-9]|FOLD\s?[0-9])\b/);

  if (m?.[1]) {
    return `GALAXY ${m[1].replace(/\s+/g, ' ').trim()}`;
  }

  m = str.match(/\b(IPHONE\s[0-9]{1,2})\s?(PRO\sMAX|PRO|PLUS|MINI)?\b/);

  if (m?.[0]) {
    return m[0].replace(/\s+/g, ' ').trim();
  }

  m = str.match(/\b(MOTO\s?G[0-9]{2}|EDGE\s[0-9]{2})\s?(PRO|ULTRA|NEO)?\b/);

  if (m?.[0]) {
    return m[0].replace(/\s+/g, ' ').trim();
  }

  m = str.match(/\b(REDMI\sNOTE\s[0-9]{1,2}|REDMI\s[0-9]{1,2}|POCO\s[A-Z][0-9]{1,2})\s?(PRO\sPLUS|PRO|PLUS)?\b/);

  if (m?.[0]) {
    return m[0].replace(/\s+/g, ' ').trim();
  }

  const samsungRef = str.match(/\bSM-([A-Z]?\d{3})\b/);

  if (samsungRef?.[1]) {
    const code = samsungRef[1];

    if (code.startsWith('S948')) return 'GALAXY S26 ULTRA';
    if (code.startsWith('S942')) return 'GALAXY S26';
    if (code.startsWith('S938')) return 'GALAXY S25 ULTRA';
    if (code.startsWith('S937')) return 'GALAXY S25';
    if (code.startsWith('S928')) return 'GALAXY S24 ULTRA';
    if (code.startsWith('S918')) return 'GALAXY S23 ULTRA';
    if (code.startsWith('S908')) return 'GALAXY S22 ULTRA';

    return `SM-${code}`;
  }

  return undefined;
}

export function formatDisplayName(value: any) {
  let clean = String(value || '')
    .replace(/SMARTPHONE/gi, '')
    .replace(/SAMSUNG/gi, '')
    .replace(/MOTOROLA/gi, '')
    .replace(/APPLE/gi, '')
    .replace(/XIAOMI/gi, '')
    .replace(/TPU/gi, '')
    .replace(/\(OPEN\)/gi, '')
    .replace(/ANTI\s?CHOQUE/gi, '')
    .replace(/PROTETORA/gi, '');

  return clean.trim().replace(/\s+/g, ' ');
}

export function extractStorage(value: any) {
  const text = normalizeProductText(value);

  const match =
    text.match(/\b(1TB|2TB)\b/) ||
    text.match(/\b(64|128|256|512)\s?GB\b/);

  if (!match?.[0]) return undefined;

  return match[0].replace(/\s+/g, '').toUpperCase();
}

const COLOR_ALIASES: Record<string, string[]> = {
  PRETO: [
    'PRETO',
    'BLACK',
    'PHANTOM BLACK',
    'JETBLACK',
    'JET BLACK',
    'TITANIO PRETO',
    'TITÂNIO PRETO',
  ],
  GRAFITE: [
    'GRAFITE',
    'GRAPHITE',
    'GRAY',
    'GREY',
    'CINZA',
    'TITANIO CINZA',
    'TITÂNIO CINZA',
  ],
  BRANCO: ['BRANCO', 'WHITE'],
  AZUL: ['AZUL', 'BLUE', 'TITANIO AZUL', 'TITÂNIO AZUL'],
  VERDE: ['VERDE', 'GREEN'],
  VIOLETA: [
    'VIOLETA',
    'VIOLET',
    'PURPLE',
    'LILAS',
    'LILÁS',
    'TITANIO VIOLETA',
    'TITÂNIO VIOLETA',
  ],
  CREME: ['CREME', 'CREAM', 'BEGE', 'TITANIO CREME', 'TITÂNIO CREME'],
  ROSA: ['ROSA', 'PINK'],
  PRATA: ['PRATA', 'SILVER', 'TITANIO PRATA', 'TITÂNIO PRATA'],
  AMARELO: ['AMARELO', 'YELLOW'],
  VERMELHO: ['VERMELHO', 'RED'],
};

export function extractColor(value: any) {
  const text = normalizeProductText(value);

  for (const [canonical, aliases] of Object.entries(COLOR_ALIASES)) {
    const found = aliases.some((alias) => {
      const aliasNorm = normalizeProductText(alias);
      return text.includes(aliasNorm);
    });

    if (found) {
      return canonical;
    }
  }

  return undefined;
}

export function extractBrand(value: any) {
  const text = normalizeProductText(value);

  if (text.includes('SAMSUNG') || text.includes('GALAXY') || text.includes('SM-')) {
    return 'SAMSUNG';
  }

  if (text.includes('APPLE') || text.includes('IPHONE')) {
    return 'APPLE';
  }

  if (text.includes('MOTOROLA') || text.includes('MOTO')) {
    return 'MOTOROLA';
  }

  if (text.includes('XIAOMI') || text.includes('REDMI') || text.includes('POCO')) {
    return 'XIAOMI';
  }

  return undefined;
}

export function tokenizeProductQuery(value: any) {
  return normalizeProductText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter(
      (token) =>
        ![
          'ME',
          'LISTE',
          'ONDE',
          'ESTA',
          'ESTAO',
          'ESTÁ',
          'ESTÃO',
          'TODOS',
          'TODAS',
          'MODELO',
          'MODELOS',
          'PRODUTO',
          'PRODUTOS',
          'DO',
          'DA',
          'DE',
          'DOS',
          'DAS',
          'LOJA',
          'LOJAS',
          'TEM',
          'TÊM',
          'EM',
          'ESTOQUE',
          'QUAL',
          'QUAIS',
          'POSSUEM',
        ].includes(token)
    );
}

export function buildSearchableText(parts: any[]) {
  return normalizeProductText(parts.filter(Boolean).join(' '));
}

export function parseProductSearchIntent(query: string): ProductSearchIntent {
  const normalizedQuery = normalizeProductText(query);

  return {
    rawQuery: query,
    normalizedQuery,
    family: getBaseModelFamily(normalizedQuery),
    storage: extractStorage(normalizedQuery),
    color: extractColor(normalizedQuery),
    category: undefined,
    tokens: tokenizeProductQuery(normalizedQuery),
  };
}

export function buildDictionaryEntryFromParts(params: {
  description?: string;
  reference?: string;
  productCode?: string;
  category?: string;
  commercialName?: string;
  source: ProductDictionaryEntry['sources'][number];
}): ProductDictionaryEntry | null {
  const description = String(params.description || '').trim();
  const reference = normalizeReference(params.reference || '');
  const referenceFamily = familyFromReference(reference);
  const productCode = String(params.productCode || '').trim();
  const category = String(params.category || '').trim();
  const commercialName = String(params.commercialName || '').trim();

  const textBasis = [
    commercialName,
    description,
    reference,
    referenceFamily,
    productCode,
    category,
  ].join(' ');

  const family =
    getBaseModelFamily(commercialName) ||
    getBaseModelFamily(description) ||
    getBaseModelFamily(reference) ||
    getBaseModelFamily(productCode) ||
    referenceFamily ||
    '';

  const storage = extractStorage(textBasis);
  const color = extractColor(textBasis);
  const brand = extractBrand(textBasis);

  const displayName =
    commercialName ||
    formatDisplayName(description) ||
    reference ||
    productCode ||
    family;

  if (!displayName && !reference && !productCode) return null;

  const aliases = Array.from(
    new Set(
      [
        commercialName,
        description,
        formatDisplayName(description),
        reference,
        referenceFamily,
        productCode,
        family,
        storage,
        color,
        brand,
      ]
        .filter(Boolean)
        .map((x) => normalizeProductText(x))
    )
  );

  const key = [
    reference || referenceFamily || family || displayName,
    productCode,
    normalizeProductText(displayName),
  ]
    .filter(Boolean)
    .join('|');

  return {
    key,
    family,
    commercialName,
    displayName,
    description,
    reference,
    referenceFamily,
    productCode,
    category,
    brand,
    storage,
    color,
    aliases,
    searchableText: buildSearchableText(aliases),
    sources: [params.source],
  };
}