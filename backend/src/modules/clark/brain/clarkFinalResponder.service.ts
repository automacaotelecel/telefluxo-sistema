import { GoogleGenAI } from '@google/genai';
import { ClarkAgentPlan, ClarkToolResult, ClarkVerificationResult } from '../agent/clarkAgent.types';
import { ClarkPeriodo } from '../clark.types';
import { formatBRL } from '../../intent/extractFilters';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function toNumber(v: any, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clip(value: any, max = 26000) { const text = String(value ?? ''); return text.length > max ? `${text.slice(0, max)}... [cortado]` : text; }
function isBadAnswer(text: string) {
  const s = String(text || '').trim();
  return !s || s === '{}' || s === '[]' || s.toLowerCase() === 'null' || s.startsWith('{"') || s.startsWith('{\n') || s.includes('exactDictionaryCandidates') || s.includes('similarDictionaryCandidates') || s.includes('toolResults');
}

function lojasCompactas(lojas: any[], limit = 5) {
  if (!Array.isArray(lojas) || !lojas.length) return 'sem lojas com quantidade positiva';
  const top = lojas.slice(0, limit).map((l) => `${l.loja}: ${toNumber(l.quantidade)}`).join(', ');
  const resto = lojas.length > limit ? ` (+${lojas.length - limit} lojas)` : '';
  return `${top}${resto}`;
}

export function respostaLocalExecutiva(params: { plan: ClarkAgentPlan; results: ClarkToolResult[]; periodo: ClarkPeriodo }) {
  const first = params.results.find((r) => r.ok && r.result)?.result;
  const tool = params.results.find((r) => r.ok && r.result)?.tool;

  if (!first) {
    const erro = params.results.find((r) => r.error)?.error;
    return erro ? `Não consegui concluir a consulta: ${erro}. Nenhum dado foi inventado.` : 'Não encontrei dados suficientes para responder com segurança. Nenhum dado foi inventado.';
  }

  if (tool === 'responder_ajuda') return first.mensagem || 'Posso analisar vendas, estoque, lojas, vendedores, categorias, seguros e relatórios executivos.';

  if (tool === 'consultar_ranking_estoque') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];
    if (!ranking.length) return `Não encontrei estoque positivo para a categoria ${first.categoria_solicitada || 'solicitada'}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.descricao} — ${toNumber(item.quantidade_total)} un.\n   Lojas principais: ${lojasCompactas(item.principais_lojas || item.lojas || [], 5)}`);
    return [`Top ${ranking.length} modelos com maior estoque${first.categoria_solicitada ? ` em ${first.categoria_solicitada}` : ''}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_estoque_produto') {
    const produtos = Array.isArray(first.produtos) ? first.produtos : [];
    const p = first.produto_planejado || {};
    const criterio = [p.family, p.storage, p.color, p.category ? `categoria ${p.category}` : null].filter(Boolean).join(', ');
    if (first.produto_nao_encontrado_exato || !produtos.length) {
      return [`Não encontrei estoque exato para ${criterio || first.termo_pesquisado || 'o produto solicitado'}.`, 'Não retornei modelos parecidos porque produto específico exige bater família/modelo, memória, cor e categoria.'].join('\n');
    }
    const linhas = produtos.map((item: any, i: number) => `${i + 1}. ${item.descricao} — ${toNumber(item.quantidade_total)} un.\n   Lojas: ${lojasCompactas(item.lojas || item.principais_lojas || [], 30)}`);
    return [`Encontrei estoque exato para ${criterio || first.termo_pesquisado}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_resumo') {
    return [`Resumo de vendas — ${first.periodo?.descricao || params.periodo.descricao}:`, `- Total: ${first.total_vendas_formatado || formatBRL(first.total_vendas)}`, `- Peças: ${toNumber(first.total_pecas)}`, `- Ticket médio: ${first.ticket_medio_formatado || formatBRL(first.ticket_medio)}`].join('\n');
  }

  if (tool === 'consultar_vendas_por_loja') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];
    if (!ranking.length) return `Não encontrei vendas por loja no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.loja}: ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | ${toNumber(item.total_pecas)} peças`);
    return [`Vendas por loja — ${first.periodo?.descricao || params.periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_por_vendedor') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];
    if (!ranking.length) return `Não encontrei vendas por vendedor no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.vendedor} (${item.loja}): ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | ${toNumber(item.total_pecas)} peças`);
    return [`Ranking de vendedores — ${first.periodo?.descricao || params.periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_por_categoria') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.categoria}: ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | ${toNumber(item.total_pecas)} peças`);
    return [`Vendas por categoria — ${first.periodo?.descricao || params.periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_seguros_por_vendedor' || tool === 'consultar_seguros_por_loja') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.vendedor || item.loja}: ${item.seguros_total_formatado || formatBRL(item.seguros_total)} | qtd: ${toNumber(item.seguros_qtd)}`);
    return [`Ranking de seguros — ${first.periodo?.descricao || params.periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'gerar_relatorio_executivo') {
    return String(first.relatorio || first.resumo || '').trim() || clip(JSON.stringify(first, null, 2), 6000);
  }

  if (tool === 'executar_sql_analitico') {
    const rows = Array.isArray(first.rows) ? first.rows : [];
    if (!rows.length) return 'Executei a consulta analítica, mas não encontrei registros para responder com segurança.';
    const linhas = rows.slice(0, 15).map((row: any, i: number) => `${i + 1}. ${Object.entries(row).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
    return [`Consulta analítica concluída. Encontrei ${first.total_linhas || rows.length} linha(s).`, '', ...linhas].join('\n');
  }

  return clip(JSON.stringify(first, null, 2), 5000);
}

function promptFinal(params: { pergunta: string; plan: ClarkAgentPlan; results: ClarkToolResult[]; verifier: ClarkVerificationResult; fallback: string }) {
  return `Você é a Clark, IA analítica executiva do TeleFluxo.

Responda em português do Brasil com clareza, precisão e formato profissional.

PERGUNTA:
${params.pergunta}

PLANO EXECUTADO:
${JSON.stringify(params.plan, null, 2)}

VALIDAÇÃO:
${JSON.stringify(params.verifier, null, 2)}

DADOS REAIS DAS FERRAMENTAS:
${clip(JSON.stringify(params.results.map((r) => ({ tool: r.tool, ok: r.ok, args: r.args, result: r.result, error: r.error })), null, 2), 30000)}

FALLBACK SEGURO:
${params.fallback}

REGRAS OBRIGATÓRIAS:
- Nunca invente números, lojas, produtos, vendedores ou períodos.
- Nunca mostre JSON bruto, trace, candidates, score, args ou nome de ferramenta interna.
- Produto específico é rígido: família/modelo, memória, cor e categoria.
- Responda com resumo objetivo, ranking/tabela simples e 1 a 3 insights quando houver dados.
- Para rankings de estoque, não inclua referência/código a menos que o usuário peça.
- Para muitas lojas, mostre as principais e indique “+N lojas”.
- Se não houver dado exato, diga claramente.

Se não conseguir melhorar o fallback com segurança, retorne o fallback reformatado.`;
}

export async function responderFinalClark(params: { pergunta: string; plan: ClarkAgentPlan; results: ClarkToolResult[]; verifier: ClarkVerificationResult; periodo: ClarkPeriodo }): Promise<{ text: string; usedGemini: boolean }> {
  const fallback = respostaLocalExecutiva({ plan: params.plan, results: params.results, periodo: params.periodo });
  if (!genAI) return { text: fallback, usedGemini: false };

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: promptFinal({ ...params, fallback }),
      config: { temperature: 0.25 } as any,
    });
    const text = String(response.text || '').trim();
    if (isBadAnswer(text)) return { text: fallback, usedGemini: false };
    return { text, usedGemini: true };
  } catch (error) {
    console.warn('⚠️ Responder Gemini falhou. Usando fallback local:', error);
    return { text: fallback, usedGemini: false };
  }
}
