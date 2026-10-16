import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveProductMaster } from '../productMaster/productMaster.service';
import { recordProductMasterIssue } from '../productMaster/productMasterIssues.service';

const router = Router();
const prisma = new PrismaClient();

const SUPER_ROLES = new Set(['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'SOCIO', 'MASTER']);
const AUDIT_TYPES = {
  GERAL: { label: 'Conferência unificada', identifierMode: 'AUTO', identifierLabel: 'IMEI, serial ou código de barras' },
  APARELHOS: {
    label: 'Aparelhos',
    identifierMode: 'IMEI',
    identifierLabel: 'IMEI',
  },
  ACESSORIOS: {
    label: 'Acessórios',
    identifierMode: 'BARCODE',
    identifierLabel: 'Código de barras',
  },
  WEARABLES: {
    label: 'Wearables',
    identifierMode: 'SERIAL',
    identifierLabel: 'Serial / identificador',
  },
  TABLETS: {
    label: 'Tablets',
    identifierMode: 'SERIAL',
    identifierLabel: 'Serial / identificador',
  },
  NOTEBOOKS: {
    label: 'Notebooks',
    identifierMode: 'SERIAL',
    identifierLabel: 'Serial / identificador',
  },
} as const;

type AuditType = keyof typeof AUDIT_TYPES;
type AuditUser = {
  id: string;
  name: string;
  role: string;
  isAdmin: boolean;
  allowedStores: string | null;
};

type AuditStockRow = {
  id: string;
  storeName: string;
  productCode: string;
  reference: string;
  description: string;
  category: string;
  quantity: number;
  serial: string | null;
  barcode: string | null;
  stockType: string;
  updatedAt: Date;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeAuditType(value: unknown): AuditType {
  const normalized = normalizeText(value).replace(/[^A-Z0-9]/g, '');
  if (['GERAL', 'TODOS', 'UNIFICADO'].includes(normalized)) return 'GERAL';
  if (normalized === 'ACESSORIO' || normalized === 'ACESSORIOS') return 'ACESSORIOS';
  if (normalized === 'WEARABLE' || normalized === 'WEARABLES') return 'WEARABLES';
  if (normalized === 'TABLET' || normalized === 'TABLETS') return 'TABLETS';
  if (normalized === 'NOTEBOOK' || normalized === 'NOTEBOOKS' || normalized === 'LAPTOP' || normalized === 'LAPTOPS') return 'NOTEBOOKS';
  return 'APARELHOS';
}

function auditTypeConfig(value: unknown) {
  const auditType = normalizeAuditType(value);
  return { auditType, ...AUDIT_TYPES[auditType] };
}

function categoryMatchesAuditType(auditType: AuditType, category: unknown): boolean {
  if (auditType === 'GERAL') return true;
  const value = normalizeText(category);
  if (!value) return false;

  if (auditType === 'APARELHOS') {
    return value.includes('SMARTPHONE') || value.includes('SMART PHONE') || value.includes('APARELHO') || value === 'CELULAR' || value.includes('TELEFONE');
  }
  if (auditType === 'ACESSORIOS') {
    return [
      'ACESSORIO', 'ACCESSOR', 'MOBILE ENHANCEMENT', 'MOBILE ACCESS', 'AUDIO',
      'BUDS', 'FONE', 'EARPHONE', 'HEADPHONE', 'HEADSET', 'CARREGADOR', 'CHARGER',
      'ADAPTADOR', 'ADAPTER', 'CABO', 'CAPA', 'COVER', 'CASE', 'PELICULA', 'PROTETOR',
      'MOUSE', 'TECLADO', 'KEYBOARD', 'POWERBANK', 'POWER BANK', 'SMARTTAG', 'SMART TAG',
      'S PEN', 'SPEN',
    ].some((token) => value.includes(token));
  }
  if (auditType === 'WEARABLES') {
    return value.includes('WEARABLE') || value.includes('WATCH') || value.includes('RELOGIO');
  }
  if (auditType === 'TABLETS') {
    return value.includes('TABLET');
  }
  return value.includes('NOTEBOOK') || value.includes('LAPTOP');
}

// A categoria é inferida do cadastro, NUNCA da aba visual selecionada.
function classifyAuditCategory(category: unknown, description: unknown): string {
  const c = normalizeText(category);
  const d = normalizeText(description);
  if (/WEARABLE|WATCH|RELOGIO|GALAXY RING/.test(c) || /\b(WATCH|GALAXY RING|FIT[0-9])\b/.test(d)) return 'WEARABLES';
  if (/TABLET|\bTAB\b/.test(c) || /GALAXY TAB|\bTABLET\b/.test(d)) return 'TABLETS';
  if (/NOTEBOOK|LAPTOP|COMPUTADOR|COMPUTER/.test(c) || /GALAXY BOOK|\bNOTEBOOK\b/.test(d)) return 'NOTEBOOKS';
  if (categoryMatchesAuditType('ACESSORIOS', c) || /BUDS|FONE|EARPHONE|HEADPHONE|HEADSET|CARREGADOR|CHARGER|ADAPTADOR|ADAPTER|PELICULA|PROTETOR|\bCABO\b|\bCAPA\b|\bCOVER\b|\bCASE\b|POWER ?BANK|SMART ?TAG|S ?PEN|TECLADO|KEYBOARD|MOUSE/.test(d)) return 'ACESSORIOS';
  if (categoryMatchesAuditType('APARELHOS', c) || /\b(GALAXY [ASMZ]|FOLD|FLIP|SMARTPHONE)\b/.test(d)) return 'APARELHOS';
  return 'OUTROS';
}
function normalizedStockType(value: unknown): string {
  const kind = normalizeText(value).replace(/[_-]/g, ' ');
  if (/AMOSTRA|MOSTRUARIO|DEMONSTRACAO/.test(kind)) return 'AMOSTRA';
  if (/\bDOA\b/.test(kind)) return 'DOA';
  return 'ESTOQUE';
}
// Preserve letras e números: serial de wearable não é um EAN.
function normalizeSerial(value: unknown): string {
  const valueText = String(value ?? '').toUpperCase().replace(/\s+/g, '').trim();
  return /^[A-Z0-9._-]{5,64}$/.test(valueText) ? valueText : '';
}
function showUnifiedIdentifier(stored: unknown): string {
  return String(stored || '').replace(/^(?:I:|S:|B:|R:|P:|X:)/, '').replace(/#\d{6}$/i, '');
}

function normalizeLookupKey(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

type UnifiedIdentifierMode = 'IMEI' | 'SERIAL' | 'BARCODE';

function inferIdentifierModeFromStoredIdentifier(value: unknown): UnifiedIdentifierMode {
  const stored = String(value || '').trim().toUpperCase();
  if (stored.startsWith('B:') || stored.startsWith('R:') || stored.startsWith('P:') || stored.startsWith('X:')) return 'BARCODE';
  if (stored.startsWith('S:')) return 'SERIAL';
  if (stored.startsWith('I:')) return 'IMEI';
  return extractImei(stored) ? 'IMEI' : 'SERIAL';
}

function enrichExpectedItemForUnifiedSession(item: any, sessionAuditType: AuditType) {
  const auditType = sessionAuditType === 'GERAL'
    ? classifyAuditCategory(item?.category, item?.description)
    : sessionAuditType;

  return {
    ...item,
    auditType,
    stockType: 'ESTOQUE',
    identifierMode: sessionAuditType === 'GERAL'
      ? inferIdentifierModeFromStoredIdentifier(item?.imei)
      : (AUDIT_TYPES[sessionAuditType].identifierMode === 'BARCODE'
        ? 'BARCODE'
        : AUDIT_TYPES[sessionAuditType].identifierMode === 'SERIAL'
          ? 'SERIAL'
          : 'IMEI'),
  };
}

function inferScanAuditType(
  scan: any,
  sessionAuditType: AuditType,
  expectedCategory?: string
): string {
  if (sessionAuditType !== 'GERAL') return sessionAuditType;
  return classifyAuditCategory(expectedCategory || '', scan?.description || '');
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function isValidImei(value: string): boolean {
  const imei = onlyDigits(value);
  if (!/^\d{15}$/.test(imei)) return false;

  let sum = 0;
  for (let index = 0; index < imei.length; index += 1) {
    let digit = Number(imei[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function extractImei(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const exact = onlyDigits(raw);
  if (exact.length === 15 && isValidImei(exact)) return exact;

  const isolated = [...raw.matchAll(/(?:^|\D)(\d{15})(?=\D|$)/g)]
    .map((match) => match[1] || '')
    .find((candidate) => isValidImei(candidate));
  if (isolated) return isolated;

  for (const group of raw.match(/\d{16,}/g) ?? []) {
    for (let index = 0; index <= group.length - 15; index += 1) {
      const candidate = group.slice(index, index + 15);
      if (isValidImei(candidate)) return candidate;
    }
  }

  return '';
}

function normalizeBarcode(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (/^[\d\s-]+$/.test(raw) && digits.length >= 8 && digits.length <= 18) return digits;

  const compact = raw
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .toUpperCase();

  return compact.length >= 4 && compact.length <= 64 ? compact : '';
}

function extractBarcode(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const exact = normalizeBarcode(raw);
  if (exact) return exact;

  const numericCandidate = raw.match(/(?:^|\D)(\d{8,18})(?=\D|$)/)?.[1];
  return numericCandidate ? normalizeBarcode(numericCandidate) : '';
}

function baseExpectedIdentifier(value: unknown, auditType: AuditType): string {
  const raw = String(value ?? '').trim();
  if (auditType === 'GERAL') return showUnifiedIdentifier(raw);
  if (AUDIT_TYPES[auditType].identifierMode === 'IMEI') return raw;
  return raw.replace(/#\d{6}$/i, '');
}

function allowedStoreNames(user: AuditUser): string[] {
  return String(user.allowedStores || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function canSeeAllStores(user: AuditUser): boolean {
  return Boolean(user.isAdmin || SUPER_ROLES.has(normalizeText(user.role)));
}

function canAccessStore(user: AuditUser, requestedStore: string): boolean {
  if (canSeeAllStores(user)) return true;
  const target = normalizeText(requestedStore);
  return allowedStoreNames(user).some((store) => normalizeText(store) === target);
}

async function resolveUser(userId: unknown): Promise<AuditUser | null> {
  const id = String(userId || '').trim();
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      isAdmin: true,
      allowedStores: true,
    },
  });
}

async function getAuditStockRows(storeName?: string): Promise<AuditStockRow[]> {
  const rows = await prisma.stock.findMany({
    where: {
      ...(storeName ? { storeName } : {}),
      // O Bipador principal confere somente o estoque comercial.
      // AMOSTRA e DOA possuem áreas próprias e ficam fora desta foto.
      stockType: { equals: 'ESTOQUE' },
      quantity: { gt: 0 },
    },
    select: {
      id: true,
      storeName: true,
      productCode: true,
      reference: true,
      description: true,
      category: true,
      quantity: true,
      serial: true,
      barcode: true,
      stockType: true,
      updatedAt: true,
    },
    orderBy: [{ storeName: 'asc' }, { description: 'asc' }],
  }) as AuditStockRow[];

  // BASE_MESTRE é a primeira camada para categoria/identidade.
  // Se ela não conhecer o produto, mantemos integralmente a categoria original
  // e as regras antigas do Bipador.
  const resolutionCache = new Map<string, Awaited<ReturnType<typeof resolveProductMaster>>>();
  const enriched: AuditStockRow[] = [];

  for (const row of rows) {
    const key = `${normalizeLookupKey(row.productCode)}|${normalizeLookupKey(row.barcode)}|${normalizeLookupKey(row.reference)}`;
    let resolution = resolutionCache.get(key);

    if (!resolution) {
      resolution = await resolveProductMaster({
        productCode: row.productCode,
        barcode: row.barcode,
        reference: row.reference,
        description: row.description,
        source: 'BIPADOR_ESTOQUE',
      });
      resolutionCache.set(key, resolution);

      if (resolution.status !== 'MASTER') {
        await recordProductMasterIssue({
          source: 'BIPADOR_ESTOQUE',
          productCode: row.productCode,
          barcode: row.barcode,
          reference: row.reference,
          description: row.description,
          status: resolution.status === 'FALLBACK'
            ? 'FALLBACK'
            : resolution.status === 'AMBIGUOUS'
              ? 'AMBIGUOUS'
              : 'UNMAPPED',
          telefluxoCode: resolution.telefluxoCode,
          matchBy: resolution.matchBy,
          details: resolution.message,
        });
      }
    }

    const masterCategory =
      resolution.group?.categories2?.[0] ||
      resolution.group?.categories?.[0] ||
      resolution.group?.categories3?.[0] ||
      '';

    enriched.push({
      ...row,
      category: masterCategory || row.category,
    });
  }

  return enriched;
}

async function assertStoreAccess(user: AuditUser, requestedStore: string): Promise<string | null> {
  const target = normalizeText(requestedStore);
  if (!target) return null;

  const rows = await prisma.stock.findMany({
    where: {
      stockType: { equals: 'ESTOQUE' },
      quantity: { gt: 0 },
    },
    distinct: ['storeName'],
    select: { storeName: true },
  });

  const matchedStore = rows.find((row: any) => normalizeText(row.storeName) === target)?.storeName || null;
  if (!matchedStore) return null;
  if (canSeeAllStores(user)) return matchedStore;

  const allowed = new Set(allowedStoreNames(user).map(normalizeText));
  return allowed.has(target) ? matchedStore : null;
}

function buildUnifiedSnapshot(stockRows: AuditStockRow[]) {
  type Expected = {
    stockId: string | null;
    imei: string;
    productCode: string;
    reference: string;
    description: string;
    category: string;
    auditType: string;
    stockType: string;
    identifierMode: string;
  };

  const expected: Expected[] = [];
  const seenSerials = new Map<string, number>();
  const barcodeGroups = new Map<string, AuditStockRow[]>();
  let missingIdentifierUnits = 0;
  const missingIdentifierProducts = new Set<string>();

  const noteMissing = (row: AuditStockRow, quantity: number) => {
    if (quantity <= 0) return;
    missingIdentifierUnits += quantity;
    missingIdentifierProducts.add(`${row.productCode}|${row.description}`);
  };

  for (const row of stockRows) {
    const quantity = Math.max(0, Math.trunc(Number(row.quantity || 0)));
    if (!quantity) continue;

    const auditType = classifyAuditCategory(row.category, row.description);
    const stockType = 'ESTOQUE';

    // REGRA DO BIPADOR UNIFICADO:
    // - somente ACESSÓRIOS usam código de barras e podem ser contados por quantidade;
    // - aparelhos usam IMEI;
    // - wearables, tablets e notebooks usam serial, inclusive alfanumérico.
    if (auditType === 'ACESSORIOS') {
      // O acessório NUNCA some da foto da conferência.
      // Preferimos o código de barras real. Quando a integração ainda não
      // trouxe o EAN/GTIN, mantemos o produto na base usando referência ou
      // código do produto como chave de contingência. Assim a aba Acessórios
      // continua refletindo TODO o estoque da loja.
      const barcode = normalizeBarcode(row.barcode);
      const referenceKey = normalizeLookupKey(row.reference);
      const productKey = normalizeLookupKey(row.productCode);
      const groupKey = barcode
        ? `B:${barcode}`
        : referenceKey
          ? `R:${referenceKey}`
          : productKey
            ? `P:${productKey}`
            : `X:${row.id}`;

      const group = barcodeGroups.get(groupKey) || [];
      group.push(row);
      barcodeGroups.set(groupKey, group);
      continue;
    }

    const serial = auditType === 'APARELHOS'
      ? extractImei(row.serial)
      : normalizeSerial(row.serial);

    if (!serial) {
      noteMissing(row, quantity);
      continue;
    }

    const identifierMode = auditType === 'APARELHOS' ? 'IMEI' : 'SERIAL';
    const key = `${identifierMode === 'IMEI' ? 'I:' : 'S:'}${serial}`;
    seenSerials.set(key, (seenSerials.get(key) || 0) + 1);

    expected.push({
      stockId: row.id,
      imei: key,
      productCode: row.productCode,
      reference: row.reference,
      description: row.description,
      category: row.category,
      auditType,
      stockType,
      identifierMode,
    });

    // Serial/IMEI representa uma unidade física. Se a origem trouxer uma linha
    // agregada com quantidade > 1 usando um único serial, não inventamos seriais.
    if (quantity > 1) noteMissing(row, quantity - 1);
  }

  // Um mesmo IMEI/serial não pode gerar duas unidades físicas diferentes porque
  // o schema possui unicidade por sessão + identificador. Mantemos uma unidade e
  // deixamos o restante apenas como inconsistência cadastral.
  const serialConflicts = new Set(
    [...seenSerials].filter(([, count]) => count > 1).map(([key]) => key),
  );
  const uniqueExpected = expected.filter((item, index, list) => {
    if (!serialConflicts.has(item.imei)) return true;
    return list.findIndex((candidate) => candidate.imei === item.imei) === index;
  });

  // Acessórios NÃO são descartados quando o mesmo código de barras aparece em
  // várias linhas/produtos. O barcode vira um grupo de contagem. Cada unidade da
  // quantidade de estoque recebe um identificador interno único B:<EAN>#000001.
  for (const [groupKey, rows] of barcodeGroups) {
    let unitIndex = 0;

    for (const row of rows) {
      const quantity = Math.max(0, Math.trunc(Number(row.quantity || 0)));
      for (let count = 0; count < quantity; count += 1) {
        unitIndex += 1;
        uniqueExpected.push({
          stockId: row.id,
          imei: `${groupKey}#${String(unitIndex).padStart(6, '0')}`,
          productCode: row.productCode,
          reference: row.reference,
          description: row.description,
          category: row.category,
          auditType: 'ACESSORIOS',
          stockType: 'ESTOQUE',
          identifierMode: 'BARCODE',
        });
      }
    }
  }

  return {
    expected: uniqueExpected,
    missingIdentifierUnits,
    missingIdentifierProducts: missingIdentifierProducts.size,
    sourceRows: stockRows,
    warnings: [],
  };
}

function buildExpectedSnapshot(stockRows: AuditStockRow[], auditType: AuditType) {
  if (auditType === 'GERAL') return buildUnifiedSnapshot(stockRows);
  const config = AUDIT_TYPES[auditType];
  const rows = stockRows.filter((row) => categoryMatchesAuditType(auditType, row.category));
  const expected: Array<{
    stockId: string | null;
    imei: string;
    productCode: string;
    reference: string;
    description: string;
    category: string;
  }> = [];

  let missingIdentifierUnits = 0;
  const missingIdentifierProducts = new Set<string>();

  if (config.identifierMode === 'IMEI') {
    for (const row of rows) {
      const imei = extractImei(row.serial || '');
      const quantity = Math.max(0, Math.trunc(Number(row.quantity || 0)));
      if (!imei) {
        missingIdentifierUnits += quantity;
        missingIdentifierProducts.add(row.description);
        continue;
      }

      expected.push({
        stockId: row.id,
        imei,
        productCode: row.productCode,
        reference: row.reference,
        description: row.description,
        category: row.category,
      });
    }
  } else {
    const byBarcode = new Map<string, {
      stockId: string | null;
      barcode: string;
      productCode: string;
      reference: string;
      description: string;
      category: string;
      quantity: number;
    }>();

    for (const row of rows) {
      const quantity = Math.max(0, Math.trunc(Number(row.quantity || 0)));
      if (quantity <= 0) continue;

      const barcode = normalizeBarcode(row.barcode || '');
      if (!barcode) {
        missingIdentifierUnits += quantity;
        missingIdentifierProducts.add(row.description);
        continue;
      }

      const current = byBarcode.get(barcode) || {
        stockId: row.id,
        barcode,
        productCode: row.productCode,
        reference: row.reference,
        description: row.description,
        category: row.category,
        quantity: 0,
      };
      current.quantity += quantity;
      byBarcode.set(barcode, current);
    }

    for (const item of byBarcode.values()) {
      for (let index = 1; index <= item.quantity; index += 1) {
        expected.push({
          stockId: item.stockId,
          imei: `${item.barcode}#${String(index).padStart(6, '0')}`,
          productCode: item.productCode,
          reference: item.reference,
          description: item.description,
          category: item.category,
        });
      }
    }
  }

  return {
    expected,
    missingIdentifierUnits,
    missingIdentifierProducts: missingIdentifierProducts.size,
    sourceRows: rows,
  };
}

async function buildSessionPayload(sessionId: string) {
  const session = await prisma.inventoryAuditSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  const config = auditTypeConfig((session as any).auditType);

  const [expectedItemsRaw, scans] = await Promise.all([
    prisma.inventoryAuditExpectedItem.findMany({
      where: { sessionId },
      orderBy: [{ description: 'asc' }, { imei: 'asc' }],
    }),
    prisma.inventoryAuditScan.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const expectedItems = expectedItemsRaw.map((rawItem: any) => {
    const item = enrichExpectedItemForUnifiedSession(rawItem, config.auditType);
    return {
      ...item,
      identifier: baseExpectedIdentifier(rawItem.imei, config.auditType),
      imei: baseExpectedIdentifier(rawItem.imei, config.auditType),
    };
  });

  // auditType/stockType NÃO são colunas de InventoryAuditScan.
  // Para a sessão GERAL, usamos primeiro a categoria do item esperado (que já
  // passou pela BASE_MESTRE). Só se não existir correspondência usamos o método
  // antigo baseado na descrição.
  const categoryByProductCode = new Map<string, string>();
  for (const item of expectedItemsRaw as any[]) {
    const code = normalizeLookupKey(item?.productCode);
    if (code && !categoryByProductCode.has(code)) {
      categoryByProductCode.set(code, String(item?.category || ''));
    }
  }

  const enrichedScans = scans.map((scan: any) => {
    const expectedCategory = categoryByProductCode.get(
      normalizeLookupKey(scan?.productCode)
    );

    return {
      ...scan,
      auditType: inferScanAuditType(scan, config.auditType, expectedCategory),
      stockType: 'ESTOQUE',
    };
  });

  const checkedItems = expectedItems.filter((item: any) => item.checkedAt !== null);
  const missingUnitItems = expectedItems.filter((item: any) => item.checkedAt === null);
  const unexpectedOnlyScans = enrichedScans.filter((scan: any) => scan.result === 'UNEXPECTED' || scan.result === 'AMBIGUOUS');
  const duplicateScans = enrichedScans.filter((scan: any) => scan.result === 'DUPLICATE');
  const excessScans = enrichedScans.filter((scan: any) => scan.result === 'EXCESS');
  const divergenceScans = enrichedScans.filter((scan: any) => scan.result === 'UNEXPECTED' || scan.result === 'EXCESS' || scan.result === 'AMBIGUOUS');
  const invalidScans = enrichedScans.filter((scan: any) => scan.result === 'INVALID');

  const products = new Map<string, {
    productCode: string;
    reference: string;
    description: string;
    auditType: string;
    stockType: string;
    expected: number;
    checked: number;
    missing: number;
  }>();

  for (const item of expectedItems) {
    const key = `${config.auditType === 'GERAL' ? (item as any).auditType : config.auditType}|${(item as any).stockType}|${item.productCode}|${item.reference}|${item.description}`;
    const current = products.get(key) || {
      productCode: item.productCode,
      reference: item.reference,
      description: item.description,
      auditType: config.auditType === 'GERAL' ? ((item as any).auditType || 'OUTROS') : config.auditType,
      stockType: (item as any).stockType || 'ESTOQUE',
      expected: 0,
      checked: 0,
      missing: 0,
    };
    current.expected += 1;
    if (item.checkedAt) current.checked += 1;
    else current.missing += 1;
    products.set(key, current);
  }

  const productSummary = [...products.values()]
    .map((item) => ({
      ...item,
      progress: item.expected > 0 ? Math.round((item.checked / item.expected) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.missing - a.missing || b.expected - a.expected || a.description.localeCompare(b.description));

  const expected = expectedItems.length;
  const checked = checkedItems.length;
  const pending = missingUnitItems.length;

  const barcodeMissing = missingUnitItems.filter((item: any) => (item as any).identifierMode === 'BARCODE' || (config.identifierMode === 'BARCODE' && config.auditType !== 'GERAL'));
  const serialMissing = missingUnitItems.filter((item: any) => !barcodeMissing.includes(item));
  const missingItems = [
    ...Array.from(
        barcodeMissing.reduce((map: Map<string, any>, item: any) => {
          const key = `${item.identifier}|${item.auditType}|${item.stockType}|${item.productCode}|${item.reference}|${item.description}`;
          const current = map.get(key);
          if (current) {
            current.quantity += 1;
          } else {
            map.set(key, { ...item, quantity: 1 });
          }
          return map;
        }, new Map<string, any>()).values(),
      ),
    ...serialMissing.map((item: any) => ({ ...item, quantity: 1 })),
  ];

  const breakdown: Record<string, { expected: number; checked: number; pending: number; unexpected: number; duplicates: number; excess: number; invalid: number; progress: number }> = {};
  const ensureBreakdown = (key: string) => breakdown[key] ||= { expected: 0, checked: 0, pending: 0, unexpected: 0, duplicates: 0, excess: 0, invalid: 0, progress: 0 };
  for (const item of expectedItems) {
    const row = ensureBreakdown(config.auditType === 'GERAL' ? ((item as any).auditType || 'OUTROS') : config.auditType);
    row.expected++;
    if (item.checkedAt) row.checked++;
    else row.pending++;
  }
  for (const scan of enrichedScans as any[]) {
    const row = ensureBreakdown(scan.auditType || config.auditType);
    if (scan.result === 'UNEXPECTED' || scan.result === 'AMBIGUOUS') row.unexpected++;
    if (scan.result === 'DUPLICATE') row.duplicates++;
    if (scan.result === 'EXCESS') row.excess++;
    if (scan.result === 'INVALID') row.invalid++;
  }
  Object.values(breakdown).forEach((row) => { row.progress = row.expected ? Math.round((row.checked / row.expected) * 1000) / 10 : 0; });

  return {
    breakdown,
    session: {
      ...session,
      auditType: config.auditType,
      auditLabel: config.label,
      identifierMode: config.identifierMode,
      identifierLabel: config.identifierLabel,
    },
    audit: config,
    stats: {
      expected,
      checked,
      pending,
      unexpected: unexpectedOnlyScans.length,
      duplicates: duplicateScans.length,
      excess: excessScans.length,
      invalid: invalidScans.length,
      progress: expected > 0 ? Math.round((checked / expected) * 1000) / 10 : 0,
    },
    productSummary,
    missingItems,
    unexpectedScans: divergenceScans,
    recentScans: enrichedScans.slice(0, 30).map((scan: any) => ({
      ...scan,
      identifier: config.auditType === 'GERAL' ? showUnifiedIdentifier(scan.imei) : scan.imei,
    })),
  };
}

type SampleConferenceSessionRow = {
  id: string;
  userId: string;
  operatorName: string;
  storeName: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startedAt: Date | string;
  completedAt: Date | string | null;
  updatedAt: Date | string;
};

type SampleConferenceItemRow = {
  id: string;
  sessionId: string;
  imei: string;
  source: string;
  productCode: string | null;
  reference: string | null;
  description: string | null;
  stockStore: string | null;
  stockStatus: 'CURRENT_STORE' | 'OTHER_STORE' | 'NOT_FOUND';
  hasDamage: number | boolean;
  damageType: string | null;
  observation: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function normalizeSampleItem(row: SampleConferenceItemRow) {
  return {
    ...row,
    hasDamage: Boolean(row.hasDamage),
  };
}

let sampleConferenceSchemaPromise: Promise<void> | null = null;

function ensureSampleConferenceSchema(): Promise<void> {
  if (!sampleConferenceSchemaPromise) {
    sampleConferenceSchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SampleConferenceSession" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "operatorName" TEXT NOT NULL,
          "storeName" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'ACTIVE',
          "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "completedAt" DATETIME,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SampleConferenceItem" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "sessionId" TEXT NOT NULL,
          "imei" TEXT NOT NULL,
          "source" TEXT NOT NULL DEFAULT 'MANUAL',
          "productCode" TEXT,
          "reference" TEXT,
          "description" TEXT,
          "stockStore" TEXT,
          "stockStatus" TEXT NOT NULL DEFAULT 'NOT_FOUND',
          "hasDamage" INTEGER NOT NULL DEFAULT 0,
          "damageType" TEXT,
          "observation" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "SampleConferenceItem_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "SampleConferenceSession" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);

      const statements = [
        'CREATE INDEX IF NOT EXISTS "SampleConferenceSession_userId_storeName_status_idx" ON "SampleConferenceSession"("userId", "storeName", "status")',
        'CREATE INDEX IF NOT EXISTS "SampleConferenceSession_storeName_startedAt_idx" ON "SampleConferenceSession"("storeName", "startedAt")',
        'CREATE UNIQUE INDEX IF NOT EXISTS "SampleConferenceItem_sessionId_imei_key" ON "SampleConferenceItem"("sessionId", "imei")',
        'CREATE INDEX IF NOT EXISTS "SampleConferenceItem_sessionId_createdAt_idx" ON "SampleConferenceItem"("sessionId", "createdAt")',
        'CREATE INDEX IF NOT EXISTS "SampleConferenceItem_sessionId_hasDamage_idx" ON "SampleConferenceItem"("sessionId", "hasDamage")',
        'CREATE INDEX IF NOT EXISTS "SampleConferenceItem_imei_idx" ON "SampleConferenceItem"("imei")',
      ];

      for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement);
      }
    })().catch((error) => {
      sampleConferenceSchemaPromise = null;
      throw error;
    });
  }

  return sampleConferenceSchemaPromise;
}

async function getSampleSession(sessionId: string): Promise<SampleConferenceSessionRow | null> {
  const rows = await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
    `SELECT * FROM "SampleConferenceSession" WHERE "id" = ? LIMIT 1`,
    sessionId,
  );
  return rows[0] || null;
}

async function assertSampleSessionAccess(user: AuditUser, sessionId: string) {
  const session = await getSampleSession(sessionId);
  if (!session) return { session: null, allowed: false };
  const allowed = canAccessStore(user, session.storeName) || session.userId === user.id;
  return { session, allowed };
}

async function buildSampleConferencePayload(sessionId: string) {
  const session = await getSampleSession(sessionId);
  if (!session) return null;

  const rows = await prisma.$queryRawUnsafe<SampleConferenceItemRow[]>(
    `SELECT * FROM "SampleConferenceItem" WHERE "sessionId" = ? ORDER BY "createdAt" DESC`,
    sessionId,
  );
  const items = rows.map(normalizeSampleItem);
  const withDamage = items.filter((item) => item.hasDamage).length;
  const outsideStore = items.filter((item) => item.stockStatus === 'OTHER_STORE').length;
  const notFound = items.filter((item) => item.stockStatus === 'NOT_FOUND').length;

  return {
    session,
    stats: {
      total: items.length,
      withDamage,
      withoutDamage: Math.max(items.length - withDamage, 0),
      outsideStore,
      notFound,
    },
    items,
  };
}

router.use('/sample-sessions', async (_req, res, next) => {
  try {
    await ensureSampleConferenceSchema();
    next();
  } catch (error: any) {
    console.error('Erro ao preparar tabelas da conferência de amostras:', error);
    return res.status(500).json({ error: 'Não foi possível preparar a conferência de amostras no banco de dados.' });
  }
});

router.get('/sample-sessions', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const store = String(req.query.store || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);

    let sessions: SampleConferenceSessionRow[];
    if (canSeeAllStores(user)) {
      sessions = store
        ? await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
            `SELECT * FROM "SampleConferenceSession" WHERE "storeName" = ? ORDER BY "startedAt" DESC LIMIT ?`,
            store,
            limit,
          )
        : await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
            `SELECT * FROM "SampleConferenceSession" ORDER BY "startedAt" DESC LIMIT ?`,
            limit,
          );
    } else {
      sessions = store
        ? await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
            `SELECT * FROM "SampleConferenceSession" WHERE "userId" = ? AND "storeName" = ? ORDER BY "startedAt" DESC LIMIT ?`,
            user.id,
            store,
            limit,
          )
        : await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
            `SELECT * FROM "SampleConferenceSession" WHERE "userId" = ? ORDER BY "startedAt" DESC LIMIT ?`,
            user.id,
            limit,
          );
    }

    return res.json({ success: true, sessions });
  } catch (error: any) {
    console.error('Erro inventory-audit/sample-sessions:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar conferências de amostras.' });
  }
});

router.post('/sample-sessions', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const requestedStore = String(req.body?.store || '').trim();
    const store = await assertStoreAccess(user, requestedStore);
    if (!store) return res.status(403).json({ error: 'Loja inválida ou sem permissão para este usuário.' });

    const activeRows = await prisma.$queryRawUnsafe<SampleConferenceSessionRow[]>(
      `SELECT * FROM "SampleConferenceSession" WHERE "userId" = ? AND "storeName" = ? AND "status" = 'ACTIVE' ORDER BY "startedAt" DESC LIMIT 1`,
      user.id,
      store,
    );
    const active = activeRows[0];

    if (active && req.body?.forceNew !== true) {
      const payload = await buildSampleConferencePayload(active.id);
      return res.json({ success: true, reused: true, ...payload });
    }

    if (active) {
      const now = new Date();
      await prisma.$executeRawUnsafe(
        `UPDATE "SampleConferenceSession" SET "status" = 'CANCELLED', "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`,
        now,
        now,
        active.id,
      );
    }

    const id = randomUUID();
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SampleConferenceSession" ("id", "userId", "operatorName", "storeName", "status", "startedAt", "updatedAt") VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      id,
      user.id,
      user.name,
      store,
      now,
      now,
    );

    const payload = await buildSampleConferencePayload(id);
    return res.status(201).json({ success: true, reused: false, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/create-sample-session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao iniciar conferência de amostras.' });
  }
});

router.get('/sample-sessions/:id', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id || '').trim();
    const access = await assertSampleSessionAccess(user, sessionId);
    if (!access.session) return res.status(404).json({ error: 'Conferência de amostras não encontrada.' });
    if (!access.allowed) return res.status(403).json({ error: 'Sem acesso a esta conferência de amostras.' });

    const payload = await buildSampleConferencePayload(sessionId);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/sample-session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar conferência de amostras.' });
  }
});

