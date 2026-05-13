import {
  ClarkDbContext,
  ClarkFiltros,
  ClarkPeriodo,
  ClarkUserScope,
} from '../clark/clark.types';

import {
  formatBRL,
  resolverNomeLojaClark,
  safeNumberClark,
} from '../intent/extractFilters';

import {
  rowCorrespondeLojaFiltroClark,
  rowPermitidaClark,
} from '../security/clarkScope';

async function consultarSegurosRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  if (!ctx.annualDb) return [];

  try {
    const rows = await ctx.annualDb.all(
      `
        SELECT
          data_emissao,
          ano,
          mes,
          loja,
          cnpj_empresa,
          nome_vendedor,
          descricao,
          regiao,
          qtd,
          premio,
          nf
        FROM seguros_anuais
        WHERE data_emissao >= ?
          AND data_emissao <= ?
      `,
      [periodo.inicio, periodo.fim]
    );

    return (rows || [])
      .filter((row: any) => rowPermitidaClark(row, scope))
      .filter((row: any) => rowCorrespondeLojaFiltroClark(row, filtros));
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler seguros_anuais:', error);
    return [];
  }
}

export async function consultarRankingVendedoresSegurosClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarSegurosRaw(ctx, periodo, scope, filtros);
  const map = new Map<string, any>();

  for (const row of rows) {
    const vendedor = row.nome_vendedor || 'Vendedor não identificado';
    const loja = resolverNomeLojaClark(row);
    const key = `${vendedor}|${loja}`;

    if (!map.has(key)) {
      map.set(key, {
        vendedor,
        loja,
        regiao: row.regiao,
        seguros_total: 0,
        seguros_qtd: 0,
      });
    }

    const atual = map.get(key);

    atual.seguros_total += safeNumberClark(row.premio);
    atual.seguros_qtd += safeNumberClark(row.qtd);
  }

  const ranking = Array.from(map.values())
    .map((item) => ({
      ...item,
      seguros_total_formatado: formatBRL(item.seguros_total),
    }))
    .sort((a, b) => b.seguros_total - a.seguros_total)
    .slice(0, filtros.limite)
    .map((item, index) => ({
      posicao: index + 1,
      ...item,
    }));

  return {
    modulo: 'seguros',
    tipo: 'ranking_vendedores_seguros',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarRankingLojasSegurosClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarSegurosRaw(ctx, periodo, scope, filtros);
  const map = new Map<string, any>();

  for (const row of rows) {
    const loja = resolverNomeLojaClark(row);
    const key = loja;

    if (!map.has(key)) {
      map.set(key, {
        loja,
        cnpj_empresa: row.cnpj_empresa,
        regiao: row.regiao,
        seguros_total: 0,
        seguros_qtd: 0,
      });
    }

    const atual = map.get(key);

    atual.seguros_total += safeNumberClark(row.premio);
    atual.seguros_qtd += safeNumberClark(row.qtd);
  }

  const ranking = Array.from(map.values())
    .map((item) => ({
      ...item,
      seguros_total_formatado: formatBRL(item.seguros_total),
    }))
    .sort((a, b) => b.seguros_total - a.seguros_total)
    .slice(0, filtros.limite)
    .map((item, index) => ({
      posicao: index + 1,
      ...item,
    }));

  return {
    modulo: 'seguros',
    tipo: 'ranking_lojas_seguros',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}