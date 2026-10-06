import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const SUPER_ROLES = new Set(['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'SOCIO', 'MASTER']);
const AUDIT_TYPES = {
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
    identifierMode: 'BARCODE',
    identifierLabel: 'Código de barras',
  },
  TABLETS: {
    label: 'Tablets',
    identifierMode: 'BARCODE',
    identifierLabel: 'Código de barras',
  },
  NOTEBOOKS: {
    label: 'Notebooks',
    identifierMode: 'BARCODE',
    identifierLabel: 'Código de barras',
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
  const value = normalizeText(category);
  if (!value) return false;

  if (auditType === 'APARELHOS') {
    return value.includes('SMARTPHONE') || value.includes('SMART PHONE') || value.includes('APARELHO') || value === 'CELULAR' || value.includes('TELEFONE');
  }
  if (auditType === 'ACESSORIOS') {
    return [
      'ACESSORIO', 'ACCESSOR', 'PELICULA', 'FONE', 'HEADPHONE', 'CARREGADOR',
      'CABO', 'CAPA', 'CASE', 'MOUSE', 'TECLADO', 'POWERBANK', 'POWER BANK',
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
  if (digits.length >= 8 && digits.length <= 18) return digits;

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
  return prisma.stock.findMany({
    where: {
      ...(storeName ? { storeName } : {}),
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
  }) as Promise<AuditStockRow[]>;
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

function buildExpectedSnapshot(stockRows: AuditStockRow[], auditType: AuditType) {
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

  const expectedItems = expectedItemsRaw.map((item: any) => ({
    ...item,
    identifier: baseExpectedIdentifier(item.imei, config.auditType),
    imei: baseExpectedIdentifier(item.imei, config.auditType),
  }));

  const checkedItems = expectedItems.filter((item: any) => item.checkedAt !== null);
  const missingUnitItems = expectedItems.filter((item: any) => item.checkedAt === null);
  const unexpectedOnlyScans = scans.filter((scan: any) => scan.result === 'UNEXPECTED');
  const duplicateScans = scans.filter((scan: any) => scan.result === 'DUPLICATE');
  const excessScans = scans.filter((scan: any) => scan.result === 'EXCESS');
  const divergenceScans = scans.filter((scan: any) => scan.result === 'UNEXPECTED' || scan.result === 'EXCESS');
  const invalidScans = scans.filter((scan: any) => scan.result === 'INVALID');

  const products = new Map<string, {
    productCode: string;
    reference: string;
    description: string;
    expected: number;
    checked: number;
    missing: number;
  }>();

  for (const item of expectedItems) {
    const key = `${item.productCode}|${item.reference}|${item.description}`;
    const current = products.get(key) || {
      productCode: item.productCode,
      reference: item.reference,
      description: item.description,
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

  const missingItems = config.identifierMode === 'BARCODE'
    ? Array.from(
        missingUnitItems.reduce((map: Map<string, any>, item: any) => {
          const key = `${item.identifier}|${item.productCode}|${item.reference}|${item.description}`;
          const current = map.get(key);
          if (current) {
            current.quantity += 1;
          } else {
            map.set(key, { ...item, quantity: 1 });
          }
          return map;
        }, new Map<string, any>()).values(),
      )
    : missingUnitItems.map((item: any) => ({ ...item, quantity: 1 }));

  return {
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
    recentScans: scans.slice(0, 30).map((scan: any) => ({
      ...scan,
      identifier: scan.imei,
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
    const rows = await getAuditStockRows();
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
      warning: snapshot.missingIdentifierUnits > 0
        ? `${snapshot.missingIdentifierUnits} unidade(s) de ${snapshot.missingIdentifierProducts} produto(s) ficaram fora da foto por não possuírem ${config.identifierLabel.toLowerCase()} cadastrado.`
        : null,
      ...payload,
    });
  } catch (error: any) {
    console.error('Erro inventory-audit/create-session:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao iniciar conferência.' });
  }
});

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
    const rawValue = String(req.body?.rawValue ?? req.body?.imei ?? '').trim();
    const source = String(req.body?.source || 'MANUAL').toUpperCase().slice(0, 20);
    const identifier = config.identifierMode === 'IMEI'
      ? extractImei(rawValue)
      : extractBarcode(rawValue);

    let result: 'FOUND' | 'UNEXPECTED' | 'DUPLICATE' | 'EXCESS' | 'INVALID' = 'INVALID';
    let title = 'Código inválido';
    let message = config.identifierMode === 'IMEI'
      ? 'Não foi possível identificar um IMEI válido de 15 dígitos.'
      : 'Não foi possível identificar um código de barras válido.';
    let productCode: string | null = null;
    let reference: string | null = null;
    let description: string | null = null;
    let foundStore: string | null = null;

    if (identifier) {
      if (config.identifierMode === 'IMEI') {
        const expected = await prisma.inventoryAuditExpectedItem.findUnique({
          where: { sessionId_imei: { sessionId: session.id, imei: identifier } },
        });

        if (expected) {
          productCode = expected.productCode;
          reference = expected.reference;
          description = expected.description;
          foundStore = session.storeName;

          if (expected.checkedAt) {
            result = 'DUPLICATE';
            title = 'Aparelho já bipado';
            message = `${expected.description} já havia sido conferido nesta sessão.`;
          } else {
            result = 'FOUND';
            title = 'Aparelho conferido';
            message = `${expected.description} localizado corretamente na base da ${session.storeName}.`;
            await prisma.inventoryAuditExpectedItem.update({
              where: { id: expected.id },
              data: { checkedAt: new Date() },
            });
          }
        } else {
          result = 'UNEXPECTED';
          title = 'Aparelho fora da base da loja';

          const stockHit = await prisma.stock.findFirst({
            where: {
              serial: identifier,
              stockType: { equals: 'ESTOQUE' },
            },
            select: {
              storeName: true,
              productCode: true,
              reference: true,
              description: true,
            },
          });

          productCode = stockHit?.productCode || null;
          reference = stockHit?.reference || null;
          description = stockHit?.description || null;
          foundStore = stockHit?.storeName || null;
          message = stockHit
            ? `${stockHit.description} está cadastrado em ${stockHit.storeName}, não em ${session.storeName}.`
            : 'IMEI válido, mas ele não consta no estoque comercial atual do Telefluxo.';
        }
      } else {
        const prefix = `${identifier}#`;
        const expected = await prisma.inventoryAuditExpectedItem.findFirst({
          where: {
            sessionId: session.id,
            imei: { startsWith: prefix },
            checkedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });

        if (expected) {
          result = 'FOUND';
          title = 'Produto conferido';
          message = `${expected.description} conferido na ${session.storeName}.`;
          productCode = expected.productCode;
          reference = expected.reference;
          description = expected.description;
          foundStore = session.storeName;

          await prisma.inventoryAuditExpectedItem.update({
            where: { id: expected.id },
            data: { checkedAt: new Date() },
          });
        } else {
          const alreadyExpected = await prisma.inventoryAuditExpectedItem.findFirst({
            where: {
              sessionId: session.id,
              imei: { startsWith: prefix },
            },
          });

          if (alreadyExpected) {
            result = 'EXCESS';
            title = 'Quantidade excedente';
            message = `${alreadyExpected.description} já atingiu a quantidade esperada nesta conferência.`;
            productCode = alreadyExpected.productCode;
            reference = alreadyExpected.reference;
            description = alreadyExpected.description;
            foundStore = session.storeName;
          } else {
            result = 'UNEXPECTED';
            title = 'Produto fora da base da loja';

            const hits = await prisma.stock.findMany({
              where: {
                barcode: identifier,
                stockType: { equals: 'ESTOQUE' },
                quantity: { gt: 0 },
              },
              select: {
                storeName: true,
                productCode: true,
                reference: true,
                description: true,
                category: true,
              },
              take: 50,
            });
            const stockHit = hits.find((row: any) => categoryMatchesAuditType(config.auditType, row.category)) || null;

            productCode = stockHit?.productCode || null;
            reference = stockHit?.reference || null;
            description = stockHit?.description || null;
            foundStore = stockHit?.storeName || null;
            message = stockHit
              ? `${stockHit.description} está cadastrado em ${stockHit.storeName}, não na foto atual da ${session.storeName}.`
              : `${config.identifierLabel} não consta no estoque comercial atual desta categoria.`;
          }
        }
      }
    }

    const scan = await prisma.inventoryAuditScan.create({
      data: {
        sessionId: session.id,
        imei: identifier,
        rawValue,
        result,
        source,
        productCode,
        reference,
        description,
        foundStore,
      },
    });

    const payload = await buildSessionPayload(session.id);
    return res.json({
      success: true,
      read: {
        id: scan.id,
        imei: identifier,
        identifier,
        result,
        title,
        message,
        productCode,
        reference,
        description,
        foundStore,
        createdAt: scan.createdAt,
      },
      ...payload,
    });
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
    // Mantém o BI atual isolado por tipo de conferência. Sem filtro explícito,
    // preserva o comportamento histórico de APARELHOS.
    const dashboardAudit = auditTypeConfig(req.query.auditType || 'APARELHOS');
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

    const dashboardStockRows = await getAuditStockRows();
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
      const key = `${item.productCode}|${item.reference}|${item.description}`;
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
