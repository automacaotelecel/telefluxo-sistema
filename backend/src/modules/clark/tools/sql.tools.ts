import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { ClarkToolResult } from '../clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';
import { getAnnualSalesDbPath, getGlobalSalesDbPath } from '../../data/databasePaths';

const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|VACUUM|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i;
const FORBIDDEN_SYSTEM_TABLES = /\b(SQLITE_MASTER|SQLITE_SCHEMA|SQLITE_TEMP_MASTER|PRISMA_MIGRATIONS)\b/i;

function pickDatabase(args: Record<string, any>) {
  const requested = String(args.database || args.db || '').toLowerCase();

  if (requested.includes('anual') || requested.includes('annual')) {
    return getAnnualSalesDbPath();
  }

  return getGlobalSalesDbPath();
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

  if (!normalized) throw new Error('SQL vazio. A consulta analítica precisa ser planejada antes da execução.');
  if (!/^SELECT\b/i.test(normalized)) {
    throw new Error('A ferramenta analítica aceita apenas consultas SELECT.');
  }
  if (FORBIDDEN_SQL.test(normalized)) {
    throw new Error('SQL contém comando bloqueado. Use apenas SELECT.');
  }
  if (FORBIDDEN_SYSTEM_TABLES.test(normalized)) {
    throw new Error('Consulta a tabelas internas do SQLite/Prisma não é permitida.');
  }
  if (/;/.test(normalized)) {
    throw new Error('Envie apenas uma consulta SELECT por vez.');
  }

  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (/^SELECT\s+1(?:\s+AS\s+[A-Z0-9_]+)?$/i.test(compact) || /CONSULTA_PRECISA_DE_PLANEJAMENTO/i.test(compact)) {
    throw new Error('Consulta placeholder bloqueada porque não responde à pergunta do usuário.');
  }

  return normalized;
}

function addLimit(sql: string, limit: number) {
  if (/\bLIMIT\s+\d+\b/i.test(sql)) return sql;
  return `${sql}\nLIMIT ${Math.max(1, Math.min(Number(limit) || 100, 1000))}`;
}

function ensureSqlScope(ctx: ClarkToolContext) {
  const scope = (ctx as any)?.scope;

  // SQL livre é difícil de reescrever com segurança para escopo por loja.
  // Usuários restritos devem usar as tools de negócio, que aplicam rowPermitidaClark.
  if (!scope?.isSuperUser) {
    throw new Error('Consulta SQL analítica livre não é permitida para usuário com escopo restrito. Use as consultas de vendas/estoque por loja autorizada.');
  }
}

/**
 * Medição de uso: este tool só é chamado quando o planner LLM antigo escolhe `executar_sql_analitico`
 * (o plano local por regex nunca o emite). Um log por chamada, para medir se SQL livre é usado de fato.
 */
function logarUsoSqlClark(params: {
  ctx: ClarkToolContext;
  args: Record<string, any>;
  resultado: 'executado' | 'erro';
  linhas?: number;
  erro?: string;
  sql?: string;
  inicio: number;
}) {
  const pergunta = String(params.args.originalQuestion || (params.ctx as any)?.pergunta || '').replace(/\s+/g, ' ').slice(0, 160);
  const sql = String(params.sql || params.args.sql || params.args.query || '').replace(/\s+/g, ' ').slice(0, 300);
  console.log(
    `[clark][sql-medicao] escolhido_pelo_planner_llm=sim resultado=${params.resultado}` +
      `${params.linhas !== undefined ? ` linhas=${params.linhas}` : ''}` +
      `${params.erro ? ` erro="${params.erro.slice(0, 120)}"` : ''}` +
      ` ms=${Date.now() - params.inicio} pergunta="${pergunta}" sql="${sql}"`,
  );
}

export async function toolExecutarSqlAnalitico(
  args: Record<string, any>,
  ctx: ClarkToolContext
): Promise<ClarkToolResult> {
  let db: any = null;
  const inicio = Date.now();

  try {
    ensureSqlScope(ctx);

    const dbPath = pickDatabase(args);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Banco não encontrado: ${path.basename(dbPath)}.`);
    }

    const sql = addLimit(assertSafeSelect(String(args.sql || args.query || '')), Number(args.limit || 200));
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    const rows = await db.all(sql);
    logarUsoSqlClark({ ctx, args, resultado: 'executado', linhas: Array.isArray(rows) ? rows.length : 0, sql, inicio });

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
    logarUsoSqlClark({ ctx, args, resultado: 'erro', erro: error?.message || 'erro', inicio });
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
