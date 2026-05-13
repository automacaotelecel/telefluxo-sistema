import { ClarkIntent } from '../clark/clark.types';
import { normalizarTextoClark } from './extractFilters';

function incluiAlgum(texto: string, termos: string[]) {
  return termos.some((termo) => texto.includes(termo));
}

function pareceBuscaProdutoEspecifico(texto: string) {
  const temBuscaLocalizacao = incluiAlgum(texto, [
    'ONDE',
    'ONDE ESTA',
    'ONDE ESTAO',
    'ONDE ESTÁ',
    'ONDE ESTÃO',
    'QUAIS LOJAS',
    'QUAL LOJA',
    'LOJAS QUE TEM',
    'LOJAS QUE TÊM',
    'EM QUAIS LOJAS',
    'ESTAO OS MODELOS',
    'ESTÃO OS MODELOS',
  ]);

  const temProdutoOuModelo = incluiAlgum(texto, [
    'GALAXY',
    'SAMSUNG',
    'ULTRA',
    'PLUS',
    'FE',
    'GB',
    'PRETO',
    'GRAFITE',
    'AZUL',
    'VERDE',
    'VIOLETA',
    'CREME',
    'MODELO',
    'MODELOS',
    'PRODUTO',
    'PRODUTOS',
    'SM-',
  ]);

  return temBuscaLocalizacao && temProdutoOuModelo;
}

function pareceRankingEstoque(texto: string) {
  return incluiAlgum(texto, [
    'TOP',
    'RANKING',
    'MAIORES',
    'MELHORES',
    'PIORES',
    'MAIOR ESTOQUE',
    'MAIORES MODELOS',
    'MODELOS COM MAIOR',
  ]);
}

