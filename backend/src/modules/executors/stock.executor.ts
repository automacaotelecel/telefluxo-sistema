import { PrismaClient } from '@prisma/client';

import { ClarkFiltros, ClarkProdutoPlanejado } from '../clark/clark.types';

import {
  formatBRL,
  normalizarTextoClark,
  resolverNomeLojaClark,
  safeNumberClark,
} from '../intent/extractFilters';

import {
  categoriaEstoqueConfereClark,
  obterEscopoUsuarioClark,
  rowCorrespondeLojaFiltroClark,
  rowPermitidaClark,
} from '../security/clarkScope';

import {
  extractColor,
  extractStorage,
  getBaseModelFamily,
  normalizeProductText,
  normalizeReference,
} from '../productDictionary/productDictionary.utils';

import { resolveProductRequest } from '../productResolver/productResolver.service';

const prisma = new PrismaClient();

function normalizar(value: any) {
  return normalizeProductText(value);
}

function montarNomeModeloEstoque(item: any) {
  const descricaoRaw = String(item.description || '').trim();
  const referencia = String(item.reference || '').trim();
  const codigo = String(item.productCode || '').trim();

  const descricaoNormalizada = normalizarTextoClark(descricaoRaw);

  const descricaoEhGenerica =
    !descricaoRaw ||
    descricaoNormalizada === 'SMARTPHONE' ||
    descricaoNormalizada === 'SMARTPHONES' ||
    descricaoNormalizada === 'APARELHO' ||
    descricaoNormalizada === 'APARELHOS' ||
    descricaoNormalizada === 'CELULAR' ||
    descricaoNormalizada === 'CELULARES' ||
    descricaoNormalizada === 'TABLET' ||
    descricaoNormalizada === 'TABLETS' ||
    descricaoNormalizada === 'WEARABLE' ||
    descricaoNormalizada === 'WEARABLES' ||
    descricaoNormalizada === 'ACESSORIO' ||
    descricaoNormalizada === 'ACESSORIOS';

  if (descricaoEhGenerica) {
    return referencia || codigo || descricaoRaw || 'SEM DESCRIÇÃO';
  }

  if (referencia && !descricaoNormalizada.includes(normalizarTextoClark(referencia))) {
    return `${descricaoRaw} ${referencia}`.trim();
  }

  return descricaoRaw;
}

function getTextoItemEstoque(item: any) {
  return normalizar(
    [
      item.description,
      item.reference,
      item.productCode,
      item.category,
    ].join(' ')
  );
}

function getReferenciaItem(item: any) {
  return normalizeReference(item.reference || item.productCode || '');
}

function getFamiliaItemEstoque(item: any) {
  const texto = getTextoItemEstoque(item);
  return getBaseModelFamily(texto) || '';
}

function getMemoriaItemEstoque(item: any) {
  const texto = getTextoItemEstoque(item);
  return extractStorage(texto) || '';
}

function getCorItemEstoque(item: any) {
  const texto = getTextoItemEstoque(item);
  return extractColor(texto) || '';
}

function itemEhCategoriaSolicitada(item: any, produto: ClarkProdutoPlanejado | null) {
  const categoriaSolicitada = normalizar(produto?.category || '');

  if (!categoriaSolicitada) return true;

  const categoriaItem = normalizar(item.category);

  const pediuSmartphone =
    categoriaSolicitada.includes('SMART') ||
    categoriaSolicitada.includes('CELULAR') ||
    categoriaSolicitada.includes('APARELHO');

  if (pediuSmartphone) {
    return (
      categoriaItem.includes('SMART') ||
      categoriaItem.includes('CELULAR') ||
      categoriaItem.includes('APARELHO')
    );
  }

  return categoriaItem.includes(categoriaSolicitada);
}

function itemBateComReferenciaCandidata(item: any, referencePrefixes: string[]) {
  if (!referencePrefixes.length) return false;

  const refItem = getReferenciaItem(item);

  return referencePrefixes.some((prefix) => {
    const normalizedPrefix = normalizeReference(prefix);

    return (
      refItem === normalizedPrefix ||
      refItem.startsWith(normalizedPrefix)
    );
  });
}


