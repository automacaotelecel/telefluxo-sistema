import * as XLSX from 'xlsx';
import { google } from 'googleapis';

import {
  ProductMasterCacheInfo,
  ProductMasterGroup,
  ProductMasterResolveInput,
  ProductMasterResolution,
  ProductMasterRow,
} from './productMaster.types';

const PRODUCT_MASTER_SHEET_ID =
  process.env.PRODUCT_MASTER_SHEET_ID ||
  '1D3BpE__wEiw48CmsMEfkQwMeeTzV13p45ZgKhgci4bA';

const PRODUCT_MASTER_SHEET_NAME =
  process.env.PRODUCT_MASTER_SHEET_NAME || 'BASE_MESTRE';

const CACHE_TTL_MS = Number(
  process.env.PRODUCT_MASTER_CACHE_TTL_MS || 10 * 60 * 1000
);

const PUBLIC_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${PRODUCT_MASTER_SHEET_ID}` +
  `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(PRODUCT_MASTER_SHEET_NAME)}`;

type MasterCache = {
  loadedAt: number;
  expiresAt: number;
  rows: ProductMasterRow[];
  groups: ProductMasterGroup[];
  byProductCode: Map<string, ProductMasterGroup[]>;
  byBarcode: Map<string, ProductMasterGroup[]>;
  bySku: Map<string, ProductMasterGroup[]>;
  byReference: Map<string, ProductMasterGroup[]>;
  byTelefluxoCode: Map<string, ProductMasterGroup>;
};

let cache: MasterCache | null = null;
let lastLoadError: string | null = null;
let pendingRefresh: Promise<MasterCache> | null = null;

function clean(value: unknown): string {
  return String(value ?? '').replace(/\u00A0/g, ' ').trim();
}

function normalizeHeader(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentity(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\uFEFF\uFFFE]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function normalizeBarcode(value: unknown): string {
  return clean(value)
    .toUpperCase()
    .replace(/[\uFEFF\uFFFE\s]+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function headerIndex(headers: string[], ...names: string[]): number {
  const wanted = names.map(normalizeHeader);
  return headers.findIndex((header) => wanted.includes(normalizeHeader(header)));
}

function getCell(cols: any[], index: number): string {
  return index >= 0 ? clean(cols[index]) : '';
}

function rowsFromMatrix(matrix: any[][]): ProductMasterRow[] {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];

  const headers = (matrix[0] || []).map((value) => clean(value));

  const idxCode = headerIndex(headers, 'CODIGO', 'CÓDIGO');
  const idxBarcode = headerIndex(
    headers,
    'CODIGO DE BARRA',
    'CÓDIGO DE BARRA',
    'EAN',
    'GTIN'
  );
  const idxBarcode2 = headerIndex(
    headers,
    'CODIGO DE BARRA 2',
    'CÓDIGO DE BARRA 2',
    'EAN 2',
    'GTIN 2'
  );
  const idxSku = headerIndex(headers, 'SKU');
  const idxReference = headerIndex(headers, 'REFERENCIA', 'REFERÊNCIA');
  const idxFullDescription = headerIndex(
    headers,
    'DESCRICAO COMPLETA',
    'DESCRIÇÃO COMPLETA'
  );
  const idxDescription = headerIndex(headers, 'DESCRICAO', 'DESCRIÇÃO');
  const idxCategory = headerIndex(headers, 'CATEGORIA');
  const idxCategory2 = headerIndex(headers, 'CATEGORIA 2');
  const idxCategory3 = headerIndex(headers, 'CATEGORIA 3');
  const idxFamily = headerIndex(headers, 'FAMILIA', 'FAMÍLIA');
  const idxStatus = headerIndex(headers, 'STATUS');
  const idxPrefix = headerIndex(
    headers,
    'PREFIXO TELEFLUXO',
    'PREFIXO TELEFUXO',
    'PREFIXO TELE FLUXO'
  );
  const idxTelefluxoCode = headerIndex(
    headers,
    'CODIGO TELEFLUXO',
    'CÓDIGO TELEFLUXO',
    'CODIGO TELEFUXO',
    'CÓDIGO TELEFUXO',
    'CODIGO TELE FLUXO',
    'CÓDIGO TELE FLUXO'
  );

  if (idxCode < 0) {
    throw new Error(
      `BASE_MESTRE sem coluna CODIGO. Cabeçalhos: ${headers.join(' | ')}`
    );
  }

  if (idxTelefluxoCode < 0) {
    throw new Error(
      `BASE_MESTRE sem coluna CODIGO TELEFLUXO. Cabeçalhos: ${headers.join(' | ')}`
    );
  }

  const result: ProductMasterRow[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const cols = matrix[i] || [];

    const row: ProductMasterRow = {
      rowNumber: i + 1,
      sourceCode: getCell(cols, idxCode),
      barcode: getCell(cols, idxBarcode),
      barcode2: getCell(cols, idxBarcode2),
      sku: getCell(cols, idxSku),
      reference: getCell(cols, idxReference),
      fullDescription: getCell(cols, idxFullDescription),
      description: getCell(cols, idxDescription),
      category: getCell(cols, idxCategory),
      category2: getCell(cols, idxCategory2),
      category3: getCell(cols, idxCategory3),
      family: getCell(cols, idxFamily),
      status: getCell(cols, idxStatus),
      telefluxoPrefix: getCell(cols, idxPrefix),
      telefluxoCode: getCell(cols, idxTelefluxoCode),
    };

    const hasUsefulData = Boolean(
      row.sourceCode ||
        row.barcode ||
        row.barcode2 ||
        row.sku ||
        row.reference ||
        row.description ||
        row.telefluxoCode
    );

    if (hasUsefulData) result.push(row);
  }

  return result;
}

function matrixFromCsv(csvText: string): any[][] {
  const workbook = XLSX.read(csvText, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  }) as any[][];
}

async function loadViaPublicCsv(): Promise<any[][]> {
  const response = await fetch(PUBLIC_CSV_URL, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'TeleFluxo-ProductMaster/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Sheets CSV respondeu HTTP ${response.status}.`);
  }

  const csvText = await response.text();
  if (!csvText.trim()) {
    throw new Error('Google Sheets CSV retornou vazio.');
  }

  return matrixFromCsv(csvText);
}

