import { ClarkHistoricoMensagem } from '../clark.types';

export function limparHistoricoClark(historico?: ClarkHistoricoMensagem[]): ClarkHistoricoMensagem[] {
  return (Array.isArray(historico) ? historico : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: String(m.text).slice(0, 2000) }));
}

export function expandirPerguntaComHistorico(pergunta: string, historico?: ClarkHistoricoMensagem[]) {
  const limpa = String(pergunta || '').trim();
  const hist = limparHistoricoClark(historico);
  if (!hist.length) return limpa;

  const pareceFollowUp =
    limpa.length <= 60 ||
    /^(e\s+|agora\s+|tamb[eé]m\s+|s[oó]\s+|somente\s+|apenas\s+|no\s+|na\s+|da\s+|do\s+|compara|compare|ent[aã]o)/i.test(limpa);

  if (!pareceFollowUp) return limpa;

  const contexto = hist
    .slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Clark' : 'Usuário'}: ${m.text}`)
    .join('\n');

  return `Contexto recente da conversa:\n${contexto}\n\nPergunta atual do usuário: ${limpa}`;
}
