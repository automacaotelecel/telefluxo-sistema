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

function deduplicarPorChave(rows: any[]) {
  const map = new Map<string, any>();

  for (const row of rows) {
    const chave = [
      row.origem || '',
      row.data_emissao || '',
      row.cnpj_empresa || '',
      row.loja || '',
      row.nome_vendedor || '',
      row.descricao || '',
      row.familia || '',
      row.quantidade || '',
      row.total_liquido || '',
    ].join('|');

    if (!map.has(chave)) {
      map.set(chave, row);
    }
  }

  return Array.from(map.values());
}

async function consultarVendasAnuaisRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo
) {
  if (!ctx.annualDb) return [];

  try {
    const rows = await ctx.annualDb.all(
      `
        SELECT
          'anual' AS origem,
          data_emissao,
          ano,
          mes,
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
      [periodo.inicio, periodo.fim]
    );

    return rows || [];
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas_anuais:', error);
    return [];
  }
}

async function consultarVendasGlobaisRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo
) {
  if (!ctx.globalDb) return [];

  try {
    const rows = await ctx.globalDb.all(
      `
        SELECT
          'global' AS origem,
          data_emissao,
          NULL AS ano,
          NULL AS mes,
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
      [periodo.inicio, periodo.fim]
    );

    return rows || [];
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas globais:', error);
    return [];
  }
}

async function consultarVendasRawClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const [anuais, globais] = await Promise.all([
    consultarVendasAnuaisRaw(ctx, periodo),
    consultarVendasGlobaisRaw(ctx, periodo),
  ]);

  let rows = anuais;

  if (!rows.length && globais.length) {
    rows = globais;
  }

  if (rows.length && globais.length && periodo.descricao.includes('Hoje')) {
    rows = globais;
  }

  const filtradas = deduplicarPorChave(rows)
    .filter((row) => rowPermitidaClark(row, scope))
    .filter((row) => rowCorrespondeLojaFiltroClark(row, filtros));

  return filtradas;
}

export async function consultarResumoVendasPeriodoClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarVendasRawClark(ctx, periodo, scope, filtros);

  const totalVendas = rows.reduce(
    (acc, row) => acc + safeNumberClark(row.total_liquido),
    0
  );

  const totalPecas = rows.reduce(
    (acc, row) => acc + safeNumberClark(row.quantidade),
    0
  );

  const lojasMap = new Map<string, any>();

  for (const row of rows) {
    const loja = resolverNomeLojaClark(row);
    const key = loja;

    if (!lojasMap.has(key)) {
      lojasMap.set(key, {
        loja,
        cnpj_empresa: row.cnpj_empresa || null,
        regiao: row.regiao || null,
        total_vendas: 0,
        total_pecas: 0,
        vendas: 0,
      });
    }

    const atual = lojasMap.get(key);

    atual.total_vendas += safeNumberClark(row.total_liquido);
    atual.total_pecas += safeNumberClark(row.quantidade);
    atual.vendas += 1;
  }

  const lojas = Array.from(lojasMap.values())
    .map((item) => ({
      ...item,
      total_vendas_formatado: formatBRL(item.total_vendas),
      ticket_medio:
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ticket_medio_formatado: formatBRL(
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0
      ),
    }))
    .sort((a, b) => b.total_vendas - a.total_vendas);

  return {
    modulo: 'vendas',
    tipo: 'resumo_periodo',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    total_vendas: totalVendas,
    total_vendas_formatado: formatBRL(totalVendas),
    total_pecas: totalPecas,
    quantidade_registros: rows.length,
    ticket_medio: totalPecas > 0 ? totalVendas / totalPecas : 0,
    ticket_medio_formatado: formatBRL(totalPecas > 0 ? totalVendas / totalPecas : 0),
    lojas_analisadas: lojas.length,
    lojas,
  };
}