export function detectarIntencaoClark(pergunta: string): ClarkIntent {
  const texto = normalizarTextoClark(pergunta);

  const falaDeVenda = incluiAlgum(texto, [
    'VENDA',
    'VENDAS',
    'VENDI',
    'VENDIDO',
    'VENDIDOS',
    'VENDEMOS',
    'VENDEU',
    'VENDERAM',
    'VENDENDO',
    'FATURAMENTO',
    'FATURADO',
    'FATURAMOS',
    'RECEITA',
    'VALOR VENDIDO',
    'TOTAL VENDIDO',
    'QUANTO VENDEMOS',
    'QUANTO VENDEU',
    'QUANTO FATUROU',
    'QUANTO FATURAMOS',
  ]);

  const falaDeLoja = incluiAlgum(texto, [
    'LOJA',
    'LOJAS',
    'FILIAL',
    'FILIAIS',
    'UNIDADE',
    'UNIDADES',
  ]);

  const falaDeVendedor = incluiAlgum(texto, [
    'VENDEDOR',
    'VENDEDORES',
    'CONSULTOR',
    'CONSULTORES',
  ]);

  const falaDeCategoria = incluiAlgum(texto, [
    'CATEGORIA',
    'CATEGORIAS',
    'FAMILIA',
    'FAMÍLIA',
    'LINHA',
    'SEGMENTO',
    'SMARTPHONE',
    'SMARTPHONES',
    'TABLET',
    'TABLETS',
    'WEARABLE',
    'WEARABLES',
    'ACESSORIO',
    'ACESSORIOS',
  ]);

  const falaDeSeguro = incluiAlgum(texto, [
    'SEGURO',
    'SEGUROS',
    'PREMIO',
    'PRÊMIO',
    'PROTECAO',
    'PROTEÇÃO',
  ]);

  const falaDeEstoque = incluiAlgum(texto, [
    'ESTOQUE',
    'ESTOQUES',
    'DISPONIVEL',
    'DISPONÍVEL',
    'QUANTIDADE EM ESTOQUE',
    'ONDE',
    'ONDE ESTA',
    'ONDE ESTAO',
    'ONDE ESTÁ',
    'ONDE ESTÃO',
    'QUAIS LOJAS',
    'QUAL LOJA',
    'MODELO',
    'MODELOS',
    'PRODUTO',
    'PRODUTOS',
    'SERIAL',
    'IMEI',
    'GALAXY',
    'SM-',
  ]);

  const falaDeRanking = incluiAlgum(texto, [
    'RANKING',
    'TOP',
    'MAIORES',
    'MELHORES',
    'PIORES',
    'LISTE',
    'LISTAR',
    'MOSTRE',
    'ME MOSTRE',
    'TRAGA',
  ]);

  const falaRelatorio = incluiAlgum(texto, [
    'RELATORIO',
    'RELATÓRIO',
    'ANALISE',
    'ANÁLISE',
    'COMPLETO',
    'COMPLETA',
    'DESEMPENHO',
    'PERFORMANCE',
  ]);

  const falaCrescimento = incluiAlgum(texto, [
    'CRESCIMENTO',
    'EVOLUCAO',
    'EVOLUÇÃO',
    'MES A MES',
    'MÊS A MÊS',
    'MENSAL',
    'COMPARAR MESES',
  ]);

  const falaComparativo = incluiAlgum(texto, [
    'COMPARATIVO',
    'COMPARAR',
    'COMPARACAO',
    'COMPARAÇÃO',
    'VERSUS',
    'VS',
  ]);

  /**
   * ESTOQUE
   *
   * Ordem importante:
   * 1. Primeiro detecta busca de produto específico.
   * 2. Depois ranking de estoque.
   */
  if (falaDeEstoque) {
    if (pareceBuscaProdutoEspecifico(texto)) {
      return 'estoque_produto_lojas';
    }

    if (pareceRankingEstoque(texto)) {
      return 'ranking_estoque_produtos';
    }

    if (falaDeCategoria) {
      return 'ranking_estoque_produtos';
    }

    return 'ranking_estoque_produtos';
  }

  /**
   * SEGUROS
   */
  if (falaDeSeguro) {
    if (falaDeLoja) return 'ranking_lojas_seguros';
    return 'ranking_vendedores_seguros';
  }

  /**
   * RELATÓRIOS ANALÍTICOS
   */
  if ((falaRelatorio || falaCrescimento || falaComparativo) && !falaDeEstoque) {
    if (falaCrescimento) return 'crescimento_mensal';
    if (falaComparativo && falaDeLoja) return 'comparativo_lojas';
    return 'relatorio_analitico_vendas';
  }

  /**
   * VENDAS SIMPLES
   */
  if (
    falaDeVenda &&
    incluiAlgum(texto, [
      'QUANTO',
      'QUANTOS',
      'QUAL FOI',
      'TOTAL',
      'RESUMO',
      'HOJE',
      'ONTEM',
      'MES',
      'MÊS',
      'PERIODO',
      'PERÍODO',
    ])
  ) {
    return 'vendas_resumo';
  }

  if (falaDeVenda && falaCrescimento) {
    return 'crescimento_mensal';
  }

  if (falaDeVenda && falaComparativo && falaDeLoja) {
    return 'comparativo_lojas';
  }

  if (falaDeVenda && falaDeVendedor) {
    return 'ranking_vendedores_vendas';
  }

  if (falaDeVenda && falaDeCategoria) {
    return 'ranking_categorias_vendas';
  }

  if (falaDeVenda && falaDeLoja) {
    return 'ranking_lojas_vendas';
  }

  if (falaDeVenda) {
    return 'vendas_resumo';
  }

  if (falaDeRanking && falaDeVendedor) {
    return 'ranking_vendedores_vendas';
  }

  if (falaDeRanking && falaDeLoja) {
    return 'ranking_lojas_vendas';
  }

  if (falaDeRanking && falaDeCategoria) {
    return 'ranking_categorias_vendas';
  }

  return 'ajuda';
}