router.post('/sample-sessions/:id/scan', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id || '').trim();
    const access = await assertSampleSessionAccess(user, sessionId);
    if (!access.session) return res.status(404).json({ error: 'Conferência de amostras não encontrada.' });
    if (!access.allowed) return res.status(403).json({ error: 'Sem acesso a esta conferência de amostras.' });
    if (access.session.status !== 'ACTIVE') return res.status(409).json({ error: 'Esta conferência de amostras já foi encerrada.' });

    const rawValue = String(req.body?.rawValue ?? req.body?.imei ?? '').trim();
    const source = String(req.body?.source || 'MANUAL').toUpperCase().slice(0, 20);
    const imei = extractImei(rawValue);

    if (!imei) {
      const payload = await buildSampleConferencePayload(sessionId);
      return res.json({
        success: true,
        read: {
          imei: '',
          result: 'INVALID',
          title: 'Código inválido',
          message: 'Não foi possível identificar um IMEI válido de 15 dígitos.',
        },
        ...payload,
      });
    }

    const duplicateRows = await prisma.$queryRawUnsafe<SampleConferenceItemRow[]>(
      `SELECT * FROM "SampleConferenceItem" WHERE "sessionId" = ? AND "imei" = ? LIMIT 1`,
      sessionId,
      imei,
    );
    const duplicate = duplicateRows[0];
    if (duplicate) {
      const payload = await buildSampleConferencePayload(sessionId);
      return res.json({
        success: true,
        read: {
          ...normalizeSampleItem(duplicate),
          result: 'DUPLICATE',
          title: 'Aparelho já bipado',
          message: 'Este IMEI já faz parte desta conferência de amostras.',
        },
        ...payload,
      });
    }

    const stockHit = await prisma.stock.findFirst({
      where: { serial: imei, category: { equals: 'Smartphone' } },
      select: {
        storeName: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
      },
    });

    const sameStore = stockHit && normalizeText(stockHit.storeName) === normalizeText(access.session.storeName);
    const stockStatus: SampleConferenceItemRow['stockStatus'] = !stockHit
      ? 'NOT_FOUND'
      : sameStore
        ? 'CURRENT_STORE'
        : 'OTHER_STORE';

    const itemId = randomUUID();
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SampleConferenceItem" (
        "id", "sessionId", "imei", "source", "productCode", "reference", "description", "stockStore", "stockStatus", "hasDamage", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      itemId,
      sessionId,
      imei,
      source,
      stockHit?.productCode || null,
      stockHit?.reference || null,
      stockHit?.description || null,
      stockHit?.storeName || null,
      stockStatus,
      now,
      now,
    );

    const payload = await buildSampleConferencePayload(sessionId);
    const savedItem = payload?.items.find((item) => item.id === itemId) || null;
    const read = {
      ...savedItem,
      result: stockStatus,
      title: stockStatus === 'CURRENT_STORE'
        ? 'Amostra registrada'
        : stockStatus === 'OTHER_STORE'
          ? 'Amostra registrada — atenção à loja'
          : 'Amostra registrada — IMEI fora da base',
      message: stockStatus === 'CURRENT_STORE'
        ? `${stockHit?.description || 'Aparelho'} adicionado à conferência.`
        : stockStatus === 'OTHER_STORE'
          ? `${stockHit?.description || 'Aparelho'} consta em ${stockHit?.storeName || 'outra loja'}.`
          : 'O IMEI foi registrado na amostra, mas não consta no estoque atual do TeleFluxo.',
    };

    return res.json({ success: true, read, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/sample-scan:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao registrar amostra.' });
  }
});

