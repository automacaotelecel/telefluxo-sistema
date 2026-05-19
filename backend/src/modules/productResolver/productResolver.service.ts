import { ProductDictionaryEntry } from '../productDictionary/productDictionary.types';

import { searchProductDictionary } from '../productDictionary/productDictionary.service';

import {
  extractColor,
  extractStorage,
  familyFromReference,
  getBaseModelFamily,
  normalizeProductText,
  normalizeReference,
} from '../productDictionary/productDictionary.utils';

import {
  ProductResolvedRequest,
  ProductResolverDictionaryCandidate,
  ProductResolverInput,
  ProductResolverResult,
  ProductSearchPrecision,
} from './productResolver.types';

function cleanNullable(value: any) {
  const text = String(value || '').trim();
  return text ? text : null;
}

function normalizeNullable(value: any) {
  const text = normalizeProductText(value);
  return text ? text : null;
}

function normalizeColorNullable(value: any) {
  const color = extractColor(value);
  return color || normalizeNullable(value);
}

function normalizeStorageNullable(value: any) {
  const storage = extractStorage(value);
  return storage || normalizeNullable(value);
}

function buildRequest(input: ProductResolverInput): ProductResolvedRequest {
  const plan = input.productPlan;

  const raw =
    cleanNullable(plan?.raw) ||
    cleanNullable(input.query) ||
    '';

  const textForInference = [
    input.query,
    plan?.raw,
    plan?.family,
    plan?.model,
    plan?.storage,
    plan?.color,
    plan?.category,
  ]
    .filter(Boolean)
    .join(' ');

  const family =
    normalizeNullable(plan?.family) ||
    normalizeNullable(getBaseModelFamily(textForInference));

  const model =
    normalizeNullable(plan?.model) ||
    (family ? family.replace(/^GALAXY\s+/, '') : null);

  const storage =
    normalizeStorageNullable(plan?.storage) ||
    normalizeStorageNullable(textForInference);

  const color =
    normalizeColorNullable(plan?.color) ||
    extractColor(textForInference) ||
    null;

  const category =
    normalizeNullable(plan?.category) ||
    inferCategoryFromText(textForInference);

  return {
    raw,
    family,
    model,
    storage,
    color,
    category,
  };
}

function inferCategoryFromText(value: any) {
  const text = normalizeProductText(value);

  if (
    text.includes('SMARTPHONE') ||
    text.includes('GALAXY S') ||
    text.includes('GALAXY A') ||
    text.includes('GALAXY M') ||
    text.includes('IPHONE') ||
    text.includes('CELULAR') ||
    text.includes('APARELHO')
  ) {
    return 'SMARTPHONES';
  }

  if (text.includes('ACESSORIO') || text.includes('ACESSORIOS')) {
    return 'ACESSORIOS';
  }

  if (text.includes('WEARABLE') || text.includes('BUDS') || text.includes('WATCH')) {
    return 'WEARABLES';
  }

  if (text.includes('TABLET') || text.includes('TAB ')) {
    return 'TABLETS';
  }

  return null;
}

function entryFamily(entry: ProductDictionaryEntry) {
  return normalizeNullable(entry.family) ||
    normalizeNullable(getBaseModelFamily([
      entry.displayName,
      entry.commercialName,
      entry.description,
      entry.reference,
      entry.referenceFamily,
      entry.productCode,
    ].join(' ')));
}

function entryStorage(entry: ProductDictionaryEntry) {
  return normalizeStorageNullable([
    entry.storage,
    entry.displayName,
    entry.commercialName,
    entry.description,
    entry.reference,
    entry.productCode,
  ].join(' '));
}

function entryColor(entry: ProductDictionaryEntry) {
  return normalizeColorNullable([
    entry.color,
    entry.displayName,
    entry.commercialName,
    entry.description,
  ].join(' '));
}

function entryMatchesExactRequest(
  entry: ProductDictionaryEntry,
  request: ProductResolvedRequest
) {
  const family = entryFamily(entry);
  const storage = entryStorage(entry);
  const color = entryColor(entry);

  if (request.family && family !== request.family) {
    return false;
  }

  if (request.storage && storage !== request.storage) {
    return false;
  }

  /**
   * Cor no dicionário nem sempre é confiável.
   * Se a cor do entry estiver vazia, ainda permitimos como candidato.
   * A validação rígida por cor será feita no estoque real.
   */
  if (request.color && color && color !== request.color) {
    return false;
  }

  return true;
}

