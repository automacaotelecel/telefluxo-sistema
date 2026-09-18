import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { ClarkDbContext, ClarkFiltros, ClarkPeriodo } from '../clark.types';
import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

import { extrairFiltrosClark, formatBRL, resolverNomeLojaClark, safeNumberClark } from '../../intent/extractFilters';
import { extrairPeriodoClark } from '../../intent/extractPeriod';
import { obterEscopoUsuarioClark, rowPermitidaClark, rowCorrespondeLojaFiltroClark } from '../../security/clarkScope';

import {
  consultarCategoriasVendasClark,
  consultarRankingLojasVendasClark,
  consultarRankingVendedoresVendasClark,
  consultarResumoVendasPeriodoClark,
  consultarVendasMensaisClark,
} from '../../executors/sales.executor';

import {
  consultarRankingLojasSegurosClark,
  consultarRankingVendedoresSegurosClark,
} from '../../executors/insurance.executor';

import { consultarRelatorioAnaliticoVendasClark } from '../../analytics/salesAnalytics';
import { calcularCrescimentoMensalClark } from '../../analytics/growth';
import { extractColor, extractStorage, getBaseModelFamily, normalizeProductText } from '../../productDictionary/productDictionary.utils';

function dbDir() {
  const rootDir = process.cwd();
  return process.env.RENDER
    ? path.join(__dirname, '../../../../database')
    : path.join(rootDir, 'database');
}

async function abrirDbSeExistir(filename: string) {
  if (!fs.existsSync(filename)) return null;
  return open({ filename, driver: sqlite3.Database });
}

async function criarDbContext(): Promise<ClarkDbContext> {
  const dir = dbDir();
  const globalPath = path.join(dir, 'samsung_vendas.db');
  const annualPath = path.join(dir, 'samsung_vendas_anuais.db');

  const [globalDb, annualDb] = await Promise.all([
    abrirDbSeExistir(globalPath),
    abrirDbSeExistir(annualPath),
  ]);

  return { globalDb, annualDb };
}

async function fecharDbContext(ctx: ClarkDbContext) {
  try { if (ctx.globalDb) await ctx.globalDb.close(); } catch {}
  try { if (ctx.annualDb) await ctx.annualDb.close(); } catch {}
}

function perguntaVirtual(args: Record<string, any>) {
  return String(args.pergunta || args.question || args.query || args.rawQuestion || '').trim();
}

function montarPeriodo(args: Record<string, any>): ClarkPeriodo {
  const pergunta = perguntaVirtual(args);
  if (args.startDate && args.endDate) {
    return {
      inicio: String(args.startDate),
      fim: String(args.endDate),
      descricao: args.label ? String(args.label) : `${args.startDate} até ${args.endDate}`,
    };
  }
  if (args.period?.startDate && args.period?.endDate) {
    return {
      inicio: String(args.period.startDate),
      fim: String(args.period.endDate),
      descricao: args.period.label ? String(args.period.label) : `${args.period.startDate} até ${args.period.endDate}`,
    };
  }
  return extrairPeriodoClark(pergunta || 'mês atual');
}

function montarFiltros(args: Record<string, any>): ClarkFiltros {
  const pergunta = perguntaVirtual(args);
  const filtros = extrairFiltrosClark(pergunta || [args.store, args.category, args.seller].filter(Boolean).join(' '));

  const limite = Number(args.limit || args.limite || filtros.limite || 10);

  const patch: Partial<ClarkFiltros> = {
    limite: Number.isFinite(limite) && limite > 0 ? Math.min(limite, 1000) : 10,
  };

  if (args.store || args.loja) {
    patch.lojaOriginal = String(args.store || args.loja);
    patch.lojaCanonica = String(args.store || args.loja).toUpperCase();
  }

  if (args.category || args.categoria) {
    patch.categoriaOriginal = String(args.category || args.categoria);
    patch.categoriaCanonica = String(args.category || args.categoria);
  }

  return { ...filtros, ...patch } as ClarkFiltros;
}

async function executarComContexto(
  tool: ClarkToolResult['tool'],
  args: Record<string, any>,
  ctxTool: ClarkToolContext,
  fn: (ctx: ClarkDbContext, periodo: ClarkPeriodo, scope: any, filtros: ClarkFiltros) => Promise<any>
): Promise<ClarkToolResult> {
  const ctx = await criarDbContext();
  try {
    const periodo = montarPeriodo(args);
    const filtros = montarFiltros(args);
    const scope = await obterEscopoUsuarioClark(ctxTool.userId);
    const result = await fn(ctx, periodo, scope, filtros);
    return { tool, ok: true, args, result };
  } catch (error: any) {
    return {
      tool,
      ok: false,
      args,
      result: null,
      error: error?.message || `Erro ao executar ${tool}.`,
    };
  } finally {
    await fecharDbContext(ctx);
  }
}

