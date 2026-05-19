import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { GoogleGenAI } from '@google/genai';
import { processarComClarkBrain } from './brain/clarkBrain.service';

import {
  ClarkAction,
  ClarkDbContext,
  ClarkFiltros,
  ClarkHistoricoItem,
  ClarkIntent,
  ClarkPerguntaInput,
  ClarkPeriodo,
  ClarkProdutoPlanejado,
  ClarkResposta,
} from './clark.types';

import {
  ClarkAgentPlan,
  ClarkToolCall,
  ClarkToolName,
  ClarkToolResult,
  ClarkVerificationResult,
} from './agent/clarkAgent.types';

import { clarkToolsRegistry } from './tools/clarkTools.registry';
import { extrairFiltrosClark, normalizarTextoClark } from '../intent/extractFilters';
import { extrairPeriodoClark } from '../intent/extractPeriod';
import { obterEscopoUsuarioClark } from '../security/clarkScope';

import {
  extractColor,
  extractStorage,
  getBaseModelFamily,
  normalizeProductText,
} from '../productDictionary/productDictionary.utils';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const ROOT_DIR = process.cwd();
const DATABASE_DIR = process.env.RENDER
  ? path.join(__dirname, '../../../../database')
  : path.join(ROOT_DIR, 'database');

const GLOBAL_DB_PATH = path.join(DATABASE_DIR, 'samsung_vendas.db');
const ANUAL_DB_PATH = path.join(DATABASE_DIR, 'samsung_vendas_anuais.db');

function safeJsonParse(text: string) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Resposta vazia da IA.');

  const cleaned = raw
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('A IA não retornou JSON válido.');
  }
}

function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatBRL(value: any) {
  return toNumber(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function limitarTexto(value: any, max = 12000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}... [cortado]` : text;
}

function historicoLimpo(historico?: ClarkHistoricoItem[]) {
  return (Array.isArray(historico) ? historico : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: String(m.text).slice(0, 1800) }));
}

function perguntaComContexto(input: ClarkPerguntaInput) {
  const pergunta = String(input.pergunta || '').trim();
  const hist = historicoLimpo(input.historico);

  if (!hist.length) return pergunta;

  const curtaOuFollowUp =
    pergunta.length <= 45 ||
    /^(e\s+|agora\s+|tamb[eé]m\s+|s[oó]\s+|somente\s+|apenas\s+|no\s+|na\s+|da\s+|do\s+)/i.test(pergunta);

  if (!curtaOuFollowUp) return pergunta;

  const contexto = hist
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Usuário' : 'Clark'}: ${m.text}`)
    .join('\n');

  return `Contexto recente:\n${contexto}\n\nPergunta atual do usuário: ${pergunta}`;
}

function perguntaAtualTemProdutoEstoque(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  const temProduto =
    /\bGALAXY\b/i.test(pergunta) ||
    /\bSM-[A-Z0-9]/i.test(pergunta) ||
    /\bS\d{2}\s*(ULTRA|PLUS|FE)?\b/i.test(pergunta) ||
    /\bA\d{2}\b/i.test(pergunta) ||
    /\bZ\s?(FLIP|FOLD)\b/i.test(pergunta) ||
    /\bTAB\s?S\b/i.test(pergunta);

  const pedeLocalizacao =
    texto.includes('QUAIS LOJAS') ||
    texto.includes('LOJAS TEM') ||
    texto.includes('LOJAS TÊM') ||
    texto.includes('LOJAS POSSUEM') ||
    texto.includes('ONDE') ||
    texto.includes('PECA') ||
    texto.includes('PEÇAS') ||
    texto.includes('PECAS') ||
    texto.includes('UNIDADES') ||
    texto.includes('APARELHOS') ||
    texto.includes('PRODUTO') ||
    texto.includes('ESTOQUE');

  return temProduto && pedeLocalizacao;
}

function perguntaAtualPedeRankingEstoque(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  const falaEstoque =
    texto.includes('ESTOQUE') ||
    texto.includes('SMARTPHONE') ||
    texto.includes('SMARTPHONES') ||
    texto.includes('MODELOS');

  const ranking =
    texto.includes('RANKING') ||
    texto.includes('TOP') ||
    texto.includes('MAIORES') ||
    texto.includes('MAIOR ESTOQUE') ||
    texto.includes('MODELOS QUE MAIS') ||
    texto.includes('MAIS TEMOS EM ESTOQUE') ||
    texto.includes('MAIS TENHO EM ESTOQUE');

  return falaEstoque && ranking;
}

async function abrirDbContext(): Promise<ClarkDbContext> {
  const [annualDb, globalDb] = await Promise.all([
    fs.existsSync(ANUAL_DB_PATH)
      ? open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database })
      : Promise.resolve(null),
    fs.existsSync(GLOBAL_DB_PATH)
      ? open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database })
      : Promise.resolve(null),
  ]);

  return { annualDb, globalDb };
}

async function fecharDbContext(ctx: ClarkDbContext) {
  await Promise.all([
    ctx.annualDb ? ctx.annualDb.close().catch(() => undefined) : Promise.resolve(),
    ctx.globalDb ? ctx.globalDb.close().catch(() => undefined) : Promise.resolve(),
  ]);
}

function detectarCategoria(pergunta: string) {
  const text = normalizeProductText(pergunta);

  if (
    text.includes('SMARTPHONE') ||
    text.includes('SMARTPHONES') ||
    text.includes('CELULAR') ||
    text.includes('CELULARES') ||
    text.includes('APARELHO') ||
    text.includes('APARELHOS') ||
    text.includes('GALAXY S') ||
    text.includes('GALAXY A') ||
    text.includes('GALAXY M') ||
    text.includes('IPHONE')
  ) {
    return 'SMARTPHONES';
  }

  if (text.includes('TABLET') || text.includes('TABLETS') || text.includes('TAB ')) return 'TABLETS';
  if (text.includes('WEARABLE') || text.includes('WATCH') || text.includes('BUDS')) return 'WEARABLES';
  if (text.includes('ACESSORIO') || text.includes('ACESSORIOS')) return 'ACESSORIOS';

  return undefined;
}

