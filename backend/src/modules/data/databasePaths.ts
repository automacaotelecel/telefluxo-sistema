import fs from 'fs';
import path from 'path';

/**
 * Caminhos oficiais dos bancos operacionais do TeleFluxo.
 *
 * No Render os SQLite persistentes ficam no disco montado em /var/data.
 * Em desenvolvimento local o backend trabalha com <cwd>/database.
 *
 * Toda a Clark deve importar estes helpers em vez de montar caminhos próprios.
 */
export function getDatabaseDir(): string {
  return process.env.RENDER
    ? '/var/data'
    : path.join(process.cwd(), 'database');
}


export function getGlobalSalesDbPath(): string {
  return path.join(getDatabaseDir(), 'samsung_vendas.db');
}

export function getAnnualSalesDbPath(): string {
  return path.join(getDatabaseDir(), 'samsung_vendas_anuais.db');
}

export function getSalesDatabaseDiagnostics() {
  const databaseDir = getDatabaseDir();
  const globalDbPath = getGlobalSalesDbPath();
  const annualDbPath = getAnnualSalesDbPath();

  return {
    environment: process.env.RENDER ? 'render' : 'local',
    databaseDir,
    globalDbPath,
    annualDbPath,
    globalDbExists: fs.existsSync(globalDbPath),
    annualDbExists: fs.existsSync(annualDbPath),
  };
}