router.patch('/sample-sessions/:id/items/:itemId', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id || '').trim();
    const itemId = String(req.params.itemId || '').trim();
    const access = await assertSampleSessionAccess(user, sessionId);
    if (!access.session) return res.status(404).json({ error: 'Conferência de amostras não encontrada.' });
    if (!access.allowed) return res.status(403).json({ error: 'Sem acesso a esta conferência de amostras.' });
    if (access.session.status !== 'ACTIVE') return res.status(409).json({ error: 'Esta conferência de amostras já foi encerrada.' });

    const itemRows = await prisma.$queryRawUnsafe<SampleConferenceItemRow[]>(
      `SELECT * FROM "SampleConferenceItem" WHERE "id" = ? AND "sessionId" = ? LIMIT 1`,
      itemId,
      sessionId,
    );
    if (!itemRows[0]) return res.status(404).json({ error: 'Aparelho não encontrado nesta conferência.' });

    const hasDamage = req.body?.hasDamage === true || req.body?.hasDamage === 1 || String(req.body?.hasDamage).toLowerCase() === 'true';
    const damageType = hasDamage ? String(req.body?.damageType || '').trim().slice(0, 160) : '';
    const observation = String(req.body?.observation || '').trim().slice(0, 1000);
    const now = new Date();

    await prisma.$executeRawUnsafe(
      `UPDATE "SampleConferenceItem" SET "hasDamage" = ?, "damageType" = ?, "observation" = ?, "updatedAt" = ? WHERE "id" = ? AND "sessionId" = ?`,
      hasDamage ? 1 : 0,
      damageType || null,
      observation || null,
      now,
      itemId,
      sessionId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "SampleConferenceSession" SET "updatedAt" = ? WHERE "id" = ?`,
      now,
      sessionId,
    );

    const payload = await buildSampleConferencePayload(sessionId);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/update-sample-item:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao salvar observação da amostra.' });
  }
});

router.delete('/sample-sessions/:id/items/:itemId', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id || '').trim();
    const itemId = String(req.params.itemId || '').trim();
    const access = await assertSampleSessionAccess(user, sessionId);
    if (!access.session) return res.status(404).json({ error: 'Conferência de amostras não encontrada.' });
    if (!access.allowed) return res.status(403).json({ error: 'Sem acesso a esta conferência de amostras.' });
    if (access.session.status !== 'ACTIVE') return res.status(409).json({ error: 'Esta conferência de amostras já foi encerrada.' });

    await prisma.$executeRawUnsafe(
      `DELETE FROM "SampleConferenceItem" WHERE "id" = ? AND "sessionId" = ?`,
      itemId,
      sessionId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "SampleConferenceSession" SET "updatedAt" = ? WHERE "id" = ?`,
      new Date(),
      sessionId,
    );

    const payload = await buildSampleConferencePayload(sessionId);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/delete-sample-item:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao remover aparelho da amostra.' });
  }
});

