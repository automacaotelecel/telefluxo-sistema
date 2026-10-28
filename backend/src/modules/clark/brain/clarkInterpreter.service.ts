import { GoogleGenAI } from '@google/genai';
import { ClarkToolCall, ClarkToolName } from '../clarkAgent.types';
import { ClarkBrainContext } from './clarkBrain.types';
import { gerarTextoClaudeClark } from '../../ai/claudeClark';
import { ClarkPeriodoValidado, hojeSaoPauloClark, validarPeriodosClark } from './clarkPeriodGuard';
import { LOJAS_MAP_GLOBAL } from '../clark.types';

// Lojas oficiais (sem duplicatas): o LLM deve devolver exatamente um destes nomes em filtros.loja.
const LOJAS_CANONICAS = Array.from(new Set(Object.values(LOJAS_MAP_GLOBAL)));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const PROVIDER = String(process.env.CLARK_PROVIDER || '').trim().toLowerCase();
const TIMEOUT_MS = 20000;
const LIMITE_DIFERENCA_DURACAO = 0.2;

/**
 * Flag de proteção: o interpretador só roda com CLARK_INTERPRETER_ENABLED=true (desligado por padrão).
 * Mantém o fluxo por regex até o Brain consumir `periodoEfetivo` por completo.
 */
export function interpretadorAtivoClark(): boolean {
  return String(process.env.CLARK_INTERPRETER_ENABLED || '').trim().toLowerCase() === 'true';
}

export type ClarkIntencao = 'vendas' | 'comparativo' | 'ranking' | 'seguros' | 'relatorio' | 'conversa' | 'ajuda';

export type ClarkInterpretacao = {
  intencao: ClarkIntencao;
  resumo: string;
  confianca: number;
  /** Já validados pelo period guard. [0] = principal, [1] = comparação (opcional). */
  periodos: ClarkPeriodoValidado[];
  /** `loja` = nome oficial reconhecido; `lojaCitada` = como o usuário escreveu (mesmo se não existir na lista). */
  filtros: { loja?: string; lojaCitada?: string; categoria?: string; vendedor?: string; limite?: number };
  /** Cada chamada traz `periodo: 0|1` em args; as datas NUNCA vêm do LLM nos args. */
  tools: ClarkToolCall[];
};

// Só ferramentas de vendas/seguros/relatório/conversa. Produto e estoque seguem o caminho determinístico.
const TOOLS_PERMITIDAS = new Set<ClarkToolName>([
  'consultar_vendas_resumo',
  'consultar_vendas_por_loja',
  'consultar_vendas_por_vendedor',
  'consultar_vendas_por_categoria',
  'consultar_crescimento_mensal',
  'consultar_relatorio_vendas',
  'consultar_seguros_por_vendedor',
  'consultar_seguros_por_loja',
  'responder_conversa',
  'responder_ajuda',
]);

const INTENCOES = new Set<string>(['vendas', 'comparativo', 'ranking', 'seguros', 'relatorio', 'conversa', 'ajuda']);

function parseJson(text: string) {
  const raw = String(text || '').trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
    throw new Error('Interpretador não retornou JSON válido.');
  }
}

function comTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timeout do LLM (${TIMEOUT_MS}ms)`)), TIMEOUT_MS)),
  ]);
}

async function chamarLlm(system: string, prompt: string): Promise<string | null> {
  if (PROVIDER === 'claude') {
    return comTimeout(gerarTextoClaudeClark({ system, prompt, maxTokens: 1200 }));
  }
  if (!genAI) return null;
  const r = await comTimeout(
    genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { systemInstruction: system, temperature: 0, responseMimeType: 'application/json' } as any,
    }),
  );
  return String(r.text || '');
}

function diaDaSemana(iso: string) {
  return ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][
    new Date(`${iso}T12:00:00Z`).getUTCDay()
  ];
}

function diasInclusivos(p: { inicio: string; fim: string }) {
  return Math.round((Date.parse(`${p.fim}T00:00:00Z`) - Date.parse(`${p.inicio}T00:00:00Z`)) / 86400000) + 1;
}

function montarPrompt(ctx: ClarkBrainContext, hoje: string) {
  const historico = (ctx.historico || [])
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Clark' : 'Usuário'}: ${String(m.text).slice(0, 600)}`)
    .join('\n');

  return `Hoje é ${hoje} (${diaDaSemana(hoje)}), fuso America/Sao_Paulo.

Você interpreta a pergunta de um diretor e devolve um plano JSON. Você NÃO responde a pergunta e NÃO calcula números.

PERGUNTA: ${ctx.perguntaOriginal}
HISTÓRICO RECENTE:
${historico || '(sem histórico)'}

PERÍODOS (campo "periodos", máximo 2, datas YYYY-MM-DD, nunca no futuro):
- [0] é o período principal; [1] só existe em comparações ("vs mês passado", "trimestre anterior").
- Sem período na pergunta: mês atual do dia 1 até hoje.
- "mês passado" = mês anterior inteiro; "essa semana" = segunda-feira até hoje; "semana passada" = segunda a domingo anteriores;
  "trimestre" = trimestre civil (jan-mar, abr-jun, jul-set, out-dez); "ano" = 1º de janeiro até hoje; "YTD" = igual a "ano".
- Em comparação com período corrente incompleto, use no período de comparação o MESMO número de dias (ex.: 1 a 21 do mês anterior).
- Pergunta de follow-up ("e no Park?") herda período e intenção do histórico.

LOJAS OFICIAIS: ${LOJAS_CANONICAS.join(' | ')}
- "filtros.loja" deve ser EXATAMENTE um destes nomes (ex.: "Park" → "PARK SHOPPING") ou null quando a loja citada não estiver na lista.
- "filtros.lojaCitada" é a loja/shopping/unidade que o usuário mencionou, como ele escreveu (ex.: "Shopping Atlântida"), MESMO que não exista na lista; null só se a pergunta não citar nenhuma loja.

FERRAMENTAS (campo "tools", máximo 4; a mesma ferramenta pode repetir com "periodo": 0 ou 1):
- consultar_vendas_resumo: total, peças e ticket do período. args: loja?, categoria?
- consultar_vendas_por_loja | consultar_vendas_por_vendedor | consultar_vendas_por_categoria: rankings. args: loja?, categoria?, limite?
- consultar_crescimento_mensal: variação mês a mês (já compara períodos equivalentes). args: loja?
- consultar_relatorio_vendas: relatório completo do período.
- consultar_seguros_por_vendedor | consultar_seguros_por_loja: seguros. args: limite?
- responder_conversa: cumprimentos e conversa sem dados.
- responder_ajuda: pergunta fora do que o Clark consegue consultar.
Para "quanto vendemos a mais/menos que X": use consultar_vendas_resumo para periodos[0] e para periodos[1].

Responda SOMENTE JSON:
{"intencao":"vendas|comparativo|ranking|seguros|relatorio|conversa|ajuda","resumo":"o que o usuário quer, em uma frase","confianca":0.0,
 "periodos":[{"inicio":"YYYY-MM-DD","fim":"YYYY-MM-DD","descricao":"ex.: mês atual até hoje"}],
 "filtros":{"loja":null,"lojaCitada":null,"categoria":null,"vendedor":null,"limite":null},
 "tools":[{"tool":"consultar_vendas_resumo","periodo":0,"args":{}}]}`;
}

/**
 * Converte a resposta bruta do LLM em interpretação validada (parse + period guard + ferramentas permitidas).
 * Função pura (sem chamada de rede). Retorna null se não houver ferramenta válida.
 */
export function construirInterpretacaoClark(texto: string, hoje = hojeSaoPauloClark()): ClarkInterpretacao | null {
  const parsed = parseJson(texto);
  const periodos = validarPeriodosClark(parsed?.periodos, hoje);

  // Aviso (sem bloquear): comparativo sem segundo período (o LLM esqueceu a comparação).
  if (parsed?.intencao === 'comparativo' && periodos.length === 1) {
    console.warn(
      `[clark][interpreter] intenção comparativo com apenas 1 período | ` +
        `${periodos[0]!.periodo.inicio}..${periodos[0]!.periodo.fim}`,
    );
  }

  // Aviso (sem bloquear): comparação entre períodos de duração muito diferente.
  if (periodos.length === 2) {
    const [a, b] = periodos.map((p) => diasInclusivos(p.periodo));
    const maior = Math.max(a!, b!);
    if (maior > 0 && Math.abs(a! - b!) / maior > LIMITE_DIFERENCA_DURACAO) {
      console.warn(
        `[clark][interpreter] períodos com duração diferente (${a} vs ${b} dias) | ` +
          `${periodos[0]!.periodo.inicio}..${periodos[0]!.periodo.fim} vs ${periodos[1]!.periodo.inicio}..${periodos[1]!.periodo.fim}`,
      );
    }
  }

  const tools: ClarkToolCall[] = (Array.isArray(parsed?.tools) ? parsed.tools : [])
    .filter((t: any) => t && TOOLS_PERMITIDAS.has(String(t.tool) as ClarkToolName))
    .slice(0, 4)
    .map((t: any) => {
      const args = t.args && typeof t.args === 'object' ? { ...t.args } : {};
      // Datas só vêm de `periodos` (validados); o LLM não injeta datas nos args.
      delete args.startDate;
      delete args.endDate;
      delete args.inicio;
      delete args.fim;
      const idx = Number(t.periodo) === 1 && periodos.length > 1 ? 1 : 0;
      const limite = Number(args.limite ?? args.limit);
      delete args.limite;
      delete args.limit;
      if (Number.isFinite(limite) && limite > 0) args.limit = Math.min(Math.floor(limite), 100);
      return { tool: String(t.tool) as ClarkToolName, reason: 'Interpretação do LLM', args: { ...args, periodo: idx } };
    });

  if (!tools.length) return null;

  const f = parsed?.filtros && typeof parsed.filtros === 'object' ? parsed.filtros : {};
  const str = (v: any) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  const limiteF = Number(f.limite);

  return {
    intencao: INTENCOES.has(String(parsed?.intencao)) ? (parsed.intencao as ClarkIntencao) : 'ajuda',
    resumo: String(parsed?.resumo || '').slice(0, 300),
    confianca: Math.max(0, Math.min(Number(parsed?.confianca) || 0, 1)),
    periodos,
    filtros: {
      ...(str(f.loja) ? { loja: str(f.loja)! } : {}),
      ...(str(f.lojaCitada) ? { lojaCitada: str(f.lojaCitada)! } : {}),
      ...(str(f.categoria) ? { categoria: str(f.categoria)! } : {}),
      ...(str(f.vendedor) ? { vendedor: str(f.vendedor)! } : {}),
      ...(Number.isFinite(limiteF) && limiteF > 0 ? { limite: Math.min(Math.floor(limiteF), 100) } : {}),
    },
    tools,
  };
}

