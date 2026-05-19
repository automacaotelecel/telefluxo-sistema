import { ClarkProdutoPlanejado } from '../clark/clark.types';

export type ProductResolvedRequest = {
  raw: string;
  family: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  category: string | null;
};

export type ProductResolverDictionaryCandidate = {
  displayName: string;
  commercialName: string;
  description: string;
  reference: string;
  referenceFamily: string;
  productCode: string;
  family: string;
  storage: string | undefined;
  color: string | undefined;
  score: number;
  reasons: string[];
  hasExactFamily: boolean;
  hasExactStorage: boolean;
  hasExactColor: boolean;
};

export type ProductSearchPrecision =
  | 'generic'
  | 'family_open'
  | 'family_storage'
  | 'exact_variant';

export type ProductResolverResult = {
  request: ProductResolvedRequest;
  searchPrecision: ProductSearchPrecision;
  exactDictionaryCandidates: ProductResolverDictionaryCandidate[];
  similarDictionaryCandidates: ProductResolverDictionaryCandidate[];
  referencePrefixes: string[];
  hasEnoughSpecificity: boolean;
  strictMode: boolean;
  diagnostics: {
    query: string;
    requestedFamily: string | null;
    requestedStorage: string | null;
    requestedColor: string | null;
    requestedCategory: string | null;
    searchPrecision: ProductSearchPrecision;
    reason: string;
  };
};

export type ProductResolverInput = {
  query: string;
  productPlan: ClarkProdutoPlanejado | null;
};