router.post('/sample-sessions/:id/complete', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id || '').trim();
    const access = await assertSampleSessionAccess(user, sessionId);
    if (!access.session) return res.status(404).json({ error: 'Conferência de amostras não encontrada.' });
    if (!access.allowed) return res.status(403).json({ error: 'Sem acesso a esta conferência de amostras.' });

    const now = new Date();
    await prisma.$executeRawUnsafe(
      `UPDATE "SampleConferenceSession" SET "status" = 'COMPLETED', "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`,
      now,
      now,
      sessionId,
    );

    const payload = await buildSampleConferencePayload(sessionId);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/complete-sample-session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao finalizar conferência de amostras.' });
  }
});

router.get('/stores', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const config = auditTypeConfig(req.query.auditType);
    const rows = await getAuditStockRows(undefined);
    const allowed = new Set(allowedStoreNames(user).map(normalizeText));
    const unrestricted = canSeeAllStores(user);

    const grouped = new Map<string, AuditStockRow[]>();
    for (const row of rows) {
      if (!categoryMatchesAuditType(config.auditType, row.category)) continue;
      if (!unrestricted && !allowed.has(normalizeText(row.storeName))) continue;
      const list = grouped.get(row.storeName) || [];
      list.push(row);
      grouped.set(row.storeName, list);
    }

    const stores = [...grouped.entries()]
      .map(([name, storeRows]) => {
        const snapshot = buildExpectedSnapshot(storeRows, config.auditType);
        return {
          name,
          expected: snapshot.expected.length,
          products: new Set(snapshot.expected.map((item) => `${item.productCode}|${item.reference}|${item.description}`)).size,
          missingIdentifierUnits: snapshot.missingIdentifierUnits,
          missingIdentifierProducts: snapshot.missingIdentifierProducts,
        };
      })
      .filter((store) => store.expected > 0 || store.missingIdentifierUnits > 0)
      .sort((a, b) => Number(b.expected > 0) - Number(a.expected > 0) || a.name.localeCompare(b.name));

    return res.json({
      success: true,
      audit: config,
      stores,
    });
  } catch (error: any) {
    console.error('Erro inventory-audit/stores:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar lojas.' });
  }
});

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const store = String(req.query.store || '').trim();
    const auditType = req.query.auditType ? normalizeAuditType(req.query.auditType) : null;
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const sessions = await prisma.inventoryAuditSession.findMany({
      where: {
        ...(store ? { storeName: store } : {}),
        ...(auditType ? { auditType } : {}),
        ...(canSeeAllStores(user) ? {} : { userId: user.id }),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return res.json({ success: true, sessions });
  } catch (error: any) {
    console.error('Erro inventory-audit/sessions:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar conferências.' });
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id ?? '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'ID da conferência não informado.' });
    }

    const session = await prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return res.status(404).json({ error: 'Conferência não encontrada.' });

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) {
      return res.status(403).json({ error: 'Sem acesso a esta conferência.' });
    }

    const payload = await buildSessionPayload(session.id);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar conferência.' });
  }
});

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const config = auditTypeConfig(req.body?.auditType);
    const requestedStore = String(req.body?.store || '').trim();
    const store = await assertStoreAccess(user, requestedStore);
    if (!store) return res.status(403).json({ error: 'Loja inválida ou sem permissão para este usuário.' });

    // O Bipador atual usa uma única sessão GERAL. Sessões antigas por categoria
    // continuam no histórico, mas não podem permanecer ativas concorrendo com ela.
    if (config.auditType === 'GERAL') {
      await prisma.inventoryAuditSession.updateMany({
        where: {
          userId: user.id,
          storeName: store,
          status: 'ACTIVE',
          auditType: { not: 'GERAL' },
        },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    }

    const existing = await prisma.inventoryAuditSession.findFirst({
      where: {
        userId: user.id,
        storeName: store,
        auditType: config.auditType,
        status: 'ACTIVE',
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existing && req.body?.forceNew !== true) {
      const payload = await buildSessionPayload(existing.id);
      return res.json({ success: true, reused: true, ...payload });
    }

    if (existing) {
      await prisma.inventoryAuditSession.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    }

    const stockRows = await getAuditStockRows(store);
    const snapshot = buildExpectedSnapshot(stockRows, config.auditType);

    if (snapshot.expected.length === 0) {
      const identifierProblem = snapshot.missingIdentifierUnits > 0
        ? ` Existem ${snapshot.missingIdentifierUnits} unidade(s) sem ${config.identifierLabel.toLowerCase()} cadastrado.`
        : '';
      return res.status(400).json({
        error: `Esta loja não possui ${config.label.toLowerCase()} conferíveis na base atual.${identifierProblem}`,
      });
    }

    const latestSourceUpdate = snapshot.sourceRows.reduce<Date | null>((latest, row) => {
      const value = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
      if (Number.isNaN(value.getTime())) return latest;
      return !latest || value.getTime() > latest.getTime() ? value : latest;
    }, null);

    const session = await prisma.$transaction(async (tx: any) => {
      const created = await tx.inventoryAuditSession.create({
        data: {
          userId: user.id,
          operatorName: user.name,
          storeName: store,
          auditType: config.auditType,
          status: 'ACTIVE',
          expectedCount: snapshot.expected.length,
          sourceUpdatedAt: latestSourceUpdate || new Date(),
        },
      });

      await tx.inventoryAuditExpectedItem.createMany({
        data: snapshot.expected.map((row) => ({
          sessionId: created.id,
          stockId: row.stockId,
          imei: row.imei,
          productCode: row.productCode,
          reference: row.reference,
          description: row.description,
          category: row.category,
        })),
      });

      return created;
    });

    const payload = await buildSessionPayload(session.id);
    return res.status(201).json({
      success: true,
      reused: false,
      warning: null,
      ...payload,
    });
  } catch (error: any) {
    console.error('Erro inventory-audit/create-session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao iniciar conferência.' });
  }
});

