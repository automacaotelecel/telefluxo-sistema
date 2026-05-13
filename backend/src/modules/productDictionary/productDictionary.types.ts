export type ProductDictionarySource =
  | 'stock'
  | 'translation_sheet'
  | 'price_guide'
  | 'sales'
  | 'manual';

export type ProductDictionaryEntry = {
  key: string;

  family: string;
  commercialName: string;
  displayName: string;

  description: string;
  reference: string;
  referenceFamily: string;
  productCode: string;
  category: string;

  brand: string | undefined;
  storage: string | undefined;
  color: string | undefined;

  aliases: string[];
  searchableText: string;

  sources: ProductDictionarySource[];
};

export type ProductSearchIntent = {
  rawQuery: string;
  normalizedQuery: string;

  family: string | undefined;
  storage: string | undefined;
  color: string | undefined;
  category: string | undefined;

  tokens: string[];
};

export type ProductDictionaryMatch = {
  entry: ProductDictionaryEntry;
  score: number;
  reasons: string[];
};