import { ClarkHistoricoMensagem } from '../clark.types';

export function limparHistoricoClark(historico?: ClarkHistoricoMensagem[]): ClarkHistoricoMensagem[] {
  return (Array.isArray(historico) ? historico : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: String(m.text).slice(0, 2000) }));
}

function normalizarFollowUp(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Só herda contexto quando a pergunta realmente parece continuação.
 * A versão anterior tratava qualquer pergunta curta como follow-up e isso fazia
 * palavras do histórico contaminarem intenção, produto, loja e período atuais.
 */
export function perguntaPareceFollowUpClark(pergunta: string): boolean {
  const limpa = String(pergunta || '').trim();
  if (!limpa) return false;

  const texto = normalizarFollowUp(limpa);

  const comecaComoContinuacao =
    /^(E\b|AGORA\b|TAMBEM\b|SO\b|SOMENTE\b|APENAS\b|ENTAO\b|COMPARE\b|COMPARA\b|NO\b|NA\b|NESSE\b|NESSA\b|NESTE\b|NESTA\b|DESSE\b|DESSA\b)/.test(texto);

  const referenciaContextual =
    /\b(ESSE|ESSA|ISSO|ELE|ELA|DELE|DELA|MESMO|MESMA|ANTERIOR|ACIMA|ULTIMO|ULTIMA|TAMBEM|NESSE|NESSA|DESSE|DESSA)\b/.test(texto);

  const followUpTemporalCurto =
    /^(E\s+)?(MES PASSADO|SEMANA PASSADA|ONTEM|HOJE|AMANHA)(\b|\?)/.test(texto);

  return comecaComoContinuacao || referenciaContextual || followUpTemporalCurto;
}

export function expandirPerguntaComHistorico(pergunta: string, historico?: ClarkHistoricoMensagem[]) {
  const limpa = String(pergunta || '').trim();
  const hist = limparHistoricoClark(historico);

  if (!hist.length || !perguntaPareceFollowUpClark(limpa)) {
    return limpa;
  }

  const contexto = hist
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Clark' : 'Usuário'}: ${m.text}`)
    .join('\n');

  return `Contexto recente da conversa:\n${contexto}\n\nPergunta atual do usuário: ${limpa}`;
}