async function scanUnified(req: Request, res: Response, session: any) {
  const rawValue = String(req.body?.rawValue ?? req.body?.imei ?? '').trim();
  const source = String(req.body?.source || 'MANUAL').toUpperCase().slice(0, 20);
  const imei = extractImei(rawValue);
  const serial = normalizeSerial(rawValue);
  const barcode = extractBarcode(rawValue);
  const lookupKey = normalizeLookupKey(rawValue);
  const confirmQuantity = req.body?.confirmQuantity === true;
  const requestedQuantityRaw = Number(req.body?.quantity ?? 1);
  const requestedQuantity = Number.isFinite(requestedQuantityRaw)
    ? Math.min(Math.max(Math.trunc(requestedQuantityRaw), 1), 9999)
    : 1;

  const keys = [...new Set([
    imei ? `I:${imei}` : '',
    serial ? `S:${serial}` : '',
  ].filter(Boolean))];

  const exactUnitItems = keys.length
    ? await prisma.inventoryAuditExpectedItem.findMany({
        where: { sessionId: session.id, imei: { in: keys } },
      })
    : [];

  const accessoryOrReferenceItems = await prisma.inventoryAuditExpectedItem.findMany({
    where: {
      sessionId: session.id,
      OR: [
        ...(barcode ? [{ imei: { startsWith: `B:${barcode}#` } }] : []),
        ...(lookupKey ? [{ imei: { startsWith: `R:${lookupKey}#` } }] : []),
        ...(lookupKey ? [{ imei: { startsWith: `P:${lookupKey}#` } }] : []),
        ...(rawValue ? [{ reference: rawValue }, { productCode: rawValue }] : []),
      ],
    },
    orderBy: { imei: 'asc' },
  });

  const match = exactUnitItems.map((item: any) => enrichExpectedItemForUnifiedSession(item, 'GERAL'));
  let accessoryItems = accessoryOrReferenceItems
    .map((item: any) => enrichExpectedItemForUnifiedSession(item, 'GERAL'))
    .filter((item: any) => item.auditType === 'ACESSORIOS');

  const nonAccessoryLookupItems = accessoryOrReferenceItems
    .map((item: any) => enrichExpectedItemForUnifiedSession(item, 'GERAL'))
    .filter((item: any) => item.auditType !== 'ACESSORIOS');

  // Se a sessão foi aberta antes de o barcode chegar ao Stock, tentamos
  // recuperar o acessório diretamente da base ATUAL da loja. Isso evita que
  // um item existente apareça como "fora da base" só porque a foto inicial
  // foi criada antes da sincronização do código de barras.
  if (accessoryItems.length === 0 && (barcode || lookupKey)) {
    const currentStockHits = await prisma.stock.findMany({
      where: {
        storeName: session.storeName,
        stockType: { equals: 'ESTOQUE' },
        quantity: { gt: 0 },
        OR: [
          ...(barcode ? [{ barcode }, { barcode: rawValue }] : []),
          ...(rawValue ? [{ reference: rawValue }, { productCode: rawValue }] : []),
        ],
      },
      select: {
        id: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        quantity: true,
        barcode: true,
      },
      take: 100,
    });

    const accessoryStockHits = currentStockHits.filter(
      (row: any) => classifyAuditCategory(row.category, row.description) === 'ACESSORIOS',
    );

    if (accessoryStockHits.length > 0) {
      const stockIds = accessoryStockHits.map((row: any) => row.id);
      let existingFromThoseStocks = await prisma.inventoryAuditExpectedItem.findMany({
        where: { sessionId: session.id, stockId: { in: stockIds } },
        orderBy: { imei: 'asc' },
      });

      // Sessões muito antigas podem nem ter criado as unidades do acessório.
      // Nesse caso, anexamos à conferência as unidades que existem AGORA no
      // estoque comercial. Sem alteração de schema e sem apagar o histórico.
      if (existingFromThoseStocks.length === 0) {
        const rowsToCreate: Array<{
          sessionId: string;
          stockId: string;
          imei: string;
          productCode: string;
          reference: string;
          description: string;
          category: string;
        }> = [];

        let index = 0;
        const effectiveCode = barcode || normalizeBarcode(accessoryStockHits[0]?.barcode) || lookupKey || 'ACESSORIO';

        for (const stockRow of accessoryStockHits) {
          const quantity = Math.max(0, Math.trunc(Number(stockRow.quantity || 0)));
          for (let unit = 0; unit < quantity; unit += 1) {
            index += 1;
            rowsToCreate.push({
              sessionId: session.id,
              stockId: stockRow.id,
              imei: `B:${effectiveCode}#${String(index).padStart(6, '0')}`,
              productCode: stockRow.productCode,
              reference: stockRow.reference,
              description: stockRow.description,
              category: stockRow.category,
            });
          }
        }

        if (rowsToCreate.length > 0) {
          await prisma.inventoryAuditExpectedItem.createMany({
            data: rowsToCreate,
          });
          existingFromThoseStocks = await prisma.inventoryAuditExpectedItem.findMany({
            where: { sessionId: session.id, stockId: { in: stockIds } },
            orderBy: { imei: 'asc' },
          });
        }
      }

      accessoryItems = existingFromThoseStocks
        .map((item: any) => enrichExpectedItemForUnifiedSession(item, 'GERAL'))
        .filter((item: any) => item.auditType === 'ACESSORIOS');
    }
  }

  // ACESSÓRIOS: código de barras/referência/código do produto identifica o
  // grupo; o usuário informa a quantidade física. Códigos repetidos são
  // válidos e somam todas as unidades daquele grupo.
  if (accessoryItems.length > 0) {
    const pendingItems = accessoryItems.filter((item: any) => item.checkedAt === null);
    const totalExpected = accessoryItems.length;
    const totalChecked = totalExpected - pendingItems.length;
    const uniqueProducts = new Set(
      accessoryItems.map((item: any) => `${item.productCode}|${item.reference}|${item.description}`),
    );
    const uniqueDescriptions = [...new Set(
      accessoryItems.map((item: any) => String(item.description || '').trim()).filter(Boolean),
    )];
    const primary = pendingItems[0] || accessoryItems[0];
    const displayDescription: string = uniqueDescriptions.length === 1
      ? String(uniqueDescriptions[0] || primary?.description || 'Acessório')
      : `${uniqueProducts.size} produtos vinculados a este identificador`;

    if (!confirmQuantity) {
      const payload = await buildSessionPayload(session.id);
      return res.json({
        success: true,
        read: {
          imei: rawValue,
          identifier: rawValue,
          rawValue,
          result: 'QUANTITY_REQUIRED',
          title: 'Acessório identificado',
          message: pendingItems.length > 0
            ? 'Informe quantas unidades físicas deste acessório você encontrou.'
            : 'Toda a quantidade esperada deste acessório já foi conferida.',
          source,
          auditType: 'ACESSORIOS',
          stockType: 'ESTOQUE',
          productCode: uniqueProducts.size === 1 ? primary?.productCode || null : null,
          reference: uniqueProducts.size === 1 ? primary?.reference || null : null,
          description: displayDescription,
          foundStore: session.storeName,
          createdAt: new Date().toISOString(),
          quantityMode: true,
          quantityExpected: totalExpected,
          quantityChecked: totalChecked,
          quantityRemaining: pendingItems.length,
          sharedProducts: uniqueProducts.size,
        },
        ...payload,
      });
    }

    const toCheck = pendingItems.slice(0, requestedQuantity);
    let updatedCount = 0;

    if (toCheck.length > 0) {
      const updated = await prisma.inventoryAuditExpectedItem.updateMany({
        where: {
          id: { in: toCheck.map((item: any) => item.id) },
          checkedAt: null,
        },
        data: { checkedAt: new Date() },
      });
      updatedCount = updated.count;
    }

    const excessCount = Math.max(0, requestedQuantity - updatedCount);
    const remainingAfter = Math.max(0, pendingItems.length - updatedCount);
    const result = excessCount > 0 ? 'EXCESS' : updatedCount > 0 ? 'FOUND' : 'EXCESS';
    const title = excessCount > 0 ? 'Quantidade acima do estoque esperado' : 'Acessório conferido';
    const message = excessCount > 0
      ? `${updatedCount} unidade(s) esperada(s) foram conferidas e ${excessCount} unidade(s) ficaram como excedente.`
      : `${updatedCount} unidade(s) conferida(s). ${remainingAfter} unidade(s) ainda pendente(s) para este acessório.`;

    const scan = await prisma.inventoryAuditScan.create({
      data: {
        sessionId: session.id,
        imei: barcode ? `B:${barcode}` : `R:${lookupKey || rawValue.toUpperCase()}`,
        rawValue,
        result,
        source,
        productCode: uniqueProducts.size === 1 ? primary?.productCode ?? null : null,
        reference: uniqueProducts.size === 1 ? primary?.reference ?? null : null,
        description: displayDescription || null,
        foundStore: session.storeName,
      },
    });

    const payload = await buildSessionPayload(session.id);
    return res.json({
      success: true,
      read: {
        id: scan.id,
        imei: rawValue,
        identifier: rawValue,
        rawValue,
        result,
        title,
        message,
        source,
        auditType: 'ACESSORIOS',
        stockType: 'ESTOQUE',
        productCode: uniqueProducts.size === 1 ? primary?.productCode || null : null,
        reference: uniqueProducts.size === 1 ? primary?.reference || null : null,
        description: displayDescription,
        foundStore: session.storeName,
        createdAt: scan.createdAt,
        quantityMode: false,
        quantityApplied: updatedCount,
        quantityRequested: requestedQuantity,
        quantityExpected: totalExpected,
        quantityChecked: totalChecked + updatedCount,
        quantityRemaining: remainingAfter,
        sharedProducts: uniqueProducts.size,
      },
      ...payload,
    });
  }

  // Caso o usuário digite a REFERÊNCIA/CÓDIGO de um wearable, tablet,
  // notebook ou aparelho, reconhecemos o produto, mas NÃO damos baixa porque
  // esses itens precisam do identificador individual da unidade.
  if (nonAccessoryLookupItems.length > 0 && match.length === 0) {
    const first = nonAccessoryLookupItems[0];
    const payload = await buildSessionPayload(session.id);
    return res.json({
      success: true,
      read: {
        imei: rawValue,
        identifier: rawValue,
        rawValue,
        result: 'INVALID',
        title: 'Produto encontrado — use o identificador da unidade',
        message: `${first.description} existe nesta conferência, mas o valor informado é referência/código do produto. Para ${first.auditType}, bipe o IMEI ou serial individual mostrado na coluna “Identificador esperado”.`,
        source,
        auditType: first.auditType,
        stockType: 'ESTOQUE',
        productCode: first.productCode || null,
        reference: first.reference || null,
        description: first.description || null,
        foundStore: session.storeName,
        createdAt: new Date().toISOString(),
      },
      ...payload,
    });
  }

  // IMEI/serial: conferência unitária normal.
  let selected: any = null;
  let result: 'FOUND' | 'UNEXPECTED' | 'DUPLICATE' | 'EXCESS' | 'INVALID' | 'AMBIGUOUS' = 'INVALID';
  let title = 'Identificador inválido';
  let message = 'Leia o IMEI ou serial individual de um produto cadastrado.';
  let foundStore: string | null = null;

  if (match.length) {
    selected = match.find((item: any) => item.checkedAt === null) || match[0];
    foundStore = session.storeName;

    if (selected.checkedAt) {
      result = 'DUPLICATE';
      title = 'Unidade já conferida';
      message = `${selected.description} já havia sido conferido nesta sessão.`;
    } else {
      const updated = await prisma.inventoryAuditExpectedItem.updateMany({
        where: { id: selected.id, checkedAt: null },
        data: { checkedAt: new Date() },
      });

      result = updated.count ? 'FOUND' : 'DUPLICATE';
      title = result === 'FOUND' ? 'Produto conferido' : 'Unidade já conferida';
      message = result === 'FOUND'
        ? `${selected.description} reconhecido automaticamente como ${selected.auditType}.`
        : `${selected.description} já havia sido conferido nesta sessão.`;
    }
  } else if (serial || barcode || imei || lookupKey) {
    result = 'UNEXPECTED';
    title = 'Identificador fora da conferência';

    const hits = await prisma.stock.findMany({
      where: {
        quantity: { gt: 0 },
        stockType: { equals: 'ESTOQUE' },
        OR: [
          ...(serial ? [{ serial }, { serial: rawValue }] : []),
          ...(imei ? [{ serial: imei }] : []),
          ...(barcode ? [{ barcode }, { barcode: rawValue }] : []),
          ...(rawValue ? [{ reference: rawValue }, { productCode: rawValue }] : []),
        ],
      },
      select: {
        storeName: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        stockType: true,
      },
      take: 100,
    });

    const sameStoreHits = hits.filter(
      (row: any) => normalizeText(row.storeName) === normalizeText(session.storeName),
    );
    const found = sameStoreHits[0] || hits[0] || null;

    if (found) {
      foundStore = found.storeName;
      selected = {
        ...found,
        auditType: classifyAuditCategory(found.category, found.description),
        stockType: 'ESTOQUE',
      };
    }

    if (found && normalizeText(found.storeName) === normalizeText(session.storeName)) {
      if (selected?.auditType === 'ACESSORIOS') {
        message = `${found.description} existe no estoque comercial da ${session.storeName}. O código de barras deste produto ainda não está vinculado à foto atual; faça uma nova sincronização do estoque e abra uma nova conferência.`;
      } else if (rawValue === found.reference || rawValue === found.productCode) {
        title = 'Produto encontrado — use o identificador da unidade';
        message = `${found.description} existe no estoque da ${session.storeName}. O valor informado é referência/código do produto; bipe o IMEI ou serial individual.`;
      } else {
        message = `${found.description} consta no estoque comercial da ${session.storeName}, mas não fazia parte da foto inicial desta conferência. Abra uma nova conferência para atualizar a base esperada.`;
      }
    } else if (found) {
      message = `${found.description} consta no estoque comercial da ${found.storeName}, não na ${session.storeName}.`;
    } else {
      message = 'Este identificador não consta no estoque comercial atual do Telefluxo.';
    }
  }

  const savedIdentifier = selected?.imei || (
    imei ? `I:${imei}` :
    serial ? `S:${serial}` :
    barcode ? `B:${barcode}` :
    rawValue.toUpperCase()
  );

  const scan = await prisma.inventoryAuditScan.create({
    data: {
      sessionId: session.id,
      imei: savedIdentifier,
      rawValue,
      result,
      source,
      productCode: selected?.productCode ?? null,
      reference: selected?.reference ?? null,
      description: selected?.description ?? null,
      foundStore,
    },
  });

  const inferredAuditType = selected?.auditType || inferScanAuditType(scan, 'GERAL');
  const payload = await buildSessionPayload(session.id);

  return res.json({
    success: true,
    read: {
      id: scan.id,
      imei: showUnifiedIdentifier(savedIdentifier),
      identifier: showUnifiedIdentifier(savedIdentifier),
      rawValue,
      result,
      title,
      message,
      source,
      auditType: inferredAuditType,
      stockType: 'ESTOQUE',
      productCode: selected?.productCode || null,
      reference: selected?.reference || null,
      description: selected?.description || null,
      foundStore,
      createdAt: scan.createdAt,
    },
    ...payload,
  });
}

