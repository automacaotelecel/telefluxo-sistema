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

type VendaClarkRow = {
  origem: string;
  data_emissao: string | null;
  ano: number | null;
  mes: number | null;
  loja: string | null;
  cnpj_empresa: string | null;
  nome_vendedor: string | null;
  descricao: string | null;
  familia: string | null;
  categoria?: string | null;
  regiao: string | null;
  quantidade: number;
  total_liquido: number;
};

function normalizarDataClark(value: any): string | null {
  const raw = String(value ?? '').trim();

  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  const brTracejado = raw.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (brTracejado) {
    return `${brTracejado[3]}-${brTracejado[2]}-${brTracejado[1]}`;
  }

  const n = Number(raw);

  if (Number.isFinite(n) && n > 20000 && n < 90000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + n);

    const y = excelEpoch.getUTCFullYear();
    const m = String(excelEpoch.getUTCMonth() + 1).padStart(2, '0');
    const d = String(excelEpoch.getUTCDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
  }

  return null;
}

function periodoInicioFim(periodo: ClarkPeriodo) {
  const inicio = normalizarDataClark(periodo?.inicio);
  const fim = normalizarDataClark(periodo?.fim);

  return {
    inicio,
    fim,
  };
}

function rowDentroPeriodo(row: VendaClarkRow, periodo: ClarkPeriodo) {
  const data = normalizarDataClark(row.data_emissao);
  const { inicio, fim } = periodoInicioFim(periodo);

  if (!data) return false;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
}

function deduplicarPorChave(rows: VendaClarkRow[]) {
  const map = new Map<string, VendaClarkRow>();

  for (const row of rows) {
    const data = normalizarDataClark(row.data_emissao) || '';

    const chave = [
      data,
      row.cnpj_empresa || '',
      row.loja || '',
      row.nome_vendedor || '',
      row.descricao || '',
      row.familia || '',
      row.categoria || '',
      row.quantidade || '',
      row.total_liquido || '',
    ].join('|');

    if (!map.has(chave)) {
      map.set(chave, row);
    }
  }

  return Array.from(map.values());
}