function itemBateComFamiliaAberta(params: {
  item: any;
  produto: ClarkProdutoPlanejado | null;
  referencePrefixes: string[];
}) {
  const { item, produto, referencePrefixes } = params;

  if (!produto) return true;

  if (!itemEhCategoriaSolicitada(item, produto)) {
    return false;
  }

  const textoItem = getTextoItemEstoque(item);
  const familiaItem = getFamiliaItemEstoque(item);
  const familiaSolicitada = normalizar(produto.family || produto.model || '');
  const modeloSolicitado = normalizar(produto.model || '');
  const bateReferencia = itemBateComReferenciaCandidata(item, referencePrefixes);

  if (!familiaSolicitada && !modeloSolicitado) return true;

  return (
    Boolean(familiaSolicitada && familiaItem === familiaSolicitada) ||
    Boolean(familiaSolicitada && textoItem.includes(familiaSolicitada)) ||
    Boolean(modeloSolicitado && textoItem.includes(modeloSolicitado)) ||
    bateReferencia
  );
}

function itemBateComProdutoPlanejado(params: {
  item: any;
  produto: ClarkProdutoPlanejado | null;
  referencePrefixes: string[];
}) {
  const { item, produto, referencePrefixes } = params;

  if (!produto) return true;

  if (!itemEhCategoriaSolicitada(item, produto)) {
    return false;
  }

  const textoItem = getTextoItemEstoque(item);
  const familiaItem = getFamiliaItemEstoque(item);
  const memoriaItem = getMemoriaItemEstoque(item);
  const corItem = getCorItemEstoque(item);

  const familiaSolicitada = normalizar(produto.family || '');
  const modeloSolicitado = normalizar(produto.model || '');
  const memoriaSolicitada = normalizar(produto.storage || '');
  const corSolicitada = normalizar(produto.color || '');

  const bateReferencia = itemBateComReferenciaCandidata(item, referencePrefixes);

  if (familiaSolicitada) {
    const bateFamilia =
      familiaItem === familiaSolicitada ||
      bateReferencia;

    if (!bateFamilia) return false;
  } else if (modeloSolicitado) {
    const bateModelo =
      familiaItem.includes(modeloSolicitado) ||
      textoItem.includes(modeloSolicitado) ||
      bateReferencia;

    if (!bateModelo) return false;
  }

  if (memoriaSolicitada) {
    if (memoriaItem !== memoriaSolicitada) return false;
  }

  if (corSolicitada) {
    /**
     * Se o estoque não tiver cor detectável, não arriscamos.
     * Melhor dizer que não encontrou do que retornar item errado.
     */
    if (!corItem) return false;
    if (corItem !== corSolicitada) return false;
  }

  return true;
}

function calcularScoreProdutoGenerico(
  item: any,
  filtros: ClarkFiltros,
  termosExpandidos: string[] = []
) {
  const termosBase = [
    ...filtros.tokensProduto,
    ...termosExpandidos,
  ]
    .map((t) => normalizar(t))
    .filter(Boolean);

  if (!termosBase.length) return 0;

  const textoItem = getTextoItemEstoque(item);

  let score = 0;

  for (const termo of termosBase) {
    if (!termo) continue;

    if (textoItem.includes(termo)) {
      score += termo.length >= 6 ? 4 : 2;
      continue;
    }

    const partes = termo.split(/\s+/).filter(Boolean);

    for (const parte of partes) {
      if (parte.length >= 2 && textoItem.includes(parte)) {
        score += 1;
      }
    }
  }

  return score;
}

async function carregarEstoquePermitidoClark(
  userId: string,
  filtros: ClarkFiltros
) {
  const scope = await obterEscopoUsuarioClark(userId);

  const estoqueRaw = await prisma.stock.findMany({
    where: {
      quantity: {
        gt: 0,
      },
    },
    select: {
      id: true,
      storeName: true,
      cnpj: true,
      productCode: true,
      reference: true,
      description: true,
      category: true,
      quantity: true,
      costPrice: true,
      salePrice: true,
      averageCost: true,
      serial: true,
      emLinha: true,
      cluster: true,
    },
  });

  const estoquePermitido = (estoqueRaw as any[])
    .filter((item) => rowPermitidaClark(item, scope))
    .filter((item) => rowCorrespondeLojaFiltroClark(item, filtros))
    .filter((item) => categoriaEstoqueConfereClark(item.category, filtros));

  return {
    scope,
    estoquePermitido,
    estoqueTotalPermitido: estoquePermitido.length,
  };
}