router.post('/sessions/:id/scan', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id ?? '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'ID da conferência não informado.' });
    }

    const session = await prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return res.status(404).json({ error: 'Conferência não encontrada.' });
    if (session.status !== 'ACTIVE') return res.status(409).json({ error: 'Esta conferência já foi encerrada.' });

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) {
      return res.status(403).json({ error: 'Sem acesso a esta conferência.' });
    }

    const config = auditTypeConfig((session as any).auditType);

    // O scanner atual é sempre unificado. Sessões antigas por categoria podem
    // ser consultadas no histórico, mas não recebem novas leituras.
    if (config.auditType !== 'GERAL') {
      return res.status(409).json({
        error: 'Esta conferência pertence ao modelo antigo por categoria. Inicie uma nova Conferência unificada para continuar a bipagem.',
        legacySession: true,
      });
    }

    return await scanUnified(req, res, session);
  } catch (error: any) {
    console.error('Erro inventory-audit/scan:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao registrar leitura.' });
  }
});

router.post('/sessions/:id/complete', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.body?.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const sessionId = String(req.params.id ?? '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'ID da conferência não informado.' });
    }

    const session = await prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return res.status(404).json({ error: 'Conferência não encontrada.' });

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) {
      return res.status(403).json({ error: 'Sem acesso a esta conferência.' });
    }

    await prisma.inventoryAuditSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const payload = await buildSessionPayload(session.id);
    return res.json({ success: true, ...payload });
  } catch (error: any) {
    console.error('Erro inventory-audit/complete:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao encerrar conferência.' });
  }
});

