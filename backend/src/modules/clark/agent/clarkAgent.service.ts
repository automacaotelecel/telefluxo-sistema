import { GoogleGenAI } from '@google/genai';

import {
  ClarkAgentInput,
  ClarkAgentOutput,
  ClarkAgentPlan,
  ClarkAgentTrace,
  ClarkToolResult,
  ClarkToolName,
} from './clarkAgent.types';

import {
  montarPromptPlanejamentoClark,
  montarPromptRespostaFinalClark,
} from './clarkAgent.prompt';

import { clarkToolsRegistry } from '../tools/clarkTools.registry';
import { verificarRespostaClark } from '../tools/answerVerifier';
import { normalizarTextoClark } from '../../intent/extractFilters';
import { extrairPeriodoClark } from '../../intent/extractPeriod';
import { extractColor, extractStorage, getBaseModelFamily } from '../../productDictionary/productDictionary.utils';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function stripJsonFences(text: string) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extrairJsonSeguro(texto: string) {
  const raw = stripJsonFences(texto);
  if (!raw) throw new Error('Resposta vazia da IA.');

  try {
    return JSON.parse(raw);
  } catch {
    const inicio = raw.indexOf('{');
    const fim = raw.lastIndexOf('}');
    if (inicio >= 0 && fim > inicio) return JSON.parse(raw.slice(inicio, fim + 1));
    throw new Error('JSON inválido retornado pela IA.');
  }
}

