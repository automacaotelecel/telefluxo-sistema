import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const SUPER_ROLES = new Set(['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'SOCIO', 'MASTER']);
const APPLIANCE_CATEGORY = 'SMARTPHONE';

type AuditUser = {
  id: string;
  name: string;
  role: string;
  isAdmin: boolean;
  allowedStores: string | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
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

async function assertStoreAccess(user: AuditUser, requestedStore: string): Promise<string | null> {
  const target = normalizeText(requestedStore);
  if (!target) return null;

  const stores = await prisma.stock.findMany({
    where: {
      category: { equals: 'Smartphone' },
      serial: { not: '' },
    },
    distinct: ['storeName'],
    select: { storeName: true },
  });

  const matchedStore = stores.find((row: any) => normalizeText(row.storeName) === target)?.storeName || null;
  if (!matchedStore) return null;

  if (canSeeAllStores(user)) return matchedStore;

  const allowed = new Set(allowedStoreNames(user).map(normalizeText));
  return allowed.has(target) ? matchedStore : null;
}

function isSmartphoneStock(row: { category: string; serial: string | null }): boolean {
  return normalizeText(row.category) === APPLIANCE_CATEGORY && isValidImei(String(row.serial || ''));
}

async function buildSessionPayload(sessionId: string) {
  const session = await prisma.inventoryAuditSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  const [expectedItems, scans] = await Promise.all([
    prisma.inventoryAuditExpectedItem.findMany({
      where: { sessionId },
      orderBy: [{ description: 'asc' }, { imei: 'asc' }],
    }),
    prisma.inventoryAuditScan.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const checkedItems = expectedItems.filter((item: any) => item.checkedAt !== null);
  const missingItems = expectedItems.filter((item: any) => item.checkedAt === null);
  const unexpectedScans = scans.filter((scan: any) => scan.result === 'UNEXPECTED');
  const duplicateScans = scans.filter((scan: any) => scan.result === 'DUPLICATE');
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
  const pending = missingItems.length;

  return {
    session,
    stats: {
      expected,
      checked,
      pending,
      unexpected: unexpectedScans.length,
      duplicates: duplicateScans.length,
      invalid: invalidScans.length,
      progress: expected > 0 ? Math.round((checked / expected) * 1000) / 10 : 0,
    },
    productSummary,
    missingItems,
    unexpectedScans,
    recentScans: scans.slice(0, 30),
  };
}

router.get('/stores', async (req: Request, res: Response) => {
  try {
    const user = await resolveUser(req.query.userId);
    if (!user) return res.status(401).json({ error: 'Usuário não identificado.' });

    const rows = await prisma.stock.findMany({
      where: {
        category: { equals: 'Smartphone' },
        serial: { not: '' },
      },
      select: {
        storeName: true,
        serial: true,
        description: true,
      },
    });

    const allowed = new Set(allowedStoreNames(user).map(normalizeText));
    const unrestricted = canSeeAllStores(user);
    const stores = new Map<string, { name: string; expected: number; products: Set<string> }>();

    for (const row of rows) {
      if (!isSmartphoneStock({ category: 'Smartphone', serial: row.serial })) continue;
      if (!unrestricted && !allowed.has(normalizeText(row.storeName))) continue;

      const current = stores.get(row.storeName) || { name: row.storeName, expected: 0, products: new Set<string>() };
      current.expected += 1;
      current.products.add(row.description);
      stores.set(row.storeName, current);
    }

    const result = [...stores.values()]
      .map((store) => ({ name: store.name, expected: store.expected, products: store.products.size }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ success: true, stores: result });
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
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const sessions = await prisma.inventoryAuditSession.findMany({
      where: {
        ...(store ? { storeName: store } : {}),
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

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) return res.status(403).json({ error: 'Sem acesso a esta conferência.' });

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

    const requestedStore = String(req.body?.store || '').trim();
    const store = await assertStoreAccess(user, requestedStore);
    if (!store) return res.status(403).json({ error: 'Loja inválida ou sem permissão para este usuário.' });

    const existing = await prisma.inventoryAuditSession.findFirst({
      where: {
        userId: user.id,
        storeName: store,
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

    const stockRows = await prisma.stock.findMany({
      where: {
        storeName: store,
        category: { equals: 'Smartphone' },
        serial: { not: '' },
      },
      select: {
        id: true,
        serial: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
      },
      orderBy: [{ description: 'asc' }, { serial: 'asc' }],
    });

    const validRows = stockRows.filter((row: any) => isSmartphoneStock(row));
    if (validRows.length === 0) {
      return res.status(400).json({ error: 'Esta loja não possui aparelhos com IMEI válido na base atual.' });
    }

    const session = await prisma.$transaction(async (tx: any) => {
      const created = await tx.inventoryAuditSession.create({
        data: {
          userId: user.id,
          operatorName: user.name,
          storeName: store,
          status: 'ACTIVE',
          expectedCount: validRows.length,
          sourceUpdatedAt: new Date(),
        },
      });

      await tx.inventoryAuditExpectedItem.createMany({
        data: validRows.map((row: any) => ({
          sessionId: created.id,
          stockId: row.id,
          imei: String(row.serial),
          productCode: row.productCode,
          reference: row.reference,
          description: row.description,
          category: row.category,
        })),
      });

      return created;
    });

    const payload = await buildSessionPayload(session.id);
    return res.status(201).json({ success: true, reused: false, ...payload });
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

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) return res.status(403).json({ error: 'Sem acesso a esta conferência.' });

    const rawValue = String(req.body?.rawValue ?? req.body?.imei ?? '').trim();
    const source = String(req.body?.source || 'MANUAL').toUpperCase().slice(0, 20);
    const imei = extractImei(rawValue);

    let result = 'INVALID';
    let title = 'Código inválido';
    let message = 'Não foi possível identificar um IMEI válido de 15 dígitos.';
    let productCode: string | null = null;
    let reference: string | null = null;
    let description: string | null = null;
    let foundStore: string | null = null;

    if (imei) {
      const expected = await prisma.inventoryAuditExpectedItem.findUnique({
        where: { sessionId_imei: { sessionId: session.id, imei } },
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
          where: { serial: imei },
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
          : 'IMEI válido, mas ele não consta no estoque atual do Telefluxo.';
      }
    }

    const scan = await prisma.inventoryAuditScan.create({
      data: {
        sessionId: session.id,
        imei,
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
        imei,
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

    if (!canAccessStore(user, session.storeName) && session.userId !== user.id) return res.status(403).json({ error: 'Sem acesso a esta conferência.' });

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

    const stockStores = await prisma.stock.findMany({
      where: {
        category: { equals: 'Smartphone' },
        serial: { not: '' },
      },
      distinct: ['storeName'],
      select: { storeName: true },
      orderBy: { storeName: 'asc' },
    });

    const allStoreNames = stockStores
      .map((item: any) => String(item.storeName || '').trim())
      .filter(Boolean);

    const requestedStore = String(req.query.store || '').trim();
    let targetStores = allStoreNames;

    if (requestedStore) {
      const normalizedRequested = normalizeText(requestedStore);
      const matched = allStoreNames.find((name) => normalizeText(name) === normalizedRequested);
      if (!matched) return res.status(404).json({ error: 'Loja não encontrada na base atual de aparelhos.' });
      targetStores = [matched];
    }

    const sessionWhere: any = {
      startedAt: { gte: from, lte: to },
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