function buildCandidate(
  entry: ProductDictionaryEntry,
  score: number,
  reasons: string[],
  request: ProductResolvedRequest
): ProductResolverDictionaryCandidate {
  const family = entryFamily(entry) || '';
  const storage = entryStorage(entry) || undefined;
  const color = entryColor(entry) || undefined;

  return {
    displayName: entry.displayName,
    commercialName: entry.commercialName,
    description: entry.description,
    reference: entry.reference,
    referenceFamily: entry.referenceFamily,
    productCode: entry.productCode,
    family,
    storage,
    color,
    score,
    reasons,
    hasExactFamily: Boolean(request.family && family === request.family),
    hasExactStorage: Boolean(request.storage && storage === request.storage),
    hasExactColor: Boolean(request.color && color === request.color),
  };
}

function extractReferencePrefixesFromEntry(entry: ProductDictionaryEntry) {
  const values = [
    entry.reference,
    entry.referenceFamily,
    entry.productCode,
  ];

  const prefixes = new Set<string>();

  for (const value of values) {
    const normalized = normalizeReference(value);

    if (!normalized) continue;

    const family = familyFromReference(normalized);

    if (family) prefixes.add(family);

    const sm = normalized.match(/SM-[A-Z]?\d{3}/i);
    if (sm?.[0]) prefixes.add(sm[0].toUpperCase());

    const bsm = normalized.match(/BSM-([A-Z]\d{3})/i);
    if (bsm?.[1]) prefixes.add(`SM-${bsm[1].toUpperCase()}`);
  }

  return Array.from(prefixes);
}

function hasExplicitReference(value: any) {
  const text = normalizeReference(value);
  return /\bSM-[A-Z0-9]/i.test(text) || /\bBSM-[A-Z0-9]/i.test(text);
}

function getSearchPrecision(
  request: ProductResolvedRequest,
  input: ProductResolverInput
): ProductSearchPrecision {
  if (!request.family && !request.model && !request.storage && !request.color) {
    return 'generic';
  }

  if (request.color || hasExplicitReference(input.query) || hasExplicitReference(request.raw)) {
    return 'exact_variant';
  }

  if (request.storage) {
    return 'family_storage';
  }

  /**
   * Ex.: "Galaxy A56", "A56", "modelos S26".
   * Isso NÃO é produto exato. É busca aberta de família/linha.
   */
  if (request.family || request.model) {
    return 'family_open';
  }

  return 'generic';
}

export async function resolveProductRequest(
  input: ProductResolverInput
): Promise<ProductResolverResult> {
  const request = buildRequest(input);
  const dictionarySearch = await searchProductDictionary(
    [
      input.query,
      request.family,
      request.model,
      request.storage,
      request.color,
      request.category,
    ]
      .filter(Boolean)
      .join(' ')
  );

  const exactMatches = dictionarySearch.matches
    .filter((match) => entryMatchesExactRequest(match.entry, request))
    .map((match) =>
      buildCandidate(match.entry, match.score, match.reasons, request)
    );

  const similarMatches = dictionarySearch.matches
    .filter((match) => !entryMatchesExactRequest(match.entry, request))
    .slice(0, 20)
    .map((match) =>
      buildCandidate(match.entry, match.score, match.reasons, request)
    );

  const referencePrefixes = Array.from(
    new Set(
      exactMatches.flatMap((candidate) => {
        const fakeEntry = {
          reference: candidate.reference,
          referenceFamily: candidate.referenceFamily,
          productCode: candidate.productCode,
        } as ProductDictionaryEntry;

        return extractReferencePrefixesFromEntry(fakeEntry);
      })
    )
  );

  const searchPrecision = getSearchPrecision(request, input);
  const hasEnoughSpecificity = searchPrecision !== 'generic';
  const strictMode = searchPrecision === 'family_storage' || searchPrecision === 'exact_variant';

  return {
    request,
    searchPrecision,
    exactDictionaryCandidates: exactMatches.slice(0, 30),
    similarDictionaryCandidates: similarMatches.slice(0, 20),
    referencePrefixes,
    hasEnoughSpecificity,
    strictMode,
    diagnostics: {
      query: input.query,
      requestedFamily: request.family,
      requestedStorage: request.storage,
      requestedColor: request.color,
      requestedCategory: request.category,
      searchPrecision,
      reason:
        searchPrecision === 'family_open'
          ? 'Busca aberta de família: retornar todas as variações da família/modelo, sem exigir memória/cor.'
          : strictMode
            ? 'Busca específica: aplicar somente os filtros que o usuário informou, como memória/cor/referência.'
            : 'Busca genérica: permitir busca por score.',
    },
  };
}