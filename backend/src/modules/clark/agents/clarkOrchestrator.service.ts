import { ClarkBrainContext } from '../brain/clarkBrain.types';
import { ClarkExecutiveReport } from '../executive/clarkExecutive.types';
import { executarAgentePrecificacaoClark } from './clarkPricing.agent';

export type ClarkSpecialist = 'precificacao_concorrencia' | 'analise_operacional';

/** Ponto único de despacho. Novos especialistas entram neste registro. */
const agents: Record<'precificacao_concorrencia', (ctx: ClarkBrainContext) => ClarkExecutiveReport> = {
  precificacao_concorrencia: executarAgentePrecificacaoClark,
};

export function selecionarEspecialistaClark(pergunta: string): ClarkSpecialist {
  const text = pergunta.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/concorrenc|precific|precos? online|pesquis\w* (?:de )?preco|compar\w* (?:os? )?preco|preco\w*.*(?:magalu|amazon|mercado livre|casas bahia|kabum)|(?:magalu|amazon|mercado livre|casas bahia|kabum).*preco|mais barato.*(?:loja|concorrente|online)|\bpreco\b.*\b(?:galaxy|sm-|a\d{2}|s\d{2}|z flip|z fold)\b|\bquanto (?:ta|esta|custa)\b.*\b(?:galaxy|a\d{2}|s\d{2})\b/.test(text)) {
    return 'precificacao_concorrencia';
  }
  return 'analise_operacional';
}

export function executarEspecialistaClark(tipo: ClarkSpecialist, ctx: ClarkBrainContext): ClarkExecutiveReport | null {
  if (tipo === 'analise_operacional') return null; // Mantém o Brain original como agente operacional.
  return agents[tipo](ctx);
}