function agruparProdutosEstoque(itens: any[], limite: number) {
  const produtosMap = new Map<string, any>();

  for (const item of itens) {
    const nomeModelo = montarNomeModeloEstoque(item);
    const descricaoOriginal = String(item.description || '').trim();
    const referencia = String(item.reference || '').trim();
    const codigo = String(item.productCode || '').trim();
    const categoria = String(item.category || 'GERAL').trim();

    const key = `${nomeModelo.toUpperCase()}|${referencia.toUpperCase()}|${codigo.toUpperCase()}`;

    const qtd = safeNumberClark(item.quantity);
    const precoVenda = safeNumberClark(item.salePrice);

    if (!produtosMap.has(key)) {
      produtosMap.set(key, {
        descricao: nomeModelo,
        descricao_original: descricaoOriginal,
        referencia,
        codigo_produto: codigo,
        categoria,
        quantidade_total: 0,
        valor_estimado_estoque: 0,
        lojas: new Map<string, number>(),
      });
    }

    const atual = produtosMap.get(key);

    atual.quantidade_total += qtd;
    atual.valor_estimado_estoque += qtd * precoVenda;

    const loja = resolverNomeLojaClark({
      loja: item.storeName,
      storeName: item.storeName,
      cnpj_empresa: item.cnpj,
    });

    atual.lojas.set(loja, (atual.lojas.get(loja) || 0) + qtd);
  }

  return Array.from(produtosMap.values())
    .sort(
      (a: any, b: any) =>
        Number(b.quantidade_total) - Number(a.quantidade_total)
    )
    .slice(0, limite)
    .map((item: any, index: number) => {
      const lojasEntries = Array.from(
        (item.lojas as Map<string, number>).entries()
      ) as Array<[string, number]>;

      const lojas = lojasEntries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([loja, quantidade]) => ({
          loja,
          quantidade: Number(quantidade || 0),
        }));

      return {
        posicao: index + 1,
        descricao: item.descricao,
        descricao_original: item.descricao_original,
        referencia: item.referencia,
        codigo_produto: item.codigo_produto,
        categoria: item.categoria,
        quantidade_total: Number(item.quantidade_total || 0),
        valor_estimado_estoque: Number(item.valor_estimado_estoque || 0),
        valor_estimado_estoque_formatado: formatBRL(
          item.valor_estimado_estoque
        ),
        lojas,
        principais_lojas: lojas.slice(0, 10),
      };
    });
}

export async function consultarRankingEstoqueProdutosClark(
  userId: string,
  filtros: ClarkFiltros
) {
  const { estoquePermitido, estoqueTotalPermitido } =
    await carregarEstoquePermitidoClark(userId, filtros);

  const categoriasMap = new Map<string, number>();

  for (const item of estoquePermitido) {
    const categoria =
      String(item.category || 'SEM CATEGORIA').trim() || 'SEM CATEGORIA';

    categoriasMap.set(
      categoria,
      (categoriasMap.get(categoria) || 0) + safeNumberClark(item.quantity)
    );
  }

  const categoriasEncontradas = Array.from(categoriasMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([categoria, quantidade]) => ({
      categoria,
      quantidade,
    }));

  const ranking = agruparProdutosEstoque(estoquePermitido, filtros.limite);

  return {
    modulo: 'estoque',
    tipo: filtros.categoriaCanonica
      ? 'ranking_estoque_categoria'
      : 'ranking_estoque_geral',
    categoria_solicitada: filtros.categoriaCanonica || null,
    filtro_loja: filtros.lojaCanonica || null,
    total_itens_filtrados: estoqueTotalPermitido,
    categorias_encontradas: categoriasEncontradas,
    ranking,
  };
}

