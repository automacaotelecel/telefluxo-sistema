const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const REQUIRED_COLUMNS = {
  Stock: [
    ['acquisitionCost', 'REAL'],
    ['stockType', "TEXT NOT NULL DEFAULT 'ESTOQUE'"],
    ['barcode', 'TEXT'],
  ],
  InventoryAuditSession: [
    ['auditType', "TEXT NOT NULL DEFAULT 'APARELHOS'"],
  ],
  ImeiHistory: [
    ['acquisitionCost', 'REAL'],
    ['acquisitionDate', 'DATETIME'],
    ['acquisitionCnpj', 'TEXT'],
    ['sourceTransaction', 'TEXT'],
    ['sourceIdentifier', 'TEXT'],
    ['sourceDocument', 'TEXT'],
    ['costSource', 'TEXT'],
    ['costResolvedAt', 'DATETIME'],
  ],
};

async function getColumnNames(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `PRAGMA table_info("${tableName}")`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `A tabela ${tableName} não existe no banco configurado em DATABASE_URL.`
    );
  }

  return new Set(rows.map((row) => String(row.name)));
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await getColumnNames(tableName);

  if (columns.has(columnName)) {
    return false;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`
  );

  console.log(`✅ Coluna criada: ${tableName}.${columnName}`);
  return true;
}


async function ensureInventoryAuditTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "InventoryAuditSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "operatorName" TEXT NOT NULL,
      "storeName" TEXT NOT NULL,
      "auditType" TEXT NOT NULL DEFAULT 'APARELHOS',
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "expectedCount" INTEGER NOT NULL DEFAULT 0,
      "sourceUpdatedAt" DATETIME,
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "InventoryAuditExpectedItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "stockId" TEXT,
      "imei" TEXT NOT NULL,
      "productCode" TEXT NOT NULL,
      "reference" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "checkedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "InventoryAuditExpectedItem_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "InventoryAuditSession" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "InventoryAuditScan" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "imei" TEXT NOT NULL,
      "rawValue" TEXT NOT NULL,
      "result" TEXT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'MANUAL',
      "productCode" TEXT,
      "reference" TEXT,
      "description" TEXT,
      "foundStore" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "InventoryAuditScan_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "InventoryAuditSession" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  const statements = [
    'CREATE INDEX IF NOT EXISTS "InventoryAuditSession_userId_storeName_status_idx" ON "InventoryAuditSession"("userId", "storeName", "status")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditSession_userId_storeName_auditType_status_idx" ON "InventoryAuditSession"("userId", "storeName", "auditType", "status")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditSession_storeName_startedAt_idx" ON "InventoryAuditSession"("storeName", "startedAt")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "InventoryAuditExpectedItem_sessionId_imei_key" ON "InventoryAuditExpectedItem"("sessionId", "imei")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditExpectedItem_sessionId_checkedAt_idx" ON "InventoryAuditExpectedItem"("sessionId", "checkedAt")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditExpectedItem_imei_idx" ON "InventoryAuditExpectedItem"("imei")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditScan_sessionId_createdAt_idx" ON "InventoryAuditScan"("sessionId", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditScan_sessionId_result_idx" ON "InventoryAuditScan"("sessionId", "result")',
    'CREATE INDEX IF NOT EXISTS "InventoryAuditScan_imei_idx" ON "InventoryAuditScan"("imei")',
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function ensureSampleConferenceTables() {
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
}

async function main() {
  console.log('🔎 Verificando compatibilidade do banco Prisma...');

  // 1) Garante primeiro que as tabelas existam.
  await ensureInventoryAuditTables();
  await ensureSampleConferenceTables();

  // 2) Em bancos antigos, as colunas precisam existir ANTES dos índices
  // que dependem delas e antes da verificação final de integridade.
  let createdColumns = 0;

  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const [columnName, definition] of columns) {
      if (await ensureColumn(tableName, columnName, definition)) {
        createdColumns += 1;
      }
    }
  }

  // 3) Recria os índices alterados por esta atualização.
  // DROP/CREATE de índice não apaga dados da tabela.
  // Isso também corrige índices SQLite inconsistentes de execuções anteriores.

  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "InventoryAuditSession_userId_storeName_status_idx"'
  );

  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "InventoryAuditSession_userId_storeName_auditType_status_idx"'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX "InventoryAuditSession_userId_storeName_auditType_status_idx" ON "InventoryAuditSession"("userId", "storeName", "auditType", "status")'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "InventoryAuditSession_storeName_startedAt_idx" ON "InventoryAuditSession"("storeName", "startedAt")'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Stock_serial_idx" ON "Stock"("serial")'
  );

  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "Stock_barcode_idx"'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX "Stock_barcode_idx" ON "Stock"("barcode")'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Stock_storeName_productCode_stockType_idx" ON "Stock"("storeName", "productCode", "stockType")'
  );

  // 4) Valida se todas as colunas esperadas realmente existem.
  const stockColumns = await getColumnNames('Stock');
  const auditSessionColumns = await getColumnNames('InventoryAuditSession');
  const historyColumns = await getColumnNames('ImeiHistory');

  for (const [columnName] of REQUIRED_COLUMNS.Stock) {
    if (!stockColumns.has(columnName)) {
      throw new Error(`Falha ao validar Stock.${columnName}.`);
    }
  }

  for (const [columnName] of REQUIRED_COLUMNS.InventoryAuditSession) {
    if (!auditSessionColumns.has(columnName)) {
      throw new Error(
        `Falha ao validar InventoryAuditSession.${columnName}.`
      );
    }
  }

  for (const [columnName] of REQUIRED_COLUMNS.ImeiHistory) {
    if (!historyColumns.has(columnName)) {
      throw new Error(`Falha ao validar ImeiHistory.${columnName}.`);
    }
  }

  // 5) Somente depois de recriar os índices fazemos o integrity_check.
  const integrityRows =
    await prisma.$queryRawUnsafe('PRAGMA integrity_check');

  const integrityMessages = Array.isArray(integrityRows)
    ? integrityRows
        .map((row) => String(row?.integrity_check || ''))
        .filter(Boolean)
    : [];

  const integrityOk =
    integrityMessages.length === 1 &&
    integrityMessages[0].toLowerCase() === 'ok';

  if (!integrityOk) {
    throw new Error(
      `O SQLite não passou na verificação de integridade: ${
        integrityMessages.join(' | ') || 'resultado desconhecido'
      }`
    );
  }

  console.log(
    createdColumns > 0
      ? `✅ Banco atualizado com segurança: ${createdColumns} coluna(s) adicionada(s) e índices validados.`
      : '✅ Banco já estava compatível. Índices validados com sucesso.'
  );
}

main()
  .catch((error) => {
    console.error(
      '❌ Não foi possível preparar o banco Prisma:',
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