export async function toolConsultarVendasResumo(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_vendas_resumo', args, ctx, consultarResumoVendasPeriodoClark);
}

export async function toolConsultarVendasPorLoja(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_vendas_por_loja', args, ctx, consultarRankingLojasVendasClark);
}

export async function toolConsultarVendasPorVendedor(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_vendas_por_vendedor', args, ctx, consultarRankingVendedoresVendasClark);
}

export async function toolConsultarVendasPorCategoria(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_vendas_por_categoria', args, ctx, consultarCategoriasVendasClark);
}

export async function toolConsultarCrescimentoMensal(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_crescimento_mensal', args, ctx, async (dbCtx, periodo, scope, filtros) => {
    const mensal = await consultarVendasMensaisClark(dbCtx, periodo, scope, filtros);
    return {
      modulo: 'vendas',
      tipo: 'crescimento_mensal',
      periodo,
      filtro_loja: filtros.lojaCanonica || null,
      meses: calcularCrescimentoMensalClark(mensal),
    };
  });
}

export async function toolConsultarRelatorioVendas(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_relatorio_vendas', args, ctx, consultarRelatorioAnaliticoVendasClark);
}

export async function toolConsultarSegurosPorVendedor(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_seguros_por_vendedor', args, ctx, consultarRankingVendedoresSegurosClark);
}

export async function toolConsultarSegurosPorLoja(args: Record<string, any>, ctx: ClarkToolContext) {
  return executarComContexto('consultar_seguros_por_loja', args, ctx, consultarRankingLojasSegurosClark);
}

// ---------------------------------------------------------------------------
// VENDAS POR UM OU VÁRIOS PRODUTOS
// ---------------------------------------------------------------------------

type ProdutoVendaSolicitado = {
  raw: string;
  family: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  category: string | null;
};

function normalizarProdutoVendaSolicitado(input: any): ProdutoVendaSolicitado {
  const raw = String(input?.raw || input?.query || input?.family || input?.model || input || '').trim();
  const family = input?.family || getBaseModelFamily(raw) || null;
  const storage = input?.storage || extractStorage(raw) || null;
  const color = input?.color || extractColor(raw) || null;
  const model = input?.model || (family ? String(family).replace(/^GALAXY\s+/i, '').trim() : null);

  return {
    raw,
    family,
    model,
    storage,
    color,
    category: input?.category || null,
  };
}

function chaveProdutoVenda(produto: ProdutoVendaSolicitado) {
  return [produto.family || normalizeProductText(produto.raw), produto.storage || '', produto.color || ''].join('|');
}

function normalizarDataVendaProduto(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const brDash = raw.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (brDash) return `${brDash[3]}-${brDash[2]}-${brDash[1]}`;

  const n = Number(raw);
  if (Number.isFinite(n) && n > 20000 && n < 90000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + n);
    return `${excelEpoch.getUTCFullYear()}-${String(excelEpoch.getUTCMonth() + 1).padStart(2, '0')}-${String(excelEpoch.getUTCDate()).padStart(2, '0')}`;
  }

  return null;
}

