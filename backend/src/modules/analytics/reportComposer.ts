import {
  ClarkFiltros,
  ClarkIntent,
  ClarkModo,
  ClarkPeriodo,
} from '../clark/clark.types';

function textoSemDados(periodo: ClarkPeriodo, filtroLoja?: string | null) {
  return `Não encontrei dados para ${filtroLoja ? `a loja ${filtroLoja}` : 'esse filtro'} no período ${periodo.descricao}.`;
}

function tituloRankingClark(item: any) {
  const descricao = String(item.descricao || '').trim();
  const referencia = String(item.referencia || '').trim();
  const codigo = String(item.codigo_produto || '').trim();

  const descricaoNorm = descricao
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const descricaoGenerica = [
    'SMARTPHONE',
    'SMARTPHONES',
    'APARELHO',
    'APARELHOS',
    'CELULAR',
    'CELULARES',
    'ACESSORIO',
    'ACESSORIOS',
    'WEARABLE',
    'WEARABLES',
    'TABLET',
    'TABLETS',
  ].includes(descricaoNorm);

  if (descricaoGenerica && referencia) return referencia;
  if (descricaoGenerica && codigo) return codigo;

  return (
    item.loja ||
    item.vendedor ||
    item.categoria ||
    item.descricao ||
    item.referencia ||
    item.codigo_produto ||
    `Item ${item.posicao}`
  );
}

function listarRanking(ranking: any[]) {
  if (!Array.isArray(ranking) || ranking.length === 0) {
    return 'Nenhum item encontrado para esse filtro.';
  }

  return ranking
    .map((item) => {
      const titulo = tituloRankingClark(item);

      const partes = [`${item.posicao}. ${titulo}`];

      if (item.categoria) partes.push(`categoria: ${item.categoria}`);

      if (item.referencia && item.referencia !== titulo) {
        partes.push(`ref: ${item.referencia}`);
      }

      if (item.codigo_produto && item.codigo_produto !== titulo) {
        partes.push(`cód: ${item.codigo_produto}`);
      }

      if (item.total_vendas_formatado) {
        partes.push(`vendas: ${item.total_vendas_formatado}`);
      }

      if (item.total_pecas !== undefined) {
        partes.push(`peças: ${item.total_pecas}`);
      }

      if (item.vendas !== undefined) {
        partes.push(`registros: ${item.vendas}`);
      }

      if (item.ticket_medio_formatado) {
        partes.push(`ticket médio: ${item.ticket_medio_formatado}`);
      }

      if (item.seguros_total_formatado) {
        partes.push(`seguros: ${item.seguros_total_formatado}`);
      }

      if (item.seguros_qtd !== undefined) {
        partes.push(`qtd seguros: ${item.seguros_qtd}`);
      }

      if (item.quantidade_total !== undefined) {
        partes.push(`estoque: ${item.quantidade_total}`);
      }

      if (Array.isArray(item.principais_lojas) && item.principais_lojas.length > 0) {
        const lojas = item.principais_lojas
          .slice(0, 8)
          .map((l: any) => `${l.loja}: ${l.quantidade}`)
          .join(', ');

        partes.push(`lojas: ${lojas}`);
      }

      return partes.join(' | ');
    })
    .join('\n');
}

