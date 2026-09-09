import { ClarkAgentPlan, ClarkToolResult, ClarkVerificationResult } from '../agent/clarkAgent.types';

const RANKING_TOOLS = new Set([
  'consultar_ranking_estoque',
  'consultar_vendas_por_loja',
  'consultar_vendas_por_vendedor',
  'consultar_vendas_por_categoria',
  'consultar_seguros_por_vendedor',
  'consultar_seguros_por_loja',
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

export function validarResultadoClark(plan: ClarkAgentPlan, results: ClarkToolResult[]): ClarkVerificationResult {
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

  // Uma intenção analítica não pode ser considerada respondida apenas porque o
  // fallback de ajuda foi executado. Isso evitava falso positivo do verificador.
  if (plan.taskType !== 'help' && results.every((r) => r.tool === 'responder_ajuda')) {
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

  if (plan.taskType === 'stock_product_search') {
    const produtos = Array.isArray(stockProduct?.produtos) ? stockProduct.produtos : [];
    if (!produtos.length) {
      return { ok: true, verdict: 'answered', problems: ['Produto exato não encontrado.'] };
    }
  }

  for (const item of results) {
    if (!RANKING_TOOLS.has(item.tool)) continue;

    const ranking = item?.result?.ranking;
    if (!Array.isArray(ranking) || !ranking.length) {
      // Ranking vazio é uma resposta legítima quando a ferramenta conseguiu
      // consultar o período; o responder local informa que não houve registros.
      continue;
    }
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
