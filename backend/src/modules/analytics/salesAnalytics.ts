import {
  ClarkDbContext,
  ClarkFiltros,
  ClarkPeriodo,
  ClarkUserScope,
} from '../clark/clark.types';

import {
  consultarCategoriasVendasClark,
  consultarRankingLojasVendasClark,
  consultarResumoVendasPeriodoClark,
  consultarVendasMensaisClark,
} from '../executors/sales.executor';

import { calcularCrescimentoMensalClark, prepararComparacaoMensalClark } from './growth';

export async function consultarRelatorioAnaliticoVendasClark(
  ctx: ClarkDbContext,
  periodo: ClarkPeriodo,
  scope: ClarkUserScope,
  filtros: ClarkFiltros
) {
  // Mês parcial é comparado com os mesmos dias do mês anterior (MTD vs MTD).
  const comparacao = prepararComparacaoMensalClark(periodo);

  const [resumo, lojas, categorias, mensal] = await Promise.all([
    consultarResumoVendasPeriodoClark(ctx, periodo, scope, filtros),
    consultarRankingLojasVendasClark(ctx, periodo, scope, {
      ...filtros,
      limite: 999,
    }),
    consultarCategoriasVendasClark(ctx, periodo, scope, {
      ...filtros,
      limite: 999,
    }),
    consultarVendasMensaisClark(ctx, periodo, scope, filtros, comparacao.diaCorte ?? undefined),
  ]);

  const crescimentoMensal = calcularCrescimentoMensalClark(mensal, comparacao);

  return {
    modulo: 'vendas',
    tipo: 'relatorio_analitico_vendas',
    periodo,
    filtro_loja: filtros.lojaCanonica || null,
    resumo,
    lojas: lojas.ranking,
    categorias: categorias.ranking,
    mensal,
    crescimento_mensal: crescimentoMensal,
  };
}