import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { PrismaClient } from '@prisma/client';

import { getDatabaseDir } from '../data/databasePaths';
import { ProductMasterResolutionStatus } from './productMaster.types';

const prisma = new PrismaClient();
const DB_PATH = path.join(getDatabaseDir(), 'product_master_audit.db');

export type ProductMasterIssueInput = {
  source?: string;
  productCode?: unknown;
  barcode?: unknown;
  sku?: unknown;
  reference?: unknown;
  description?: unknown;
  status: Extract<ProductMasterResolutionStatus, 'FALLBACK' | 'AMBIGUOUS' | 'UNMAPPED'>;
  telefluxoCode?: unknown;
  matchBy?: unknown;
  details?: unknown;
};

function clean(value: unknown): string {
  return String(value ?? '').replace(/\u00A0/g, ' ').trim();
}

function normalizedKey(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

async function getDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_master_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL UNIQUE,
      source TEXT,
      product_code TEXT,
      barcode TEXT,
      sku TEXT,
      reference TEXT,
      description TEXT,
      mapping_status TEXT NOT NULL,
      telefluxo_code TEXT,
      match_by TEXT,
      details TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_product_master_issues_status
      ON product_master_issues(mapping_status, resolved, last_seen_at);
  `);

  return db;
}

function issueKey(input: ProductMasterIssueInput): string {
  return [
    clean(input.status),
    clean(input.source || 'UNKNOWN'),
    normalizedKey(input.productCode),
    normalizedKey(input.barcode),
    normalizedKey(input.sku),
    normalizedKey(input.reference),
    normalizedKey(input.description),
  ].join('|');
}

async function notifyAdmins(input: ProductMasterIssueInput) {
  try {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true },
    });

    if (!admins.length) return;

    const identity =
      clean(input.productCode) ||
      clean(input.barcode) ||
      clean(input.sku) ||
      clean(input.reference) ||
      clean(input.description) ||
      'produto sem identificador';

    const text =
      input.status === 'UNMAPPED'
        ? `Base Mestre: produto não encontrado (${identity}). Consulte a relação de pendências.`
        : input.status === 'AMBIGUOUS'
          ? `Base Mestre: produto ambíguo (${identity}). Mais de uma chave TeleFluxo encontrada.`
          : `Base Mestre: código não encontrado, produto resolvido por fallback (${identity} → ${clean(input.telefluxoCode) || 'chave encontrada'}).`;

    await prisma.$transaction(
      admins.map((admin: { id: string }) =>
        prisma.notification.create({
          data: {
            userId: admin.id,
            text,
            read: false,
          },
        })
      )
    );
  } catch (error) {
    console.warn('⚠️ Não consegui notificar administradores sobre BASE_MESTRE:', error);
  }
}

export async function recordProductMasterIssue(input: ProductMasterIssueInput) {
  const db = await getDb();
  const now = new Date().toISOString();
  const key = issueKey(input);

  try {
    const existing = await db.get(
      `SELECT id, resolved FROM product_master_issues WHERE issue_key = ?`,
      key
    );

    if (existing?.id) {
      await db.run(
        `UPDATE product_master_issues
           SET source = ?,
               product_code = ?,
               barcode = ?,
               sku = ?,
               reference = ?,
               description = ?,
               mapping_status = ?,
               telefluxo_code = ?,
               match_by = ?,
               details = ?,
               occurrences = occurrences + 1,
               last_seen_at = ?,
               resolved = 0,
               resolved_at = NULL
         WHERE issue_key = ?`,
        clean(input.source),
        clean(input.productCode),
        clean(input.barcode),
        clean(input.sku),
        clean(input.reference),
        clean(input.description),
        input.status,
        clean(input.telefluxoCode),
        clean(input.matchBy),
        clean(input.details),
        now,
        key
      );

      return { created: false, id: existing.id };
    }

    const result = await db.run(
      `INSERT INTO product_master_issues (
         issue_key, source, product_code, barcode, sku, reference, description,
         mapping_status, telefluxo_code, match_by, details,
         occurrences, first_seen_at, last_seen_at, resolved
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
      key,
      clean(input.source),
      clean(input.productCode),
      clean(input.barcode),
      clean(input.sku),
      clean(input.reference),
      clean(input.description),
      input.status,
      clean(input.telefluxoCode),
      clean(input.matchBy),
      clean(input.details),
      now,
      now
    );

    await notifyAdmins(input);
    return { created: true, id: result.lastID };
  } finally {
    await db.close().catch(() => undefined);
  }
}

export async function listProductMasterIssues(params?: {
  includeResolved?: boolean;
  limit?: number;
}) {
  const db = await getDb();
  try {
    const limit = Math.min(Math.max(Number(params?.limit || 200), 1), 1000);
    const where = params?.includeResolved ? '' : 'WHERE resolved = 0';

    return await db.all(`
      SELECT
        id,
        source,
        product_code AS productCode,
        barcode,
        sku,
        reference,
        description,
        mapping_status AS mappingStatus,
        telefluxo_code AS telefluxoCode,
        match_by AS matchBy,
        details,
        occurrences,
        first_seen_at AS firstSeenAt,
        last_seen_at AS lastSeenAt,
        resolved,
        resolved_at AS resolvedAt
      FROM product_master_issues
      ${where}
      ORDER BY resolved ASC, last_seen_at DESC
      LIMIT ${limit}
    `);
  } finally {
    await db.close().catch(() => undefined);
  }
}

export async function resolveProductMasterIssue(id: number) {
  const db = await getDb();
  try {
    const now = new Date().toISOString();
    await db.run(
      `UPDATE product_master_issues
       SET resolved = 1, resolved_at = ?
       WHERE id = ?`,
      now,
      id
    );
    return true;
  } finally {
    await db.close().catch(() => undefined);
  }
}
