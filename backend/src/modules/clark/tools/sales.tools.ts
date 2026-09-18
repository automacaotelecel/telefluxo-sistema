import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { ClarkDbContext, ClarkFiltros, ClarkPeriodo } from '../clark.types';
import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

import {
  getAnnualSalesDbPath,
  getGlobalSalesDbPath,
  getSalesDatabaseDiagnostics,
} from '../../data/databasePaths';

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

async function abrirDbSeExistir(filename: string) {
  if (!fs.existsSync(filename)) return null;
  return open({ filename, driver: sqlite3.Database });
}

async function criarDbContext(): Promise<ClarkDbContext> {
  const globalPath = getGlobalSalesDbPath();
  const annualPath = getAnnualSalesDbPath();

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

function assegurarBancoDisponivel(ctx: ClarkDbContext) {
  if (ctx.globalDb || ctx.annualDb) return;

  const diag = getSalesDatabaseDiagnostics();
  throw new Error(
    `Bancos de vendas indisponíveis. Diretório consultado: ${diag.databaseDir}. ` +
    'A Clark não retornará R$ 0,00 quando não conseguir acessar a base.',
  );
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
    assegurarBancoDisponivel(ctx);
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

type VendaProdutoRow = {
  origem: string;
  data_emissao: string | null;
  loja: string | null;
  cnpj_empresa: string | null;
  nome_vendedor: string | null;
  codigo_produto: string | null;
  referencia: string | null;
  descricao: string | null;
  familia: string | null;
  categoria: string | null;
  regiao: string | null;
  quantidade: number;
  total_liquido: number;
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

function proximoDiaIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
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

function normalizarVendaProdutoRow(row: any, origem: string): VendaProdutoRow {
  const qtdReal = safeNumberClark(row?.qtd_real);
  const totalReal = safeNumberClark(row?.total_real);

  return {
    origem,
    data_emissao: normalizarDataVendaProduto(row?.data_emissao) || row?.data_emissao || null,
    loja: row?.loja || row?.nome_fantasia || row?.storeName || null,
    cnpj_empresa: row?.cnpj_empresa || row?.cnpj || null,
    nome_vendedor: row?.nome_vendedor || row?.vendedor || null,
    codigo_produto: row?.codigo_produto || row?.CODIGO_PRODUTO || null,
    referencia: row?.referencia || row?.REFERENCIA || row?.familia || null,
    descricao: row?.descricao || row?.produto || null,
    familia: row?.familia || row?.categoria_real || row?.categoria || null,
    categoria: row?.categoria_real || row?.categoria || row?.familia || null,
    regiao: row?.regiao || null,
    quantidade: qtdReal !== 0 ? qtdReal : safeNumberClark(row?.quantidade),
    total_liquido: totalReal !== 0
      ? totalReal
      : safeNumberClark(row?.total_liquido ?? row?.valor ?? row?.total),
  };
}

function deduplicarVendasProduto(rows: VendaProdutoRow[]) {
  const map = new Map<string, VendaProdutoRow>();
  for (const row of rows) {
    const key = [
      normalizarDataVendaProduto(row?.data_emissao) || '',
      row?.cnpj_empresa || '',
      row?.loja || '',
      row?.nome_vendedor || '',
      row?.codigo_produto || '',
      row?.referencia || '',
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

async function carregarVendasAnuaisRawProduto(db: ClarkDbContext, periodo: ClarkPeriodo) {
  if (!db.annualDb || !(await tabelaExisteVendasProduto(db.annualDb, 'vendas_anuais_raw'))) {
    return [] as VendaProdutoRow[];
  }

  const rows = await db.annualDb.all(`
    SELECT
      data_emissao,
      loja,
      cnpj_empresa,
      nome_vendedor,
      codigo_produto,
      referencia,
      descricao,
      categoria,
      categoria_real,
      regiao,
      quantidade,
      qtd_real,
      total_liquido,
      total_real,
      cancelado
    FROM vendas_anuais_raw
    WHERE COALESCE(cancelado, 'N') = 'N'
  `).catch(() => []);

  return (rows as any[])
    .map((row) => normalizarVendaProdutoRow(row, 'vendas_anuais_raw'))
    .filter((row) => vendaProdutoDentroPeriodo(row, periodo));
}

async function carregarVendasDetalhadasProduto(
  db: ClarkDbContext,
  periodo: ClarkPeriodo,
  startOverride?: string,
) {
  if (!db.globalDb || !(await tabelaExisteVendasProduto(db.globalDb, 'vendas_detalhadas_imei'))) {
    return [] as VendaProdutoRow[];
  }

  const rows = await db.globalDb.all(`
    SELECT
      data_emissao,
      nome_fantasia AS loja,
      cnpj_empresa,
      nome_vendedor,
      codigo_produto,
      referencia,
      descricao,
      categoria,
      categoria AS familia,
      regiao,
      quantidade,
      total_liquido
    FROM vendas_detalhadas_imei
  `).catch(() => []);

  const start = startOverride || periodo.inicio;
  const periodoEfetivo: ClarkPeriodo = {
    ...periodo,
    inicio: start,
  };

  return (rows as any[])
    .map((row) => normalizarVendaProdutoRow(row, 'vendas_detalhadas_imei'))
    .filter((row) => vendaProdutoDentroPeriodo(row, periodoEfetivo));
}

async function carregarVendasAnuaisConsolidadasProduto(db: ClarkDbContext, periodo: ClarkPeriodo) {
  if (!db.annualDb || !(await tabelaExisteVendasProduto(db.annualDb, 'vendas_anuais'))) {
    return [] as VendaProdutoRow[];
  }

  const rows = await db.annualDb.all(`
    SELECT
      data_emissao,
      loja,
      cnpj_empresa,
      nome_vendedor,
      NULL AS codigo_produto,
      familia AS referencia,
      descricao,
      familia,
      familia AS categoria,
      regiao,
      quantidade,
      total_liquido
    FROM vendas_anuais
  `).catch(() => []);

  return (rows as any[])
    .map((row) => normalizarVendaProdutoRow(row, 'vendas_anuais'))
    .filter((row) => vendaProdutoDentroPeriodo(row, periodo));
}

async function carregarVendasLegadoProduto(db: ClarkDbContext, periodo: ClarkPeriodo) {
  if (!db.globalDb || !(await tabelaExisteVendasProduto(db.globalDb, 'vendas'))) {
    return [] as VendaProdutoRow[];
  }

  const rows = await db.globalDb.all(`
    SELECT
      data_emissao,
      NULL AS loja,
      cnpj_empresa,
      nome_vendedor,
      NULL AS codigo_produto,
      familia AS referencia,
      descricao,
      familia,
      familia AS categoria,
      regiao,
      quantidade,
      total_liquido
    FROM vendas
  `).catch(() => []);

  return (rows as any[])
    .map((row) => normalizarVendaProdutoRow(row, 'vendas'))
    .filter((row) => vendaProdutoDentroPeriodo(row, periodo));
}

/**
 * Monta uma base de produto sem duplicar histórico:
 * - anual RAW até a última data disponível;
 * - detalhada IMEI apenas depois dessa data;
 * - anual consolidada como fallback se RAW não existir;
 * - `vendas` legado fica separado e é usado por produto quando as bases
 *   detalhadas não conseguem identificar aquele modelo.
 */
async function carregarFontesVendasProduto(db: ClarkDbContext, periodo: ClarkPeriodo) {
  const annualRaw = await carregarVendasAnuaisRawProduto(db, periodo);

  const datasAnnual = annualRaw
    .map((row) => normalizarDataVendaProduto(row.data_emissao))
    .filter((value): value is string => Boolean(value))
    .sort();

  const annualMaxDate = datasAnnual.length ? datasAnnual[datasAnnual.length - 1] : null;
  const detailedStart = annualMaxDate ? proximoDiaIso(annualMaxDate) : periodo.inicio;

  const detailed =
    detailedStart <= periodo.fim
      ? await carregarVendasDetalhadasProduto(db, periodo, detailedStart)
      : [];

  let principal: VendaProdutoRow[] = [];
  let fontePrincipal = 'nenhuma';

  if (annualRaw.length || detailed.length) {
    principal = deduplicarVendasProduto([...annualRaw, ...detailed]);
    fontePrincipal = [
      annualRaw.length ? 'vendas_anuais_raw' : '',
      detailed.length ? 'vendas_detalhadas_imei' : '',
    ].filter(Boolean).join('+');
  } else {
    const annualConsolidada = await carregarVendasAnuaisConsolidadasProduto(db, periodo);
    if (annualConsolidada.length) {
      principal = deduplicarVendasProduto(annualConsolidada);
      fontePrincipal = 'vendas_anuais';
    }
  }

  const legacy = deduplicarVendasProduto(await carregarVendasLegadoProduto(db, periodo));

  return {
    principal,
    legacy,
    fontePrincipal,
    annualMaxDate,
    debug: {
      annual_raw: annualRaw.length,
      detalhadas_complementares: detailed.length,
      principal: principal.length,
      legacy: legacy.length,
      annual_max_date: annualMaxDate,
      detailed_start: detailedStart,
    },
  };
}

function textoVendaProduto(row: VendaProdutoRow) {
  return normalizeProductText([
    row.descricao,
    row.familia,
    row.categoria,
    row.referencia,
    row.codigo_produto,
  ].filter(Boolean).join(' '));
}

function vendaCombinaProduto(row: VendaProdutoRow, produto: ProdutoVendaSolicitado) {
  const text = textoVendaProduto(row);
  const familyRow = getBaseModelFamily(text) || normalizeProductText(row.familia || '');

  if (produto.family) {
    const familyNorm = normalizeProductText(produto.family);
    if (familyRow !== produto.family && familyRow !== familyNorm && !text.includes(familyNorm)) return false;
  } else {
    const raw = normalizeProductText(produto.raw);
    if (raw && !text.includes(raw)) return false;
  }

  if (produto.storage) {
    const storageRow = extractStorage(text) || '';
    const storageNorm = normalizeProductText(produto.storage);
    if (storageRow !== produto.storage && storageRow !== storageNorm && !text.includes(storageNorm)) return false;
  }

  if (produto.color) {
    const colorRow = extractColor(text) || '';
    const colorNorm = normalizeProductText(produto.color);
    if (colorRow && colorRow !== produto.color && colorRow !== colorNorm) return false;
    if (!colorRow && !text.includes(colorNorm)) return false;
  }

  if (produto.category) {
    const cat = normalizeProductText(produto.category);
    if (cat && !text.includes(cat)) return false;
  }

  return true;
}

function consolidarVendaProduto(
  rows: VendaProdutoRow[],
  produto: ProdutoVendaSolicitado,
  fonte: string,
) {
  const lojas = new Map<string, { loja: string; total_vendas: number; total_pecas: number }>();
  const variacoes = new Map<string, { descricao: string; referencia: string | null; total_vendas: number; total_pecas: number }>();
  let totalVendas = 0;
  let totalPecas = 0;

  for (const row of rows) {
    const valor = safeNumberClark(row.total_liquido);
    const qtd = safeNumberClark(row.quantidade);
    const loja = resolverNomeLojaClark(row);
    const descricao = String(row.descricao || row.referencia || row.familia || produto.raw || 'Produto').trim();

    totalVendas += valor;
    totalPecas += qtd;

    const lojaItem = lojas.get(loja) || { loja, total_vendas: 0, total_pecas: 0 };
    lojaItem.total_vendas += valor;
    lojaItem.total_pecas += qtd;
    lojas.set(loja, lojaItem);

    const variacaoKey = normalizeProductText(`${row.referencia || ''}|${descricao}`) || descricao;
    const variacao = variacoes.get(variacaoKey) || {
      descricao,
      referencia: row.referencia || null,
      total_vendas: 0,
      total_pecas: 0,
    };
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
    fonte_dados: fonte,
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
 * Consulta factual de vendas por produto.
 *
 * Regras:
 * - aceita products[] e devolve uma resposta para CADA item solicitado;
 * - procura descrição + família + categoria + referência + código do produto;
 * - usa base anual RAW + complemento diário sem duplicar datas;
 * - se um produto não existir na base detalhada, tenta a tabela `vendas`;
 * - indisponibilidade de banco vira erro, nunca R$ 0,00 falso.
 */
export async function toolConsultarVendasProdutos(
  args: Record<string, any>,
  ctxTool: ClarkToolContext,
): Promise<ClarkToolResult> {
  const tool: ClarkToolResult['tool'] = 'consultar_vendas_produtos';
  const db = await criarDbContext();

  try {
    assegurarBancoDisponivel(db);

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

    const sources = await carregarFontesVendasProduto(db, periodo);

    const filtrarEscopo = (rows: VendaProdutoRow[]) => rows
      .filter((row) => rowPermitidaClark(row, scope))
      .filter((row) => rowCorrespondeLojaFiltroClark(row, filtros));

    const principal = filtrarEscopo(sources.principal);
    const legacy = filtrarEscopo(sources.legacy);

    const results = uniqueProducts.map((product) => {
      const principalRows = principal.filter((row) => vendaCombinaProduto(row, product));

      if (principalRows.length) {
        return consolidarVendaProduto(
          principalRows,
          product,
          sources.fontePrincipal || 'base_detalhada',
        );
      }

      const legacyRows = legacy.filter((row) => vendaCombinaProduto(row, product));
      return consolidarVendaProduto(legacyRows, product, legacyRows.length ? 'vendas' : 'nenhuma');
    });

    const totalVendas = results.reduce((acc, item) => acc + safeNumberClark(item.total_vendas), 0);
    const totalPecas = results.reduce((acc, item) => acc + safeNumberClark(item.total_pecas), 0);

    const diagnostics = getSalesDatabaseDiagnostics();

    return {
      tool,
      ok: true,
      args,
      result: {
        tipo: 'vendas_produtos',
        periodo,
        fonte_dados: sources.fontePrincipal || (legacy.length ? 'vendas' : 'nenhuma'),
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
        debug: {
          ...sources.debug,
          database_environment: diagnostics.environment,
          database_dir: diagnostics.databaseDir,
          global_db_exists: diagnostics.globalDbExists,
          annual_db_exists: diagnostics.annualDbExists,
          principal_apos_escopo: principal.length,
          legacy_apos_escopo: legacy.length,
        },
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
