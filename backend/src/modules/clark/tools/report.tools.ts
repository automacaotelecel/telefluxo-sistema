import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';
import {
  toolConsultarRelatorioVendas,
  toolConsultarSegurosPorLoja,
  toolConsultarSegurosPorVendedor,
  toolConsultarVendasPorLoja,
  toolConsultarVendasPorVendedor,
  toolConsultarVendasResumo,
} from './sales.tools';
import { toolConsultarRankingEstoque } from './stock.tools';

function toNumber(v: any, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function brl(v: any) { return toNumber(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function topResumo(ranking: any[], label: string, valueKey = 'total_vendas') {
  if (!Array.isArray(ranking) || !ranking.length) return `- ${label}: sem dados encontrados.`;
  return ranking.slice(0, 5).map((item: any) => {
    const nome = item.loja || item.vendedor || item.categoria || item.descricao || 'Item';
    const valor = item[`${valueKey}_formatado`] || brl(item[valueKey] ?? item.quantidade_total ?? item.seguros_total ?? 0);
    return `- ${nome}: ${valor}`;
  }).join('\n');
}

export async function toolGerarRelatorioExecutivo(args: Record<string, any>, ctx: ClarkToolContext): Promise<ClarkToolResult> {
  try {
    const periodoCtx = (ctx.periodo || {}) as any;
    const baseArgs = {
      ...args,
      limit: args.limit || 10,
      originalQuestion: args.originalQuestion || ctx.pergunta || '',
      startDate: args.startDate || periodoCtx.inicio,
      endDate: args.endDate || periodoCtx.fim,
    };

    const [resumo, lojas, vendedores, segurosLojas, segurosVend, estoque, relatorioVendas] = await Promise.all([
      toolConsultarVendasResumo(baseArgs, ctx),
      toolConsultarVendasPorLoja(baseArgs, ctx),
      toolConsultarVendasPorVendedor(baseArgs, ctx),
      toolConsultarSegurosPorLoja(baseArgs, ctx),
      toolConsultarSegurosPorVendedor(baseArgs, ctx),
      toolConsultarRankingEstoque({ ...baseArgs, category: args.category || args.categoria || 'SMARTPHONES', limit: 5, includeStores: true }, ctx),
      toolConsultarRelatorioVendas(baseArgs, ctx),
    ]);

    const periodo = resumo.result?.periodo?.descricao || periodoCtx.descricao || `${baseArgs.startDate || ''} até ${baseArgs.endDate || ''}`;
    const total = resumo.result?.total_vendas_formatado || brl(resumo.result?.total_vendas || 0);
    const pecas = toNumber(resumo.result?.total_pecas || 0);
    const ticket = resumo.result?.ticket_medio_formatado || brl(resumo.result?.ticket_medio || 0);

    const linhasEstoque = Array.isArray(estoque.result?.ranking)
      ? estoque.result.ranking.slice(0, 5).map((i: any) => `- ${i.descricao}: ${toNumber(i.quantidade_total)} un.`).join('\n')
      : '- Sem dados de estoque.';

    const relatorio = [
      `Relatório executivo — ${periodo}`,
      '',
      '1. Resumo geral',
      `- Vendas totais: ${total}`,
      `- Peças vendidas: ${pecas}`,
      `- Ticket médio: ${ticket}`,
      '',
      '2. Destaques por loja',
      topResumo(lojas.result?.ranking || [], 'lojas', 'total_vendas'),
      '',
      '3. Destaques por vendedor',
      topResumo(vendedores.result?.ranking || [], 'vendedores', 'total_vendas'),
      '',
      '4. Seguros',
      'Por loja:',
      topResumo(segurosLojas.result?.ranking || [], 'seguros por loja', 'seguros_total'),
      'Por vendedor:',
      topResumo(segurosVend.result?.ranking || [], 'seguros por vendedor', 'seguros_total'),
      '',
      '5. Estoque em destaque',
      linhasEstoque,
      '',
      '6. Recomendações iniciais',
      '- Avaliar lojas com alta concentração de estoque e baixo giro no período.',
      '- Cruzar vendedores com baixa participação de seguros para plano de treinamento.',
      '- Monitorar produtos com maior concentração no CD para possível redistribuição.',
    ].join('\n');

    return {
      tool: 'gerar_relatorio_executivo',
      ok: true,
      args,
      result: {
        periodo,
        relatorio,
        dados: {
          resumo: resumo.result,
          lojas: lojas.result,
          vendedores: vendedores.result,
          segurosLojas: segurosLojas.result,
          segurosVend: segurosVend.result,
          estoque: estoque.result,
          relatorioVendas: relatorioVendas.result,
        },
        erros: [resumo, lojas, vendedores, segurosLojas, segurosVend, estoque, relatorioVendas].filter((r) => !r.ok).map((r) => ({ tool: r.tool, error: r.error })),
      },
    };
  } catch (error: any) {
    return { tool: 'gerar_relatorio_executivo', ok: false, args, result: null, error: error?.message || 'Erro ao gerar relatório executivo.' };
  }
}