function aliasesCategoria(category?: string) {
  const text = normalizeProductText(category || '');
  if (!text) return [];
  if (text.includes('SMART')) return ['SMARTPHONE', 'SMARTPHONES', 'APARELHO', 'APARELHOS', 'CELULAR', 'CELULARES'];
  if (text.includes('TABLET')) return ['TABLET', 'TABLETS'];
  if (text.includes('WEARABLE')) return ['WEARABLE', 'WEARABLES', 'WATCH', 'BUDS'];
  if (text.includes('ACESSORIO')) return ['ACESSORIO', 'ACESSORIOS'];
  return [category || ''];
}

function detectarLimite(pergunta: string, fallback = 10) {
  const text = normalizarTextoClark(pergunta);
  const match =
    text.match(/\bTOP\s+(\d{1,3})\b/) ||
    text.match(/\b(\d{1,3})\s+(MAIORES|PRINCIPAIS|MODELOS|PRODUTOS|VENDEDORES|LOJAS)\b/) ||
    text.match(/\bLISTE\s+OS?\s+(\d{1,3})\b/);
  const parsed = match?.[1] ? Number(match[1]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

function limparTermoProduto(pergunta: string) {
  return String(pergunta || '')
    .replace(/^me\s+liste\s+as\s+lojas\s+que\s+t[eê]m\s+/i, '')
    .replace(/^liste\s+as\s+lojas\s+que\s+t[eê]m\s+/i, '')
    .replace(/^quais\s+lojas\s+t[eê]m\s+o?\s*/i, '')
    .replace(/^quais\s+lojas\s+possuem\s+o?\s*/i, '')
    .replace(/^onde\s+t[eê]m\s+o?\s*/i, '')
    .replace(/^onde\s+est[aã]o\s+as?\s+pe[cç]as\s+do\s+produto\s*/i, '')
    .replace(/^onde\s+est[aã]o\s+os?\s+aparelhos\s+do\s+produto\s*/i, '')
    .replace(/^onde\s+est[aã]o\s+as?\s+unidades\s+do\s+produto\s*/i, '')
    .replace(/^tem\s+o?\s*/i, '')
    .replace(/\bem\s+estoque\b/gi, ' ')
    .replace(/\bna\s+categoria\s+[a-z0-9\s]+$/gi, ' ')
    .replace(/\bcategoria\s+(SMARTPHONES?|TABLETS?|WEARABLES?|ACESS[OÓ]RIOS?)\b/gi, ' ')
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function montarProdutoPlanejado(pergunta: string, categoria?: string): ClarkProdutoPlanejado {
  const raw = limparTermoProduto(pergunta);
  const family = getBaseModelFamily(raw) || getBaseModelFamily(pergunta) || null;
  const storage = extractStorage(raw) || extractStorage(pergunta) || null;
  const color = extractColor(raw) || extractColor(pergunta) || null;
  const model = family ? family.replace(/^GALAXY\s+/, '') : null;

  return {
    raw: raw || pergunta,
    family,
    model,
    storage,
    color,
    category: categoria || detectarCategoria(pergunta) || null,
  };
}

function montarFiltrosEstoque(params: {
  pergunta: string;
  limite?: number;
  categoria?: string;
  produtoPlanejado?: ClarkProdutoPlanejado | null;
}): ClarkFiltros {
  const categoria = params.categoria || detectarCategoria(params.pergunta);
  const produtoPlanejado = params.produtoPlanejado || null;
  const termoProduto = produtoPlanejado
    ? [produtoPlanejado.raw, produtoPlanejado.family, produtoPlanejado.storage, produtoPlanejado.color]
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';

  const tokensProduto = normalizeProductText(termoProduto)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !['GALAXY', 'SAMSUNG', 'SMARTPHONE', 'SMARTPHONES', 'MODELO', 'MODELOS', 'PRODUTO', 'PRODUTOS', 'ESTOQUE'].includes(token));

  return {
    limite: params.limite || 10,
    categoriaOriginal: categoria,
    categoriaCanonica: categoria,
    aliasesCategoria: aliasesCategoria(categoria),
    termoProduto,
    tokensProduto,
    produtoPlanejado,
    lojaOriginal: undefined,
    lojaCanonica: undefined,
    cnpjLoja: undefined,
    detalharPorLoja: true,
    detalharPorVendedor: false,
    detalharPorCategoria: false,
    detalharPorMes: false,
  };
}

function respostaBase(params: {
  ok?: boolean;
  clark: string;
  intencao: ClarkIntent;
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
  dados: any;
  origem?: ClarkResposta['resposta_origem'];
  modo?: 'simples' | 'analitico';
}): ClarkResposta {
  return {
    ok: params.ok ?? true,
    clark: String(params.clark || '').trim() || 'Não consegui montar uma resposta segura para essa pergunta.',
    intencao: params.intencao,
    modo: params.modo || 'simples',
    periodo: params.periodo,
    filtros: params.filtros,
    dados: params.dados,
    resposta_origem: params.origem || 'local_precisa',
  };
}

function planoBase(pergunta: string, periodo: ClarkPeriodo, filtros: ClarkFiltros): ClarkAgentPlan {
  const texto = normalizarTextoClark(pergunta);
  const limite = detectarLimite(pergunta, filtros.limite || 10);

  const call = (tool: ClarkToolName, args: Record<string, any> = {}, reason = ''): ClarkToolCall => ({
    tool,
    reason,
    args: {
      originalQuestion: pergunta,
      startDate: periodo.inicio,
      endDate: periodo.fim,
      limit: limite,
      ...args,
    },
  });

  const falaEstoque =
    texto.includes('ESTOQUE') ||
    texto.includes('TEM') ||
    texto.includes('POSSUEM') ||
    texto.includes('QUAIS LOJAS') ||
    texto.includes('ONDE') ||
    texto.includes('PECA') ||
    texto.includes('PEÇAS') ||
    texto.includes('PECAS') ||
    texto.includes('UNIDADES') ||
    texto.includes('APARELHOS') ||
    texto.includes('PRODUTO');
  const rankingEstoque = texto.includes('RANKING') || texto.includes('TOP') || texto.includes('MAIORES') || texto.includes('MAIOR ESTOQUE') || texto.includes('MODELOS QUE MAIS') || texto.includes('MAIS TEMOS EM ESTOQUE');
  const produto = /\b(GALAXY|SM-[A-Z0-9]|S\d{2}|A\d{2}|Z\s?FLIP|Z\s?FOLD|TAB\s?S)\b/i.test(pergunta);

  // Produto específico vem ANTES de ranking. Se o usuário cita Galaxy/S26/A17 e pergunta onde/lojas/peças,
  // a Clark deve buscar aquele produto, não reaproveitar ranking do histórico.
  if (falaEstoque && produto && !rankingEstoque) {
    const categoria = detectarCategoria(pergunta) || 'SMARTPHONES';
    const plan = montarProdutoPlanejado(pergunta, categoria);
    return {
      understoodQuestion: pergunta,
      taskType: 'stock_product_search',
      mode: 'analitico',
      confidence: 0.96,
      entities: { product: plan, limit: 50 },
      toolCalls: [
        call('resolver_produto', { query: plan.raw, family: plan.family, model: plan.model, storage: plan.storage, color: plan.color, category: plan.category }, 'Resolver produto no dicionário.'),
        call('consultar_estoque_produto', { query: plan.raw, family: plan.family, model: plan.model, storage: plan.storage, color: plan.color, category: plan.category, strict: true, limit: 50 }, 'Consultar estoque exato por loja.'),
      ],
      validationRules: ['Produto específico deve bater família, memória, cor e categoria.', 'Se não encontrar, informar claramente.'],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if ((falaEstoque && rankingEstoque) || texto.includes('MODELOS QUE MAIS TEMOS')) {
    const categoria = detectarCategoria(pergunta) || filtros.categoriaCanonica || 'SMARTPHONES';
    return {
      understoodQuestion: pergunta,
      taskType: 'stock_ranking',
      mode: 'analitico',
      confidence: 0.92,
      entities: { category: categoria, limit: limite },
      toolCalls: [call('consultar_ranking_estoque', { category: categoria, includeStores: true }, 'Ranking de produtos em estoque.')],
      validationRules: ['Responder ranking de estoque real.', 'Não inventar produtos.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (texto.includes('SEGURO') || texto.includes('SEGUROS')) {
    const porLoja = texto.includes('LOJA') || texto.includes('LOJAS');
    return {
      understoodQuestion: pergunta,
      taskType: porLoja ? 'insurance_store_ranking' : 'insurance_seller_ranking',
      mode: 'analitico',
      confidence: 0.88,
      entities: { limit: limite, period: periodo },
      toolCalls: [porLoja ? call('consultar_seguros_por_loja', {}, 'Ranking de seguros por loja.') : call('consultar_seguros_por_vendedor', {}, 'Ranking de seguros por vendedor.')],
      validationRules: ['Responder apenas com dados de seguros reais.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (texto.includes('VENDA') || texto.includes('VENDAS') || texto.includes('VENDEMOS') || texto.includes('FATURAMENTO') || texto.includes('FATURAMOS')) {
    const analitico = texto.includes('RELATORIO') || texto.includes('RELATÓRIO') || texto.includes('ANALISE') || texto.includes('ANÁLISE') || texto.includes('INSIGHT');
    const crescimento = texto.includes('CRESC') || texto.includes('MES A MES') || texto.includes('MÊS A MÊS') || texto.includes('MENSAL');
    const vendedor = texto.includes('VENDEDOR') || texto.includes('VENDEDORES');
    const categoria = texto.includes('CATEGORIA') || texto.includes('CATEGORIAS') || texto.includes('FAMILIA') || texto.includes('FAMÍLIA');
    const loja = texto.includes('LOJA') || texto.includes('LOJAS') || Boolean(filtros.lojaCanonica);

    let tool: ClarkToolName = 'consultar_vendas_resumo';
    let taskType: ClarkAgentPlan['taskType'] = 'sales_summary';

    if (analitico) {
      tool = 'consultar_relatorio_vendas';
      taskType = 'sales_report';
    } else if (crescimento) {
      tool = 'consultar_crescimento_mensal';
      taskType = 'sales_growth';
    } else if (vendedor) {
      tool = 'consultar_vendas_por_vendedor';
      taskType = 'sales_seller_ranking';
    } else if (categoria) {
      tool = 'consultar_vendas_por_categoria';
      taskType = 'sales_category_ranking';
    } else if (loja) {
      tool = 'consultar_vendas_por_loja';
      taskType = 'sales_store_ranking';
    }

    return {
      understoodQuestion: pergunta,
      taskType,
      mode: 'analitico',
      confidence: 0.9,
      entities: { limit: limite, period: periodo, store: filtros.lojaCanonica || null, category: filtros.categoriaCanonica || null },
      toolCalls: [call(tool, {}, 'Consulta real de vendas no banco do TeleFluxo.')],
      validationRules: ['Usar período solicitado.', 'Usar escopo de acesso do usuário.', 'Não inventar valores.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  return {
    understoodQuestion: pergunta,
    taskType: 'help',
    mode: 'simples',
    confidence: 0.3,
    entities: {},
    toolCalls: [call('responder_ajuda', {}, 'Pergunta fora do escopo analítico.')],
    validationRules: [],
    answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: false, shouldIncludeInsights: false, shouldIncludeSuggestions: true },
  };
}

function promptPlanner(params: {
  pergunta: string;
  perguntaExpandida: string;
  historico: ClarkHistoricoItem[];
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
}) {
  return `Você é a Clark, IA analítica do sistema TeleFluxo.

Você NÃO responde ao usuário agora. Você pensa e monta um PLANO JSON para o backend executar ferramentas reais.

Histórico recente:
${params.historico.map((m) => `${m.role}: ${m.text}`).join('\n') || 'Sem histórico.'}

Pergunta atual: ${params.pergunta}
Pergunta com contexto: ${params.perguntaExpandida}
Período detectado pelo backend: ${JSON.stringify(params.periodo)}
Filtros detectados pelo backend: ${JSON.stringify(params.filtros)}

Ferramentas disponíveis:
- resolver_produto
- consultar_estoque_produto
- consultar_ranking_estoque
- consultar_vendas_resumo
- consultar_vendas_por_loja
- consultar_vendas_por_vendedor
- consultar_vendas_por_categoria
- consultar_crescimento_mensal
- consultar_relatorio_vendas
- consultar_seguros_por_vendedor
- consultar_seguros_por_loja
- executar_sql_analitico
- responder_ajuda

Regras críticas:
- A IA nunca consulta banco diretamente. Só escolhe ferramentas.
- Para produto específico, seja rígida: família/modelo, memória, cor e categoria.
- Galaxy S26 não pode retornar S25. 512GB não pode retornar 256GB. Preto não pode retornar cinza.
- Para perguntas como "e no Park?", use o histórico para manter período/intenção anterior.
- Se o usuário pedir lojas e valor, use consultar_vendas_por_loja.
- Se pedir vendedores, use consultar_vendas_por_vendedor.
- Se pedir seguros por vendedor, use consultar_seguros_por_vendedor.
- Se pedir análise, tendência, insight ou relatório, use consultar_relatorio_vendas.
- Se a pergunta exigir cruzamento livre de tabelas ou uma análise que as ferramentas acima não cobrem, use executar_sql_analitico.
- executar_sql_analitico aceita apenas SELECT. Use LIMIT. Não use INSERT, UPDATE, DELETE, DROP ou PRAGMA.
- Schema principal para SQL:
  samsung_vendas.db: stock(id, cnpj, storeName, productCode, reference, description, category, quantity, costPrice, salePrice, averageCost, serial, emLinha, cluster), vendas(data_emissao, nome_vendedor, descricao, quantidade, total_liquido, cnpj_empresa, familia, regiao), vendedores_kpi(loja, vendedor, fat_atual, tendencia, fat_anterior, crescimento, seguros, pa, qtd, ticket, regiao, pct_seguro), vendas_detalhadas_imei(data_emissao, nota_fiscal, nome_fantasia, cnpj_empresa, nome_vendedor, codigo_produto, referencia, descricao, categoria, imei, quantidade, total_liquido, regiao).
  samsung_vendas_anuais.db: vendas_anuais_raw, vendas_anuais, seguros_anuais, agg_lojas_mensal, agg_vendedores_mensal.

Responda SOMENTE JSON válido no formato:
{
  "understoodQuestion": "",
  "taskType": "stock_product_search|stock_ranking|sales_summary|sales_store_ranking|sales_seller_ranking|sales_category_ranking|sales_report|sales_growth|insurance_seller_ranking|insurance_store_ranking|sql_analytics|help",
  "mode": "simples|analitico",
  "confidence": 0.0,
  "entities": {},
  "toolCalls": [{"tool":"consultar_vendas_resumo", "reason":"", "args": {}}],
  "validationRules": [],
  "answerStyle": {"shouldExplainUncertainty": true, "shouldIncludeTables": true, "shouldIncludeInsights": true, "shouldIncludeSuggestions": true}
}`;
}

async function planejarComGemini(params: {
  pergunta: string;
  perguntaExpandida: string;
  historico: ClarkHistoricoItem[];
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
}) {
  if (!genAI) return null;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: promptPlanner(params),
      config: { temperature: 0.1 } as any,
    });

    const parsed = safeJsonParse(response.text || '');
    const fallback = planoBase(params.perguntaExpandida, params.periodo, params.filtros);

    return {
      ...fallback,
      ...parsed,
      entities: parsed.entities || fallback.entities,
      toolCalls: Array.isArray(parsed.toolCalls) && parsed.toolCalls.length ? parsed.toolCalls : fallback.toolCalls,
      validationRules: Array.isArray(parsed.validationRules) ? parsed.validationRules : fallback.validationRules,
      answerStyle: { ...fallback.answerStyle, ...(parsed.answerStyle || {}) },
    } as ClarkAgentPlan;
  } catch (error) {
    console.warn('⚠️ Clark planner Gemini falhou. Usando planner local:', error);
    return null;
  }
}

function validarPlano(plan: ClarkAgentPlan, pergunta: string, periodo: ClarkPeriodo) {
  const fallback = planoBase(pergunta, periodo, extrairFiltrosClark(pergunta));
  const toolsValidas = new Set(Object.keys(clarkToolsRegistry));

  const calls = (plan.toolCalls || [])
    .filter((call: any) => call && toolsValidas.has(call.tool))
    .map((call: any) => ({
      tool: call.tool as ClarkToolName,
      reason: String(call.reason || ''),
      args: {
        originalQuestion: pergunta,
        startDate: periodo.inicio,
        endDate: periodo.fim,
        ...(call.args || {}),
      },
    }));

  return {
    ...fallback,
    ...plan,
    toolCalls: calls.length ? calls : fallback.toolCalls,
  };
}

async function executarFerramentas(params: {
  plan: ClarkAgentPlan;
  userId: string;
  pergunta: string;
  db: ClarkDbContext;
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
}) {
  const scope = await obterEscopoUsuarioClark(params.userId);
  const results: ClarkToolResult[] = [];

  for (const call of params.plan.toolCalls || []) {
    const handler = clarkToolsRegistry[call.tool];

    if (!handler) {
      results.push({ tool: call.tool, ok: false, args: call.args || {}, result: null, error: `Ferramenta não registrada: ${call.tool}` });
      continue;
    }

    const result = await handler(call.args || {}, {
      userId: params.userId,
      pergunta: params.pergunta,
      db: params.db,
      periodo: params.periodo,
      filtros: params.filtros,
      scope,
    });

    results.push(result);
  }

  return results;
}

function validarResposta(plan: ClarkAgentPlan, results: ClarkToolResult[]): ClarkVerificationResult {
  const erros = results.filter((r) => !r.ok);
  if (erros.length) {
    return { ok: false, verdict: 'tool_error', problems: erros.map((r) => `${r.tool}: ${r.error || 'erro'}`) };
  }

  const algumResultado = results.some((r) => r.result);
  if (!algumResultado) {
    return { ok: false, verdict: 'missing_data', problems: ['Nenhuma ferramenta retornou dados.'] };
  }

  const produto = results.find((r) => r.tool === 'consultar_estoque_produto')?.result;
  if (produto?.produto_nao_encontrado_exato) {
    return { ok: true, verdict: 'answered', problems: [] };
  }

  return { ok: true, verdict: 'answered', problems: [] };
}

function formatarLojas(lojas: any[], limite = 12) {
  if (!Array.isArray(lojas) || lojas.length === 0) return 'sem lojas com quantidade positiva';
  return lojas.slice(0, limite).map((l) => `${l.loja}: ${toNumber(l.quantidade)}`).join(', ');
}

function respostaDeterministica(plan: ClarkAgentPlan, results: ClarkToolResult[], periodo: ClarkPeriodo) {
  const principal = results.find((r) => r.ok && r.result)?.result;
  const tool = results.find((r) => r.ok && r.result)?.tool;

  if (!principal) {
    const erro = results.find((r) => r.error)?.error;
    return erro
      ? `Não consegui concluir a consulta porque a ferramenta retornou erro: ${erro}. Nenhum dado foi inventado.`
      : 'Não encontrei dados suficientes para responder com segurança. Nenhum dado foi inventado.';
  }

  if (tool === 'responder_ajuda') {
    return principal.mensagem || 'Posso responder sobre vendas, estoque, lojas, vendedores, categorias e seguros.';
  }

  if (tool === 'consultar_ranking_estoque') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei produtos com estoque positivo para a categoria ${principal.categoria_solicitada || 'solicitada'}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.descricao} | ref: ${item.referencia || '-'} | cód: ${item.codigo_produto || '-'} | estoque: ${toNumber(item.quantidade_total)} | lojas: ${formatarLojas(item.principais_lojas || item.lojas || [], 10)}`);
    return [`Encontrei ${ranking.length} modelos com maior estoque${principal.categoria_solicitada ? ` na categoria ${principal.categoria_solicitada}` : ''}.`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_estoque_produto') {
    const produtos = Array.isArray(principal.produtos) ? principal.produtos : [];
    const criterio = [principal.produto_planejado?.family, principal.produto_planejado?.storage, principal.produto_planejado?.color, principal.produto_planejado?.category ? `categoria ${principal.produto_planejado.category}` : null].filter(Boolean).join(', ');
    if (principal.produto_nao_encontrado_exato || !produtos.length) {
      return [`Não encontrei estoque exato para ${criterio || principal.termo_pesquisado || 'o produto solicitado'}.`, 'Não retornei modelos parecidos porque produto específico exige bater família/modelo, memória, cor e categoria.'].join('\n');
    }
    const linhas = produtos.map((item: any, index: number) => `${index + 1}. ${item.descricao} | ref: ${item.referencia || '-'} | cód: ${item.codigo_produto || '-'} | estoque: ${toNumber(item.quantidade_total)} | lojas: ${formatarLojas(item.lojas || item.principais_lojas || [], 50)}`);
    return [`Encontrei estoque exato para ${criterio || principal.termo_pesquisado}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_resumo') {
    return [
      `No período ${principal.periodo?.descricao || periodo.descricao}, encontrei ${principal.total_vendas_formatado || formatBRL(principal.total_vendas)} em vendas, com ${toNumber(principal.total_pecas)} peças.`,
      `Ticket médio: ${principal.ticket_medio_formatado || formatBRL(principal.ticket_medio)}.`,
      principal.filtro_loja ? `Filtro de loja: ${principal.filtro_loja}.` : `Lojas analisadas: ${toNumber(principal.lojas_analisadas)}.`,
    ].join('\n');
  }

  if (tool === 'consultar_vendas_por_loja') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei vendas no período ${principal.periodo?.descricao || periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.loja}: ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | peças: ${toNumber(item.total_pecas)} | ticket: ${item.ticket_medio_formatado || formatBRL(item.ticket_medio)}`);
    return [`Vendas por loja no período ${principal.periodo?.descricao || periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_por_vendedor') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei vendas por vendedor no período ${principal.periodo?.descricao || periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.vendedor} (${item.loja}): ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | peças: ${toNumber(item.total_pecas)}`);
    return [`Ranking de vendedores no período ${principal.periodo?.descricao || periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_vendas_por_categoria') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei vendas por categoria no período ${principal.periodo?.descricao || periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.categoria}: ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | peças: ${toNumber(item.total_pecas)}`);
    return [`Vendas por categoria no período ${principal.periodo?.descricao || periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_seguros_por_vendedor') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei seguros no período ${principal.periodo?.descricao || periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.vendedor} (${item.loja}): ${item.seguros_total_formatado || formatBRL(item.seguros_total)} | qtd: ${toNumber(item.seguros_qtd)}`);
    return [`Ranking de seguros por vendedor no período ${principal.periodo?.descricao || periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_seguros_por_loja') {
    const ranking = Array.isArray(principal.ranking) ? principal.ranking : [];
    if (!ranking.length) return `Não encontrei seguros no período ${principal.periodo?.descricao || periodo.descricao}.`;
    const linhas = ranking.map((item: any) => `${item.posicao}. ${item.loja}: ${item.seguros_total_formatado || formatBRL(item.seguros_total)} | qtd: ${toNumber(item.seguros_qtd)}`);
    return [`Ranking de seguros por loja no período ${principal.periodo?.descricao || periodo.descricao}:`, '', ...linhas].join('\n');
  }

  if (tool === 'consultar_crescimento_mensal' || tool === 'consultar_relatorio_vendas') {
    return `Concluí a análise do período ${principal.periodo?.descricao || periodo.descricao}. Dados principais:\n${limitarTexto(JSON.stringify(principal, null, 2), 5000)}`;
  }


  if (tool === 'executar_sql_analitico') {
    const rows = Array.isArray(principal.rows) ? principal.rows : [];
    if (!rows.length) return 'Executei a consulta analítica, mas não encontrei registros para responder com segurança.';
    const preview = rows.slice(0, 20).map((row: any, index: number) => {
      const cols = Object.entries(row).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' | ');
      return `${index + 1}. ${cols}`;
    });
    return [`Consulta analítica concluída. Encontrei ${principal.total_linhas || rows.length} linha(s).`, '', ...preview].join('\n');
  }

  return limitarTexto(JSON.stringify(principal, null, 2), 6000);
}

function promptRespostaFinal(params: {
  pergunta: string;
  plan: ClarkAgentPlan;
  results: ClarkToolResult[];
  verifier: ClarkVerificationResult;
  respostaFallback: string;
}) {
  const payload = params.results.map((r) => ({ tool: r.tool, ok: r.ok, args: r.args, result: r.result, error: r.error }));

  return `Você é a Clark, IA analítica executiva do TeleFluxo.

Responda em português do Brasil, de forma natural, objetiva e inteligente.

PERGUNTA DO USUÁRIO:
${params.pergunta}

PLANO EXECUTADO:
${JSON.stringify(params.plan, null, 2)}

VALIDAÇÃO DO BACKEND:
${JSON.stringify(params.verifier, null, 2)}

DADOS REAIS DAS FERRAMENTAS:
${limitarTexto(JSON.stringify(payload, null, 2), 25000)}

REGRAS OBRIGATÓRIAS:
- Não invente nenhum número, loja, produto, vendedor ou período.
- Se o dado não existir, diga que não encontrou.
- Produto específico é rígido: não aceite família, memória, cor ou categoria diferente.
- Traga a resposta com clareza executiva, com ranking quando houver ranking.
- Inclua 1 a 3 insights quando os dados permitirem, mas sem especular além dos dados.
- Se houver erro de ferramenta, explique que não conseguiu consultar aquela parte.
- Não mencione JSON, ferramenta ou backend, a menos que seja necessário para explicar falha.

RASCUNHO SEGURO DO BACKEND, caso precise:
${params.respostaFallback}`;
}

async function redigirRespostaFinal(params: {
  pergunta: string;
  plan: ClarkAgentPlan;
  results: ClarkToolResult[];
  verifier: ClarkVerificationResult;
  periodo: ClarkPeriodo;
}) {
  const fallback = respostaDeterministica(params.plan, params.results, params.periodo);

  if (!genAI) return fallback;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: promptRespostaFinal({ ...params, respostaFallback: fallback }),
      config: { temperature: 0.35 } as any,
    });

    const text = String(response.text || '').trim();
    if (!text || text === '{}' || text === '[]' || text.toLowerCase() === 'null') return fallback;
    return text;
  } catch (error) {
    console.warn('⚠️ Clark resposta final Gemini falhou. Usando resposta determinística:', error);
    return fallback;
  }
}

function intentFromPlan(plan: ClarkAgentPlan): ClarkIntent {
  const first = plan.toolCalls?.[0]?.tool;

  if (first === 'consultar_ranking_estoque') return 'ranking_estoque_produtos';
  if (first === 'consultar_estoque_produto') return 'estoque_produto_lojas';
  if (first === 'consultar_vendas_por_loja') return 'ranking_lojas_vendas';
  if (first === 'consultar_vendas_por_vendedor') return 'ranking_vendedores_vendas';
  if (first === 'consultar_vendas_por_categoria') return 'ranking_categorias_vendas';
  if (first === 'consultar_vendas_resumo') return 'vendas_resumo';
  if (first === 'consultar_crescimento_mensal') return 'crescimento_mensal';
  if (first === 'consultar_relatorio_vendas') return 'relatorio_analitico_vendas';
  if (first === 'consultar_seguros_por_vendedor') return 'ranking_vendedores_seguros';
  if (first === 'consultar_seguros_por_loja') return 'ranking_lojas_seguros';
  if (first === 'executar_sql_analitico') return 'relatorio_analitico_vendas';

  return 'ajuda';
}

export async function processarPerguntaClarkLegado(input: ClarkPerguntaInput): Promise<ClarkResposta> {
  const pergunta = String(input?.pergunta || '').trim();
  const userId = String(input?.userId || '').trim();
  const periodoVazio: ClarkPeriodo = { inicio: '', fim: '', descricao: '' };

  if (!userId) {
    const filtros = extrairFiltrosClark(pergunta);
    return respostaBase({ ok: false, clark: 'Usuário não informado. Faça login novamente e tente consultar a Clark.', intencao: 'ajuda', periodo: periodoVazio, filtros, dados: null, origem: 'fallback' });
  }

  if (!pergunta) {
    const filtros = extrairFiltrosClark('');
    return respostaBase({ ok: false, clark: 'Digite uma pergunta para a Clark.', intencao: 'ajuda', periodo: periodoVazio, filtros, dados: null, origem: 'fallback' });
  }

  const perguntaExpandida = perguntaComContexto(input);
  const periodo = extrairPeriodoClark(perguntaExpandida);
  let filtros = extrairFiltrosClark(perguntaExpandida);
  let db: ClarkDbContext | null = null;

  try {
    db = await abrirDbContext();

    const hist = historicoLimpo(input.historico);

    const perguntaAtualProduto = perguntaAtualTemProdutoEstoque(pergunta);
    const perguntaAtualRanking = perguntaAtualPedeRankingEstoque(pergunta);

    // Quando a pergunta atual é explícita (produto ou ranking), NÃO deixe o histórico dominar o plano.
    // Histórico só deve completar follow-ups curtos como "e no Park?".
    const perguntaPlanejamento = perguntaAtualProduto || perguntaAtualRanking ? pergunta : perguntaExpandida;
    const filtrosPlanejamento = perguntaAtualProduto || perguntaAtualRanking ? extrairFiltrosClark(pergunta) : filtros;

    const planoLocal = planoBase(perguntaPlanejamento, periodo, filtrosPlanejamento);

    // Para produto específico e ranking explícito, o planner local é mais seguro e evita a Gemini reaproveitar o ranking anterior do histórico.
    const planoIa = perguntaAtualProduto || perguntaAtualRanking
      ? null
      : await planejarComGemini({ pergunta, perguntaExpandida, historico: hist, periodo, filtros });

    const plan = validarPlano(planoIa || planoLocal, perguntaPlanejamento, periodo);

    // Para estoque específico, preserva o filtro rígido de produto já testado.
    if (plan.toolCalls.some((c) => c.tool === 'consultar_estoque_produto')) {
      const categoria = detectarCategoria(perguntaPlanejamento) || 'SMARTPHONES';
      const produtoPlanejado = montarProdutoPlanejado(perguntaPlanejamento, categoria);
      filtros = montarFiltrosEstoque({ pergunta: perguntaPlanejamento, limite: 50, categoria, produtoPlanejado });
    }

    if (plan.toolCalls.some((c) => c.tool === 'consultar_ranking_estoque')) {
      const categoria = detectarCategoria(perguntaPlanejamento) || filtros.categoriaCanonica || 'SMARTPHONES';
      filtros = montarFiltrosEstoque({ pergunta: perguntaPlanejamento, limite: detectarLimite(perguntaPlanejamento, filtros.limite || 10), categoria });
    }

    const toolResults = await executarFerramentas({ plan, userId, pergunta: perguntaPlanejamento, db, periodo, filtros });
    const verifier = validarResposta(plan, toolResults);
    const clark = await redigirRespostaFinal({ pergunta, plan, results: toolResults, verifier, periodo });

    return respostaBase({
      ok: verifier.ok,
      clark,
      intencao: intentFromPlan(plan),
      periodo,
      filtros,
      dados: {
        plan,
        toolResults,
        verifier,
      },
      origem: genAI ? 'gemini_analitico' : 'local_precisa',
      modo: plan.mode || 'analitico',
    });
  } catch (error: any) {
    console.error('❌ Erro no service da Clark:', error);

    return respostaBase({
      ok: false,
      clark: 'Tive uma falha interna ao consultar a Clark. Por segurança, não vou inventar dados.',
      intencao: 'ajuda',
      periodo,
      filtros,
      dados: { error: error?.message || 'Erro desconhecido' },
      origem: 'fallback',
    });
  } finally {
    if (db) await fecharDbContext(db);
  }
}



function extrairResultadoFerramenta(dados: any, toolName: string) {
  const toolResults = Array.isArray(dados?.toolResults) ? dados.toolResults : [];
  return toolResults.find((item: any) => item?.tool === toolName && item?.ok)?.result || null;
}

function montarDadosExcelBasico(resposta: ClarkResposta) {
  const dadosOriginais: any = resposta.dados || {};

  if (dadosOriginais?.tipo === 'relatorio_executivo') {
    return dadosOriginais;
  }

  const relatorioVendas = extrairResultadoFerramenta(dadosOriginais, 'consultar_relatorio_vendas');
  const vendasResumo = extrairResultadoFerramenta(dadosOriginais, 'consultar_vendas_resumo');
  const vendasPorLoja = extrairResultadoFerramenta(dadosOriginais, 'consultar_vendas_por_loja');
  const vendasPorVendedor = extrairResultadoFerramenta(dadosOriginais, 'consultar_vendas_por_vendedor');
  const estoqueRanking = extrairResultadoFerramenta(dadosOriginais, 'consultar_ranking_estoque');
  const segurosPorLoja = extrairResultadoFerramenta(dadosOriginais, 'consultar_seguros_por_loja');
  const segurosPorVendedor = extrairResultadoFerramenta(dadosOriginais, 'consultar_seguros_por_vendedor');

  const resumoBase = relatorioVendas?.resumo || vendasResumo || {};

  return {
    tipo: 'relatorio_executivo',
    periodo: resposta.periodo,
    resumo: {
      vendasTotais: toNumber(resumoBase.total_vendas ?? resumoBase.vendas_totais ?? resumoBase.valor_total),
      pecasVendidas: toNumber(resumoBase.total_pecas ?? resumoBase.pecas_vendidas ?? resumoBase.quantidade),
      ticketMedio: toNumber(resumoBase.ticket_medio),
    },
    vendasPorLoja: (relatorioVendas?.lojas || vendasPorLoja?.ranking || []).map((item: any) => ({
      loja: String(item.loja || item.nome_loja || 'Loja não informada'),
      valor: toNumber(item.total_vendas ?? item.valor ?? item.faturamento),
      quantidade: toNumber(item.total_pecas ?? item.quantidade ?? item.qtd),
    })),
    vendasPorVendedor: (relatorioVendas?.vendedores || vendasPorVendedor?.ranking || []).map((item: any) => ({
      vendedor: String(item.vendedor || item.nome_vendedor || 'Vendedor não informado'),
      loja: item.loja || item.nome_loja || '',
      valor: toNumber(item.total_vendas ?? item.valor ?? item.faturamento),
      quantidade: toNumber(item.total_pecas ?? item.quantidade ?? item.qtd),
    })),
    estoqueDestaque: (estoqueRanking?.ranking || []).map((item: any) => ({
      produto: String(item.descricao || item.produto || item.nome || 'Produto não informado'),
      quantidade: toNumber(item.quantidade_total ?? item.quantidade ?? item.estoque),
      lojas: formatarLojas(item.principais_lojas || item.lojas || [], 8),
    })),
    segurosPorLoja: (segurosPorLoja?.ranking || []).map((item: any) => ({
      loja: String(item.loja || item.nome_loja || 'Loja não informada'),
      valor: toNumber(item.seguros_total ?? item.valor ?? item.total),
      quantidade: toNumber(item.seguros_qtd ?? item.quantidade ?? item.qtd),
    })),
    segurosPorVendedor: (segurosPorVendedor?.ranking || []).map((item: any) => ({
      vendedor: String(item.vendedor || item.nome_vendedor || 'Vendedor não informado'),
      loja: item.loja || item.nome_loja || '',
      valor: toNumber(item.seguros_total ?? item.valor ?? item.total),
      quantidade: toNumber(item.seguros_qtd ?? item.quantidade ?? item.qtd),
    })),
    recomendacoes: [
      'Avaliar lojas com alta concentração de estoque e baixo giro.',
      'Comparar desempenho de vendas com participação de seguros.',
      'Monitorar produtos com maior volume para possível redistribuição.',
    ],
    origem: dadosOriginais,
  };
}

const TOOLS_EXPORTAVEIS_EXCEL = new Set<string>([
  'consultar_estoque_produto',
  'consultar_ranking_estoque',
  'consultar_vendas_por_loja',
  'consultar_vendas_por_vendedor',
  'consultar_vendas_por_categoria',
  'consultar_vendas_resumo',
  'consultar_seguros_por_loja',
  'consultar_seguros_por_vendedor',
  'executar_sql_analitico',
  'gerar_relatorio_executivo',
  'consultar_relatorio_vendas',
  'consultar_analise_produto_comercial',
  'consultar_vendas_vs_estoque',
  'consultar_risco_stockout',
  'consultar_excesso_estoque',
  'consultar_redistribuicao_estoque',
  'consultar_modo_diretoria',
]);

function temDadosExportaveisExcel(resposta: ClarkResposta): boolean {
  const dados: any = resposta?.dados;

  const toolResults = Array.isArray(dados?.toolResults)
    ? dados.toolResults
    : Array.isArray(dados?.results)
      ? dados.results
      : Array.isArray(dados?.resultado?.toolResults)
        ? dados.resultado.toolResults
        : [];

  if (!toolResults.length) {
    return false;
  }

  const ferramentasExportaveis = new Set([
    'consultar_estoque_produto',
    'consultar_ranking_estoque',

    'consultar_vendas_resumo',
    'consultar_vendas_por_loja',
    'consultar_vendas_por_vendedor',
    'consultar_vendas_por_categoria',

    'consultar_seguros_por_loja',
    'consultar_seguros_por_vendedor',

    'executar_sql_analitico',
    'gerar_relatorio_executivo',
    'consultar_relatorio_vendas',
    'consultar_analise_produto_comercial',
    'consultar_vendas_vs_estoque',
    'consultar_risco_stockout',
    'consultar_excesso_estoque',
    'consultar_redistribuicao_estoque',
    'consultar_modo_diretoria',
  ]);

  return toolResults.some((item: any) => {
    const tool = String(item?.tool || item?.name || item?.nome || '').trim();

    if (!tool) return false;

    return ferramentasExportaveis.has(tool);
  });
}

function anexarAcaoExcelSeNecessario(
  _input: ClarkPerguntaInput,
  resposta: ClarkResposta,
): ClarkResposta {
  if (!temDadosExportaveisExcel(resposta)) {
    return resposta;
  }

  const actionsAtuais = Array.isArray(resposta.actions) ? resposta.actions : [];

  const jaTemExcel = actionsAtuais.some((action) => {
    return action?.type === 'download_excel';
  });

  if (jaTemExcel) {
    return resposta;
  }

  const actionsFinais: ClarkAction[] = [
    ...actionsAtuais,
    {
      type: 'download_excel',
      label: 'Baixar Excel',
    },
  ];

  const respostaFinal: ClarkResposta = {
    ...resposta,
  };

  if (actionsFinais.length > 0) {
    respostaFinal.actions = actionsFinais;
  }

  return respostaFinal;
}


/**
 * Clark v8: Brain inteligente primeiro, fluxo legado como fallback.
 * Não apague o service legado: ele continua útil para estabilidade.
 */
export async function processarPerguntaClark(input: ClarkPerguntaInput): Promise<ClarkResposta> {
  try {
    const respostaBrain = await processarComClarkBrain(input);
    const texto = String(respostaBrain?.clark || '').trim();

    if (
      texto &&
      texto !== '{}' &&
      texto !== '[]' &&
      !texto.includes('exactDictionaryCandidates') &&
      !texto.includes('similarDictionaryCandidates')
    ) {
      return anexarAcaoExcelSeNecessario(input, respostaBrain);
    }

    console.warn('⚠️ Clark Brain retornou resposta inadequada. Usando legado.');
  } catch (error) {
    console.warn('⚠️ Clark Brain falhou. Usando fluxo legado:', error);
  }

  const respostaLegado = await processarPerguntaClarkLegado(input);
  return anexarAcaoExcelSeNecessario(input, respostaLegado);
}

