import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { ClarkDbContext, ClarkFiltros, ClarkPeriodo } from '../clark.types';
import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

import { extrairFiltrosClark } from '../../intent/extractFilters';
import { extrairPeriodoClark } from '../../intent/extractPeriod';
import { obterEscopoUsuarioClark } from '../../security/clarkScope';

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