async function loadViaGoogleApi(): Promise<any[][]> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !redirectUri || !refreshToken) {
    throw new Error('Credenciais Google OAuth indisponíveis para fallback da BASE_MESTRE.');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: PRODUCT_MASTER_SHEET_ID,
    range: `'${PRODUCT_MASTER_SHEET_NAME}'!A:ZZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  return (response.data.values || []) as any[][];
}

async function loadRawRows(): Promise<ProductMasterRow[]> {
  let publicError: unknown = null;

  try {
    const matrix = await loadViaPublicCsv();
    return rowsFromMatrix(matrix);
  } catch (error) {
    publicError = error;
    console.warn(
      '⚠️ BASE_MESTRE: CSV público indisponível, tentando Google Sheets API.',
      error
    );
  }

  try {
    const matrix = await loadViaGoogleApi();
    return rowsFromMatrix(matrix);
  } catch (apiError: any) {
    const publicMessage =
      publicError instanceof Error ? publicError.message : String(publicError || '');
    const apiMessage =
      apiError instanceof Error ? apiError.message : String(apiError || '');

    throw new Error(
      `Não consegui carregar BASE_MESTRE. CSV: ${publicMessage}. API: ${apiMessage}`
    );
  }
}

function buildGroups(rows: ProductMasterRow[]): ProductMasterGroup[] {
  const grouped = new Map<string, ProductMasterRow[]>();

  for (const row of rows) {
    const telefluxoCode = clean(row.telefluxoCode);
    if (!telefluxoCode) continue;

    const key = normalizeIdentity(telefluxoCode);
    if (!key) continue;

    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }

  const groups: ProductMasterGroup[] = [];

  for (const rowsOfGroup of grouped.values()) {
    const first = rowsOfGroup[0];
    if (!first) continue;

    groups.push({
      telefluxoCode: clean(first.telefluxoCode),
      telefluxoPrefix: clean(first.telefluxoPrefix),
      sourceCodes: uniqueStrings(rowsOfGroup.map((row) => row.sourceCode)),
      barcodes: uniqueStrings(
        rowsOfGroup.flatMap((row) => [row.barcode, row.barcode2])
      ),
      skus: uniqueStrings(rowsOfGroup.map((row) => row.sku)),
      references: uniqueStrings(rowsOfGroup.map((row) => row.reference)),
      descriptions: uniqueStrings(rowsOfGroup.map((row) => row.description)),
      fullDescriptions: uniqueStrings(
        rowsOfGroup.map((row) => row.fullDescription)
      ),
      categories: uniqueStrings(rowsOfGroup.map((row) => row.category)),
      categories2: uniqueStrings(rowsOfGroup.map((row) => row.category2)),
      categories3: uniqueStrings(rowsOfGroup.map((row) => row.category3)),
      families: uniqueStrings(rowsOfGroup.map((row) => row.family)),
      statuses: uniqueStrings(rowsOfGroup.map((row) => row.status)),
      rows: rowsOfGroup,
    });
  }

  return groups;
}

function addIndex(
  map: Map<string, ProductMasterGroup[]>,
  key: string,
  group: ProductMasterGroup
) {
  if (!key) return;
  const current = map.get(key) || [];
  if (!current.some((item) => item.telefluxoCode === group.telefluxoCode)) {
    current.push(group);
  }
  map.set(key, current);
}

function buildCache(rows: ProductMasterRow[]): MasterCache {
  const groups = buildGroups(rows);
  const byProductCode = new Map<string, ProductMasterGroup[]>();
  const byBarcode = new Map<string, ProductMasterGroup[]>();
  const bySku = new Map<string, ProductMasterGroup[]>();
  const byReference = new Map<string, ProductMasterGroup[]>();
  const byTelefluxoCode = new Map<string, ProductMasterGroup>();

  for (const group of groups) {
    byTelefluxoCode.set(normalizeIdentity(group.telefluxoCode), group);

    group.sourceCodes.forEach((value) =>
      addIndex(byProductCode, normalizeIdentity(value), group)
    );
    group.barcodes.forEach((value) =>
      addIndex(byBarcode, normalizeBarcode(value), group)
    );
    group.skus.forEach((value) => addIndex(bySku, normalizeIdentity(value), group));
    group.references.forEach((value) =>
      addIndex(byReference, normalizeIdentity(value), group)
    );
  }

  const now = Date.now();

  return {
    loadedAt: now,
    expiresAt: now + Math.max(30_000, CACHE_TTL_MS),
    rows,
    groups,
    byProductCode,
    byBarcode,
    bySku,
    byReference,
    byTelefluxoCode,
  };
}

export async function refreshProductMaster(): Promise<MasterCache> {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    try {
      const rows = await loadRawRows();
      const nextCache = buildCache(rows);
      cache = nextCache;
      lastLoadError = null;
      console.log(
        `✅ BASE_MESTRE carregada: ${nextCache.rows.length} linhas / ${nextCache.groups.length} chaves TeleFluxo.`
      );
      return nextCache;
    } catch (error: any) {
      lastLoadError = error?.message || String(error);
      console.error('❌ Falha ao atualizar BASE_MESTRE:', error);

      // Se já existe cache válido de execução anterior, nunca derrubamos o sistema.
      if (cache) return cache;
      throw error;
    } finally {
      pendingRefresh = null;
    }
  })();

  return pendingRefresh;
}

export async function getProductMasterCache(params?: {
  forceRefresh?: boolean;
}): Promise<MasterCache> {
  const now = Date.now();

  if (!params?.forceRefresh && cache && cache.expiresAt > now) {
    return cache;
  }

  return refreshProductMaster();
}

function uniqueGroups(groups: ProductMasterGroup[]): ProductMasterGroup[] {
  const map = new Map<string, ProductMasterGroup>();
  groups.forEach((group) => {
    map.set(normalizeIdentity(group.telefluxoCode), group);
  });
  return Array.from(map.values());
}

function resultForCandidates(
  candidates: ProductMasterGroup[],
  matchBy: ProductMasterResolution['matchBy'],
  exactCodeMatch: boolean
): ProductMasterResolution {
  const unique = uniqueGroups(candidates);

  if (unique.length === 1) {
    const group = unique[0]!;
    return {
      status: exactCodeMatch ? 'MASTER' : 'FALLBACK',
      telefluxoCode: group.telefluxoCode,
      matchBy,
      group,
      candidates: unique,
      usedLegacyFallback: false,
      message: exactCodeMatch
        ? 'Produto encontrado pelo código de origem na BASE_MESTRE.'
        : `Produto encontrado por ${matchBy || 'identificador auxiliar'} na BASE_MESTRE.`,
    };
  }

  if (unique.length > 1) {
    return {
      status: 'AMBIGUOUS',
      telefluxoCode: null,
      matchBy,
      group: null,
      candidates: unique,
      usedLegacyFallback: true,
      message: 'Mais de uma chave TeleFluxo corresponde ao identificador informado.',
    };
  }

  return {
    status: 'UNMAPPED',
    telefluxoCode: null,
    matchBy: null,
    group: null,
    candidates: [],
    usedLegacyFallback: true,
    message: 'Produto não localizado na BASE_MESTRE.',
  };
}

export async function resolveProductMaster(
  input: ProductMasterResolveInput
): Promise<ProductMasterResolution> {
  let current: MasterCache;

  try {
    current = await getProductMasterCache();
  } catch (error: any) {
    return {
      status: 'UNMAPPED',
      telefluxoCode: null,
      matchBy: null,
      group: null,
      candidates: [],
      usedLegacyFallback: true,
      message:
        `BASE_MESTRE indisponível; manter método antigo. ${error?.message || ''}`.trim(),
    };
  }

  const codeKey = normalizeIdentity(input.productCode);
  if (codeKey) {
    const byCode = current.byProductCode.get(codeKey) || [];
    const result = resultForCandidates(byCode, 'PRODUCT_CODE', true);
    if (result.status !== 'UNMAPPED') return result;
  }

  const barcodeKey = normalizeBarcode(input.barcode);
  if (barcodeKey) {
    const result = resultForCandidates(
      current.byBarcode.get(barcodeKey) || [],
      'BARCODE',
      false
    );
    if (result.status !== 'UNMAPPED') return result;
  }

  const skuKey = normalizeIdentity(input.sku);
  if (skuKey) {
    const result = resultForCandidates(
      current.bySku.get(skuKey) || [],
      'SKU',
      false
    );
    if (result.status !== 'UNMAPPED') return result;
  }

  const referenceKey = normalizeIdentity(input.reference);
  if (referenceKey) {
    const result = resultForCandidates(
      current.byReference.get(referenceKey) || [],
      'REFERENCE',
      false
    );
    if (result.status !== 'UNMAPPED') return result;
  }

  return resultForCandidates([], null, false);
}

export async function getProductMasterGroups(params?: {
  forceRefresh?: boolean;
}): Promise<ProductMasterGroup[]> {
  const current = await getProductMasterCache(params);
  return current.groups;
}

export function getProductMasterCacheInfo(): ProductMasterCacheInfo {
  const now = Date.now();

  return {
    sheetId: PRODUCT_MASTER_SHEET_ID,
    sheetName: PRODUCT_MASTER_SHEET_NAME,
    loadedAt: cache ? new Date(cache.loadedAt).toISOString() : null,
    expiresAt: cache ? new Date(cache.expiresAt).toISOString() : null,
    stale: Boolean(cache && cache.expiresAt <= now),
    rows: cache?.rows.length || 0,
    groups: cache?.groups.length || 0,
    lastError: lastLoadError,
  };
}