export async function consultarRankingLojasVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const resumo = await consultarResumoVendasPeriodoClark(
    ctx,
    periodo,
    scope,
    filtros
  );

  const ranking = resumo.lojas
    .slice(0, filtros.limite)
    .map((item: any, index: number) => ({
      posicao: index + 1,
      loja: item.loja,
      cnpj_empresa: item.cnpj_empresa,
      regiao: item.regiao,
      total_vendas: item.total_vendas,
      total_vendas_formatado: item.total_vendas_formatado,
      total_pecas: item.total_pecas,
      vendas: item.vendas,
      ticket_medio: item.ticket_medio,
      ticket_medio_formatado: item.ticket_medio_formatado,
    }));

  return {
    modulo: 'vendas',
    tipo: 'ranking_lojas',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarRankingVendedoresVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarVendasRawClark(ctx, periodo, scope, filtros);

  const map = new Map<string, any>();

  for (const row of rows) {
    const vendedor = String(row.nome_vendedor || 'Vendedor não identificado').trim();
    const loja = resolverNomeLojaClark(row);
    const key = `${vendedor}|${loja}`;

    if (!map.has(key)) {
      map.set(key, {
        vendedor,
        loja,
        regiao: row.regiao || null,
        total_vendas: 0,
        total_pecas: 0,
        vendas: 0,
      });
    }

    const atual = map.get(key);

    atual.total_vendas += safeNumberClark(row.total_liquido);
    atual.total_pecas += safeNumberClark(row.quantidade);
    atual.vendas += 1;
  }

  const ranking = Array.from(map.values())
    .map((item) => ({
      ...item,
      total_vendas_formatado: formatBRL(item.total_vendas),
      ticket_medio:
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ticket_medio_formatado: formatBRL(
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0
      ),
    }))
    .sort((a, b) => b.total_vendas - a.total_vendas)
    .slice(0, filtros.limite)
    .map((item, index) => ({
      posicao: index + 1,
      ...item,
    }));

  return {
    modulo: 'vendas',
    tipo: 'ranking_vendedores',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarCategoriasVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarVendasRawClark(ctx, periodo, scope, filtros);

  const categoriasMap = new Map<string, any>();

  for (const row of rows) {
    const categoria = String(
      row.familia || row.categoria || 'SEM CATEGORIA'
    ).trim();

    if (!categoriasMap.has(categoria)) {
      categoriasMap.set(categoria, {
        categoria,
        total_vendas: 0,
        total_pecas: 0,
        vendas: 0,
        lojas: new Map<string, number>(),
      });
    }

    const atual = categoriasMap.get(categoria);

    atual.total_vendas += safeNumberClark(row.total_liquido);
    atual.total_pecas += safeNumberClark(row.quantidade);
    atual.vendas += 1;

    const loja = resolverNomeLojaClark(row);
    atual.lojas.set(
      loja,
      (atual.lojas.get(loja) || 0) + safeNumberClark(row.total_liquido)
    );
  }

  const ranking = Array.from(categoriasMap.values())
    .sort((a, b) => b.total_vendas - a.total_vendas)
    .slice(0, filtros.limite)
    .map((item, index) => {
      const principaisLojas = Array.from(
        (item.lojas as Map<string, number>).entries()
      )
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 8)
        .map(([loja, total]) => ({
          loja,
          total_vendas: total,
          total_vendas_formatado: formatBRL(total),
        }));

      return {
        posicao: index + 1,
        categoria: item.categoria,
        total_vendas: item.total_vendas,
        total_vendas_formatado: formatBRL(item.total_vendas),
        total_pecas: item.total_pecas,
        vendas: item.vendas,
        ticket_medio:
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ticket_medio_formatado: formatBRL(
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0
        ),
        principais_lojas: principaisLojas,
      };
    });

  return {
    modulo: 'vendas',
    tipo: 'ranking_categorias',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarVendasMensaisClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  const rows = await consultarVendasRawClark(ctx, periodo, scope, filtros);

  const mapa = new Map<string, any>();

  for (const row of rows) {
    const data = String(row.data_emissao || '');

    if (!/^\d{4}-\d{2}-\d{2}/.test(data)) continue;

    const chave = data.slice(0, 7);

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        mes: chave,
        total_vendas: 0,
        total_pecas: 0,
        vendas: 0,
        lojas: new Map<string, any>(),
      });
    }

    const atual = mapa.get(chave);

    atual.total_vendas += safeNumberClark(row.total_liquido);
    atual.total_pecas += safeNumberClark(row.quantidade);
    atual.vendas += 1;

    const loja = resolverNomeLojaClark(row);

    if (!atual.lojas.has(loja)) {
      atual.lojas.set(loja, {
        loja,
        total_vendas: 0,
        total_pecas: 0,
        vendas: 0,
      });
    }

    const lojaAtual = atual.lojas.get(loja);

    lojaAtual.total_vendas += safeNumberClark(row.total_liquido);
    lojaAtual.total_pecas += safeNumberClark(row.quantidade);
    lojaAtual.vendas += 1;
  }

  return Array.from(mapa.values())
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)))
    .map((item) => {
      const lojas = Array.from((item.lojas as Map<string, any>).values())
        .map((loja: any) => ({
          ...loja,
          total_vendas_formatado: formatBRL(loja.total_vendas),
        }))
        .sort((a, b) => b.total_vendas - a.total_vendas);

      return {
        mes: item.mes,
        total_vendas: item.total_vendas,
        total_vendas_formatado: formatBRL(item.total_vendas),
        total_pecas: item.total_pecas,
        vendas: item.vendas,
        ticket_medio:
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ticket_medio_formatado: formatBRL(
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0
        ),
        lojas,
      };
    });
}