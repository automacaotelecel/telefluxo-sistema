import { ClarkToolRegistry } from './clarkTools.types';

import {
  toolConsultarEstoqueProduto,
  toolConsultarRankingEstoque,
  toolResolverProduto,
} from './stock.tools';

import {
  toolConsultarCrescimentoMensal,
  toolConsultarRelatorioVendas,
  toolConsultarSegurosPorLoja,
  toolConsultarSegurosPorVendedor,
  toolConsultarVendasPorCategoria,
  toolConsultarVendasPorLoja,
  toolConsultarVendasPorVendedor,
  toolConsultarVendasResumo,
} from './sales.tools';

import { toolExecutarSqlAnalitico } from './sql.tools';
import { toolGerarRelatorioExecutivo } from './report.tools';

export const clarkToolsRegistry: ClarkToolRegistry = {
  resolver_produto: toolResolverProduto,
  consultar_estoque_produto: toolConsultarEstoqueProduto,
  consultar_ranking_estoque: toolConsultarRankingEstoque,

  consultar_vendas_resumo: toolConsultarVendasResumo,
  consultar_vendas_por_loja: toolConsultarVendasPorLoja,
  consultar_vendas_por_vendedor: toolConsultarVendasPorVendedor,
  consultar_vendas_por_categoria: toolConsultarVendasPorCategoria,
  consultar_crescimento_mensal: toolConsultarCrescimentoMensal,
  consultar_relatorio_vendas: toolConsultarRelatorioVendas,

  consultar_seguros_por_vendedor: toolConsultarSegurosPorVendedor,
  consultar_seguros_por_loja: toolConsultarSegurosPorLoja,

  executar_sql_analitico: toolExecutarSqlAnalitico,
  gerar_relatorio_executivo: toolGerarRelatorioExecutivo,

  responder_ajuda: async (args) => ({
    tool: 'responder_ajuda',
    ok: true,
    args,
    result: {
      mensagem:
        'Posso analisar vendas, estoque, lojas, vendedores, categorias, seguros, crescimento e relatórios executivos. Pergunte, por exemplo: “vendas por loja entre 25/03/2026 e 04/04/2026” ou “quais lojas têm Galaxy A56 128GB Preto?”.',
    },
  }),
};
