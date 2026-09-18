import { ClarkAgentPlan, ClarkToolResult, ClarkVerificationResult } from '../agent/clarkAgent.types';
import { ClarkQuestionRequirements } from './clarkRequirements.service';

const RANKING_TOOLS = new Set([
  'consultar_ranking_estoque',
  'consultar_vendas_por_loja',
  'consultar_vendas_por_vendedor',
  'consultar_vendas_por_categoria',
  'consultar_seguros_por_vendedor',
  'consultar_seguros_por_loja',
]);

const STOCK_OR_CROSS_TOOLS = new Set([
  'consultar_estoque_produto',
  'consultar_estoque_produtos',
  'consultar_analise_produto_comercial',
  'consultar_vendas_vs_estoque',
  'consultar_risco_stockout',
  'consultar_excesso_estoque',
  'consultar_redistribuicao_estoque',
]);

function resultadoTemConteudo(result: any): boolean {
  if (result === null || result === undefined) return false;
  if (Array.isArray(result)) return result.length > 0;
  if (typeof result !== 'object') return String(result).trim().length > 0;
  return Object.keys(result).length > 0;
}

function sqlEhPlaceholder(result: any): boolean {
  const sql = String(result?.sql || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!sql) return true;

  return (
    /^SELECT\s+1(?:\s+AS\s+[A-Z0-9_]+)?(?:\s+LIMIT\s+\d+)?$/.test(sql) ||
    sql.includes('CONSULTA_PRECISA_DE_PLANEJAMENTO')
  );
}

function checkRequirementCoverage(
  requirements: ClarkQuestionRequirements | undefined,
  results: ClarkToolResult[],
): ClarkVerificationResult | null {
  if (!requirements) return null;

  const requestedProducts = requirements.products.length;

  // Regra central: pergunta "vendas de X" não pode virar análise de estoque.
  if (requirements.salesOnly && requestedProducts > 0) {
    const salesResult = results.find((r) => r.tool === 'consultar_vendas_produtos');
    const wrongTools = results.filter((r) => STOCK_OR_CROSS_TOOLS.has(r.tool));

    if (!salesResult || wrongTools.length) {
      return {
        ok: false,
        verdict: 'wrong_intent',
        problems: [
          'O usuário pediu somente vendas de produto(s), mas o plano não executou a ferramenta factual de vendas por produto ou acrescentou análise de estoque.',
        ],
        retrySuggestion: 'Executar consultar_vendas_produtos para todos os produtos solicitados, sem ferramentas de estoque.',
      };
    }

    const answered = Number(salesResult.result?.answered_count || 0);
    const products = Array.isArray(salesResult.result?.products) ? salesResult.result.products : [];

    if (answered < requestedProducts || products.length < requestedProducts) {
      return {
        ok: false,
        verdict: 'needs_retry',
        problems: [`Foram solicitados ${requestedProducts} produto(s), mas apenas ${Math.max(answered, products.length)} foram processados.`],
        retrySuggestion: 'Reexecutar consultar_vendas_produtos com o array completo de produtos solicitado pelo usuário.',
      };
    }
  }

  if (requirements.stockOnly && requestedProducts > 1) {
    const stockResult = results.find((r) => r.tool === 'consultar_estoque_produtos');
    const answered = Number(stockResult?.result?.answered_count || 0);
    if (!stockResult || answered < requestedProducts) {
      return {
        ok: false,
        verdict: 'needs_retry',
        problems: [`A pergunta pede estoque de ${requestedProducts} produtos e nem todos foram processados.`],
        retrySuggestion: 'Executar consultar_estoque_produtos com todos os produtos citados.',
      };
    }
  }

  if (requirements.wantsSales && requirements.wantsStock && requestedProducts > 0) {
    const salesResult = results.find((r) => r.tool === 'consultar_vendas_produtos');
    const stockResult = results.find((r) => r.tool === 'consultar_estoque_produtos');
    if (!salesResult || !stockResult) {
      return {
        ok: false,
        verdict: 'needs_retry',
        problems: ['A pergunta pede vendas e estoque, mas uma das duas fontes não foi consultada.'],
        retrySuggestion: 'Consultar vendas e estoque para o mesmo conjunto completo de produtos.',
      };
    }
  }

  return null;
}

export function validarResultadoClark(
  plan: ClarkAgentPlan,
  results: ClarkToolResult[],
  requirements?: ClarkQuestionRequirements,
): ClarkVerificationResult {
  const erros = results.filter((r) => !r.ok);
  if (erros.length) {
    return {
      ok: false,
      verdict: 'tool_error',
      problems: erros.map((r) => `${r.tool}: ${r.error || 'erro'}`),
      retrySuggestion: 'Replanejar com ferramenta alternativa ou explicar a falha sem estimar dados.',
    };
  }

  if (!results.length || !results.some((r) => resultadoTemConteudo(r.result))) {
    return {
      ok: false,
      verdict: 'missing_data',
      problems: ['Nenhuma ferramenta retornou dados úteis.'],
    };
  }

  const coverage = checkRequirementCoverage(requirements, results);
  if (coverage) return coverage;

  // Uma intenção analítica não pode ser considerada respondida apenas porque o
  // fallback de ajuda foi executado.
  if (plan.taskType !== 'help' && plan.taskType !== 'conversation' && results.every((r) => r.tool === 'responder_ajuda')) {
    return {
      ok: false,
      verdict: 'wrong_intent',
      problems: ['A pergunta exigia análise de dados, mas nenhuma ferramenta analítica válida foi executada.'],
      retrySuggestion: 'Reformular o plano com uma ferramenta compatível com a intenção.',
    };
  }

  const stockProduct = results.find((r) => r.tool === 'consultar_estoque_produto')?.result;
  if (stockProduct?.produto_nao_encontrado_exato) {
    return { ok: true, verdict: 'answered', problems: [] };
  }

  if (plan.taskType === 'stock_product_search' && stockProduct) {
    const produtos = Array.isArray(stockProduct?.produtos) ? stockProduct.produtos : [];
    if (!produtos.length) {
      return { ok: true, verdict: 'answered', problems: ['Produto exato não encontrado.'] };
    }
  }

  for (const item of results) {
    if (!RANKING_TOOLS.has(item.tool)) continue;
    const ranking = item?.result?.ranking;
    if (!Array.isArray(ranking) || !ranking.length) continue;
  }

  const sqlResult = results.find((r) => r.tool === 'executar_sql_analitico')?.result;
  if (sqlResult) {
    const rows = Array.isArray(sqlResult.rows) ? sqlResult.rows : [];

    if (sqlEhPlaceholder(sqlResult)) {
      return {
        ok: false,
        verdict: 'wrong_intent',
        problems: ['A consulta SQL executada era apenas um placeholder e não respondia à pergunta.'],
        retrySuggestion: 'Gerar uma consulta SELECT real baseada na pergunta e no schema autorizado.',
      };
    }

    if (!rows.length) {
      return {
        ok: false,
        verdict: 'missing_data',
        problems: ['A consulta analítica não retornou registros.'],
      };
    }
  }

  return { ok: true, verdict: 'answered', problems: [] };
}
