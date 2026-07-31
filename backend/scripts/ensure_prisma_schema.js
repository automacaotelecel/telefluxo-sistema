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

async function main() {
  console.log('🔎 Verificando compatibilidade do banco Prisma...');

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