async function tabelaExiste(db: any, nome: string): Promise<boolean> {
  if (!db) return false;

  try {
    const row = await db.get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      [nome],
    );

    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function normalizarRow(row: any, origem: string): VendaClarkRow {
  const dataNormalizada = normalizarDataClark(row?.data_emissao);

  return {
    origem,
    data_emissao: dataNormalizada || row?.data_emissao || null,
    ano: row?.ano !== undefined && row?.ano !== null ? Number(row.ano) : null,
    mes: row?.mes !== undefined && row?.mes !== null ? Number(row.mes) : null,
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

async function consultarVendasDetalhadasRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
): Promise<VendaClarkRow[]> {
  if (!ctx.globalDb) return [];

  const existe = await tabelaExiste(ctx.globalDb, 'vendas_detalhadas_imei');
  if (!existe) return [];

  try {
    const rows = await ctx.globalDb.all(
      `
        SELECT
          data_emissao,
          nome_fantasia AS loja,
          cnpj_empresa,
          nome_vendedor,
          descricao,
          categoria,
          categoria AS familia,
          regiao,
          quantidade,
          total_liquido
        FROM vendas_detalhadas_imei
      `,
    );

    return (rows || [])
      .map((row: any) => normalizarRow(row, 'vendas_detalhadas_imei'))
      .filter((row: VendaClarkRow) => rowDentroPeriodo(row, periodo));
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas_detalhadas_imei:', error);
    return [];
  }
}

async function consultarVendasAnuaisRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
): Promise<VendaClarkRow[]> {
  if (!ctx.annualDb) return [];

  const existe = await tabelaExiste(ctx.annualDb, 'vendas_anuais');
  if (!existe) return [];

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
          familia,
          familia AS categoria,
          regiao,
          quantidade,
          total_liquido
        FROM vendas_anuais
      `,
    );

    return (rows || [])
      .map((row: any) => normalizarRow(row, 'vendas_anuais'))
      .filter((row: VendaClarkRow) => rowDentroPeriodo(row, periodo));
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas_anuais:', error);
    return [];
  }
}

async function consultarVendasAnuaisNoBancoGlobalRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
): Promise<VendaClarkRow[]> {
  if (!ctx.globalDb) return [];

  const existe = await tabelaExiste(ctx.globalDb, 'vendas_anuais');
  if (!existe) return [];

  try {
    const rows = await ctx.globalDb.all(
      `
        SELECT
          data_emissao,
          ano,
          mes,
          loja,
          cnpj_empresa,
          nome_vendedor,
          descricao,
          familia,
          familia AS categoria,
          regiao,
          quantidade,
          total_liquido
        FROM vendas_anuais
      `,
    );

    return (rows || [])
      .map((row: any) => normalizarRow(row, 'vendas_anuais_global'))
      .filter((row: VendaClarkRow) => rowDentroPeriodo(row, periodo));
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas_anuais no banco global:', error);
    return [];
  }
}

async function consultarVendasGlobaisRaw(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
): Promise<VendaClarkRow[]> {
  if (!ctx.globalDb) return [];

  const existe = await tabelaExiste(ctx.globalDb, 'vendas');
  if (!existe) return [];

  try {
    const rows = await ctx.globalDb.all(
      `
        SELECT
          data_emissao,
          NULL AS ano,
          NULL AS mes,
          NULL AS loja,
          cnpj_empresa,
          nome_vendedor,
          descricao,
          familia,
          familia AS categoria,
          regiao,
          quantidade,
          total_liquido
        FROM vendas
      `,
    );

    return (rows || [])
      .map((row: any) => normalizarRow(row, 'vendas'))
      .filter((row: VendaClarkRow) => rowDentroPeriodo(row, periodo));
  } catch (error) {
    console.warn('⚠️ Clark não conseguiu ler vendas globais:', error);
    return [];
  }
}

async function consultarVendasRawClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros,
) {
  const [
    detalhadas,
    anuaisSeparado,
    anuaisGlobal,
    globais,
  ] = await Promise.all([
    consultarVendasDetalhadasRaw(ctx, periodo),
    consultarVendasAnuaisRaw(ctx, periodo),
    consultarVendasAnuaisNoBancoGlobalRaw(ctx, periodo),
    consultarVendasGlobaisRaw(ctx, periodo),
  ]);

  let fonte = 'nenhuma';
  let rows: VendaClarkRow[] = [];

  if (detalhadas.length) {
    fonte = 'vendas_detalhadas_imei';
    rows = detalhadas;
  } else if (anuaisSeparado.length) {
    fonte = 'vendas_anuais';
    rows = anuaisSeparado;
  } else if (anuaisGlobal.length) {
    fonte = 'vendas_anuais_global';
    rows = anuaisGlobal;
  } else if (globais.length) {
    fonte = 'vendas';
    rows = globais;
  }

  const filtradas = deduplicarPorChave(rows)
    .filter((row) => rowPermitidaClark(row, scope))
    .filter((row) => rowCorrespondeLojaFiltroClark(row, filtros));

  return {
    fonte,
    rows: filtradas,
    debug: {
      periodo,
      fonte_escolhida: fonte,
      total_detalhadas: detalhadas.length,
      total_anuais_separado: anuaisSeparado.length,
      total_anuais_global: anuaisGlobal.length,
      total_vendas_global: globais.length,
      total_apos_filtro: filtradas.length,
    },
  };
}

export async function consultarResumoVendasPeriodoClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros,
) {
  const consulta = await consultarVendasRawClark(ctx, periodo, scope, filtros);
  const rows = consulta.rows;

  const totalVendas = rows.reduce(
    (acc, row) => acc + safeNumberClark(row.total_liquido),
    0,
  );

  const totalPecas = rows.reduce(
    (acc, row) => acc + safeNumberClark(row.quantidade),
    0,
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
      ticket_medio: item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ticket_medio_formatado: formatBRL(
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ),
    }))
    .sort((a, b) => b.total_vendas - a.total_vendas);

  return {
    modulo: 'vendas',
    tipo: 'resumo_periodo',
    periodo,
    fonte_dados: consulta.fonte,
    debug: consulta.debug,
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
  filtros: ClarkFiltros,
) {
  const resumo = await consultarResumoVendasPeriodoClark(
    ctx,
    periodo,
    scope,
    filtros,
  );

  const limite =
    Number.isFinite(Number(filtros.limite)) && Number(filtros.limite) > 0
      ? Number(filtros.limite)
      : 1000;

  const ranking = resumo.lojas
    .slice(0, limite)
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
    fonte_dados: resumo.fonte_dados,
    debug: resumo.debug,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarRankingVendedoresVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros,
) {
  const consulta = await consultarVendasRawClark(ctx, periodo, scope, filtros);
  const rows = consulta.rows;

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

  const limite =
    Number.isFinite(Number(filtros.limite)) && Number(filtros.limite) > 0
      ? Number(filtros.limite)
      : 1000;

  const ranking = Array.from(map.values())
    .map((item) => ({
      ...item,
      total_vendas_formatado: formatBRL(item.total_vendas),
      ticket_medio: item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ticket_medio_formatado: formatBRL(
        item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
      ),
    }))
    .sort((a, b) => b.total_vendas - a.total_vendas)
    .slice(0, limite)
    .map((item, index) => ({
      posicao: index + 1,
      ...item,
    }));

  return {
    modulo: 'vendas',
    tipo: 'ranking_vendedores',
    periodo,
    fonte_dados: consulta.fonte,
    debug: consulta.debug,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarCategoriasVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros,
) {
  const consulta = await consultarVendasRawClark(ctx, periodo, scope, filtros);
  const rows = consulta.rows;

  const categoriasMap = new Map<string, any>();

  for (const row of rows) {
    const categoria = String(
      row.familia || row.categoria || 'SEM CATEGORIA',
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
      (atual.lojas.get(loja) || 0) + safeNumberClark(row.total_liquido),
    );
  }

  const limite =
    Number.isFinite(Number(filtros.limite)) && Number(filtros.limite) > 0
      ? Number(filtros.limite)
      : 1000;

  const ranking = Array.from(categoriasMap.values())
    .sort((a, b) => b.total_vendas - a.total_vendas)
    .slice(0, limite)
    .map((item, index) => {
      const principaisLojas = Array.from(
        (item.lojas as Map<string, number>).entries(),
      )
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 30)
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
        ticket_medio: item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ticket_medio_formatado: formatBRL(
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ),
        principais_lojas: principaisLojas,
      };
    });

  return {
    modulo: 'vendas',
    tipo: 'ranking_categorias',
    periodo,
    fonte_dados: consulta.fonte,
    debug: consulta.debug,
    filtro_loja: filtros.lojaCanonica || null,
    ranking,
  };
}

export async function consultarVendasMensaisClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros,
) {
  const consulta = await consultarVendasRawClark(ctx, periodo, scope, filtros);
  const rows = consulta.rows;

  const mapa = new Map<string, any>();

  for (const row of rows) {
    const data = normalizarDataClark(row.data_emissao);

    if (!data) continue;

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
        ticket_medio: item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ticket_medio_formatado: formatBRL(
          item.total_pecas > 0 ? item.total_vendas / item.total_pecas : 0,
        ),
        lojas,
      };
    });
}