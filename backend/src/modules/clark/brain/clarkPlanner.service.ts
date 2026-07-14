import { GoogleGenAI } from '@google/genai';
import { ClarkAgentPlan, ClarkToolCall, ClarkToolName } from '../agent/clarkAgent.types';
import { ClarkFiltros, ClarkPeriodo } from '../clark.types';
import { normalizarTextoClark } from '../../intent/extractFilters';
import { CLARK_SCHEMA_CONTEXT } from './clarkSchemaContext';
import { ClarkBrainContext } from './clarkBrain.types';
import { gerarTextoClaudeClark } from '../../ai/claudeClark';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const PROVIDER = String(process.env.CLARK_PROVIDER || '').trim().toLowerCase();

function safeJsonParse(text: string) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Resposta vazia da IA.');
  const cleaned = raw.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Planner não retornou JSON válido.');
  }
}

function detectarLimite(pergunta: string, fallback = 10) {
  const text = normalizarTextoClark(pergunta);
  const match = text.match(/\bTOP\s+(\d{1,3})\b/) || text.match(/\bLISTE\s+OS?\s+(\d{1,3})\b/) || text.match(/\b(\d{1,3})\s+(MAIORES|PRINCIPAIS|MODELOS|PRODUTOS|VENDEDORES|LOJAS)\b/);
  const n = match?.[1] ? Number(match[1]) : fallback;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : fallback;
}

function call(tool: ClarkToolName, args: Record<string, any>, reason: string, periodo: ClarkPeriodo, pergunta: string): ClarkToolCall {
  return {
    tool,
    reason,
    args: {
      originalQuestion: pergunta,
      startDate: periodo.inicio,
      endDate: periodo.fim,
      ...args,
    },
  };
}

function categoriaDefault(pergunta: string, filtros: ClarkFiltros) {
  const text = normalizarTextoClark(pergunta);
  if (filtros.categoriaCanonica) return filtros.categoriaCanonica;
  if (text.includes('TABLET')) return 'TABLETS';
  if (text.includes('WATCH') || text.includes('BUDS') || text.includes('WEARABLE')) return 'WEARABLES';
  if (text.includes('ACESSORIO')) return 'ACESSÓRIOS';
  if (text.includes('GALAXY') || text.includes('SMART') || text.includes('APARELHO') || text.includes('CELULAR')) return 'SMARTPHONES';
  return 'SMARTPHONES';
}


function perguntaAtualTemProdutoEstoque(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  const temProduto =
    /\bGALAXY\b/i.test(pergunta) ||
    /\bSM-[A-Z0-9]/i.test(pergunta) ||
    /\bS\d{2}\s*(ULTRA|PLUS|FE)?\b/i.test(pergunta) ||
    /\bA\d{2}\b/i.test(pergunta) ||
    /\bM\d{2}\b/i.test(pergunta) ||
    /\bZ\s?(FLIP|FOLD)\b/i.test(pergunta) ||
    /\bTAB\s?S\b/i.test(pergunta);

  const pedeLocalizacaoOuEstoque =
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

  return temProduto && pedeLocalizacaoOuEstoque;
}


function perguntaAtualPareceProduto(pergunta: string) {
  return (
    /\bGALAXY\b/i.test(pergunta) ||
    /\bSM-[A-Z0-9]/i.test(pergunta) ||
    /\bS\d{2}\s*(ULTRA|PLUS|FE)?\b/i.test(pergunta) ||
    /\bA\d{2}\b/i.test(pergunta) ||
    /\bM\d{2}\b/i.test(pergunta) ||
    /\bZ\s?(FLIP|FOLD)\b/i.test(pergunta) ||
    /\bTAB\s?S\b/i.test(pergunta)
  );
}

function historicoPediuProduto(ctx: ClarkBrainContext) {
  const ultimas = (ctx.historico || []).slice(-4);
  return ultimas.some((m) => {
    if (m.role !== 'assistant') return false;
    const texto = normalizarTextoClark(m.text || '');
    return (
      texto.includes('QUAL PRODUTO') ||
      texto.includes('PRODUTO VOCE DESEJA') ||
      texto.includes('PRODUTO VOCÊ DESEJA') ||
      texto.includes('BUSCAR PRODUTO')
    );
  });
}

