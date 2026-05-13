import { clarkToolsRegistry } from '../tools/clarkTools.registry';
import { ClarkAgentPlan, ClarkToolName, ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkBrainContext } from './clarkBrain.types';

const INTERNAL_ONLY_TOOLS = new Set<ClarkToolName>(['resolver_produto']);

function ensureProductStockAfterResolver(plan: ClarkAgentPlan): ClarkAgentPlan {
  const hasResolver = plan.toolCalls.some((c) => c.tool === 'resolver_produto');
  const hasStock = plan.toolCalls.some((c) => c.tool === 'consultar_estoque_produto');
  if (!hasResolver || hasStock) return plan;

  const resolver = plan.toolCalls.find((c) => c.tool === 'resolver_produto');
  if (!resolver) return plan;

  return {
    ...plan,
    toolCalls: [
      ...plan.toolCalls,
      {
        tool: 'consultar_estoque_produto',
        reason: 'Consultar estoque exato depois da resolução do produto. Resolver produto não pode ser resposta final.',
        args: { ...resolver.args, strict: true, limit: resolver.args?.limit || 50 },
      },
    ],
  };
}

export async function executarFerramentasClark(planOriginal: ClarkAgentPlan, ctx: ClarkBrainContext): Promise<{ plan: ClarkAgentPlan; results: ClarkToolResult[] }> {
  const plan = ensureProductStockAfterResolver(planOriginal);
  const results: ClarkToolResult[] = [];

  for (const call of plan.toolCalls || []) {
    const handler = clarkToolsRegistry[call.tool];
    if (!handler) {
      results.push({ tool: call.tool, ok: false, args: call.args || {}, result: null, error: `Ferramenta não registrada: ${call.tool}` });
      continue;
    }

    try {
      const result = await handler(call.args || {}, {
        userId: ctx.userId,
        pergunta: ctx.perguntaExpandida,
        periodo: ctx.periodo,
        filtros: ctx.filtros,
        scope: ctx.scope,
      });
      results.push(result);
    } catch (error: any) {
      results.push({ tool: call.tool, ok: false, args: call.args || {}, result: null, error: error?.message || `Erro ao executar ${call.tool}.` });
    }
  }

  // Nunca deixe uma execução só com ferramenta interna virar resposta final.
  const publicResults = results.filter((r) => !INTERNAL_ONLY_TOOLS.has(r.tool));
  return { plan, results: publicResults.length ? publicResults : results };
}
