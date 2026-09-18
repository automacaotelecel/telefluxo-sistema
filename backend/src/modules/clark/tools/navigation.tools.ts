import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

const VIEW_LABELS: Record<string, string> = {
  home: 'Início',
  stock: 'Controle de Estoque',
  estoque_vendas: 'Ponto de Pedido',
  estoque_detalhado: 'Previsão Estoque',
  alertas_inteligentes: 'Alertas',
  estoque_inteligente: 'Estoque Inteligente',
  stockout: 'Stockout',
  sales_dash: 'Vendas Mensal',
  comparativo: 'Vendas Anuais',
  comparativos_pdf: 'Montar Comparativo',
  agenda: 'Agenda Pessoal',
  solicitacoes: 'Solicitações',
  rh: 'RH',
};

export async function toolNavegarModulo(
  args: Record<string, any>,
  _ctx: ClarkToolContext,
): Promise<ClarkToolResult> {
  const view = String(args.view || args.target || '').trim();
  const label = VIEW_LABELS[view];

  if (!view || !label) {
    return {
      tool: 'navegar_modulo',
      ok: false,
      args,
      result: null,
      error: 'Não consegui identificar o módulo solicitado para navegação.',
    };
  }

  return {
    tool: 'navegar_modulo',
    ok: true,
    args,
    result: { view, label },
  };
}

export async function toolResponderConversa(
  args: Record<string, any>,
  _ctx: ClarkToolContext,
): Promise<ClarkToolResult> {
  return {
    tool: 'responder_conversa',
    ok: true,
    args,
    result: {
      pergunta: String(args.originalQuestion || args.question || '').trim(),
      mensagemFallback: 'Estou por aqui. Posso conversar com você e também consultar os dados do TeleFluxo quando precisar.',
    },
  };
}