function perguntaAtualEhConsultaDiretaDeProduto(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);

  if (!perguntaAtualPareceProduto(pergunta)) return false;

  /**
   * Quando o usuário escreve apenas "Galaxy A56", "Galaxy A56 128GB",
   * "S26", "Modelos S26" etc., isso deve ser tratado como consulta de estoque.
   * Antes a Clark só entendia como estoque se viesse "quais lojas", "onde" ou se
   * o histórico tivesse pedido um produto. Isso fazia a pergunta cair em ajuda.
   */
  const assuntoNaoEhEstoque =
    texto.includes('VENDA') ||
    texto.includes('VENDAS') ||
    texto.includes('FATURAMENTO') ||
    texto.includes('SEGURO') ||
    texto.includes('SEGUROS') ||
    texto.includes('RELATORIO') ||
    texto.includes('RELATÓRIO') ||
    texto.includes('EXECUTIVO');

  return !assuntoNaoEhEstoque;
}

function deveForcarBuscaProduto(ctx: ClarkBrainContext) {
  if (perguntaAtualTemProdutoEstoque(ctx.perguntaOriginal)) return true;
  if (perguntaAtualEhConsultaDiretaDeProduto(ctx.perguntaOriginal)) return true;
  return perguntaAtualPareceProduto(ctx.perguntaOriginal) && historicoPediuProduto(ctx);
}