function montarRespostaProdutoNaoEncontrado(dados: any) {
  const resolver = dados?.produto_resolvido;
  const request = resolver?.request;

  const pedido = [
    request?.family,
    request?.storage,
    request?.color,
  ]
    .filter(Boolean)
    .join(' ');

  const candidatosExatos = Array.isArray(resolver?.exactDictionaryCandidates)
    ? resolver.exactDictionaryCandidates
    : [];

  const similares = Array.isArray(resolver?.similarDictionaryCandidates)
    ? resolver.similarDictionaryCandidates
    : [];

  const blocoExatos = candidatosExatos.length
    ? candidatosExatos
        .slice(0, 10)
        .map((s: any) => {
          const nome =
            s.displayName ||
            s.commercialName ||
            s.description ||
            s.reference ||
            s.productCode ||
            'Produto';

          const detalhes = [
            s.reference ? `ref: ${s.reference}` : '',
            s.referenceFamily ? `família ref: ${s.referenceFamily}` : '',
            s.family ? `família: ${s.family}` : '',
            s.storage ? `memória: ${s.storage}` : '',
            s.color ? `cor: ${s.color}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          return `- ${nome}${detalhes ? ` | ${detalhes}` : ''}`;
        })
        .join('\n')
    : '';

  const blocoSimilares = !candidatosExatos.length && similares.length
    ? similares
        .slice(0, 8)
        .map((s: any) => {
          const nome =
            s.displayName ||
            s.commercialName ||
            s.description ||
            s.reference ||
            s.productCode ||
            'Produto';

          const detalhes = [
            s.reference ? `ref: ${s.reference}` : '',
            s.family ? `família: ${s.family}` : '',
            s.storage ? `memória: ${s.storage}` : '',
            s.color ? `cor: ${s.color}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          return `- ${nome}${detalhes ? ` | ${detalhes}` : ''}`;
        })
        .join('\n')
    : '';

  return `Não encontrei estoque para o produto exato solicitado${
    pedido ? `: ${pedido}` : ''
  }.

A Clark validou modelo, memória, cor e categoria antes de responder. Não vou retornar S25, S24, acessórios ou tablets como se fossem o produto pedido.

${
  blocoExatos
    ? `O produto existe no dicionário de modelos, mas não apareceu com estoque disponível:\n${blocoExatos}`
    : blocoSimilares
      ? `Não encontrei candidato exato no dicionário. Referências parecidas, não tratadas como resultado:\n${blocoSimilares}`
      : 'Não encontrei candidatos confiáveis no dicionário de produtos.'
}`;
}

function montarRespostaEstoqueProdutos(dados: any) {
  if (dados?.produto_nao_encontrado_exato) {
    return montarRespostaProdutoNaoEncontrado(dados);
  }

  if (!Array.isArray(dados?.produtos) || dados.produtos.length === 0) {
    const sugestoes = Array.isArray(dados?.sugestoes_se_nao_encontrou)
      ? dados.sugestoes_se_nao_encontrou
          .map((s: any, index: number) => {
            const nome =
              s.displayName ||
              s.commercialName ||
              s.description ||
              s.referencia ||
              s.reference ||
              'Produto';

            return `${index + 1}. ${nome} | ${s.reference || s.referencia || 'sem ref'} | score: ${s.score || '-'}`;
          })
          .join('\n')
      : '';

    return `Não encontrei o produto "${dados?.termo_pesquisado || ''}" em estoque para os filtros informados.

${
  sugestoes
    ? `Sugestões próximas encontradas:\n${sugestoes}`
    : 'Não encontrei sugestões próximas.'
}`;
  }

  const produtos = dados.produtos
    .map((produto: any) => {
      const lojas = Array.isArray(produto.lojas)
        ? produto.lojas
            .map((l: any) => `- ${l.loja}: ${l.quantidade}`)
            .join('\n')
        : '';

      return `${produto.posicao}. ${produto.descricao}
Referência: ${produto.referencia || 'Não informada'}
Código: ${produto.codigo_produto || 'Não informado'}
Categoria: ${produto.categoria}
Quantidade total: ${produto.quantidade_total}
Valor estimado: ${produto.valor_estimado_estoque_formatado}
Lojas:
${lojas}`;
    })
    .join('\n\n');

  return `Produtos encontrados em estoque:

${produtos}`;
}

export function gerarRespostaLocalClark(params: {
  intencao: ClarkIntent;
  modo: ClarkModo;
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
  dados: any;
}) {
  const { periodo, filtros, dados } = params;

  const sufixoLoja = filtros.lojaCanonica
    ? ` da loja ${filtros.lojaCanonica}`
    : '';

  if (dados?.modulo === 'vendas' && dados?.tipo === 'resumo_periodo') {
    if (!dados.quantidade_registros || dados.total_vendas === 0) {
      return textoSemDados(periodo, filtros.lojaCanonica || null);
    }

    const topLojas = Array.isArray(dados.lojas)
      ? dados.lojas
          .slice(0, 5)
          .map(
            (loja: any, index: number) =>
              `${index + 1}. ${loja.loja}: ${loja.total_vendas_formatado} | peças: ${loja.total_pecas}`
          )
          .join('\n')
      : '';

    return `Resumo de vendas${sufixoLoja} — ${periodo.descricao}:

Total vendido: ${dados.total_vendas_formatado}
Peças vendidas: ${dados.total_pecas}
Registros de venda: ${dados.quantidade_registros}
Ticket médio: ${dados.ticket_medio_formatado}
Lojas analisadas: ${dados.lojas_analisadas}

${topLojas ? `Principais lojas:\n${topLojas}` : ''}`;
  }

  if (dados?.modulo === 'vendas' && Array.isArray(dados?.ranking)) {
    if (!dados.ranking.length) {
      return textoSemDados(periodo, filtros.lojaCanonica || null);
    }

    const titulo =
      dados.tipo === 'ranking_lojas'
        ? 'Ranking de lojas'
        : dados.tipo === 'ranking_vendedores'
          ? 'Ranking de vendedores'
          : 'Ranking de categorias';

    return `${titulo}${sufixoLoja} — ${periodo.descricao}:

${listarRanking(dados.ranking)}

Observação: valores calculados apenas com os dados permitidos para seu usuário.`;
  }

  if (dados?.modulo === 'seguros' && Array.isArray(dados?.ranking)) {
    if (!dados.ranking.length) {
      return textoSemDados(periodo, filtros.lojaCanonica || null);
    }

    const titulo =
      dados.tipo === 'ranking_lojas_seguros'
        ? 'Ranking de lojas por seguros'
        : 'Ranking de vendedores por seguros';

    return `${titulo}${sufixoLoja} — ${periodo.descricao}:

${listarRanking(dados.ranking)}

Observação: seguros usam prêmio total e quantidade de seguros.`;
  }

  if (dados?.modulo === 'estoque' && Array.isArray(dados?.ranking)) {
    if (!dados.ranking.length) {
      return `Não encontrei itens em estoque para os filtros informados.`;
    }

    return `Ranking de estoque${
      filtros.categoriaCanonica ? ` da categoria ${filtros.categoriaCanonica}` : ''
    }${sufixoLoja}:

${listarRanking(dados.ranking)}

Itens filtrados: ${dados.total_itens_filtrados}.`;
  }

  if (dados?.modulo === 'estoque' && Array.isArray(dados?.produtos)) {
    return montarRespostaEstoqueProdutos(dados);
  }

  if (dados?.modulo === 'vendas' && dados?.tipo === 'crescimento_mensal') {
    if (!Array.isArray(dados.mensal) || !dados.mensal.length) {
      return textoSemDados(periodo, filtros.lojaCanonica || null);
    }

    const linhas = dados.mensal
      .map(
        (m: any) =>
          `${m.mes}: ${m.total_vendas_formatado} | peças: ${m.total_pecas} | registros: ${m.vendas}`
      )
      .join('\n');

    return `Crescimento mensal de vendas${sufixoLoja} — ${periodo.descricao}:

${linhas}`;
  }

  if (dados?.modulo === 'ajuda') {
    return `${dados.mensagem}

Exemplos:
${dados.exemplos.map((exemplo: string) => `- ${exemplo}`).join('\n')}`;
  }

  return 'Não consegui montar uma resposta local para esses dados.';
}