function vendaProdutoDentroPeriodo(row: any, periodo: ClarkPeriodo) {
  const date = normalizarDataVendaProduto(row?.data_emissao);
  const start = normalizarDataVendaProduto(periodo?.inicio);
  const end = normalizarDataVendaProduto(periodo?.fim);
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

async function tabelaExisteVendasProduto(db: any, table: string) {
  if (!db) return false;
  try {
    const row = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`, [table]);
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function normalizarVendaProdutoRow(row: any, origem: string) {
  return {
    origem,
    data_emissao: normalizarDataVendaProduto(row?.data_emissao) || row?.data_emissao || null,
    loja: row?.loja || row?.nome_fantasia || row?.storeName || null,
    cnpj_empresa: row?.cnpj_empresa || row?.cnpj || null,
    nome_vendedor: row?.nome_vendedor || row?.vendedor || null,
    descricao: row?.descricao || row?.produto || null,
    familia: row?.familia || row?.categoria || null,
    categoria: row?.categoria || row?.familia || null,
    regiao: row?.regiao || null,
    quantidade: safeNumberClark(row?.quantidade),
    total_liquido: safeNumberClark(row?.total_liquido ?? row?.valor ?? row?.total),
  };
}

function deduplicarVendasProduto(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = [
      normalizarDataVendaProduto(row?.data_emissao) || '',
      row?.cnpj_empresa || '',
      row?.loja || '',
      row?.nome_vendedor || '',
      row?.descricao || '',
      row?.familia || '',
      row?.categoria || '',
      row?.quantidade || '',
      row?.total_liquido || '',
    ].join('|');
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

async function carregarFonteVendasProduto(db: ClarkDbContext, periodo: ClarkPeriodo) {
  let detalhadas: any[] = [];
  let anuaisSeparado: any[] = [];
  let anuaisGlobal: any[] = [];
  let globais: any[] = [];

  if (db.globalDb && await tabelaExisteVendasProduto(db.globalDb, 'vendas_detalhadas_imei')) {
    detalhadas = await db.globalDb.all(`
      SELECT data_emissao, nome_fantasia AS loja, cnpj_empresa, nome_vendedor,
             descricao, categoria, categoria AS familia, regiao, quantidade, total_liquido
      FROM vendas_detalhadas_imei
    `).catch(() => []);
    detalhadas = detalhadas.map((row: any) => normalizarVendaProdutoRow(row, 'vendas_detalhadas_imei')).filter((row: any) => vendaProdutoDentroPeriodo(row, periodo));
  }

  if (db.annualDb && await tabelaExisteVendasProduto(db.annualDb, 'vendas_anuais')) {
    anuaisSeparado = await db.annualDb.all(`
      SELECT data_emissao, loja, cnpj_empresa, nome_vendedor, descricao, familia,
             familia AS categoria, regiao, quantidade, total_liquido
      FROM vendas_anuais
    `).catch(() => []);
    anuaisSeparado = anuaisSeparado.map((row: any) => normalizarVendaProdutoRow(row, 'vendas_anuais')).filter((row: any) => vendaProdutoDentroPeriodo(row, periodo));
  }

  if (db.globalDb && await tabelaExisteVendasProduto(db.globalDb, 'vendas_anuais')) {
    anuaisGlobal = await db.globalDb.all(`
      SELECT data_emissao, loja, cnpj_empresa, nome_vendedor, descricao, familia,
             familia AS categoria, regiao, quantidade, total_liquido
      FROM vendas_anuais
    `).catch(() => []);
    anuaisGlobal = anuaisGlobal.map((row: any) => normalizarVendaProdutoRow(row, 'vendas_anuais_global')).filter((row: any) => vendaProdutoDentroPeriodo(row, periodo));
  }

  if (db.globalDb && await tabelaExisteVendasProduto(db.globalDb, 'vendas')) {
    globais = await db.globalDb.all(`
      SELECT data_emissao, NULL AS loja, cnpj_empresa, nome_vendedor, descricao, familia,
             familia AS categoria, regiao, quantidade, total_liquido
      FROM vendas
    `).catch(() => []);
    globais = globais.map((row: any) => normalizarVendaProdutoRow(row, 'vendas')).filter((row: any) => vendaProdutoDentroPeriodo(row, periodo));
  }

  // Mantém exatamente a mesma prioridade da camada principal de vendas do
  // TeleFluxo. Assim a Clark e a tela de vendas usam a mesma fonte lógica.
  if (detalhadas.length) return { fonte: 'vendas_detalhadas_imei', rows: deduplicarVendasProduto(detalhadas) };
  if (anuaisSeparado.length) return { fonte: 'vendas_anuais', rows: deduplicarVendasProduto(anuaisSeparado) };
  if (anuaisGlobal.length) return { fonte: 'vendas_anuais_global', rows: deduplicarVendasProduto(anuaisGlobal) };
  if (globais.length) return { fonte: 'vendas', rows: deduplicarVendasProduto(globais) };
  return { fonte: 'nenhuma', rows: [] };
}

async function consultarVendasRawProdutos(db: ClarkDbContext, periodo: ClarkPeriodo) {
  return carregarFonteVendasProduto(db, periodo);
}

function vendaCombinaProduto(row: any, produto: ProdutoVendaSolicitado) {
  const text = normalizeProductText([row.descricao, row.familia].filter(Boolean).join(' '));
  const familyRow = getBaseModelFamily(text) || normalizeProductText(row.familia || '');

  if (produto.family) {
    if (familyRow !== produto.family && !text.includes(produto.family)) return false;
  } else {
    const raw = normalizeProductText(produto.raw);
    if (raw && !text.includes(raw)) return false;
  }

  if (produto.storage) {
    const storageRow = extractStorage(text) || '';
    if (storageRow !== produto.storage && !text.includes(produto.storage)) return false;
  }

  if (produto.color) {
    const colorRow = extractColor(text) || '';
    if (colorRow && colorRow !== produto.color) return false;
    if (!colorRow && !text.includes(normalizeProductText(produto.color))) return false;
  }

  return true;
}

function consolidarVendaProduto(rows: any[], produto: ProdutoVendaSolicitado) {
  const lojas = new Map<string, { loja: string; total_vendas: number; total_pecas: number }>();
  const variacoes = new Map<string, { descricao: string; total_vendas: number; total_pecas: number }>();
  let totalVendas = 0;
  let totalPecas = 0;

  for (const row of rows) {
    const valor = safeNumberClark(row.total_liquido);
    const qtd = safeNumberClark(row.quantidade);
    const loja = resolverNomeLojaClark(row);
    const descricao = String(row.descricao || row.familia || produto.raw || 'Produto').trim();

    totalVendas += valor;
    totalPecas += qtd;

    const lojaItem = lojas.get(loja) || { loja, total_vendas: 0, total_pecas: 0 };
    lojaItem.total_vendas += valor;
    lojaItem.total_pecas += qtd;
    lojas.set(loja, lojaItem);

    const variacaoKey = normalizeProductText(descricao) || descricao;
    const variacao = variacoes.get(variacaoKey) || { descricao, total_vendas: 0, total_pecas: 0 };
    variacao.total_vendas += valor;
    variacao.total_pecas += qtd;
    variacoes.set(variacaoKey, variacao);
  }

  const lojasArray = Array.from(lojas.values())
    .map((item) => ({ ...item, total_vendas_formatado: formatBRL(item.total_vendas) }))
    .sort((a, b) => b.total_vendas - a.total_vendas);

  const variacoesArray = Array.from(variacoes.values())
    .map((item) => ({ ...item, total_vendas_formatado: formatBRL(item.total_vendas) }))
    .sort((a, b) => b.total_vendas - a.total_vendas);

  return {
    requested: produto.raw,
    family: produto.family,
    model: produto.model,
    storage: produto.storage,
    color: produto.color,
    matched: rows.length > 0,
    total_vendas: totalVendas,
    total_vendas_formatado: formatBRL(totalVendas),
    total_pecas: totalPecas,
    ticket_medio: totalPecas > 0 ? totalVendas / totalPecas : 0,
    ticket_medio_formatado: formatBRL(totalPecas > 0 ? totalVendas / totalPecas : 0),
    registros: rows.length,
    lojas: lojasArray,
    variacoes: variacoesArray,
  };
}

/**
 * Consulta factual de vendas por produto. Aceita products[] e SEMPRE devolve
 * uma entrada para cada produto solicitado, inclusive quando a venda foi zero.
 * Isso permite ao verificador provar que nenhum item da pergunta foi ignorado.
 */
export async function toolConsultarVendasProdutos(
  args: Record<string, any>,
  ctxTool: ClarkToolContext,
): Promise<ClarkToolResult> {
  const tool: ClarkToolResult['tool'] = 'consultar_vendas_produtos';
  const db = await criarDbContext();

  try {
    const periodo = montarPeriodo(args);
    const filtros = montarFiltros(args);
    const scope = await obterEscopoUsuarioClark(ctxTool.userId);

    const rawProducts = Array.isArray(args.products)
      ? args.products
      : args.product
        ? [args.product]
        : [];

    const products = rawProducts
      .map(normalizarProdutoVendaSolicitado)
      .filter((p: ProdutoVendaSolicitado) => p.raw || p.family);

    const uniqueProducts: ProdutoVendaSolicitado[] = [];
    const seen = new Set<string>();
    for (const product of products) {
      const key = chaveProdutoVenda(product);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueProducts.push(product);
    }

    if (!uniqueProducts.length) {
      return {
        tool,
        ok: false,
        args,
        result: null,
        error: 'Nenhum produto foi informado para a consulta de vendas.',
      };
    }

    const source = await consultarVendasRawProdutos(db, periodo);
    const rawRows = source.rows
      .filter((row: any) => rowPermitidaClark(row, scope))
      .filter((row: any) => rowCorrespondeLojaFiltroClark(row, filtros));

    const results = uniqueProducts.map((product) => {
      const rows = rawRows.filter((row) => vendaCombinaProduto(row, product));
      return consolidarVendaProduto(rows, product);
    });

    const totalVendas = results.reduce((acc, item) => acc + safeNumberClark(item.total_vendas), 0);
    const totalPecas = results.reduce((acc, item) => acc + safeNumberClark(item.total_pecas), 0);

    return {
      tool,
      ok: true,
      args,
      result: {
        tipo: 'vendas_produtos',
        periodo,
        fonte_dados: source.fonte,
        requested_count: uniqueProducts.length,
        answered_count: results.length,
        matched_count: results.filter((item) => item.matched).length,
        missing_products: results.filter((item) => !item.matched).map((item) => item.requested),
        products: results,
        total_vendas: totalVendas,
        total_vendas_formatado: formatBRL(totalVendas),
        total_pecas: totalPecas,
        ticket_medio: totalPecas > 0 ? totalVendas / totalPecas : 0,
        ticket_medio_formatado: formatBRL(totalPecas > 0 ? totalVendas / totalPecas : 0),
      },
    };
  } catch (error: any) {
    return {
      tool,
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao consultar vendas por produto.',
    };
  } finally {
    await fecharDbContext(db);
  }
}
