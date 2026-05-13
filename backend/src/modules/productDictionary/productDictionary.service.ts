import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

import {
  ProductDictionaryEntry,
  ProductDictionaryMatch,
  ProductSearchIntent,
} from './productDictionary.types';

import {
  buildDictionaryEntryFromParts,
  familyFromReference,
  normalizeProductText,
  normalizeReference,
  parseProductSearchIntent,
} from './productDictionary.utils';

const prisma = new PrismaClient();

const GSHEET_TRANSLATION_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS96tjslp46EX-F8-Q8AfYfanS_DzG-2XpUJ6bjK7xTE73m-7LdsX59sTjRnyPMWcE8niiHpJa-A4pX/pub?output=csv';

let cache: {
  createdAt: number;
  entries: ProductDictionaryEntry[];
} | null = null;

const CACHE_TTL_MS = 1000 * 60 * 15;

function mergeEntry(
  map: Map<string, ProductDictionaryEntry>,
  entry: ProductDictionaryEntry | null
) {
  if (!entry) return;

  const existing = map.get(entry.key);

  if (!existing) {
    map.set(entry.key, entry);
    return;
  }

  existing.commercialName =
    existing.commercialName || entry.commercialName;

  existing.displayName =
    existing.displayName || entry.displayName;

  existing.description =
    existing.description || entry.description;

  existing.reference =
    existing.reference || entry.reference;

  existing.referenceFamily =
    existing.referenceFamily || entry.referenceFamily;

  existing.productCode =
    existing.productCode || entry.productCode;

  existing.category =
    existing.category || entry.category;

  existing.brand =
    existing.brand || entry.brand;

  existing.storage =
    existing.storage || entry.storage;

  existing.color =
    existing.color || entry.color;

  existing.aliases = Array.from(
    new Set([...existing.aliases, ...entry.aliases])
  );

  existing.searchableText = normalizeProductText(
    `${existing.searchableText} ${entry.searchableText}`
  );

  existing.sources = Array.from(
    new Set([...existing.sources, ...entry.sources])
  ) as any;
}

function normalizeHeader(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadMarketingTranslations() {
  try {
    const response = await fetch(GSHEET_TRANSLATION_URL, {
      cache: 'no-store',
    });

    if (!response.ok) return [];

    const csvText = await response.text();

    const workbook = XLSX.read(csvText, { type: 'string' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];

    if (!sheet) return [];

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    }) as any[][];

    if (rawRows.length < 2) return [];

    const headers = (rawRows[0] || []).map((h: any) => String(h || '').trim());

    const findHeader = (...names: string[]) => {
      const normalizedNames = names.map(normalizeHeader);

      return headers.findIndex((header) =>
        normalizedNames.includes(normalizeHeader(header))
      );
    };

    const idxBasic = findHeader('Basic Model', 'basicModel', 'BASIC MODEL');
    const idxMarketing = findHeader('Marketing Name', 'marketingName');
    const idxDescricao = findHeader(
      'DESCRIÇÃO 2',
      'DESCRICAO 2',
      'descricao2'
    );
    const idxReferencia = findHeader(
      'REFERÊNCIA 2',
      'REFERENCIA 2',
      'referencia2'
    );

    return rawRows.slice(1).map((cols) => ({
      basicModel: idxBasic >= 0 ? String(cols[idxBasic] || '').trim() : '',
      marketingName:
        idxMarketing >= 0 ? String(cols[idxMarketing] || '').trim() : '',
      descricao2:
        idxDescricao >= 0 ? String(cols[idxDescricao] || '').trim() : '',
      referencia2:
        idxReferencia >= 0 ? String(cols[idxReferencia] || '').trim() : '',
    }));
  } catch (error) {
    console.warn('⚠️ Não consegui carregar tradução de modelos:', error);
    return [];
  }
}

async function buildDictionaryFromStock(map: Map<string, ProductDictionaryEntry>) {
  const stock = await prisma.stock.findMany({
    select: {
      productCode: true,
      reference: true,
      description: true,
      category: true,
    },
  });

  for (const item of stock as any[]) {
    const entry = buildDictionaryEntryFromParts({
      description: item.description,
      reference: item.reference,
      productCode: item.productCode,
      category: item.category,
      source: 'stock',
    });

    mergeEntry(map, entry);
  }
}

async function buildDictionaryFromMarketingSheet(
  map: Map<string, ProductDictionaryEntry>
) {
  const rows = await loadMarketingTranslations();

  for (const row of rows) {
    const reference = normalizeReference(row.referencia2);
    const referenceFamily = familyFromReference(reference);

    const entry = buildDictionaryEntryFromParts({
      description: row.descricao2,
      reference: reference || referenceFamily,
      productCode: row.basicModel,
      category: 'SMARTPHONES',
      commercialName: row.marketingName || row.descricao2,
      source: 'translation_sheet',
    });

    mergeEntry(map, entry);
  }
}

export async function getProductDictionary(params?: { forceRefresh?: boolean }) {
  const now = Date.now();

  if (
    !params?.forceRefresh &&
    cache &&
    now - cache.createdAt < CACHE_TTL_MS
  ) {
    return cache.entries;
  }

  const map = new Map<string, ProductDictionaryEntry>();

  await buildDictionaryFromStock(map);
  await buildDictionaryFromMarketingSheet(map);

  const entries = Array.from(map.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

  cache = {
    createdAt: now,
    entries,
  };

  return entries;
}

function scoreEntry(
  entry: ProductDictionaryEntry,
  intent: ProductSearchIntent
): ProductDictionaryMatch {
  let score = 0;
  const reasons: string[] = [];

  const searchable = entry.searchableText;
  const normalizedQuery = intent.normalizedQuery;

  if (normalizedQuery && searchable.includes(normalizedQuery)) {
    score += 80;
    reasons.push('texto completo encontrado');
  }

  if (intent.family && entry.family === intent.family) {
    score += 50;
    reasons.push(`família ${intent.family}`);
  } else if (intent.family && searchable.includes(intent.family)) {
    score += 35;
    reasons.push(`família parecida ${intent.family}`);
  }

  if (intent.storage && entry.storage === intent.storage) {
    score += 25;
    reasons.push(`memória ${intent.storage}`);
  }

  if (intent.color && entry.color === intent.color) {
    score += 25;
    reasons.push(`cor ${intent.color}`);
  }

  for (const token of intent.tokens) {
    if (searchable.includes(token)) {
      score += 8;
      reasons.push(`token ${token}`);
    }
  }

  if (entry.reference && normalizedQuery.includes(entry.reference)) {
    score += 60;
    reasons.push('referência exata');
  }

  if (entry.productCode && normalizedQuery.includes(entry.productCode)) {
    score += 45;
    reasons.push('código exato');
  }

  return {
    entry,
    score,
    reasons,
  };
}

export async function searchProductDictionary(query: string) {
  const dictionary = await getProductDictionary();
  const intent = parseProductSearchIntent(query);

  const matches = dictionary
    .map((entry) => scoreEntry(entry, intent))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    intent,
    matches,
    bestMatches: matches.slice(0, 20),
  };
}