export async function consultarLojasProdutoEstoqueClark(
  userId: string,
  filtros: ClarkFiltros
) {
  const { estoquePermitido, estoqueTotalPermitido } =
    await carregarEstoquePermitidoClark(userId, filtros);

  const produtoPlanejado = filtros.produtoPlanejado;

  const resolver = await resolveProductRequest({
    query: filtros.termoProduto,
    productPlan: produtoPlanejado,
  });

  const termosExpandidos: string[] =
  resolver.exactDictionaryCandidates.flatMap((candidate: any) => {
    const values = [
      candidate.displayName,
      candidate.commercialName,
      candidate.description,
      candidate.reference,
      candidate.referenceFamily,
      candidate.productCode,
      candidate.family,
      candidate.storage,
      candidate.color,
    ];

    return values.filter((value): value is string => {
      return typeof value === 'string' && value.trim().length > 0;
    });
  });

  const buscaFamiliaAberta =
    resolver.searchPrecision === 'family_open' &&
    Boolean(resolver.request.family || resolver.request.model);

  if (buscaFamiliaAberta) {
    const itensFamilia = estoquePermitido.filter((item) =>
      itemBateComFamiliaAberta({
        item,
        produto: produtoPlanejado,
        referencePrefixes: resolver.referencePrefixes,
      })
    );

    const produtos = agruparProdutosEstoque(itensFamilia, filtros.limite);

    return {
      modulo: 'estoque',
      tipo: 'estoque_produto_lojas',
      termo_pesquisado: filtros.termoProduto,
      categoria_solicitada: filtros.categoriaCanonica || null,
      filtro_loja: filtros.lojaCanonica || null,
      tokens_usados: filtros.tokensProduto,
      total_itens_filtrados: estoqueTotalPermitido,
      produto_nao_encontrado_exato: produtos.length === 0,
      produto_planejado: produtoPlanejado,
      produto_resolvido: resolver,
      produtos,
      sugestoes_se_nao_encontrou: produtos.length
        ? []
        : resolver.similarDictionaryCandidates.slice(0, 8),
    };
  }

  const buscaEspecifica = resolver.strictMode;

  if (buscaEspecifica) {
    const itensEstritos = estoquePermitido.filter((item) =>
      itemBateComProdutoPlanejado({
        item,
        produto: produtoPlanejado,
        referencePrefixes: resolver.referencePrefixes,
      })
    );

    if (itensEstritos.length === 0) {
      return {
        modulo: 'estoque',
        tipo: 'estoque_produto_lojas',
        termo_pesquisado: filtros.termoProduto,
        categoria_solicitada: filtros.categoriaCanonica || null,
        filtro_loja: filtros.lojaCanonica || null,
        tokens_usados: filtros.tokensProduto,
        total_itens_filtrados: estoqueTotalPermitido,
        produto_nao_encontrado_exato: true,
        produto_planejado: produtoPlanejado,
        produto_resolvido: resolver,
        produtos: [],
        sugestoes_se_nao_encontrou: resolver.exactDictionaryCandidates.length
          ? resolver.exactDictionaryCandidates
          : resolver.similarDictionaryCandidates.slice(0, 8),
      };
    }

    const produtos = agruparProdutosEstoque(itensEstritos, filtros.limite);

    return {
      modulo: 'estoque',
      tipo: 'estoque_produto_lojas',
      termo_pesquisado: filtros.termoProduto,
      categoria_solicitada: filtros.categoriaCanonica || null,
      filtro_loja: filtros.lojaCanonica || null,
      tokens_usados: filtros.tokensProduto,
      total_itens_filtrados: estoqueTotalPermitido,
      produto_nao_encontrado_exato: false,
      produto_planejado: produtoPlanejado,
      produto_resolvido: resolver,
      produtos,
      sugestoes_se_nao_encontrou: [],
    };
  }

  const itensPontuados = estoquePermitido
    .map((item) => ({
      item,
      score: calcularScoreProdutoGenerico(item, filtros, termosExpandidos),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const produtos = agruparProdutosEstoque(
    itensPontuados.map((x) => x.item),
    filtros.limite
  );

  return {
    modulo: 'estoque',
    tipo: 'estoque_produto_lojas',
    termo_pesquisado: filtros.termoProduto,
    categoria_solicitada: filtros.categoriaCanonica || null,
    filtro_loja: filtros.lojaCanonica || null,
    tokens_usados: filtros.tokensProduto,
    total_itens_filtrados: estoqueTotalPermitido,
    produto_nao_encontrado_exato: false,
    produto_planejado: produtoPlanejado,
    produto_resolvido: resolver,
    produtos,
    sugestoes_se_nao_encontrou: produtos.length
      ? []
      : resolver.similarDictionaryCandidates.slice(0, 8),
  };
}