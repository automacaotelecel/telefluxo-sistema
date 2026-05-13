import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|VACUUM|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i;

function databaseDir() {
  const rootDir = process.cwd();
  return process.env.RENDER
    ? path.join(__dirname, '../../../../database')
    : path.join(rootDir, 'database');
}

function pickDatabase(args: Record<string, any>) {
  const requested = String(args.database || args.db || '').toLowerCase();
  const dir = databaseDir();

  if (requested.includes('anual') || requested.includes('annual')) {
    return path.join(dir, 'samsung_vendas_anuais.db');
  }

  return path.join(dir, 'samsung_vendas.db');
}

function cleanSql(sql: string) {
  return String(sql || '')
    .replace(/```sql/gi, '')
    .replace(/```/g, '')
    .trim()
    .replace(/;\s*$/g, '');
}

function assertSafeSelect(sql: string) {
  const normalized = cleanSql(sql);

  if (!normalized) throw new Error('SQL vazio.');
  if (!/^SELECT\b/i.test(normalized)) {
    throw new Error('A ferramenta analítica aceita apenas consultas SELECT.');
  }
  if (FORBIDDEN_SQL.test(normalized)) {
    throw new Error('SQL contém comando bloqueado. Use apenas SELECT.');
  }
  if (/;/.test(normalized)) {
    throw new Error('Envie apenas uma consulta SELECT por vez.');
  }

  return normalized;
}

function addLimit(sql: string, limit: number) {
  if (/\bLIMIT\s+\d+\b/i.test(sql)) return sql;
  return `${sql}\nLIMIT ${Math.max(1, Math.min(Number(limit) || 100, 1000))}`;
}

export async function toolExecutarSqlAnalitico(
  args: Record<string, any>,
  _ctx: ClarkToolContext
): Promise<ClarkToolResult> {
  let db: any = null;

  try {
    const dbPath = pickDatabase(args);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Banco não encontrado: ${path.basename(dbPath)}.`);
    }

    const sql = addLimit(assertSafeSelect(String(args.sql || args.query || '')), Number(args.limit || 200));
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    const rows = await db.all(sql);

    return {
      tool: 'executar_sql_analitico',
      ok: true,
      args: { ...args, sql },
      result: {
        database: path.basename(dbPath),
        sql,
        total_linhas: Array.isArray(rows) ? rows.length : 0,
        rows,
      },
    };
  } catch (error: any) {
    return {
      tool: 'executar_sql_analitico',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao executar SQL analítico.',
    };
  } finally {
    try { if (db) await db.close(); } catch {}
  }
}