function canViewAuditDashboard(user: AuditUser): boolean {
  const role = normalizeText(user.role);
  return Boolean(user.isAdmin || ['CEO', 'DIRETOR', 'ADM', 'ADMIN'].includes(role));
}

function safeDate(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });
    if (!canViewAuditDashboard(user)) {
      return res.status(403).json({ error: 'O BI de conferências é exclusivo para perfis administrativos.' });
    }

    const now = new Date();
    // O padrão agora é a sessão unificada. O parâmetro auditType permite
    // consultar auditorias antigas por categoria sem apagar o histórico.
    const dashboardAudit = auditTypeConfig(req.query.auditType || 'GERAL');
    const requestedDays = Number(req.query.days || 7);
    const days = Number.isFinite(requestedDays) ? Math.min(Math.max(Math.trunc(requestedDays), 1), 180) : 7;
    const requestedFrom = safeDate(req.query.from);
    const requestedTo = safeDate(req.query.to);
    const from = requestedFrom || new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    const to = requestedTo || now;
    if (!requestedTo) to.setHours(23, 59, 59, 999);

    if (from.getTime() > to.getTime()) {
      return res.status(400).json({ error: 'Período inválido para o BI de conferências.' });
    }

    const dashboardStockRows = await getAuditStockRows(undefined);
    const allStoreNames = Array.from(new Set(
      dashboardStockRows
        .filter((item) => categoryMatchesAuditType(dashboardAudit.auditType, item.category))
        .map((item) => String(item.storeName || '').trim())
        .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const requestedStore = String(req.query.store || '').trim();
    let targetStores = allStoreNames;

    if (requestedStore) {
      const normalizedRequested = normalizeText(requestedStore);
      const matched = allStoreNames.find((name) => normalizeText(name) === normalizedRequested);
      if (!matched) return res.status(404).json({ error: 'Loja não encontrada na base atual de estoque.' });
      targetStores = [matched];
    }

    const sessionWhere: any = {
      startedAt: { gte: from, lte: to },
      auditType: dashboardAudit.auditType,
    };
    sessionWhere.storeName = { in: targetStores };

    const sessions = await prisma.inventoryAuditSession.findMany({
      where: sessionWhere,
      orderBy: { startedAt: 'desc' },
    });

    const sessionIds = sessions.map((item: any) => item.id);
    const [expectedItems, scans] = sessionIds.length > 0
      ? await Promise.all([
          prisma.inventoryAuditExpectedItem.findMany({
            where: { sessionId: { in: sessionIds } },
            select: {
              sessionId: true,
              checkedAt: true,
              productCode: true,
              reference: true,
              description: true,
              category: true,
            },
          }),
          prisma.inventoryAuditScan.findMany({
            where: { sessionId: { in: sessionIds } },
            select: {
              sessionId: true,
              result: true,
            },
          }),
        ])
      : [[], []];

    const expectedBySession = new Map<string, any[]>();
    for (const item of expectedItems as any[]) {
      const list = expectedBySession.get(item.sessionId) || [];
      list.push(item);
      expectedBySession.set(item.sessionId, list);
    }

    const scansBySession = new Map<string, any[]>();
    for (const scan of scans as any[]) {
      const list = scansBySession.get(scan.sessionId) || [];
      list.push(scan);
      scansBySession.set(scan.sessionId, list);
    }

    const sessionMetrics = sessions.map((session: any) => {
      const expected = expectedBySession.get(session.id) || [];
      const sessionScans = scansBySession.get(session.id) || [];
      const checked = expected.filter((item) => item.checkedAt !== null).length;
      const missing = Math.max(expected.length - checked, 0);
      const unexpected = sessionScans.filter((scan) => scan.result === 'UNEXPECTED').length;
      const duplicates = sessionScans.filter((scan) => scan.result === 'DUPLICATE').length;
      const invalid = sessionScans.filter((scan) => scan.result === 'INVALID').length;
      const adherence = expected.length > 0 ? Math.round((checked / expected.length) * 1000) / 10 : 0;

      return {
        id: session.id,
        userId: session.userId,
        operatorName: session.operatorName,
        storeName: session.storeName,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        expected: expected.length,
        checked,
        missing,
        unexpected,
        duplicates,
        invalid,
        adherence,
      };
    });

    const latestByStore = new Map<string, any>();
    for (const metric of sessionMetrics) {
      const key = normalizeText(metric.storeName);
      if (!latestByStore.has(key)) latestByStore.set(key, metric);
    }

    const stores = targetStores.map((storeName) => {
      const latest = latestByStore.get(normalizeText(storeName));
      if (!latest) {
        return {
          storeName,
          sessionId: null,
          status: 'NOT_AUDITED',
          operatorName: null,
          startedAt: null,
          completedAt: null,
          expected: 0,
          checked: 0,
          missing: 0,
          unexpected: 0,
          duplicates: 0,
          invalid: 0,
          adherence: 0,
        };
      }
      return { ...latest, sessionId: latest.id };
    });

    stores.sort((a: any, b: any) => {
      if (a.status === 'NOT_AUDITED' && b.status !== 'NOT_AUDITED') return -1;
      if (b.status === 'NOT_AUDITED' && a.status !== 'NOT_AUDITED') return 1;
      if (b.missing !== a.missing) return b.missing - a.missing;
      if (b.unexpected !== a.unexpected) return b.unexpected - a.unexpected;
      return String(a.storeName).localeCompare(String(b.storeName), 'pt-BR');
    });

    const latestSessionIds = new Set(stores.map((store: any) => store.sessionId).filter(Boolean));
    const missingProductMap = new Map<string, {
      productCode: string;
      reference: string;
      description: string;
      missing: number;
      stores: Set<string>;
    }>();

    const sessionStoreById = new Map(sessionMetrics.map((item: any) => [item.id, item.storeName]));
    for (const item of expectedItems as any[]) {
      if (!latestSessionIds.has(item.sessionId) || item.checkedAt !== null) continue;
      const inferredAuditType = dashboardAudit.auditType === 'GERAL'
        ? classifyAuditCategory(item.category, item.description)
        : dashboardAudit.auditType;
      const key = `${inferredAuditType}|ESTOQUE|${item.productCode}|${item.reference}|${item.description}`;
      const current = missingProductMap.get(key) || {
        productCode: item.productCode,
        reference: item.reference,
        description: item.description,
        missing: 0,
        stores: new Set<string>(),
      };
      current.missing += 1;
      const storeName = sessionStoreById.get(item.sessionId);
      if (storeName) current.stores.add(String(storeName));
      missingProductMap.set(key, current);
    }

    const topMissingProducts = [...missingProductMap.values()]
      .map((item) => ({
        productCode: item.productCode,
        reference: item.reference,
        description: item.description,
        missing: item.missing,
        stores: [...item.stores].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      }))
      .sort((a, b) => b.missing - a.missing || a.description.localeCompare(b.description, 'pt-BR'))
      .slice(0, 12);

    const auditedStores = stores.filter((store: any) => store.sessionId !== null);
    const totalExpected = auditedStores.reduce((sum: number, store: any) => sum + store.expected, 0);
    const totalChecked = auditedStores.reduce((sum: number, store: any) => sum + store.checked, 0);
    const totalMissing = auditedStores.reduce((sum: number, store: any) => sum + store.missing, 0);
    const totalUnexpected = auditedStores.reduce((sum: number, store: any) => sum + store.unexpected, 0);
    const adherence = totalExpected > 0 ? Math.round((totalChecked / totalExpected) * 1000) / 10 : 0;

    return res.json({
      success: true,
      generatedAt: now,
      audit: dashboardAudit,
      period: { from, to, days },
      summary: {
        storesTotal: stores.length,
        storesAudited: auditedStores.length,
        storesPendingAudit: Math.max(stores.length - auditedStores.length, 0),
        sessions: sessionMetrics.length,
        completed: sessionMetrics.filter((item: any) => item.status === 'COMPLETED').length,
        active: sessionMetrics.filter((item: any) => item.status === 'ACTIVE').length,
        expected: totalExpected,
        checked: totalChecked,
        missing: totalMissing,
        unexpected: totalUnexpected,
        adherence,
      },
      stores,
      recentSessions: sessionMetrics.slice(0, 60),
      topMissingProducts,
      storeOptions: allStoreNames,
    });
  } catch (error: any) {
    console.error('Erro inventory-audit/dashboard:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao carregar BI de conferências.' });
  }
});

export default router;
