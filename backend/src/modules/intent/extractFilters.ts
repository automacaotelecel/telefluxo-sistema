import {
  ClarkFiltros,
  CORRECAO_NOMES_SERVER,
  LOJAS_MAP_GLOBAL,
} from '../clark/clark.types';

export function normalizarTextoClark(value: any) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarTokenClark(value: any) {
  let token = normalizarTextoClark(value)
    .replace(/[^\w]/g, '')
    .trim();

  if (token.length > 3 && token.endsWith('S')) {
    token = token.slice(0, -1);
  }

  return token;
}

export function cnpjLimpoClark(value: any) {
  return String(value || '').replace(/\D/g, '');
}

export function safeNumberClark(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatBRL(value: any) {
  const n = Number(value || 0);

  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function normalizarLojaClark(value: any) {
  let loja = normalizarTextoClark(value);

  loja = loja.replace(/^SAMSUNG\s*-\s*MRF\s*-\s*/i, '').trim();
  loja = loja.replace(/^SSG\s+/i, '').trim();

  const corrigida = CORRECAO_NOMES_SERVER[loja];

  if (corrigida) {
    return normalizarTextoClark(corrigida);
  }

  return loja;
}

export function traduzirCnpjParaLoja(cnpj: any) {
  const key = cnpjLimpoClark(cnpj);
  return LOJAS_MAP_GLOBAL[key] || '';
}

function montarReverseLojasClark() {
  const reverse: Record<string, string> = {};

  Object.entries(LOJAS_MAP_GLOBAL).forEach(([cnpj, nome]) => {
    reverse[normalizarLojaClark(nome)] = cnpj;
  });

  return reverse;
}

export const REVERSE_LOJAS_CLARK = montarReverseLojasClark();

export function resolverNomeLojaClark(row: any) {
  const byCnpj = traduzirCnpjParaLoja(row?.cnpj_empresa || row?.cnpj || '');

  if (byCnpj) return byCnpj;

  const lojaRaw = String(
    row?.loja || row?.storeName || row?.nome_fantasia || ''
  ).trim();

  if (lojaRaw) {
    const lojaNorm = normalizarLojaClark(lojaRaw);
    const corrigida = CORRECAO_NOMES_SERVER[lojaNorm];

    if (corrigida) return corrigida;

    const cnpj = REVERSE_LOJAS_CLARK[lojaNorm];

    if (cnpj && LOJAS_MAP_GLOBAL[cnpj]) {
      return LOJAS_MAP_GLOBAL[cnpj];
    }

    return lojaRaw.toUpperCase();
  }

  return 'Loja não identificada';
}

function extrairCategoriaClark(textoNormalizado: string) {
  if (
    textoNormalizado.includes('SMARTPHONE') ||
    textoNormalizado.includes('SMARTPHONES') ||
    textoNormalizado.includes('APARELHO') ||
    textoNormalizado.includes('APARELHOS') ||
    textoNormalizado.includes('CELULAR') ||
    textoNormalizado.includes('CELULARES')
  ) {
    return {
      categoriaOriginal: 'SMARTPHONES',
      categoriaCanonica: 'SMARTPHONES',
      aliasesCategoria: [
        'SMARTPHONE',
        'SMARTPHONES',
        'APARELHO',
        'APARELHOS',
        'CELULAR',
        'CELULARES',
      ],
    };
  }

  if (
    textoNormalizado.includes('ACESSORIO') ||
    textoNormalizado.includes('ACESSORIOS') ||
    textoNormalizado.includes('ACESSÓRIO') ||
    textoNormalizado.includes('ACESSÓRIOS')
  ) {
    return {
      categoriaOriginal: 'ACESSÓRIOS',
      categoriaCanonica: 'ACESSÓRIOS',
      aliasesCategoria: ['ACESSORIO', 'ACESSORIOS', 'ACESSÓRIO', 'ACESSÓRIOS'],
    };
  }

  if (
    textoNormalizado.includes('WEARABLE') ||
    textoNormalizado.includes('WEARABLES') ||
    textoNormalizado.includes('RELOGIO') ||
    textoNormalizado.includes('RELÓGIO') ||
    textoNormalizado.includes('BUDS') ||
    textoNormalizado.includes('FONE') ||
    textoNormalizado.includes('FONES')
  ) {
    return {
      categoriaOriginal: 'WEARABLES',
      categoriaCanonica: 'WEARABLES',
      aliasesCategoria: [
        'WEARABLE',
        'WEARABLES',
        'RELOGIO',
        'RELÓGIO',
        'BUDS',
        'FONE',
        'FONES',
      ],
    };
  }

  if (textoNormalizado.includes('TABLET') || textoNormalizado.includes('TABLETS')) {
    return {
      categoriaOriginal: 'TABLETS',
      categoriaCanonica: 'TABLETS',
      aliasesCategoria: ['TABLET', 'TABLETS'],
    };
  }

  return {
    categoriaOriginal: undefined,
    categoriaCanonica: undefined,
    aliasesCategoria: [],
  };
}

function extrairLojaClark(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);

  const candidatos: Array<{
    lojaOriginal: string;
    lojaCanonica: string;
    cnpjLoja: string;
    normalizado: string;
  }> = [];

  Object.entries(LOJAS_MAP_GLOBAL).forEach(([cnpj, nome]) => {
    candidatos.push({
      lojaOriginal: nome,
      lojaCanonica: nome,
      cnpjLoja: cnpj,
      normalizado: normalizarLojaClark(nome),
    });
  });

  Object.entries(CORRECAO_NOMES_SERVER).forEach(([alias, oficial]) => {
    const lojaCanonicaNorm = normalizarLojaClark(oficial);
    const cnpj = REVERSE_LOJAS_CLARK[lojaCanonicaNorm];

    if (cnpj && LOJAS_MAP_GLOBAL[cnpj]) {
      candidatos.push({
        lojaOriginal: alias,
        lojaCanonica: LOJAS_MAP_GLOBAL[cnpj],
        cnpjLoja: cnpj,
        normalizado: normalizarLojaClark(alias),
      });
    }
  });

  candidatos.sort((a, b) => b.normalizado.length - a.normalizado.length);

  for (const candidato of candidatos) {
    if (candidato.normalizado && texto.includes(candidato.normalizado)) {
      return {
        lojaOriginal: candidato.lojaOriginal,
        lojaCanonica: candidato.lojaCanonica,
        cnpjLoja: candidato.cnpjLoja,
      };
    }
  }

  return {
    lojaOriginal: undefined,
    lojaCanonica: undefined,
    cnpjLoja: undefined,
  };
}

function extrairTermoProdutoClark(pergunta: string) {
  const original = String(pergunta || '');

  const entreAspas =
    original.match(/"([^"]+)"/)?.[1] ||
    original.match(/'([^']+)'/)?.[1] ||
    '';

  if (entreAspas.trim()) {
    return entreAspas.trim();
  }

  let texto = normalizarTextoClark(original);

  const frasesRemover = [
    'ME LISTE ONDE ESTAO TODOS OS MODELOS DO',
    'ME LISTE ONDE ESTÃO TODOS OS MODELOS DO',
    'ME LISTE ONDE ESTA TODOS OS MODELOS DO',
    'ME LISTE ONDE ESTÁ TODOS OS MODELOS DO',
    'ME LISTE ONDE ESTAO OS MODELOS DO',
    'ME LISTE ONDE ESTÃO OS MODELOS DO',
    'ME LISTE AS LOJAS QUE POSSUEM O MODELO',
    'ME LISTE AS LOJAS QUE POSSUEM',
    'ME LISTE AS LOJAS QUE TEM',
    'ME LISTE AS LOJAS QUE TÊM',
    'ONDE ESTAO TODOS OS MODELOS DO',
    'ONDE ESTÃO TODOS OS MODELOS DO',
    'ONDE ESTAO OS MODELOS DO',
    'ONDE ESTÃO OS MODELOS DO',
    'ONDE ESTA O MODELO',
    'ONDE ESTÁ O MODELO',
    'ONDE ESTA',
    'ONDE ESTÁ',
    'ONDE ESTAO',
    'ONDE ESTÃO',
    'QUAIS LOJAS TEM O',
    'QUAIS LOJAS TÊM O',
    'QUAIS LOJAS TEM',
    'QUAIS LOJAS TÊM',
    'QUAL LOJA TEM',
    'QUAL LOJA TÊM',
    'EM QUAIS LOJAS TEM',
    'EM QUAIS LOJAS TÊM',
    'LOJAS QUE POSSUEM O MODELO',
    'LOJAS QUE POSSUEM',
    'POSSUEM O MODELO',
    'POSSUEM',
    'EM ESTOQUE',
    'NO ESTOQUE',
    'NA CATEGORIA',
    'DA CATEGORIA',
    'CATEGORIA',
    'TODOS OS MODELOS DO',
    'TODOS OS MODELOS DA',
    'TODOS OS MODELOS',
    'OS MODELOS DO',
    'OS MODELOS DA',
    'MODELOS DO',
    'MODELOS DA',
    'MODELO DO',
    'MODELO DA',
    'MODELO',
    'MODELOS',
    'PRODUTO',
    'PRODUTOS',
    'VENDAS',
    'VENDA',
    'RELATORIO',
    'RELATÓRIO',
    'COMPLETO',
    'ANALISE',
    'ANÁLISE',
    'MAIORES',
    'MELHORES',
    'TOP',
    'LISTE',
    'QUAIS',
    'QUANTIDADE',
    'QTD',
    'ESTAO',
    'ESTÃO',
    'ESTA',
    'ESTÁ',
    'TODOS',
    'TODAS',
  ];

  for (const loja of Object.values(LOJAS_MAP_GLOBAL)) {
    texto = texto.replace(normalizarTextoClark(loja), ' ');
  }

  for (const alias of Object.keys(CORRECAO_NOMES_SERVER)) {
    texto = texto.replace(normalizarTextoClark(alias), ' ');
  }

  for (const frase of frasesRemover) {
    texto = texto.replace(frase, ' ');
  }

  texto = texto
    .replace(/\bDO\b/g, ' ')
    .replace(/\bDA\b/g, ' ')
    .replace(/\bDE\b/g, ' ')
    .replace(/\bDOS\b/g, ' ')
    .replace(/\bDAS\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return texto;
}

