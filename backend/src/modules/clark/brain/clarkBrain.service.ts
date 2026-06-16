import { ClarkFiltros, ClarkIntent, ClarkPerguntaInput, ClarkPeriodo, ClarkResposta } from '../clark.types';
import { extrairFiltrosClark } from '../../intent/extractFilters';
import { extrairPeriodoClark } from '../../intent/extractPeriod';
import { obterEscopoUsuarioClark } from '../../security/clarkScope';
import { limparHistoricoClark, expandirPerguntaComHistorico } from './clarkMemory.service';
import {
  aplicarMemoriaNaPerguntaClark,
  atualizarMemoriaExecutivaClark,
  montarHistoricoComMemoriaClark,
  obterMemoriaExecutivaClark,
} from './clarkExecutiveMemory.service';
import { CLARK_SCHEMA_CONTEXT } from './clarkSchemaContext';
import { ClarkBrainContext } from './clarkBrain.types';
import { planejarClark } from './clarkPlanner.service';
import { executarFerramentasClark } from './clarkToolExecutor.service';
import { validarResultadoClark } from './clarkVerifier.service';
import { responderFinalClark } from './clarkFinalResponder.service';
import { ClarkAgentPlan } from '../agent/clarkAgent.types';

function periodoVazio(): ClarkPeriodo {
  return { inicio: '', fim: '', descricao: '' };
}

function filtrosVazios(): ClarkFiltros {
  return extrairFiltrosClark('');
}

function intentFromPlan(plan: ClarkAgentPlan): ClarkIntent {
  const first = plan.toolCalls?.find((c) => c.tool !== 'resolver_produto')?.tool || plan.toolCalls?.[0]?.tool;
  if (first === 'consultar_ranking_estoque') return 'ranking_estoque_produtos';
  if (first === 'consultar_estoque_produto') return 'estoque_produto_lojas';
  if (first === 'consultar_vendas_por_loja') return 'ranking_lojas_vendas';
  if (first === 'consultar_vendas_por_vendedor') return 'ranking_vendedores_vendas';
  if (first === 'consultar_vendas_por_categoria') return 'ranking_categorias_vendas';
  if (first === 'consultar_vendas_resumo') return 'vendas_resumo';
  if (first === 'consultar_crescimento_mensal') return 'crescimento_mensal';
  if (
    first === 'consultar_relatorio_vendas' ||
    first === 'gerar_relatorio_executivo' ||
    first === 'executar_sql_analitico' ||
    first === 'consultar_analise_produto_comercial' ||
    first === 'consultar_vendas_vs_estoque' ||
    first === 'consultar_risco_stockout' ||
    first === 'consultar_excesso_estoque' ||
    first === 'consultar_redistribuicao_estoque' ||
    first === 'consultar_modo_diretoria'
  ) return 'relatorio_analitico_vendas';
  if (first === 'consultar_seguros_por_vendedor') return 'ranking_vendedores_seguros';
  if (first === 'consultar_seguros_por_loja') return 'ranking_lojas_seguros';
  return 'ajuda';
}

function sanitizeFinalText(text: string) {
  const resposta = String(text || '').trim();
  if (!resposta || resposta === '{}' || resposta === '[]' || resposta.toLowerCase() === 'null') {
    return 'Não consegui montar uma resposta segura a partir dos dados retornados. Nenhum dado foi inventado.';
  }
  if (resposta.includes('exactDictionaryCandidates') || resposta.includes('similarDictionaryCandidates') || resposta.includes('toolResults')) {
    return 'A consulta retornou dados técnicos internos, mas eles foram bloqueados para evitar uma resposta inadequada. Refaça a pergunta de forma mais específica ou solicite uma consulta de estoque, vendas ou relatório.';
  }
  return resposta;
}

export async function processarComClarkBrain(input: ClarkPerguntaInput): Promise<ClarkResposta> {
  const userId = String(input?.userId || '').trim();
  const perguntaOriginal = String(input?.pergunta || '').trim();

  if (!userId) {
    return {
      ok: false,
      clark: 'Usuário não informado. Faça login novamente e tente consultar a Clark.',
      intencao: 'ajuda',
      modo: 'simples',
      periodo: periodoVazio(),
      filtros: filtrosVazios(),
      dados: null,
      resposta_origem: 'fallback',
    };
  }

  if (!perguntaOriginal) {
    return {
      ok: false,
      clark: 'Digite uma pergunta para a Clark.',
      intencao: 'ajuda',
      modo: 'simples',
      periodo: periodoVazio(),
      filtros: filtrosVazios(),
      dados: null,
      resposta_origem: 'fallback',
    };
  }

  const historicoLimpo = limparHistoricoClark(input.historico);
  const memoriaExecutiva = await obterMemoriaExecutivaClark(userId);
  const perguntaComMemoria = aplicarMemoriaNaPerguntaClark(perguntaOriginal, memoriaExecutiva);
  const historico = montarHistoricoComMemoriaClark(memoriaExecutiva, historicoLimpo);
  const perguntaExpandida = expandirPerguntaComHistorico(perguntaComMemoria, historico);
  const periodo = extrairPeriodoClark(perguntaExpandida);
  const filtros = extrairFiltrosClark(perguntaExpandida);
  const scope = await obterEscopoUsuarioClark(userId);

  const context: ClarkBrainContext = {
    userId,
    perguntaOriginal,
    perguntaExpandida,
    historico,
    periodo,
    filtros,
    scope,
    schemaContext: CLARK_SCHEMA_CONTEXT,
  };

  const { plan: planned, usedGemini: usedGeminiPlanner } = await planejarClark(context);
  const { plan, results } = await executarFerramentasClark(planned, context);
  const verifier = validarResultadoClark(plan, results);
  const { text, usedGemini: usedGeminiResponder } = await responderFinalClark({ pergunta: perguntaOriginal, plan, results, verifier, periodo });

  const respostaFinal: ClarkResposta = {
    ok: verifier.ok,
    clark: sanitizeFinalText(text),
    intencao: intentFromPlan(plan),
    modo: plan.mode || 'analitico',
    periodo,
    filtros,
    dados: {
      plan,
      toolResults: results,
      verifier,
      brain: {
        version: 'v9-memory-executive',
        usedGeminiPlanner,
        usedGeminiResponder,
        memoryBefore: memoriaExecutiva,
      },
    },
    resposta_origem: usedGeminiPlanner || usedGeminiResponder ? 'gemini_analitico' : 'local_precisa',
    sugestoes: [
      'Gerar relatório executivo do período',
      'Comparar com outro período',
      'Filtrar por loja ou vendedor',
    ],
  };

  const memoriaAtualizada = await atualizarMemoriaExecutivaClark({
    userId,
    perguntaOriginal,
    resposta: respostaFinal,
  });

  respostaFinal.dados = {
    ...respostaFinal.dados,
    brain: {
      ...(respostaFinal.dados?.brain || {}),
      memoryAfter: memoriaAtualizada,
    },
  };

  return respostaFinal;
}
