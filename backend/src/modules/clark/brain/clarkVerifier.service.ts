import { ClarkAgentPlan, ClarkToolResult, ClarkVerificationResult } from '../agent/clarkAgent.types';

export function validarResultadoClark(plan: ClarkAgentPlan, results: ClarkToolResult[]): ClarkVerificationResult {
  const erros = results.filter((r) => !r.ok);
  if (erros.length) {
    return { ok: false, verdict: 'tool_error', problems: erros.map((r) => `${r.tool}: ${r.error || 'erro'}`), retrySuggestion: 'Replanejar com ferramenta alternativa ou explicar falha.' };
  }

  if (!results.length || !results.some((r) => r.result !== null && r.result !== undefined)) {
    return { ok: false, verdict: 'missing_data', problems: ['Nenhuma ferramenta retornou dados úteis.'] };
  }

  const stockProduct = results.find((r) => r.tool === 'consultar_estoque_produto')?.result;
  if (stockProduct?.produto_nao_encontrado_exato) {
    return { ok: true, verdict: 'answered', problems: [] };
  }

  if (plan.taskType === 'stock_product_search') {
    const produtos = Array.isArray(stockProduct?.produtos) ? stockProduct.produtos : [];
    if (!produtos.length) {
      return { ok: true, verdict: 'answered', problems: ['Produto exato não encontrado.'] };
    }
  }

  if (plan.taskType === 'stock_ranking') {
    const ranking = results.find((r) => r.tool === 'consultar_ranking_estoque')?.result?.ranking;
    if (!Array.isArray(ranking) || !ranking.length) {
      return { ok: false, verdict: 'missing_data', problems: ['Ranking de estoque vazio.'] };
    }
  }

  return { ok: true, verdict: 'answered', problems: [] };
}