function perguntaAtualPedeRankingEstoque(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  const falaEstoque = texto.includes('ESTOQUE') || texto.includes('SMARTPHONE') || texto.includes('SMARTPHONES') || texto.includes('MODELOS');
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


function perguntaAtualPedeModoDiretoria(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  return (
    texto.includes('MODO DIRETORIA') ||
    texto.includes('RESUMO DA OPERACAO') ||
    texto.includes('RESUMO DA OPERAÇÃO') ||
    texto.includes('O QUE EU PRECISO OLHAR') ||
    texto.includes('PONTOS DE ATENCAO') ||
    texto.includes('PONTOS DE ATENÇÃO') ||
    texto.includes('LOJAS PREOCUPANTES') ||
    texto.includes('PRODUTOS PREOCUPANTES') ||
    texto.includes('RESUMO EXECUTIVO DA OPERACAO') ||
    texto.includes('RESUMO EXECUTIVO DA OPERAÇÃO')
  );
}

function perguntaAtualPedeAnaliseComercialProduto(pergunta: string) {
  const texto = normalizarTextoClark(pergunta);
  if (!perguntaAtualPareceProduto(pergunta)) return false;

  return (
    texto.includes('ANALISE') ||
    texto.includes('ANÁLISE') ||
    texto.includes('COMO ESTA') ||
    texto.includes('COMO ESTÁ') ||
    texto.includes('GIRO') ||
    texto.includes('COBERTURA') ||
    texto.includes('PARADO') ||
    texto.includes('PARADOS') ||
    texto.includes('VENDE POUCO') ||
    texto.includes('VENDENDO POUCO') ||
    texto.includes('EXCESSO') ||
    texto.includes('RUPTURA') ||
    texto.includes('STOCKOUT') ||
    texto.includes('REDISTRIBU') ||
    texto.includes('TRANSFERIR') ||
    texto.includes('TRANSFERENCIA') ||
    texto.includes('TRANSFERÊNCIA') ||
    texto.includes('ESTOQUE VS VENDA') ||
    texto.includes('VENDAS VS ESTOQUE')
  );
}

function ferramentaComercialProduto(pergunta: string): { tool: ClarkToolName; taskType: ClarkAgentPlan['taskType']; reason: string } {
  const texto = normalizarTextoClark(pergunta);

  if (texto.includes('REDISTRIBU') || texto.includes('TRANSFERIR') || texto.includes('TRANSFERENCIA') || texto.includes('TRANSFERÊNCIA')) {
    return {
      tool: 'consultar_redistribuicao_estoque',
      taskType: 'stock_redistribution',
      reason: 'Sugerir redistribuição cruzando estoque por loja e vendas do produto.',
    };
  }

  if (texto.includes('RUPTURA') || texto.includes('STOCKOUT') || texto.includes('FALTA')) {
    return {
      tool: 'consultar_risco_stockout',
      taskType: 'stockout_risk',
      reason: 'Identificar lojas com venda recente e baixo/zero estoque.',
    };
  }

  if (texto.includes('EXCESSO') || texto.includes('PARADO') || texto.includes('PARADOS') || texto.includes('VENDE POUCO') || texto.includes('VENDENDO POUCO')) {
    return {
      tool: 'consultar_excesso_estoque',
      taskType: 'excess_stock',
      reason: 'Identificar lojas com estoque alto e baixo giro no período.',
    };
  }

  if (texto.includes('VS') || texto.includes('VERSUS') || texto.includes('GIRO') || texto.includes('COBERTURA')) {
    return {
      tool: 'consultar_vendas_vs_estoque',
      taskType: 'stock_sales_cross',
      reason: 'Cruzar estoque atual com vendas do período para calcular giro e cobertura.',
    };
  }

  return {
    tool: 'consultar_analise_produto_comercial',
    taskType: 'product_commercial_analysis',
    reason: 'Analisar comercialmente o produto cruzando estoque, vendas, giro, riscos e recomendações.',
  };
}

export function planejarLocalClark(ctx: ClarkBrainContext): ClarkAgentPlan {
  const perguntaAtualProduto = deveForcarBuscaProduto(ctx);
  const perguntaAtualRanking = perguntaAtualPedeRankingEstoque(ctx.perguntaOriginal);

  // Se a pergunta atual cita produto específico ou pede ranking explicitamente,
  // ignoramos o histórico para evitar herdar o plano anterior.
  const pergunta = perguntaAtualProduto || perguntaAtualRanking ? ctx.perguntaOriginal : ctx.perguntaExpandida;
  const texto = normalizarTextoClark(pergunta);
  const limite = detectarLimite(pergunta, ctx.filtros.limite || 10);
  const categoria = categoriaDefault(pergunta, ctx.filtros);

  const falaProduto = /\b(GALAXY|SM-[A-Z0-9]|S\d{2}|A\d{2}|M\d{2}|Z\s?FLIP|Z\s?FOLD|TAB\s?S)\b/i.test(pergunta);
  const falaEstoque = texto.includes('ESTOQUE') || texto.includes('LOJAS') || texto.includes('POSSUEM') || texto.includes('ONDE') || texto.includes('PECA') || texto.includes('PEÇAS') || texto.includes('UNIDADES') || texto.includes('APARELHOS') || texto.includes('PRODUTO');
  const rankingEstoque = texto.includes('RANKING') || texto.includes('TOP') || texto.includes('MAIORES') || texto.includes('MAIOR ESTOQUE') || texto.includes('MODELOS QUE MAIS') || texto.includes('MAIS TEMOS EM ESTOQUE');

  if (perguntaAtualPedeModoDiretoria(ctx.perguntaOriginal)) {
    return {
      understoodQuestion: pergunta,
      taskType: 'director_mode',
      mode: 'analitico',
      confidence: 0.94,
      entities: { limit: limite, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [
        call('consultar_modo_diretoria', { limit: limite }, 'Gerar resumo executivo da operação com vendas, estoque, alertas e recomendações.', ctx.periodo, pergunta),
      ],
      validationRules: ['Usar apenas dados reais.', 'Trazer resumo executivo, alertas e ações recomendadas.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (perguntaAtualPedeAnaliseComercialProduto(ctx.perguntaOriginal)) {
    const ferramenta = ferramentaComercialProduto(ctx.perguntaOriginal);
    return {
      understoodQuestion: pergunta,
      taskType: ferramenta.taskType,
      mode: 'analitico',
      confidence: 0.95,
      entities: { category: categoria, limit: 100, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [
        call(ferramenta.tool, { query: pergunta, originalQuestion: ctx.perguntaOriginal, category: categoria, categoria, limit: 100 }, ferramenta.reason, ctx.periodo, pergunta),
      ],
      validationRules: [
        'Cruzar estoque atual com vendas do período.',
        'Não inventar giro, cobertura, loja, produto ou quantidade.',
        'Quando não houver venda no período, informar claramente.',
      ],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  const falaVendasProduto =
    falaProduto &&
    (
      texto.includes('VENDA') ||
      texto.includes('VENDAS') ||
      texto.includes('FATURAMENTO') ||
      texto.includes('GIRO') ||
      texto.includes('COBERTURA') ||
      texto.includes('SAIDA') ||
      texto.includes('SAÍDA')
    );

  if (falaVendasProduto) {
    return {
      understoodQuestion: pergunta,
      taskType: 'stock_sales_cross',
      mode: 'analitico',
      confidence: 0.94,
      entities: { category: categoria, limit: 100, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [
        call(
          'consultar_vendas_vs_estoque',
          { query: pergunta, originalQuestion: ctx.perguntaOriginal, category: categoria, categoria, limit: 100 },
          'Pergunta de continuação ou direta sobre vendas de produto. Cruzar vendas com estoque usando a memória/contexto da Clark quando existir.',
          ctx.periodo,
          pergunta,
        ),
      ],
      validationRules: [
        'Responder sobre o produto em contexto, não sobre vendas gerais.',
        'Cruzar estoque atual com vendas reais do período.',
        'Não inventar lojas, quantidade, giro ou cobertura.',
      ],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (falaProduto && (falaEstoque || perguntaAtualProduto)) {
    return {
      understoodQuestion: pergunta,
      taskType: 'stock_product_search',
      mode: 'analitico',
      confidence: 0.93,
      entities: { category: categoria, limit: 50, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [
        call('resolver_produto', { query: pergunta, originalQuestion: ctx.perguntaOriginal, category: categoria, categoria }, 'Resolver produto apenas como etapa interna.', ctx.periodo, pergunta),
        call('consultar_estoque_produto', { query: pergunta, originalQuestion: ctx.perguntaOriginal, category: categoria, categoria, strict: true, limit: 200 }, 'Consultar estoque por família/modelo, respeitando memória e cor quando informadas.', ctx.periodo, pergunta),
      ],
      validationRules: [
        'Se o usuário informou apenas família/modelo, retornar todas as variações encontradas dessa família/modelo.',
        'Se o usuário informou memória, respeitar a memória.',
        'Se o usuário informou cor, respeitar a cor.',
        'Não retornar produtos parecidos de outra família/modelo como se fossem corretos.',
      ],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if ((falaEstoque && rankingEstoque) || texto.includes('MODELOS QUE MAIS TEMOS')) {
    return {
      understoodQuestion: pergunta,
      taskType: 'stock_ranking',
      mode: 'analitico',
      confidence: 0.92,
      entities: { category: categoria, limit: limite, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [call('consultar_ranking_estoque', { category: categoria, categoria, limit: limite, includeStores: true }, 'Ranking real de estoque por modelo e loja.', ctx.periodo, pergunta)],
      validationRules: ['Retornar ranking real de estoque.', 'Respeitar limite pedido.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }



  if (texto.includes('RELATORIO') || texto.includes('RELATÓRIO') || texto.includes('ANALISE') || texto.includes('ANÁLISE') || texto.includes('EXECUTIVO')) {
    return {
      understoodQuestion: pergunta,
      taskType: 'sales_report',
      mode: 'analitico',
      confidence: 0.9,
      entities: { limit: limite, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [call('gerar_relatorio_executivo', { limit: limite }, 'Gerar relatório executivo cruzando dados reais disponíveis.', ctx.periodo, pergunta)],
      validationRules: ['Relatório deve usar apenas dados reais.', 'Trazer resumo, destaques, alertas e recomendações.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (texto.includes('SEGURO') || texto.includes('SEGUROS')) {
    const porLoja = texto.includes('LOJA') || texto.includes('LOJAS');
    const tool: ClarkToolName = porLoja ? 'consultar_seguros_por_loja' : 'consultar_seguros_por_vendedor';
    return {
      understoodQuestion: pergunta,
      taskType: porLoja ? 'insurance_store_ranking' : 'insurance_seller_ranking',
      mode: 'analitico',
      confidence: 0.88,
      entities: { limit: limite, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [call(tool, { limit: limite }, porLoja ? 'Ranking de seguros por loja.' : 'Ranking de seguros por vendedor.', ctx.periodo, pergunta)],
      validationRules: ['Responder apenas com dados reais de seguros.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  if (texto.includes('VENDA') || texto.includes('VENDAS') || texto.includes('FATURAMENTO') || texto.includes('VENDEMOS') || texto.includes('FATURAMOS')) {
    const vendedor = texto.includes('VENDEDOR') || texto.includes('VENDEDORES');
    const categoriaPerg = texto.includes('CATEGORIA') || texto.includes('CATEGORIAS') || texto.includes('FAMILIA') || texto.includes('FAMÍLIA');
    const loja = texto.includes('LOJA') || texto.includes('LOJAS') || Boolean(ctx.filtros.lojaCanonica);
    const crescimento = texto.includes('CRESC') || texto.includes('COMPAR') || texto.includes('MENSAL');
    let tool: ClarkToolName = 'consultar_vendas_resumo';
    let taskType: ClarkAgentPlan['taskType'] = 'sales_summary';
    if (crescimento) { tool = 'consultar_crescimento_mensal'; taskType = 'sales_growth'; }
    else if (vendedor) { tool = 'consultar_vendas_por_vendedor'; taskType = 'sales_seller_ranking'; }
    else if (categoriaPerg) { tool = 'consultar_vendas_por_categoria'; taskType = 'sales_category_ranking'; }
    else if (loja) { tool = 'consultar_vendas_por_loja'; taskType = 'sales_store_ranking'; }

    return {
      understoodQuestion: pergunta,
      taskType,
      mode: 'analitico',
      confidence: 0.9,
      entities: { limit: limite, store: ctx.filtros.lojaCanonica || null, category: ctx.filtros.categoriaCanonica || null, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [call(tool, { limit: limite, store: ctx.filtros.lojaCanonica || undefined, category: ctx.filtros.categoriaCanonica || undefined }, 'Consulta real de vendas no banco.', ctx.periodo, pergunta)],
      validationRules: ['Usar o período solicitado.', 'Não inventar valores.'],
      answerStyle: { shouldExplainUncertainty: false, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  // Perguntas cruzadas/complexas que o detector não capturou: usar SQL analítico como ferramenta de pensamento.
  if (texto.includes('ESTOQUE') || texto.includes('LOJA') || texto.includes('VENDEDOR') || texto.includes('PRODUTO') || texto.includes('CATEGORIA') || texto.includes('RISCO') || texto.includes('RUPTURA')) {
    return {
      understoodQuestion: pergunta,
      taskType: 'sql_analytics',
      mode: 'analitico',
      confidence: 0.7,
      entities: { limit: limite, period: { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim, descricao: ctx.periodo.descricao } },
      toolCalls: [call('executar_sql_analitico', { sql: 'SELECT 1 AS consulta_precisa_de_planejamento', limit: 20 }, 'Fallback analítico. O planner Gemini deve substituir por SQL útil quando disponível.', ctx.periodo, pergunta)],
      validationRules: ['SQL deve ser SELECT e responder à pergunta.'],
      answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: true, shouldIncludeInsights: true, shouldIncludeSuggestions: true },
    };
  }

  return {
    understoodQuestion: pergunta,
    taskType: 'help',
    mode: 'simples',
    confidence: 0.35,
    entities: {},
    toolCalls: [call('responder_ajuda', {}, 'Pergunta fora do escopo.', ctx.periodo, pergunta)],
    validationRules: [],
    answerStyle: { shouldExplainUncertainty: true, shouldIncludeTables: false, shouldIncludeInsights: false, shouldIncludeSuggestions: true },
  };
}

function promptPlanner(ctx: ClarkBrainContext, planoLocal: ClarkAgentPlan) {
  return `Você é o PLANNER da Clark, IA analítica do TeleFluxo.

Sua tarefa é montar um plano JSON. Você NÃO responde ao usuário.

Pergunta original: ${ctx.perguntaOriginal}
Pergunta com contexto: ${ctx.perguntaExpandida}
Histórico recente: ${JSON.stringify(ctx.historico)}
Período detectado pelo backend: ${JSON.stringify(ctx.periodo)}
Filtros detectados pelo backend: ${JSON.stringify(ctx.filtros)}

${CLARK_SCHEMA_CONTEXT}

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
- gerar_relatorio_executivo
- consultar_analise_produto_comercial
- consultar_vendas_vs_estoque
- consultar_risco_stockout
- consultar_excesso_estoque
- consultar_redistribuicao_estoque
- consultar_modo_diretoria
- executar_sql_analitico
- responder_ajuda

Use executar_sql_analitico quando a pergunta exigir cruzar dados ou algo fora das ferramentas prontas. O SQL deve ser SELECT e usar LIMIT.

Plano local sugerido pelo backend: ${JSON.stringify(planoLocal)}

Retorne SOMENTE JSON válido neste formato:
{
  "understoodQuestion": string,
  "taskType": "stock_product_search" | "stock_ranking" | "sales_summary" | "sales_store_ranking" | "sales_seller_ranking" | "sales_category_ranking" | "sales_report" | "sales_growth" | "insurance_seller_ranking" | "insurance_store_ranking" | "sql_analytics" | "product_commercial_analysis" | "stock_sales_cross" | "stockout_risk" | "excess_stock" | "stock_redistribution" | "director_mode" | "help",
  "mode": "simples" | "analitico",
  "confidence": number,
  "entities": object,
  "toolCalls": [{ "tool": string, "reason": string, "args": object }],
  "validationRules": string[],
  "answerStyle": { "shouldExplainUncertainty": boolean, "shouldIncludeTables": boolean, "shouldIncludeInsights": boolean, "shouldIncludeSuggestions": boolean }
}`;
}

export async function planejarClark(ctx: ClarkBrainContext): Promise<{ plan: ClarkAgentPlan; usedGemini: boolean }> {
  const local = planejarLocalClark(ctx);

  // Consulta de produto e ranking explícito são determinísticos.
  // Não deixamos a Gemini reaproveitar histórico e trocar por ajuda/ranking errado.
  if (deveForcarBuscaProduto(ctx) || perguntaAtualPedeRankingEstoque(ctx.perguntaOriginal)) {
    return { plan: local, usedGemini: false };
  }

  const normalizarPlano = (parsed: any): ClarkAgentPlan => {
    const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
    const normalizedCalls: ClarkToolCall[] = toolCalls
      .filter((c: any) => c && c.tool)
      .map((c: any) => ({
        tool: c.tool as ClarkToolName,
        reason: String(c.reason || ''),
        args: {
          originalQuestion: ctx.perguntaExpandida,
          startDate: ctx.periodo.inicio,
          endDate: ctx.periodo.fim,
          ...(c.args || {}),
        },
      }));

    return {
      ...local,
      ...parsed,
      toolCalls: normalizedCalls.length ? normalizedCalls : local.toolCalls,
      validationRules: Array.isArray(parsed.validationRules) ? parsed.validationRules : local.validationRules,
      answerStyle: { ...local.answerStyle, ...(parsed.answerStyle || {}) },
    };
  };

  if (PROVIDER === 'claude') {
    try {
      const text = await gerarTextoClaudeClark({
        prompt: promptPlanner(ctx, local),
        maxTokens: 2048,
        temperature: 0,
        system:
          'Você é o planner da Clark, um agente analítico do TeleFluxo. Retorne somente JSON válido, sem markdown e sem explicações.',
      });

      return { plan: normalizarPlano(safeJsonParse(text)), usedGemini: true };
    } catch (error) {
      console.warn('⚠️ Planner Claude falhou. Usando planner local:', error);
      return { plan: local, usedGemini: false };
    }
  }

  if (!genAI) return { plan: local, usedGemini: false };

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: promptPlanner(ctx, local),
      config: { temperature: 0.15, responseMimeType: 'application/json' } as any,
    });

    return { plan: normalizarPlano(safeJsonParse(String(response.text || ''))), usedGemini: true };
  } catch (error) {
    console.warn('⚠️ Planner Gemini falhou. Usando planner local:', error);
    return { plan: local, usedGemini: false };
  }
}