function extrairLimiteClark(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);

  const matchTop = texto.match(/\bTOP\s+(\d{1,3})\b/);
  if (matchTop?.[1]) return Number(matchTop[1]);

  const matchPrimeiros = texto.match(
    /\b(\d{1,3})\s+(MAIORES|MELHORES|PIORES|MODELOS|PRODUTOS)/
  );
  if (matchPrimeiros?.[1]) return Number(matchPrimeiros[1]);

  const matchListe = texto.match(/\bLISTE\s+OS?\s+(\d{1,3})\b/);
  if (matchListe?.[1]) return Number(matchListe[1]);

  return 10;
}

export function extrairFiltrosClark(pergunta: string): ClarkFiltros {
  const texto = normalizarTextoClark(pergunta);

  const categoria = extrairCategoriaClark(texto);
  const loja = extrairLojaClark(pergunta);
  const termoProduto = extrairTermoProdutoClark(pergunta);

  const tokensProduto = termoProduto
    .split(/\s+/)
    .map(normalizarTokenClark)
    .filter((token) => token.length >= 2)
    .filter(
      (token) =>
        ![
          'ME',
          'AS',
          'OS',
          'DA',
          'DE',
          'DO',
          'DAS',
          'DOS',
          'QUE',
          'TEM',
          'TÊM',
          'LOJA',
          'LOJAS',
          'ESTOQUE',
          'MODELO',
          'PRODUTO',
        ].includes(token)
    );

  return {
    limite: extrairLimiteClark(pergunta),

    categoriaOriginal: categoria.categoriaOriginal,
    categoriaCanonica: categoria.categoriaCanonica,
    aliasesCategoria: categoria.aliasesCategoria,

    termoProduto,
    tokensProduto,

    produtoPlanejado: null,

    lojaOriginal: loja.lojaOriginal,
    lojaCanonica: loja.lojaCanonica,
    cnpjLoja: loja.cnpjLoja,

    detalharPorLoja:
      texto.includes('LOJA') ||
      texto.includes('LOJAS') ||
      texto.includes('LOJA A LOJA') ||
      texto.includes('FILIAL'),

    detalharPorVendedor:
      texto.includes('VENDEDOR') ||
      texto.includes('VENDEDORES') ||
      texto.includes('VENDEDOR A VENDEDOR'),

    detalharPorCategoria:
      texto.includes('CATEGORIA') ||
      texto.includes('CATEGORIAS') ||
      texto.includes('FAMILIA') ||
      texto.includes('FAMÍLIA'),

    detalharPorMes:
      texto.includes('MES') ||
      texto.includes('MÊS') ||
      texto.includes('MENSAL') ||
      texto.includes('MES A MES') ||
      texto.includes('MÊS A MÊS'),
  };
}