function numeroLimite(pergunta: string, fallback = 10) {
  const t = normalizarTextoClark(pergunta);
  const m = t.match(/\bTOP\s+(\d{1,3})\b/) ||
    t.match(/\bLISTE\s+OS?\s+(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s+(MAIORES|MELHORES|MODELOS|PRODUTOS|VENDEDORES|LOJAS)\b/);
  const n = m?.[1] ? Number(m[1]) : fallback;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : fallback;
}

function inferirCategoriaProduto(pergunta: string) {
  const t = normalizarTextoClark(pergunta);
  if (t.includes('SMART') || t.includes('GALAXY') || t.includes('CELULAR') || t.includes('APARELHO')) return 'SMARTPHONES';
  if (t.includes('TABLET') || t.includes('TAB ')) return 'TABLETS';
  if (t.includes('WEARABLE') || t.includes('WATCH') || t.includes('BUDS')) return 'WEARABLES';
  if (t.includes('ACESSORIO')) return 'ACESSÓRIOS';
  return undefined;
}

function limparTermoProduto(pergunta: string) {
  return String(pergunta || '')
    .replace(/^me\s+liste\s+as\s+lojas\s+que\s+t[eê]m\s+/i, '')
    .replace(/^quais\s+lojas\s+t[eê]m\s+o?\s*/i, '')
    .replace(/^quais\s+lojas\s+possuem\s+o?\s*/i, '')
    .replace(/^onde\s+t[eê]m\s+o?\s*/i, '')
    .replace(/\bem\s+estoque\b/gi, ' ')
    .replace(/\bna\s+categoria\s+[a-z0-9\sçãõéíóúâêô]+$/gi, ' ')
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function planoBase(pergunta: string): ClarkAgentPlan {
  return {
    understoodQuestion: pergunta,
    taskType: 'help',
    mode: 'simples',
    confidence: 0.3,
    entities: {},
    toolCalls: [{ tool: 'responder_ajuda', reason: 'Não classificado com segurança.', args: { pergunta } }],
    validationRules: [],
    answerStyle: {
      shouldExplainUncertainty: true,
      shouldIncludeTables: false,
      shouldIncludeInsights: false,
      shouldIncludeSuggestions: true,
    },
  };
}

function planoLocal(pergunta: string): ClarkAgentPlan {
  const t = normalizarTextoClark(pergunta);
  const limite = numeroLimite(pergunta, 10);
  const periodo = extrairPeriodoClark(pergunta);
  const perguntaArgs = { pergunta, startDate: periodo.inicio, endDate: periodo.fim, label: periodo.descricao, limit: limite };

  const falaEstoque = t.includes('ESTOQUE') || t.includes('TEM') || t.includes('POSSUEM') || t.includes('MODELOS QUE MAIS TEMOS') || t.includes('MODELOS QUE MAIS');
  const rankingEstoque = falaEstoque && (t.includes('RANKING') || t.includes('TOP') || t.includes('MAIORES') || t.includes('MODELOS QUE MAIS') || t.includes('MAIOR ESTOQUE'));
  const produtoEstoque = falaEstoque && (t.includes('QUAIS LOJAS') || t.includes('ONDE TEM') || t.includes('POSSUEM') || /\bGALAXY\s+[A-Z]?\s?\d{2}/.test(t) || /\b[ASZM]\d{2}\b/.test(t));

  if (rankingEstoque) {
    const category = inferirCategoriaProduto(pergunta) || 'SMARTPHONES';
    return {
      ...planoBase(pergunta),
      taskType: 'stock_ranking',
      confidence: 0.92,
      entities: { category, limit: limite },
      toolCalls: [{ tool: 'consultar_ranking_estoque', reason: 'Usuário pediu ranking de estoque.', args: { category, limit: limite, includeStores: true } }],
      validationRules: ['Ranking deve ter produtos, quantidade total e lojas.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: false },
    };
  }

  if (produtoEstoque) {
    const raw = limparTermoProduto(pergunta);
    const family = getBaseModelFamily(raw) || getBaseModelFamily(pergunta) || undefined;
    const storage = extractStorage(raw) || extractStorage(pergunta) || undefined;
    const color = extractColor(raw) || extractColor(pergunta) || undefined;
    const category = inferirCategoriaProduto(pergunta) || 'SMARTPHONES';
    const product: Record<string, any> = { raw, category };
    if (family) product.family = family;
    if (family) product.model = family.replace(/^GALAXY\s+/, '');
    if (storage) product.storage = storage;
    if (color) product.color = color;

    return {
      ...planoBase(pergunta),
      taskType: 'stock_product_search',
      confidence: 0.94,
      entities: { product, limit: 50 },
      toolCalls: [
        { tool: 'resolver_produto', reason: 'Resolver produto solicitado.', args: { query: raw, ...product } },
        { tool: 'consultar_estoque_produto', reason: 'Consultar estoque exato por loja.', args: { query: raw, ...product, strict: true, limit: 50 } },
      ],
      validationRules: ['Não retornar família, memória ou cor diferente da solicitada.'],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: false, shouldIncludeSuggestions: true },
    };
  }

  if (t.includes('SEGURO') || t.includes('SEGUROS')) {
    const porLoja = t.includes('LOJA') || t.includes('LOJAS');
    return {
      ...planoBase(pergunta),
      taskType: porLoja ? 'insurance_by_store' : 'insurance_by_seller',
      confidence: 0.9,
      entities: { period: { startDate: periodo.inicio, endDate: periodo.fim, label: periodo.descricao }, limit: limite },
      toolCalls: [{ tool: porLoja ? 'consultar_seguros_por_loja' : 'consultar_seguros_por_vendedor', reason: 'Usuário pediu ranking/análise de seguros.', args: perguntaArgs }],
      validationRules: ['Resposta deve usar dados de seguros.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (t.includes('VENDA') || t.includes('VENDAS') || t.includes('FATURAMENTO') || t.includes('FATURAMOS')) {
    let taskType: ClarkAgentPlan['taskType'] = 'sales_summary';
    let tool: ClarkToolName = 'consultar_vendas_resumo';
    if (t.includes('RELATORIO') || t.includes('RELATÓRIO') || t.includes('ANALISE') || t.includes('ANÁLISE') || t.includes('INSIGHT')) {
      taskType = 'sales_report'; tool = 'consultar_relatorio_vendas';
    } else if (t.includes('CRESCIMENTO') || t.includes('MES A MES') || t.includes('MÊS A MÊS') || t.includes('MENSAL')) {
      taskType = 'sales_growth'; tool = 'consultar_crescimento_mensal';
    } else if (t.includes('VENDEDOR') || t.includes('VENDEDORES')) {
      taskType = 'sales_by_seller'; tool = 'consultar_vendas_por_vendedor';
    } else if (t.includes('CATEGORIA') || t.includes('CATEGORIAS') || t.includes('FAMILIA') || t.includes('FAMÍLIA')) {
      taskType = 'sales_by_category'; tool = 'consultar_vendas_por_categoria';
    } else if (t.includes('LOJA') || t.includes('LOJAS') || t.includes('PARK') || t.includes('SHOPPING')) {
      taskType = 'sales_by_store'; tool = 'consultar_vendas_por_loja';
    }

    return {
      ...planoBase(pergunta),
      taskType,
      mode: taskType === 'sales_report' ? 'analitico' : 'simples',
      confidence: 0.9,
      entities: { period: { startDate: periodo.inicio, endDate: periodo.fim, label: periodo.descricao }, limit: limite },
      toolCalls: [{ tool, reason: 'Consultar dados reais de vendas.', args: perguntaArgs }],
      validationRules: ['Resposta deve respeitar período e filtros solicitados.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  return planoBase(pergunta);
}

function limparPlano(rawPlan: any, pergunta: string): ClarkAgentPlan {
  const fallback = planoLocal(pergunta);
  const toolCalls = Array.isArray(rawPlan?.toolCalls) && rawPlan.toolCalls.length
    ? rawPlan.toolCalls.filter((c: any) => c?.tool && clarkToolsRegistry[c.tool as ClarkToolName])
    : fallback.toolCalls;

  return {
    ...fallback,
    ...rawPlan,
    understoodQuestion: String(rawPlan?.understoodQuestion || fallback.understoodQuestion),
    taskType: rawPlan?.taskType || fallback.taskType,
    mode: rawPlan?.mode === 'analitico' ? 'analitico' : fallback.mode,
    confidence: Number(rawPlan?.confidence || fallback.confidence),
    entities: rawPlan?.entities || fallback.entities,
    toolCalls: toolCalls.length ? toolCalls.map((c: any) => ({ tool: c.tool, reason: String(c.reason || ''), args: c.args || {} })) : fallback.toolCalls,
    validationRules: Array.isArray(rawPlan?.validationRules) ? rawPlan.validationRules : fallback.validationRules,
    answerStyle: { ...fallback.answerStyle, ...(rawPlan?.answerStyle || {}) },
  };
}

async function gerarPlano(input: ClarkAgentInput): Promise<ClarkAgentPlan> {
  const fallback = planoLocal(input.pergunta);
  if (!genAI) return fallback;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: montarPromptPlanejamentoClark(Array.isArray(input.historico) ? { pergunta: input.pergunta, historico: input.historico } : { pergunta: input.pergunta }),
      config: { temperature: 0 } as any,
    });

    return limparPlano(extrairJsonSeguro(response.text || ''), input.pergunta);
  } catch (error) {
    console.warn('⚠️ Clark planner Gemini falhou; usando planner local:', error);
    return fallback;
  }
}

async function executarFerramentas(plan: ClarkAgentPlan, input: ClarkAgentInput): Promise<ClarkToolResult[]> {
  const results: ClarkToolResult[] = [];
  for (const call of plan.toolCalls || []) {
    const handler = clarkToolsRegistry[call.tool];
    if (!handler) {
      results.push({ tool: call.tool, ok: false, args: call.args || {}, result: null, error: `Ferramenta não registrada: ${call.tool}` });
      continue;
    }
    results.push(await handler({ pergunta: input.pergunta, ...(call.args || {}) }, { userId: input.userId }));
  }
  return results;
}

function formatarLojas(lojas: any[], limite = 12) {
  if (!Array.isArray(lojas) || !lojas.length) return 'nenhuma loja com quantidade positiva';
  return lojas.slice(0, limite).map((l) => `${l.loja}: ${Number(l.quantidade || l.total_pecas || 0)}`).join(', ');
}

function formatarRankingGenerico(ranking: any[], tipo: string, limite = 20) {
  if (!Array.isArray(ranking) || !ranking.length) return 'Não encontrei dados para montar o ranking solicitado.';
  return ranking.slice(0, limite).map((item: any, idx: number) => {
    const nome = item.loja || item.vendedor || item.categoria || item.descricao || `Item ${idx + 1}`;
    const partes = [`${item.posicao || idx + 1}. ${nome}`];
    if (item.total_vendas_formatado) partes.push(`vendas: ${item.total_vendas_formatado}`);
    if (item.total_pecas !== undefined) partes.push(`peças: ${Number(item.total_pecas || 0)}`);
    if (item.ticket_medio_formatado) partes.push(`ticket médio: ${item.ticket_medio_formatado}`);
    if (item.seguros_total_formatado) partes.push(`seguros: ${item.seguros_total_formatado}`);
    if (item.seguros_qtd !== undefined) partes.push(`qtd seguros: ${Number(item.seguros_qtd || 0)}`);
    if (Array.isArray(item.principais_lojas) && item.principais_lojas.length) {
      partes.push(`lojas: ${item.principais_lojas.slice(0, 6).map((l: any) => `${l.loja}: ${l.total_vendas_formatado || l.quantidade}`).join(', ')}`);
    }
    return partes.join(' | ');
  }).join('\n');
}

function respostaEstoqueProduto(result: any) {
  const produtos = Array.isArray(result?.produtos) ? result.produtos : [];
  const p = result?.produto_planejado || result?.produto_resolvido?.request || {};
  const criterio = [p.family, p.storage, p.color, p.category ? `categoria ${p.category}` : null].filter(Boolean).join(', ') || result?.termo_pesquisado || 'o produto solicitado';

  if (result?.produto_nao_encontrado_exato || !produtos.length) {
    return [
      `Não encontrei estoque exato para ${criterio}.`,
      'Validei família/modelo, memória, cor e categoria antes de responder. Por segurança, não retornei modelos parecidos como se fossem o produto pedido.',
    ].join('\n');
  }

  const linhas = produtos.map((item: any, index: number) => {
    const ref = item.referencia ? ` | ref: ${item.referencia}` : '';
    const cod = item.codigo_produto ? ` | cód: ${item.codigo_produto}` : '';
    return `${index + 1}. ${item.descricao}${ref}${cod} | estoque: ${Number(item.quantidade_total || 0)} | lojas: ${formatarLojas(item.lojas || item.principais_lojas || [], 50)}`;
  });

  return [`Encontrei estoque exato para ${criterio}:`, '', ...linhas].join('\n');
}

function respostaRankingEstoque(result: any) {
  const ranking = Array.isArray(result?.ranking) ? result.ranking : [];
  const categoria = result?.categoria_solicitada || 'estoque geral';
  if (!ranking.length) return `Não encontrei produtos com estoque positivo para ${categoria}.`;

  const linhas = ranking.map((item: any) => {
    const ref = item.referencia ? ` | ref: ${item.referencia}` : '';
    const cod = item.codigo_produto ? ` | cód: ${item.codigo_produto}` : '';
    return `${item.posicao}. ${item.descricao}${ref}${cod} | estoque: ${Number(item.quantidade_total || 0)} | lojas: ${formatarLojas(item.principais_lojas || item.lojas || [], 10)}`;
  });

  const top = ranking[0];
  const insight = top ? `Maior concentração: ${top.descricao}, com ${Number(top.quantidade_total || 0)} unidades.` : '';
  return [`Ranking de estoque da categoria ${categoria}:`, '', ...linhas, '', insight].filter(Boolean).join('\n');
}

function respostaLocalFinal(plan: ClarkAgentPlan, toolResults: ClarkToolResult[]) {
  const firstOk = toolResults.find((r) => r.ok && r.result);
  const firstError = toolResults.find((r) => !r.ok);

  if (!firstOk) {
    const msg = firstError?.error ? ` ${firstError.error}` : '';
    return `Não consegui responder com dados reais agora.${msg} Por segurança, não vou inventar informações.`;
  }

  const r = firstOk.result;

  if (firstOk.tool === 'consultar_estoque_produto') return respostaEstoqueProduto(r);
  if (firstOk.tool === 'consultar_ranking_estoque') return respostaRankingEstoque(r);

  if (firstOk.tool === 'consultar_vendas_resumo') {
    if (!r?.quantidade_registros) return `Não encontrei vendas no período ${r?.periodo?.descricao || 'solicitado'}.`;
    const linhas = [
      `No período ${r.periodo.descricao}, encontrei ${r.total_vendas_formatado} em vendas, com ${Number(r.total_pecas || 0)} peças e ticket médio de ${r.ticket_medio_formatado}.`,
      `Foram ${Number(r.quantidade_registros || 0)} registros em ${Number(r.lojas_analisadas || 0)} loja(s).`,
    ];
    if (Array.isArray(r.lojas) && r.lojas.length) {
      linhas.push('', 'Principais lojas:', formatarRankingGenerico(r.lojas.slice(0, 10).map((x: any, i: number) => ({ ...x, posicao: i + 1 })), 'lojas', 10));
    }
    return linhas.join('\n');
  }

  if (['consultar_vendas_por_loja', 'consultar_vendas_por_vendedor', 'consultar_vendas_por_categoria', 'consultar_seguros_por_vendedor', 'consultar_seguros_por_loja'].includes(firstOk.tool)) {
    const periodo = r?.periodo?.descricao || 'período solicitado';
    const ranking = Array.isArray(r?.ranking) ? r.ranking : [];
    if (!ranking.length) return `Não encontrei dados para o ranking solicitado no período ${periodo}.`;
    const titulo = firstOk.tool.includes('seguros') ? 'Ranking de seguros' : 'Ranking de vendas';
    return [`${titulo} no período ${periodo}:`, '', formatarRankingGenerico(ranking, r?.tipo || '', 50)].join('\n');
  }

  if (firstOk.tool === 'consultar_crescimento_mensal') {
    const meses = Array.isArray(r?.meses) ? r.meses : [];
    if (!meses.length) return `Não encontrei dados mensais no período ${r?.periodo?.descricao || 'solicitado'}.`;
    return [`Crescimento mensal no período ${r.periodo.descricao}:`, '', meses.map((m: any) => `${m.mes}: ${m.total_vendas_formatado} | peças: ${Number(m.total_pecas || 0)} | ${m.crescimento_descricao || 'sem comparativo'}`).join('\n')].join('\n');
  }

  if (firstOk.tool === 'consultar_relatorio_vendas') {
    const resumo = r?.resumo;
    const linhas = [`Relatório executivo de vendas — ${r?.periodo?.descricao || 'período solicitado'}:`];
    if (resumo) linhas.push('', `Resumo: ${resumo.total_vendas_formatado} em vendas, ${Number(resumo.total_pecas || 0)} peças, ticket médio de ${resumo.ticket_medio_formatado}.`);
    if (Array.isArray(r?.lojas) && r.lojas.length) linhas.push('', 'Top lojas:', formatarRankingGenerico(r.lojas.slice(0, 10), 'lojas', 10));
    if (Array.isArray(r?.categorias) && r.categorias.length) linhas.push('', 'Top categorias:', formatarRankingGenerico(r.categorias.slice(0, 10), 'categorias', 10));
    return linhas.join('\n');
  }

  if (firstOk.tool === 'responder_ajuda') return firstOk.result?.mensagem || 'Posso ajudar com vendas, estoque e seguros.';

  return 'Consegui consultar os dados, mas não consegui montar uma resposta segura. Nenhum dado foi inventado.';
}

function respostaPareceJson(text: string) {
  const t = String(text || '').trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

async function gerarRespostaFinal(input: ClarkAgentInput, plan: ClarkAgentPlan, toolResults: ClarkToolResult[], verifier: any) {
  const fallback = respostaLocalFinal(plan, toolResults);
  if (!genAI) return fallback;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: montarPromptRespostaFinalClark(Array.isArray(input.historico) ? { pergunta: input.pergunta, historico: input.historico, plan, toolResults, verifier } : { pergunta: input.pergunta, plan, toolResults, verifier }),
      config: { temperature: 0.2 } as any,
    });
    const final = String(response.text || '').trim();
    if (!final || respostaPareceJson(final)) return fallback;
    return final;
  } catch (error) {
    console.warn('⚠️ Clark resposta Gemini falhou; usando resposta local:', error);
    return fallback;
  }
}

export async function executarClarkAgent(input: ClarkAgentInput): Promise<ClarkAgentOutput> {
  let plan: ClarkAgentPlan | null = null;
  let toolResults: ClarkToolResult[] = [];
  let verifier: any = null;

  try {
    plan = await gerarPlano(input);
    toolResults = await executarFerramentas(plan, input);
    verifier = verificarRespostaClark(plan, toolResults);
    const finalAnswer = await gerarRespostaFinal(input, plan, toolResults, verifier);

    const trace: ClarkAgentTrace = { question: input.pergunta, plan, toolResults, verifier, finalAnswer };
    return { ok: verifier?.ok !== false, clark: finalAnswer, trace };
  } catch (error: any) {
    const finalAnswer = `Não consegui processar sua pergunta agora. Ocorreu uma falha no agente da Clark: ${error?.message || 'erro desconhecido'}. Por segurança, não vou inventar dados.`;
    const trace: ClarkAgentTrace = { question: input.pergunta, plan, toolResults, verifier, finalAnswer };
    return { ok: false, clark: finalAnswer, trace };
  }
}
