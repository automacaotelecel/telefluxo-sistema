import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ClarkHistoricoMensagem, ClarkResposta } from '../clark.types';
import { perguntaPareceFollowUpClark } from './clarkMemory.service';

type SqliteDb = Awaited<ReturnType<typeof open>>;

export type ClarkExecutiveMemory = {
  userId: string;
  lastProduct: string | null;
  lastProducts: string[];
  lastStore: string | null;
  lastPeriodStart: string | null;
  lastPeriodEnd: string | null;
  lastPeriodLabel: string | null;
  lastIntent: string | null;
  lastTool: string | null;
  lastQuestion: string | null;
  lastAnswerSummary: string | null;
  interactionCount: number;
  updatedAt: string | null;
};

const ROOT_DIR = process.cwd();
const MEMORY_TABLE = 'clark_memory_state';

function mainDbPath() {
  const envUrl = String(process.env.DATABASE_URL || '').trim();

  if (envUrl.startsWith('file:')) {
    const raw = envUrl.replace(/^file:/, '').trim();

    if (path.isAbsolute(raw)) {
      return raw;
    }

    const fromRoot = path.resolve(ROOT_DIR, raw);
    const fromPrisma = path.resolve(ROOT_DIR, 'prisma', raw.replace(/^\.\//, ''));

    if (fs.existsSync(fromRoot)) return fromRoot;
    if (fs.existsSync(fromPrisma)) return fromPrisma;
  }

  return path.join(ROOT_DIR, 'prisma', 'dev.db');
}

async function openMemoryDb(): Promise<SqliteDb> {
  const filename = mainDbPath();

  await fs.promises.mkdir(path.dirname(filename), { recursive: true });

  const db = await open({
    filename,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${MEMORY_TABLE} (
      userId TEXT PRIMARY KEY,
      lastProduct TEXT,
      lastProducts TEXT,
      lastStore TEXT,
      lastPeriodStart TEXT,
      lastPeriodEnd TEXT,
      lastPeriodLabel TEXT,
      lastIntent TEXT,
      lastTool TEXT,
      lastQuestion TEXT,
      lastAnswerSummary TEXT,
      interactionCount INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL
    )
  `);

  // Migração leve para instalações que já possuíam a tabela antes do suporte
  // a múltiplos produtos no contexto.
  const columns = await db.all(`PRAGMA table_info(${MEMORY_TABLE})`);
  if (!columns.some((col: any) => String(col?.name) === 'lastProducts')) {
    await db.exec(`ALTER TABLE ${MEMORY_TABLE} ADD COLUMN lastProducts TEXT`);
  }

  return db;
}

function cleanText(value: any, max = 500): string | null {
  const text = String(value ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text === '{}' || text === '[]' || text.toLowerCase() === 'null') {
    return null;
  }

  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function pickFirstString(...values: any[]): string | null {
  for (const value of values) {
    const clean = cleanText(value, 160);
    if (clean) return clean;
  }

  return null;
}

function normalizarMemoria(row: any): ClarkExecutiveMemory | null {
  if (!row?.userId) return null;

  return {
    userId: String(row.userId),
    lastProduct: row.lastProduct || null,
    lastProducts: (() => { try { const parsed = JSON.parse(String(row.lastProducts || '[]')); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 20) : []; } catch { return []; } })(),
    lastStore: row.lastStore || null,
    lastPeriodStart: row.lastPeriodStart || null,
    lastPeriodEnd: row.lastPeriodEnd || null,
    lastPeriodLabel: row.lastPeriodLabel || null,
    lastIntent: row.lastIntent || null,
    lastTool: row.lastTool || null,
    lastQuestion: row.lastQuestion || null,
    lastAnswerSummary: row.lastAnswerSummary || null,
    interactionCount: Number(row.interactionCount || 0),
    updatedAt: row.updatedAt || null,
  };
}

export async function obterMemoriaExecutivaClark(
  userId: string,
): Promise<ClarkExecutiveMemory | null> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return null;

  let db: SqliteDb | null = null;

  try {
    db = await openMemoryDb();

    const row = await db.get(
      `SELECT * FROM ${MEMORY_TABLE} WHERE userId = ?`,
      [safeUserId],
    );

    return normalizarMemoria(row);
  } catch (error) {
    console.warn('⚠️ Não foi possível ler memória da Clark:', error);
    return null;
  } finally {
    if (db) await db.close().catch(() => undefined);
  }
}

export async function limparMemoriaExecutivaClark(userId: string): Promise<void> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return;

  let db: SqliteDb | null = null;

  try {
    db = await openMemoryDb();

    await db.run(
      `DELETE FROM ${MEMORY_TABLE} WHERE userId = ?`,
      [safeUserId],
    );
  } finally {
    if (db) await db.close().catch(() => undefined);
  }
}

function extrairProdutoDaResposta(resposta: ClarkResposta): string | null {
  const dados: any = resposta?.dados || {};
  const plan: any = dados?.plan || {};
  const toolResults: any[] = Array.isArray(dados?.toolResults) ? dados.toolResults : [];

  const fromPlan = pickFirstString(
    plan?.entities?.product?.raw,
    [
      plan?.entities?.product?.family,
      plan?.entities?.product?.storage,
      plan?.entities?.product?.color,
    ].filter(Boolean).join(' '),
  );

  if (fromPlan) return fromPlan;

  for (const item of toolResults) {
    const result = item?.result || {};
    const produtoPlanejado = result?.produto_planejado || result?.produto_resolvido?.request || {};

    const candidate = pickFirstString(
      produtoPlanejado.raw,
      [
        produtoPlanejado.family,
        produtoPlanejado.storage,
        produtoPlanejado.color,
      ].filter(Boolean).join(' '),
      result?.termo_pesquisado,
      result?.produto,
      result?.descricao,
      Array.isArray(result?.produtos) ? result.produtos?.[0]?.descricao : null,
      Array.isArray(result?.ranking) ? result.ranking?.[0]?.descricao : null,
    );

    if (candidate) return candidate;
  }

  return null;
}

function extrairProdutosDaResposta(resposta: ClarkResposta): string[] {
  const dados: any = resposta?.dados || {};
  const plan: any = dados?.plan || {};
  const toolResults: any[] = Array.isArray(dados?.toolResults) ? dados.toolResults : [];
  const values: string[] = [];

  const planProducts = Array.isArray(plan?.entities?.products) ? plan.entities.products : [];
  for (const item of planProducts) {
    const candidate = pickFirstString(
      item?.raw,
      [item?.family, item?.storage, item?.color].filter(Boolean).join(' '),
    );
    if (candidate) values.push(candidate);
  }

  for (const item of toolResults) {
    const result = item?.result || {};
    const products = Array.isArray(result?.products) ? result.products : [];
    for (const product of products) {
      const candidate = pickFirstString(
        product?.requested,
        [product?.family, product?.storage, product?.color].filter(Boolean).join(' '),
        product?.request?.raw,
      );
      if (candidate) values.push(candidate);
    }
  }

  return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean))).slice(0, 20);
}

function extrairLojaDaResposta(resposta: ClarkResposta): string | null {
  const dados: any = resposta?.dados || {};
  const plan: any = dados?.plan || {};
  const filtros: any = resposta?.filtros || {};

  return pickFirstString(
    filtros?.lojaCanonica,
    filtros?.lojaOriginal,
    plan?.entities?.store,
  );
}

function extrairToolPrincipal(resposta: ClarkResposta): string | null {
  const toolResults: any[] = Array.isArray((resposta?.dados as any)?.toolResults)
    ? (resposta?.dados as any).toolResults
    : [];

  const firstPublic = toolResults.find((item) => item?.tool && item.tool !== 'resolver_produto');

  return firstPublic?.tool || toolResults?.[0]?.tool || null;
}

export function montarHistoricoComMemoriaClark(
  memoria: ClarkExecutiveMemory | null,
  historico: ClarkHistoricoMensagem[],
): ClarkHistoricoMensagem[] {
  if (!memoria) return historico;

  const partes = [
    memoria.lastProducts.length ? `últimos produtos consultados: ${memoria.lastProducts.join(', ')}` : memoria.lastProduct ? `último produto consultado: ${memoria.lastProduct}` : null,
    memoria.lastStore ? `última loja consultada: ${memoria.lastStore}` : null,
    memoria.lastPeriodLabel ? `último período: ${memoria.lastPeriodLabel}` : null,
    memoria.lastIntent ? `última intenção: ${memoria.lastIntent}` : null,
    memoria.lastTool ? `última ferramenta: ${memoria.lastTool}` : null,
  ].filter(Boolean);

  if (!partes.length) return historico;

  return [
    {
      role: 'assistant',
      text: `Memória persistente da Clark para continuar a conversa: ${partes.join('; ')}. Use essa memória apenas para perguntas curtas de continuação, como "e as vendas?", "e no Park Shopping?", "e mês passado?".`,
    },
    ...historico,
  ];
}

export function aplicarMemoriaNaPerguntaClark(
  perguntaOriginal: string,
  memoria: ClarkExecutiveMemory | null,
): string {
  const pergunta = String(perguntaOriginal || '').trim();

  if (!pergunta || !memoria) return pergunta;

  const upper = pergunta
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // Memória persistente só deve entrar quando a pergunta atual realmente
  // referencia o contexto anterior. Perguntas curtas e completas, como
  // "vendas por loja este mês", não podem herdar o último produto consultado.
  if (!perguntaPareceFollowUpClark(pergunta)) return pergunta;

  const temProdutoNaPergunta =
    /\b(GALAXY|SM-[A-Z0-9]|S\d{2}|A\d{2}|M\d{2}|Z\s?FLIP|Z\s?FOLD|TAB\s?S)\b/i.test(pergunta);

  const falaVendas =
    upper.includes('VENDA') ||
    upper.includes('FATURAMENTO') ||
    upper.includes('GIRO');

  const falaEstoque =
    upper.includes('ESTOQUE') ||
    upper.includes('LOJA') ||
    upper.includes('LOJAS') ||
    upper.includes('ONDE') ||
    upper.includes('PECA') ||
    upper.includes('PECAS') ||
    upper.includes('PEÇAS');

  const produtosContexto = memoria.lastProducts.length ? memoria.lastProducts : (memoria.lastProduct ? [memoria.lastProduct] : []);

  if (!temProdutoNaPergunta && produtosContexto.length && falaVendas) {
    return `Com base nos últimos produtos consultados (${produtosContexto.join(', ')}), responda: ${pergunta}`;
  }

  if (!temProdutoNaPergunta && produtosContexto.length && falaEstoque) {
    return `Com base nos últimos produtos consultados (${produtosContexto.join(', ')}), responda: ${pergunta}`;
  }

  if (memoria.lastStore && /^(E\s+)?(NO|NA)\s+/i.test(pergunta)) {
    return `${pergunta}. Considere também o contexto anterior, se fizer sentido: produto ${memoria.lastProduct || 'não informado'}.`;
  }

  return pergunta;
}

export async function atualizarMemoriaExecutivaClark(params: {
  userId: string;
  perguntaOriginal: string;
  resposta: ClarkResposta;
}): Promise<ClarkExecutiveMemory | null> {
  const userId = String(params.userId || '').trim();

  if (!userId) return null;

  const resposta = params.resposta;
  const atual = await obterMemoriaExecutivaClark(userId);

  const extractedProducts = extrairProdutosDaResposta(resposta);
  const lastProducts = extractedProducts.length ? extractedProducts : (atual?.lastProducts || []);
  const lastProduct = lastProducts[0] || extrairProdutoDaResposta(resposta) || atual?.lastProduct || null;
  const lastStore = extrairLojaDaResposta(resposta) || atual?.lastStore || null;
  const lastTool = extrairToolPrincipal(resposta) || atual?.lastTool || null;
  const periodo: any = resposta?.periodo || {};
  const updatedAt = new Date().toISOString();

  const next: ClarkExecutiveMemory = {
    userId,
    lastProduct,
    lastProducts,
    lastStore,
    lastPeriodStart: periodo.inicio || atual?.lastPeriodStart || null,
    lastPeriodEnd: periodo.fim || atual?.lastPeriodEnd || null,
    lastPeriodLabel: periodo.descricao || atual?.lastPeriodLabel || null,
    lastIntent: resposta?.intencao || atual?.lastIntent || null,
    lastTool,
    lastQuestion: cleanText(params.perguntaOriginal, 500) || atual?.lastQuestion || null,
    lastAnswerSummary: cleanText(resposta?.clark, 900) || atual?.lastAnswerSummary || null,
    interactionCount: Number(atual?.interactionCount || 0) + 1,
    updatedAt,
  };

  let db: SqliteDb | null = null;

  try {
    db = await openMemoryDb();

    await db.run(
      `INSERT INTO ${MEMORY_TABLE} (
        userId,
        lastProduct,
        lastProducts,
        lastStore,
        lastPeriodStart,
        lastPeriodEnd,
        lastPeriodLabel,
        lastIntent,
        lastTool,
        lastQuestion,
        lastAnswerSummary,
        interactionCount,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        lastProduct = excluded.lastProduct,
        lastProducts = excluded.lastProducts,
        lastStore = excluded.lastStore,
        lastPeriodStart = excluded.lastPeriodStart,
        lastPeriodEnd = excluded.lastPeriodEnd,
        lastPeriodLabel = excluded.lastPeriodLabel,
        lastIntent = excluded.lastIntent,
        lastTool = excluded.lastTool,
        lastQuestion = excluded.lastQuestion,
        lastAnswerSummary = excluded.lastAnswerSummary,
        interactionCount = excluded.interactionCount,
        updatedAt = excluded.updatedAt`,
      [
        next.userId,
        next.lastProduct,
        JSON.stringify(next.lastProducts || []),
        next.lastStore,
        next.lastPeriodStart,
        next.lastPeriodEnd,
        next.lastPeriodLabel,
        next.lastIntent,
        next.lastTool,
        next.lastQuestion,
        next.lastAnswerSummary,
        next.interactionCount,
        next.updatedAt,
      ],
    );

    return next;
  } catch (error) {
    console.warn('⚠️ Não foi possível atualizar memória da Clark:', error);
    return atual || null;
  } finally {
    if (db) await db.close().catch(() => undefined);
  }
}