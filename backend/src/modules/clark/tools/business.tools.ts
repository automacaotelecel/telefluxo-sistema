import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { PrismaClient } from '@prisma/client';

import { ClarkDbContext, ClarkFiltros, ClarkPeriodo } from '../clark.types';
import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

import { extrairFiltrosClark, formatBRL, normalizarTextoClark, resolverNomeLojaClark, safeNumberClark } from '../../intent/extractFilters';
import { extrairPeriodoClark } from '../../intent/extractPeriod';
import { obterEscopoUsuarioClark, rowPermitidaClark, rowCorrespondeLojaFiltroClark } from '../../security/clarkScope';

import {
  extractColor,
  extractStorage,
  getBaseModelFamily,
  normalizeProductText,
} from '../../productDictionary/productDictionary.utils';

const prisma = new PrismaClient();

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
  return String(args.originalQuestion || args.pergunta || args.question || args.query || args.rawQuestion || '').trim();
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

  return extrairPeriodoClark(pergunta || 'últimos 30 dias');
}

function montarFiltros(args: Record<string, any>): ClarkFiltros {
  const pergunta = perguntaVirtual(args);
  const filtros = extrairFiltrosClark(pergunta || [args.store, args.category, args.seller].filter(Boolean).join(' '));

  const limite = Number(args.limit || args.limite || filtros.limite || 20);
  const patch: Partial<ClarkFiltros> = {
    limite: Number.isFinite(limite) && limite > 0 ? Math.min(limite, 1000) : 20,
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

function detectarProduto(args: Record<string, any>) {
  const pergunta = perguntaVirtual(args);
  const query = String(args.query || args.product || args.produto || pergunta || '').trim();

  const family =
    getBaseModelFamily(query) ||
    getBaseModelFamily(pergunta) ||
    (args.family ? normalizeProductText(args.family) : null);

  const storage =
    extractStorage(query) ||
    extractStorage(pergunta) ||
    (args.storage ? normalizeProductText(args.storage) : null);

  const color =
    extractColor(query) ||
    extractColor(pergunta) ||
    (args.color ? normalizeProductText(args.color) : null);

  return {
    query,
    family,
    storage,
    color,
    category: String(args.category || args.categoria || '').trim() || null,
  };
}

function textoItemEstoque(row: any) {
  return normalizeProductText([row.description, row.reference, row.productCode, row.category].filter(Boolean).join(' '));
}

function limparDescricaoProduto(descricao: any): string {
  return String(descricao || '')
    .replace(/\bSM-[A-Z0-9]{6,}\b/gi, '')
    .replace(/\b[A-Z]{1,4}-?[A-Z0-9]{8,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function produtoBate(row: any, produto: ReturnType<typeof detectarProduto>) {
  const texto = textoItemEstoque(row);
  const familiaItem = getBaseModelFamily(texto) || '';

  if (produto.family && familiaItem !== produto.family) return false;
  if (!produto.family && produto.query) {
    const queryNorm = normalizeProductText(produto.query);
    if (queryNorm && !texto.includes(queryNorm)) return false;
  }

  if (produto.storage) {
    const storageItem = extractStorage(texto) || '';
    if (storageItem !== produto.storage) return false;
  }

  if (produto.color) {
    const colorItem = extractColor(texto) || '';
    if (colorItem !== produto.color) return false;
  }

  const categoriaSolicitada = normalizeProductText(produto.category || '');
  if (categoriaSolicitada) {
    const categoriaItem = normalizeProductText(row.category || '');
    if (categoriaSolicitada.includes('SMART') && !categoriaItem.includes('SMART')) return false;
    if (!categoriaSolicitada.includes('SMART') && !categoriaItem.includes(categoriaSolicitada)) return false;
  }

  return true;
}

async function consultarEstoqueProduto(args: Record<string, any>, ctxTool: ClarkToolContext) {
  const produto = detectarProduto(args);
  const scope = await obterEscopoUsuarioClark(ctxTool.userId);

  const rows = await prisma.stock.findMany({
    where: {
      quantity: {
        gt: 0,
      },
    },
    orderBy: {
      quantity: 'desc',
    },
  });

  const filtradas = rows
    .filter((row: any) => rowPermitidaClark(row, scope))
    .filter((row: any) => produtoBate(row, produto));

  const variacoesMap = new Map<string, any>();
  const lojasMap = new Map<string, any>();

  for (const row of filtradas as any[]) {
    const descricao = limparDescricaoProduto(row.description || row.reference || row.productCode || 'Produto não informado');
    const loja = String(row.storeName || 'Loja não informada').trim();
    const qtd = safeNumberClark(row.quantity);

    if (!variacoesMap.has(descricao)) {
      variacoesMap.set(descricao, {
        variacao: descricao,
        quantidade_total: 0,
        lojas: new Map<string, number>(),
      });
    }

    const variacao = variacoesMap.get(descricao);
    variacao.quantidade_total += qtd;
    variacao.lojas.set(loja, (variacao.lojas.get(loja) || 0) + qtd);

    if (!lojasMap.has(loja)) {
      lojasMap.set(loja, {
        loja,
        quantidade_total: 0,
        variacoes: new Map<string, number>(),
      });
    }

    const lojaItem = lojasMap.get(loja);
    lojaItem.quantidade_total += qtd;
    lojaItem.variacoes.set(descricao, (lojaItem.variacoes.get(descricao) || 0) + qtd);
  }

  const variacoes = Array.from(variacoesMap.values())
    .map((item: any) => ({
      variacao: item.variacao,
      quantidade_total: item.quantidade_total,
      lojas: Array.from((item.lojas as Map<string, number>).entries())
        .map(([loja, quantidade]) => ({ loja, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade),
    }))
    .sort((a, b) => b.quantidade_total - a.quantidade_total);

  const lojas = Array.from(lojasMap.values())
    .map((item: any) => ({
      loja: item.loja,
      quantidade_total: item.quantidade_total,
      variacoes: Array.from((item.variacoes as Map<string, number>).entries())
        .map(([variacao, quantidade]) => ({ variacao, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade),
    }))
    .sort((a, b) => b.quantidade_total - a.quantidade_total);

  const totalEstoque = variacoes.reduce((acc, item) => acc + safeNumberClark(item.quantidade_total), 0);

  return {
    produto,
    total_estoque: totalEstoque,
    variacoes,
    lojas,
    total_variacoes: variacoes.length,
    total_lojas: lojas.length,
  };
}

async function consultarVendasRaw(ctx: ClarkDbContext, periodo: ClarkPeriodo) {
  const queries = [];

  if (ctx.annualDb) {
    queries.push(
      ctx.annualDb.all(
        `
          SELECT
            'anual' AS origem,
            data_emissao,
            loja,
            cnpj_empresa,
            nome_vendedor,
            descricao,
            familia,
            regiao,
            quantidade,
            total_liquido
          FROM vendas_anuais
          WHERE data_emissao >= ?
            AND data_emissao <= ?
        `,
        [periodo.inicio, periodo.fim],
      ).catch(() => []),
    );
  }

  if (ctx.globalDb) {
    queries.push(
      ctx.globalDb.all(
        `
          SELECT
            'global' AS origem,
            data_emissao,
            NULL AS loja,
            cnpj_empresa,
            nome_vendedor,
            descricao,
            familia,
            regiao,
            quantidade,
            total_liquido
          FROM vendas
          WHERE data_emissao >= ?
            AND data_emissao <= ?
        `,
        [periodo.inicio, periodo.fim],
      ).catch(() => []),
    );
  }

  const results = await Promise.all(queries);
  const rows = results.flat();

  const map = new Map<string, any>();
  for (const row of rows) {
    const key = [
      row.origem,
      row.data_emissao,
      row.cnpj_empresa,
      row.loja,
      row.nome_vendedor,
      row.descricao,
      row.familia,
      row.quantidade,
      row.total_liquido,
    ].join('|');
    if (!map.has(key)) map.set(key, row);
  }

  return Array.from(map.values());
}

function vendaBateProduto(row: any, produto: ReturnType<typeof detectarProduto>) {
  const texto = normalizeProductText([row.descricao, row.familia].filter(Boolean).join(' '));
  if (produto.family) {
    const familiaVenda = getBaseModelFamily(texto) || normalizeProductText(row.familia || '');
    if (familiaVenda !== produto.family && !texto.includes(produto.family)) return false;
  } else if (produto.query && !texto.includes(normalizeProductText(produto.query))) {
    return false;
  }
  if (produto.storage && !texto.includes(produto.storage)) return false;
  if (produto.color) {
    const corVenda = extractColor(texto) || '';
    if (corVenda && corVenda !== produto.color) return false;
  }
  return true;
}

async function consultarVendasProduto(args: Record<string, any>, ctxTool: ClarkToolContext, produto: ReturnType<typeof detectarProduto>) {
  const db = await criarDbContext();
  try {
    const periodo = montarPeriodo(args);
    const filtros = montarFiltros(args);
    const scope = await obterEscopoUsuarioClark(ctxTool.userId);
    const rows = (await consultarVendasRaw(db, periodo))
      .filter((row) => rowPermitidaClark(row, scope))
      .filter((row) => rowCorrespondeLojaFiltroClark(row, filtros))
      .filter((row) => vendaBateProduto(row, produto));

    const lojasMap = new Map<string, any>();
    const vendedoresMap = new Map<string, any>();

    for (const row of rows) {
      const loja = resolverNomeLojaClark(row);
      const vendedor = String(row.nome_vendedor || 'Vendedor não informado').trim();
      const qtd = safeNumberClark(row.quantidade);
      const total = safeNumberClark(row.total_liquido);

      if (!lojasMap.has(loja)) {
        lojasMap.set(loja, { loja, total_vendas: 0, total_pecas: 0, registros: 0 });
      }
      const lojaItem = lojasMap.get(loja);
      lojaItem.total_vendas += total;
      lojaItem.total_pecas += qtd;
      lojaItem.registros += 1;

      const vendedorKey = `${vendedor}|${loja}`;
      if (!vendedoresMap.has(vendedorKey)) {
        vendedoresMap.set(vendedorKey, { vendedor, loja, total_vendas: 0, total_pecas: 0, registros: 0 });
      }
      const vendedorItem = vendedoresMap.get(vendedorKey);
      vendedorItem.total_vendas += total;
      vendedorItem.total_pecas += qtd;
      vendedorItem.registros += 1;
    }

    const lojas = Array.from(lojasMap.values())
      .map((item: any) => ({
        ...item,
        total_vendas_formatado: formatBRL(item.total_vendas),
        ticket_medio: item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ticket_medio_formatado: formatBRL(item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0),
      }))
      .sort((a, b) => b.total_pecas - a.total_pecas);

    const vendedores = Array.from(vendedoresMap.values())
      .map((item: any) => ({
        ...item,
        total_vendas_formatado: formatBRL(item.total_vendas),
      }))
      .sort((a, b) => b.total_vendas - a.total_vendas);

    const totalVendas = rows.reduce((acc, row) => acc + safeNumberClark(row.total_liquido), 0);
    const totalPecas = rows.reduce((acc, row) => acc + safeNumberClark(row.quantidade), 0);

    return {
      periodo,
      total_vendas: totalVendas,
      total_vendas_formatado: formatBRL(totalVendas),
      total_pecas: totalPecas,
      quantidade_registros: rows.length,
      ticket_medio: totalPecas > 0 ? totalVendas / totalPecas : 0,
      ticket_medio_formatado: formatBRL(totalPecas > 0 ? totalVendas / totalPecas : 0),
      lojas,
      vendedores: vendedores.slice(0, 50),
    };
  } finally {
    await fecharDbContext(db);
  }
}

function calcularDiasPeriodo(periodo: ClarkPeriodo) {
  const inicio = new Date(`${periodo.inicio}T00:00:00`);
  const fim = new Date(`${periodo.fim}T00:00:00`);
  const diff = Math.floor((fim.getTime() - inicio.getTime()) / 86400000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

function montarDiagnosticoProduto(estoque: any, vendas: any) {
  const dias = calcularDiasPeriodo(vendas.periodo);
  const mediaDiaria = vendas.total_pecas > 0 ? vendas.total_pecas / dias : 0;
  const coberturaDias = mediaDiaria > 0 ? estoque.total_estoque / mediaDiaria : null;

  const estoquePorLoja = new Map<string, number>();
  for (const loja of estoque.lojas || []) {
    estoquePorLoja.set(loja.loja, safeNumberClark(loja.quantidade_total));
  }

  const vendasPorLoja = new Map<string, any>();
  for (const loja of vendas.lojas || []) {
    vendasPorLoja.set(loja.loja, loja);
  }

  const lojasComPossivelExcesso = Array.from(estoquePorLoja.entries())
    .map(([loja, qtd]) => {
      const venda = vendasPorLoja.get(loja);
      const pecasVendidas = safeNumberClark(venda?.total_pecas);
      const mediaLoja = pecasVendidas > 0 ? pecasVendidas / dias : 0;
      const cobertura = mediaLoja > 0 ? qtd / mediaLoja : null;
      return {
        loja,
        estoque: qtd,
        vendas_periodo: pecasVendidas,
        cobertura_dias: cobertura,
        motivo: pecasVendidas <= 0 ? 'tem estoque, mas não vendeu no período' : 'cobertura alta no período analisado',
      };
    })
    .filter((item) => item.estoque > 0 && (item.vendas_periodo <= 0 || (item.cobertura_dias !== null && item.cobertura_dias > 45)))
    .sort((a, b) => b.estoque - a.estoque)
    .slice(0, 20);

  const lojasComRiscoRuptura = Array.from(vendasPorLoja.values())
    .map((loja: any) => {
      const estoqueLoja = estoquePorLoja.get(loja.loja) || 0;
      return {
        loja: loja.loja,
        estoque: estoqueLoja,
        vendas_periodo: safeNumberClark(loja.total_pecas),
        motivo: estoqueLoja <= 0 ? 'vendeu no período e está sem estoque' : 'estoque baixo frente à venda do período',
      };
    })
    .filter((item) => item.vendas_periodo > 0 && item.estoque <= Math.max(2, Math.ceil(item.vendas_periodo * 0.25)))
    .sort((a, b) => b.vendas_periodo - a.vendas_periodo)
    .slice(0, 20);

  const sugestoesRedistribuicao = lojasComRiscoRuptura.slice(0, 10).map((destino) => {
    const origem = lojasComPossivelExcesso.find((item) => item.loja !== destino.loja && item.estoque >= 3);
    if (!origem) return null;
    const quantidade_sugerida = Math.min(
      Math.max(1, Math.floor(origem.estoque * 0.2)),
      Math.max(1, destino.vendas_periodo),
      10,
    );
    return {
      origem: origem.loja,
      destino: destino.loja,
      quantidade_sugerida,
      motivo: `origem com ${origem.estoque} un. e destino com venda de ${destino.vendas_periodo} un. no período`,
    };
  }).filter(Boolean);

  const alertas = [];
  if (estoque.total_estoque > 0 && vendas.total_pecas <= 0) {
    alertas.push('Produto com estoque disponível, mas sem venda no período analisado.');
  }
  if (lojasComRiscoRuptura.length) {
    alertas.push(`${lojasComRiscoRuptura.length} loja(s) com possível risco de ruptura.`);
  }
  if (lojasComPossivelExcesso.length) {
    alertas.push(`${lojasComPossivelExcesso.length} loja(s) com possível excesso de estoque.`);
  }

  const recomendacoes = [];
  if (sugestoesRedistribuicao.length) {
    recomendacoes.push('Avaliar redistribuição entre lojas com excesso e lojas com venda recente/baixo estoque.');
  }
  if (coberturaDias !== null && coberturaDias > 45) {
    recomendacoes.push('A cobertura geral está alta para o período analisado; acompanhar giro e campanhas.');
  }
  if (coberturaDias !== null && coberturaDias < 10 && estoque.total_estoque > 0) {
    recomendacoes.push('A cobertura geral está baixa; avaliar reposição.');
  }
  if (!recomendacoes.length) {
    recomendacoes.push('Acompanhar vendas por loja e manter monitoramento de cobertura por variação.');
  }

  return {
    dias_periodo: dias,
    media_diaria_pecas: mediaDiaria,
    cobertura_dias: coberturaDias,
    alertas,
    lojas_com_possivel_excesso: lojasComPossivelExcesso,
    lojas_com_risco_ruptura: lojasComRiscoRuptura,
    sugestoes_redistribuicao: sugestoesRedistribuicao,
    recomendacoes,
  };
}

export async function toolConsultarAnaliseProdutoComercial(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const estoque = await consultarEstoqueProduto(args, ctx);
    const produto = detectarProduto(args);
    const vendas = await consultarVendasProduto(args, ctx, produto);
    const diagnostico = montarDiagnosticoProduto(estoque, vendas);

    return {
      tool: 'consultar_analise_produto_comercial',
      ok: true,
      args,
      result: {
        tipo: 'analise_produto_comercial',
        produto,
        periodo: vendas.periodo,
        estoque,
        vendas,
        diagnostico,
      },
    };
  } catch (error: any) {
    return {
      tool: 'consultar_analise_produto_comercial',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao analisar produto comercialmente.',
    };
  }
}

export async function toolConsultarVendasVsEstoque(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const estoque = await consultarEstoqueProduto(args, ctx);
    const produto = detectarProduto(args);
    const vendas = await consultarVendasProduto(args, ctx, produto);
    const diagnostico = montarDiagnosticoProduto(estoque, vendas);

    return {
      tool: 'consultar_vendas_vs_estoque',
      ok: true,
      args,
      result: {
        tipo: 'vendas_vs_estoque',
        produto,
        periodo: vendas.periodo,
        estoque,
        vendas,
        diagnostico,
      },
    };
  } catch (error: any) {
    return {
      tool: 'consultar_vendas_vs_estoque',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao cruzar vendas e estoque.',
    };
  }
}

export async function toolConsultarRiscoStockout(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const base = await toolConsultarVendasVsEstoque(args, ctx);
    if (!base.ok) return { ...base, tool: 'consultar_risco_stockout' };
    return {
      tool: 'consultar_risco_stockout',
      ok: true,
      args,
      result: {
        tipo: 'risco_stockout',
        produto: base.result.produto,
        periodo: base.result.periodo,
        lojas_com_risco_ruptura: base.result.diagnostico.lojas_com_risco_ruptura,
        diagnostico: base.result.diagnostico,
      },
    };
  } catch (error: any) {
    return { tool: 'consultar_risco_stockout', ok: false, args, result: null, error: error?.message || 'Erro ao consultar risco de ruptura.' };
  }
}

export async function toolConsultarExcessoEstoque(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const base = await toolConsultarVendasVsEstoque(args, ctx);
    if (!base.ok) return { ...base, tool: 'consultar_excesso_estoque' };
    return {
      tool: 'consultar_excesso_estoque',
      ok: true,
      args,
      result: {
        tipo: 'excesso_estoque',
        produto: base.result.produto,
        periodo: base.result.periodo,
        lojas_com_possivel_excesso: base.result.diagnostico.lojas_com_possivel_excesso,
        diagnostico: base.result.diagnostico,
      },
    };
  } catch (error: any) {
    return { tool: 'consultar_excesso_estoque', ok: false, args, result: null, error: error?.message || 'Erro ao consultar excesso de estoque.' };
  }
}

export async function toolConsultarRedistribuicaoEstoque(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const base = await toolConsultarVendasVsEstoque(args, ctx);
    if (!base.ok) return { ...base, tool: 'consultar_redistribuicao_estoque' };
    return {
      tool: 'consultar_redistribuicao_estoque',
      ok: true,
      args,
      result: {
        tipo: 'redistribuicao_estoque',
        produto: base.result.produto,
        periodo: base.result.periodo,
        sugestoes_redistribuicao: base.result.diagnostico.sugestoes_redistribuicao,
        lojas_com_possivel_excesso: base.result.diagnostico.lojas_com_possivel_excesso,
        lojas_com_risco_ruptura: base.result.diagnostico.lojas_com_risco_ruptura,
        diagnostico: base.result.diagnostico,
      },
    };
  } catch (error: any) {
    return { tool: 'consultar_redistribuicao_estoque', ok: false, args, result: null, error: error?.message || 'Erro ao sugerir redistribuição.' };
  }
}

export async function toolConsultarModoDiretoria(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  const db = await criarDbContext();

  try {
    const periodo = montarPeriodo(args);
    const filtros = montarFiltros(args);
    const scope = await obterEscopoUsuarioClark(ctx.userId);

    const vendasRows = (await consultarVendasRaw(db, periodo))
      .filter((row) => rowPermitidaClark(row, scope))
      .filter((row) => rowCorrespondeLojaFiltroClark(row, filtros));

    const totalVendas = vendasRows.reduce((acc, row) => acc + safeNumberClark(row.total_liquido), 0);
    const totalPecas = vendasRows.reduce((acc, row) => acc + safeNumberClark(row.quantidade), 0);

    const lojasVendasMap = new Map<string, any>();
    for (const row of vendasRows) {
      const loja = resolverNomeLojaClark(row);
      if (!lojasVendasMap.has(loja)) lojasVendasMap.set(loja, { loja, total_vendas: 0, total_pecas: 0, registros: 0 });
      const item = lojasVendasMap.get(loja);
      item.total_vendas += safeNumberClark(row.total_liquido);
      item.total_pecas += safeNumberClark(row.quantidade);
      item.registros += 1;
    }

    const topLojasVendas = Array.from(lojasVendasMap.values())
      .map((item: any) => ({
        ...item,
        total_vendas_formatado: formatBRL(item.total_vendas),
      }))
      .sort((a, b) => b.total_vendas - a.total_vendas)
      .slice(0, 10);

    const estoqueRows = await prisma.stock.findMany({
      where: { quantity: { gt: 0 } },
      orderBy: { quantity: 'desc' },
    });

    const estoquePermitido = (estoqueRows as any[]).filter((row) => rowPermitidaClark(row, scope));
    const estoqueTotal = estoquePermitido.reduce((acc, row) => acc + safeNumberClark(row.quantity), 0);

    const produtosMap = new Map<string, any>();
    for (const row of estoquePermitido) {
      const produto = limparDescricaoProduto(row.description || row.reference || row.productCode || 'Produto não informado');
      if (!produtosMap.has(produto)) produtosMap.set(produto, { produto, estoque: 0, lojas: new Set<string>() });
      const item = produtosMap.get(produto);
      item.estoque += safeNumberClark(row.quantity);
      item.lojas.add(String(row.storeName || 'Loja não informada'));
    }

    const topProdutosEstoque = Array.from(produtosMap.values())
      .map((item: any) => ({ produto: item.produto, estoque: item.estoque, total_lojas: item.lojas.size }))
      .sort((a, b) => b.estoque - a.estoque)
      .slice(0, 15);

    const alertas = [];
    if (!vendasRows.length) alertas.push('Não foram encontradas vendas no período analisado.');
    if (estoqueTotal > 0 && totalPecas <= 0) alertas.push('Há estoque disponível, mas não foram encontradas vendas no período.');
    if (topProdutosEstoque.length) alertas.push(`Maior concentração de estoque: ${topProdutosEstoque[0]?.produto} com ${topProdutosEstoque[0]?.estoque} un.`);

    return {
      tool: 'consultar_modo_diretoria',
      ok: true,
      args,
      result: {
        tipo: 'modo_diretoria',
        periodo,
        resumo: {
          total_vendas: totalVendas,
          total_vendas_formatado: formatBRL(totalVendas),
          total_pecas: totalPecas,
          estoque_total: estoqueTotal,
          lojas_com_venda: lojasVendasMap.size,
          produtos_em_estoque: produtosMap.size,
        },
        top_lojas_vendas: topLojasVendas,
        top_produtos_estoque: topProdutosEstoque,
        alertas,
        recomendacoes: [
          'Avaliar concentração dos produtos com maior estoque.',
          'Cruzar produtos de maior estoque com giro de vendas antes de novas compras.',
          'Monitorar lojas com venda alta e estoque baixo nos produtos estratégicos.',
        ],
      },
    };
  } catch (error: any) {
    return {
      tool: 'consultar_modo_diretoria',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao gerar modo diretoria.',
    };
  } finally {
    await fecharDbContext(db);
  }
}
