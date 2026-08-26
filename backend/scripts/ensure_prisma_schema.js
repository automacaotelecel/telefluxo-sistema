const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const REQUIRED_COLUMNS = {
  Stock: [
    ['acquisitionCost', 'REAL'],
    ['stockType', "TEXT NOT NULL DEFAULT 'ESTOQUE'"],
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

async function main() {
  console.log('🔎 Verificando compatibilidade do banco Prisma...');
  await ensureInventoryAuditTables();

  const integrity = await prisma.$queryRawUnsafe('PRAGMA integrity_check');
  const integrityResult = String(integrity?.[0]?.integrity_check || '');

  if (integrityResult.toLowerCase() !== 'ok') {
    throw new Error(
      `O SQLite não passou na verificação de integridade: ${integrityResult || 'resultado desconhecido'}`
    );
  }

  let createdColumns = 0;

  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const [columnName, definition] of columns) {
      if (await ensureColumn(tableName, columnName, definition)) {
        createdColumns += 1;
      }
    }
  }

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Stock_serial_idx" ON "Stock"("serial")'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Stock_storeName_productCode_stockType_idx" ON "Stock"("storeName", "productCode", "stockType")'
  );

  const stockColumns = await getColumnNames('Stock');
  const historyColumns = await getColumnNames('ImeiHistory');

  for (const [columnName] of REQUIRED_COLUMNS.Stock) {
    if (!stockColumns.has(columnName)) {
      throw new Error(`Falha ao validar Stock.${columnName}.`);
    }
  }

  for (const [columnName] of REQUIRED_COLUMNS.ImeiHistory) {
    if (!historyColumns.has(columnName)) {
      throw new Error(`Falha ao validar ImeiHistory.${columnName}.`);
    }
  }

  console.log(
    createdColumns > 0
      ? `✅ Banco atualizado com segurança: ${createdColumns} coluna(s) adicionada(s).`
      : '✅ Banco já estava compatível. Nenhuma alteração necessária.'
  );
}

main()
  .catch((error) => {
    console.error('❌ Não foi possível preparar o banco Prisma:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