/**
 * Situação do interpretador numa resposta (exposta em dados.brain.interpretadorStatus):
 * - 'desligado': CLARK_INTERPRETER_ENABLED não está 'true';
 * - 'nao_usado': flag ligada, mas a pergunta não passou pelo interpretador (ex.: produto/estoque);
 * - 'ok': o interpretador respondeu e o plano foi construído;
 * - 'falhou:<motivo>': tentou e caiu no fallback de regex (autenticacao, timeout, json_invalido, ...).
 */
export type ClarkInterpretadorStatus = 'desligado' | 'nao_usado' | 'ok' | `falhou:${string}`;

let falhaAutenticacaoJaLogada = false;

function motivoDaFalha(error: unknown): string {
  const msg = String((error as any)?.message || error || '');
  const lower = msg.toLowerCase();
  if (lower.includes('não configurada') || lower.includes('nao configurada')) return 'sem_chave_llm';
  if (
    lower.includes('api key not valid') || lower.includes('api_key_invalid') || lower.includes('invalid x-api-key') ||
    lower.includes('authentication') || lower.includes('permission_denied') || lower.includes('permission denied') ||
    /\b(401|403)\b/.test(lower)
  ) return 'autenticacao';
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('resource_exhausted') || lower.includes('overloaded')) return 'limite_ou_sobrecarga';
  if (lower.includes('json')) return 'json_invalido';
  return 'erro_llm';
}

/** Primeira falha de autenticação do processo: log destacado (as demais seguem só no warn normal). */
function logarFalhaDeAutenticacaoUmaVez(error: unknown) {
  if (falhaAutenticacaoJaLogada) return;
  falhaAutenticacaoJaLogada = true;
  const provider = PROVIDER === 'claude' ? 'claude (ANTHROPIC_API_KEY)' : 'gemini (GEMINI_API_KEY)';
  console.error(
    '\n[clark][ATENÇÃO] FALHA DE AUTENTICAÇÃO NO PROVEDOR DE LLM — provider=' + provider + '.\n' +
      '  A chave está inválida, expirada ou sem permissão. O interpretador (e demais recursos de IA do Clark) está operando em FALLBACK de regex.\n' +
      '  Verifique CLARK_PROVIDER, GEMINI_API_KEY e ANTHROPIC_API_KEY no ambiente. Detalhe: ' + String((error as any)?.message || error).slice(0, 200) + '\n',
  );
}

/**
 * Interpreta pergunta livre (período + intenção + ferramentas) com 1 chamada ao LLM.
 * `interpretacao` é null em qualquer falha (sem chave, autenticação, timeout, JSON inválido, sem ferramenta válida):
 * o chamador deve usar o fluxo atual por regex como fallback, e o `status` explica o motivo.
 */
export async function interpretarPerguntaComStatusClark(
  ctx: ClarkBrainContext,
): Promise<{ interpretacao: ClarkInterpretacao | null; status: ClarkInterpretadorStatus }> {
  if (!interpretadorAtivoClark()) return { interpretacao: null, status: 'desligado' };

  try {
    const hoje = hojeSaoPauloClark();
    const texto = await chamarLlm(
      'Você é o interpretador da Clark, IA analítica do TeleFluxo. Retorne somente JSON válido, sem markdown.',
      montarPrompt(ctx, hoje),
    );
    if (!texto) return { interpretacao: null, status: 'falhou:sem_chave_llm' };

    const interpretacao = construirInterpretacaoClark(texto, hoje);
    if (!interpretacao) {
      console.warn('[clark][interpreter] LLM não retornou ferramenta válida; usando fallback');
      return { interpretacao: null, status: 'falhou:sem_ferramenta_valida' };
    }
    return { interpretacao, status: 'ok' };
  } catch (error) {
    const motivo = motivoDaFalha(error);
    if (motivo === 'autenticacao') logarFalhaDeAutenticacaoUmaVez(error);
    console.warn(`[clark][interpreter] falhou (${motivo}); usando fallback:`, error);
    return { interpretacao: null, status: `falhou:${motivo}` };
  }
}

/** Compatibilidade: só a interpretação (null se desligado ou em qualquer falha). */
export async function interpretarPerguntaClark(ctx: ClarkBrainContext): Promise<ClarkInterpretacao | null> {
  return (await interpretarPerguntaComStatusClark(ctx)).interpretacao;
}
