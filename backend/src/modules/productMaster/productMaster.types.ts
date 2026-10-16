export type ProductMasterResolutionStatus =
  | 'MASTER'
  | 'FALLBACK'
  | 'AMBIGUOUS'
  | 'UNMAPPED';

export type ProductMasterRow = {
  rowNumber: number;
  sourceCode: string;
  barcode: string;
  barcode2: string;
  sku: string;
  reference: string;
  fullDescription: string;
  description: string;
  category: string;
  category2: string;
  category3: string;
  family: string;
  status: string;
  telefluxoPrefix: string;
  telefluxoCode: string;
};

export type ProductMasterGroup = {
  telefluxoCode: string;
  telefluxoPrefix: string;
  sourceCodes: string[];
  barcodes: string[];
  skus: string[];
  references: string[];
  descriptions: string[];
  fullDescriptions: string[];
  categories: string[];
  categories2: string[];
  categories3: string[];
  families: string[];
  statuses: string[];
  rows: ProductMasterRow[];
};

export type ProductMasterResolveInput = {
  productCode?: unknown;
  barcode?: unknown;
  sku?: unknown;
  reference?: unknown;
  description?: unknown;
  source?: string;
  logIssue?: boolean;
};

export type ProductMasterResolution = {
  status: ProductMasterResolutionStatus;
  telefluxoCode: string | null;
  matchBy: 'PRODUCT_CODE' | 'BARCODE' | 'SKU' | 'REFERENCE' | null;
  group: ProductMasterGroup | null;
  candidates: ProductMasterGroup[];
  usedLegacyFallback: boolean;
  message: string;
};

export type ProductMasterCacheInfo = {
  sheetId: string;
  sheetName: string;
  loadedAt: string | null;
  expiresAt: string | null;
  stale: boolean;
  rows: number;
  groups: number;
  lastError: string | null;
};
