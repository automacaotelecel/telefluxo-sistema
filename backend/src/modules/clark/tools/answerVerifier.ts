import {
  ClarkAgentPlan,
  ClarkToolResult,
  ClarkVerificationResult,
} from '../agent/clarkAgent.types';

function normalize(value: any) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function verificarProdutoEstoque(
  plan: ClarkAgentPlan,
  toolResults: ClarkToolResult[]
): ClarkVerificationResult {
  const estoque = toolResults.find(
    (r) => r.tool === 'consultar_estoque_produto'
  );

  if (!estoque || !estoque.ok) {
    return {
      ok: false,
      verdict: 'missing_data',
      problems: ['A ferramenta de estoque não retornou dados válidos.'],
      retrySuggestion: 'Consultar estoque do produto novamente.',
    };
  }

  const result = estoque.result;

  if (result?.produto_nao_encontrado_exato) {
    return {
      ok: true,
      verdict: 'answered',
      problems: [],
    };
  }

  const produtos = Array.isArray(result?.produtos) ? result.produtos : [];

  if (!produtos.length) {
    return {
      ok: true,
      verdict: 'answered',
      problems: [],
    };
  }

  const product = plan.entities.product;
  const expectedFamily = normalize(product?.family);
  const expectedStorage = normalize(product?.storage);
  const expectedColor = normalize(product?.color);

  const problems: string[] = [];

  for (const item of produtos) {
    const text = normalize(
      [
        item.descricao,
        item.descricao_original,
        item.referencia,
        item.codigo_produto,
        item.categoria,
      ].join(' ')
    );

    if (expectedFamily) {
      const familyTokens = expectedFamily.split(/\s+/).filter(Boolean);

      const matchesFamily = familyTokens.every((token) => text.includes(token));

      if (!matchesFamily) {
        problems.push(
          `Produto retornado não parece bater com a família pedida: ${item.descricao}`
        );
      }
    }

    if (expectedStorage && !text.includes(expectedStorage)) {
      problems.push(
        `Produto retornado não parece bater com a memória pedida: ${item.descricao}`
      );
    }

    if (expectedColor && !text.includes(expectedColor)) {
      /**
       * Aqui é propositalmente rígido.
       * Se o item não carrega a cor no texto, não deve passar como resposta exata.
       */
      problems.push(
        `Produto retornado não parece bater com a cor pedida: ${item.descricao}`
      );
    }
  }

  if (problems.length) {
    return {
      ok: false,
      verdict: 'wrong_product',
      problems,
      retrySuggestion:
        'Reexecutar a busca com modo estrito ou responder que não encontrou produto exato.',
    };
  }

  return {
    ok: true,
    verdict: 'answered',
    problems: [],
  };
}

function verificarRankingEstoque(
  plan: ClarkAgentPlan,
  toolResults: ClarkToolResult[]
): ClarkVerificationResult {
  const ranking = toolResults.find(
    (r) => r.tool === 'consultar_ranking_estoque'
  );

  if (!ranking || !ranking.ok) {
    return {
      ok: false,
      verdict: 'missing_data',
      problems: ['Ranking de estoque não retornou dados válidos.'],
    };
  }

  const items = ranking.result?.ranking;

  if (!Array.isArray(items) || !items.length) {
    return {
      ok: false,
      verdict: 'missing_data',
      problems: ['Ranking de estoque veio vazio.'],
    };
  }

  return {
    ok: true,
    verdict: 'answered',
    problems: [],
  };
}

export function verificarRespostaClark(
  plan: ClarkAgentPlan,
  toolResults: ClarkToolResult[]
): ClarkVerificationResult {
  if (plan.taskType === 'stock_product_search') {
    return verificarProdutoEstoque(plan, toolResults);
  }

  if (plan.taskType === 'stock_ranking') {
    return verificarRankingEstoque(plan, toolResults);
  }

  return {
    ok: true,
    verdict: 'answered',
    problems: [],
  };
}