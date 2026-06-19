import { GoogleGenAI } from '@google/genai';
import {
  ClarkAgentPlan,
  ClarkToolResult,
  ClarkVerificationResult,
} from '../agent/clarkAgent.types';
import { ClarkPeriodo } from '../clark.types';
import { formatBRL } from '../../intent/extractFilters';
import { gerarRespostaAnaliticaClaudeClark } from '../../ai/claudeClark';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Roteador de IA via Variável de Ambiente
const PROVIDER = process.env.CLARK_PROVIDER?.toLowerCase() || 'gemini';

function toNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clip(value: any, max = 26000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}... [cortado]` : text;
}

function isBadAnswer(text: string) {
  const s = String(text || '').trim();

  return (
    !s ||
    s === '{}' ||
    s === '[]' ||
    s.toLowerCase() === 'null' ||
    s.startsWith('{"') ||
    s.startsWith('{\n') ||
    s.includes('exactDictionaryCandidates') ||
    s.includes('similarDictionaryCandidates') ||
    s.includes('toolResults') ||
    s.includes('"result"') ||
    s.includes('"args"')
  );
}

function limparDescricaoProduto(descricao: any) {
  return String(descricao || '')
    .replace(/\bSM-[A-Z0-9]{6,}\b/gi, '')
    .replace(/\b[A-Z]{1,4}-?[A-Z0-9]{8,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function lojasFormatadasTodas(lojas: any[]) {
  if (!Array.isArray(lojas) || !lojas.length) {
    return '   • Sem lojas com quantidade positiva';
  }

  return lojas
    .map((l) => {
      const loja = String(l?.loja || '').trim() || 'Loja não informada';
      return `   • ${loja}: ${toNumber(l?.quantidade)} un.`;
    })
    .join('\n');
}

function resumoLojasRanking(lojas: any[], limit = 8) {
  if (!Array.isArray(lojas) || !lojas.length) {
    return 'sem lojas com quantidade positiva';
  }

  const top = lojas
    .slice(0, limit)
    .map((l) => {
      const loja = String(l?.loja || '').trim() || 'Loja não informada';
      return `${loja}: ${toNumber(l?.quantidade)} un.`;
    })
    .join(', ');

  const resto = lojas.length > limit ? ` (+${lojas.length - limit} lojas)` : '';

  return `${top}${resto}`;
}

function montarCriterioProduto(p: any, termoPesquisado?: string) {
  const partes = [
    p?.family || p?.model || termoPesquisado,
    p?.storage,
    p?.color,
    p?.category ? `categoria ${p.category}` : null,
  ].filter(Boolean);

  return partes.join(', ');
}

function normalizarNivelBuscaProduto(first: any) {
  const p = first?.produto_planejado || {};

  const temMemoria = Boolean(p.storage);
  const temCor = Boolean(p.color);

  const nivelInformado =
    first?.nivel_busca ||
    first?.searchLevel ||
    first?.search_level ||
    p?.nivel_busca ||
    p?.searchLevel ||
    p?.search_level ||
    '';

  const nivel = String(nivelInformado).toLowerCase();

  if (
    nivel.includes('familia') ||
    nivel.includes('família') ||
    nivel.includes('family') ||
    nivel.includes('linha') ||
    nivel.includes('modelo_aberto')
  ) {
    return 'familia';
  }

  if (
    nivel.includes('memoria') ||
    nivel.includes('memória') ||
    nivel.includes('storage') ||
    nivel.includes('intermediaria') ||
    nivel.includes('intermediária') ||
    nivel.includes('intermediario') ||
    nivel.includes('intermediário')
  ) {
    return 'memoria';
  }

  if (
    nivel.includes('exata') ||
    nivel.includes('exato') ||
    nivel.includes('specific') ||
    nivel.includes('specifico') ||
    nivel.includes('especifico') ||
    nivel.includes('específico')
  ) {
    return 'exato';
  }

  if (!temMemoria && !temCor) return 'familia';
  if (temMemoria && !temCor) return 'memoria';

  return 'exato';
}

function tituloProduto(first: any) {
  const p = first?.produto_planejado || {};

  return String(p.family || p.model || first?.termo_pesquisado || 'produto solicitado')
    .trim()
    .toUpperCase();
}

function subtituloProduto(first: any) {
  const p = first?.produto_planejado || {};

  const partes = [
    p.storage,
    p.color,
    p.category ? `categoria ${p.category}` : null,
  ].filter(Boolean);

  if (!partes.length) return '';

  return partes.join(' • ').toUpperCase();
}

function formatarListaProdutosEstoque(params: {
  produtos: any[];
  first: any;
  nivelBusca: string;
}) {
  const { produtos, first, nivelBusca } = params;

  const linhas = produtos.map((item: any, i: number) => {
    const descricaoLimpa = limparDescricaoProduto(item?.descricao);
    const lojas = item?.lojas || item?.principais_lojas || [];

    return [
      `${i + 1}. ${descricaoLimpa}`,
      `   Total: ${toNumber(item?.quantidade_total)} un.`,
      `   Lojas com estoque:`,
      lojasFormatadasTodas(lojas),
    ].join('\n');
  });

  const total = produtos.reduce((acc: number, item: any) => {
    return acc + toNumber(item?.quantidade_total);
  }, 0);

  const titulo = tituloProduto(first);
  const subtitulo = subtituloProduto(first);

  if (nivelBusca === 'familia') {
    return [
      `📦 Estoque encontrado — ${titulo}`,
      subtitulo ? `Filtro: ${subtitulo}` : '',
      `Total geral: ${total} un.`,
      `Variações encontradas: ${produtos.length}`,
      '',
      `Variações disponíveis:`,
      '',
      ...linhas,
    ]
      .filter((linha) => linha !== '')
      .join('\n');
  }

  if (nivelBusca === 'memoria') {
    return [
      `📦 Estoque encontrado — ${titulo}`,
      subtitulo ? `Filtro: ${subtitulo}` : '',
      `Total geral: ${total} un.`,
      `Cores/variações encontradas: ${produtos.length}`,
      '',
      `Variações disponíveis:`,
      '',
      ...linhas,
    ]
      .filter((linha) => linha !== '')
      .join('\n');
  }

  return [
    `📦 Estoque encontrado — ${titulo}`,
    subtitulo ? `Filtro: ${subtitulo}` : '',
    `Total geral: ${total} un.`,
    '',
    ...linhas,
  ]
    .filter((linha) => linha !== '')
    .join('\n');
}

function formatarCobertura(value: any) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'sem cálculo por falta de venda no período';
  return `${n.toFixed(1).replace('.', ',')} dias`;
}

function formatarAnaliseProdutoComercial(first: any) {
  const produto = String(first?.produto?.family || first?.produto?.query || 'produto solicitado').toUpperCase();
  const periodo = first?.periodo?.descricao || `${first?.periodo?.inicio || ''} até ${first?.periodo?.fim || ''}`.trim();

  const estoque = first?.estoque || {};
  const vendas = first?.vendas || {};
  const diagnostico = first?.diagnostico || {};

  const alertas = Array.isArray(diagnostico.alertas) ? diagnostico.alertas : [];
  const recomendacoes = Array.isArray(diagnostico.recomendacoes) ? diagnostico.recomendacoes : [];
  const excesso = Array.isArray(diagnostico.lojas_com_possivel_excesso) ? diagnostico.lojas_com_possivel_excesso : [];
  const ruptura = Array.isArray(diagnostico.lojas_com_risco_ruptura) ? diagnostico.lojas_com_risco_ruptura : [];
  const redistribuicao = Array.isArray(diagnostico.sugestoes_redistribuicao) ? diagnostico.sugestoes_redistribuicao : [];

  const linhas: string[] = [
    `📊 Análise comercial — ${produto}`,
    periodo ? `Período de vendas: ${periodo}` : '',
    '',
    'Resumo:',
    `• Estoque atual: ${toNumber(estoque.total_estoque)} un.`,
    `• Vendas no período: ${toNumber(vendas.total_pecas)} peça(s) | ${vendas.total_vendas_formatado || formatBRL(vendas.total_vendas)}`,
    `• Variações em estoque: ${toNumber(estoque.total_variacoes)}`,
    `• Lojas com estoque: ${toNumber(estoque.total_lojas)}`,
    `• Média diária de venda: ${Number(diagnostico.media_diaria_pecas || 0).toFixed(2).replace('.', ',')} peça(s)/dia`,
    `• Cobertura estimada: ${formatarCobertura(diagnostico.cobertura_dias)}`,
  ].filter(Boolean);

  if (alertas.length) {
    linhas.push('', 'Alertas:');
    alertas.slice(0, 8).forEach((item: any) => linhas.push(`• ${item}`));
  }

  if (ruptura.length) {
    linhas.push('', 'Lojas com possível risco de ruptura:');
    ruptura.slice(0, 15).forEach((item: any, index: number) => {
      linhas.push(`${index + 1}. ${item.loja} — estoque: ${toNumber(item.estoque)} un. | vendas: ${toNumber(item.vendas_periodo)} un. | ${item.motivo}`);
    });
  }

  if (excesso.length) {
    linhas.push('', 'Lojas com possível excesso:');
    excesso.slice(0, 15).forEach((item: any, index: number) => {
      linhas.push(`${index + 1}. ${item.loja} — estoque: ${toNumber(item.estoque)} un. | vendas: ${toNumber(item.vendas_periodo)} un. | cobertura: ${formatarCobertura(item.cobertura_dias)}`);
    });
  }

  if (redistribuicao.length) {
    linhas.push('', 'Sugestões de redistribuição:');
    redistribuicao.slice(0, 10).forEach((item: any, index: number) => {
      linhas.push(`${index + 1}. Enviar ${toNumber(item.quantidade_sugerida)} un. de ${item.origem} para ${item.destino}.`);
      linhas.push(`   Motivo: ${item.motivo}`);
    });
  }

  if (recomendacoes.length) {
    linhas.push('', 'Ações recomendadas:');
    recomendacoes.slice(0, 8).forEach((item: any) => linhas.push(`• ${item}`));
  }

  return linhas.join('\n');
}

function formatarModoDiretoria(first: any) {
  const periodo = first?.periodo?.descricao || `${first?.periodo?.inicio || ''} até ${first?.periodo?.fim || ''}`.trim();
  const resumo = first?.resumo || {};
  const topLojas = Array.isArray(first?.top_lojas_vendas) ? first.top_lojas_vendas : [];
  const topProdutos = Array.isArray(first?.top_produtos_estoque) ? first.top_produtos_estoque : [];
  const alertas = Array.isArray(first?.alertas) ? first.alertas : [];
  const recomendacoes = Array.isArray(first?.recomendacoes) ? first.recomendacoes : [];

  const linhas: string[] = [
    '👑 Modo Diretoria — resumo da operação',
    periodo ? `Período: ${periodo}` : '',
    '',
    'Indicadores principais:',
    `• Vendas: ${resumo.total_vendas_formatado || formatBRL(resumo.total_vendas)}`,
    `• Peças vendidas: ${toNumber(resumo.total_pecas)}`,
    `• Estoque atual: ${toNumber(resumo.estoque_total)} un.`,
    `• Lojas com venda: ${toNumber(resumo.lojas_com_venda)}`,
    `• Produtos em estoque: ${toNumber(resumo.produtos_em_estoque)}`,
  ].filter(Boolean);

  if (alertas.length) {
    linhas.push('', 'Pontos de atenção:');
    alertas.forEach((item: any) => linhas.push(`• ${item}`));
  }

  if (topLojas.length) {
    linhas.push('', 'Top lojas em vendas:');
    topLojas.slice(0, 10).forEach((item: any, index: number) => {
      linhas.push(`${index + 1}. ${item.loja}: ${item.total_vendas_formatado || formatBRL(item.total_vendas)} | ${toNumber(item.total_pecas)} peças`);
    });
  }

  if (topProdutos.length) {
    linhas.push('', 'Maiores concentrações de estoque:');
    topProdutos.slice(0, 10).forEach((item: any, index: number) => {
      linhas.push(`${index + 1}. ${limparDescricaoProduto(item.produto)} — ${toNumber(item.estoque)} un. em ${toNumber(item.total_lojas)} loja(s)`);
    });
  }

  if (recomendacoes.length) {
    linhas.push('', 'Ações recomendadas:');
    recomendacoes.forEach((item: any) => linhas.push(`• ${item}`));
  }

  return linhas.join('\n');
}

export function respostaLocalExecutiva(params: {
  plan: ClarkAgentPlan;
  results: ClarkToolResult[];
  periodo: ClarkPeriodo;
}) {
  const success = params.results.find((r) => r.ok && r.result);
  const first = success?.result;
  const tool = success?.tool;

  if (!first) {
    const erro = params.results.find((r) => r.error)?.error;

    return erro
      ? `Não consegui concluir a consulta: ${erro}. Nenhum dado foi inventado.`
      : 'Não encontrei dados suficientes para responder com segurança. Nenhum dado foi inventado.';
  }

  if (tool === 'responder_ajuda') {
    return (
      first.mensagem ||
      'Posso analisar vendas, estoque, lojas, vendedores, categorias, seguros, crescimento e relatórios executivos.'
    );
  }

  if (tool === 'consultar_ranking_estoque') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];

    if (!ranking.length) {
      return `Não encontrei estoque positivo para a categoria ${first.categoria_solicitada || 'solicitada'}.`;
    }

    const linhas = ranking.map((item: any) => {
      const descricaoLimpa = limparDescricaoProduto(item?.descricao);

      return [
        `${item?.posicao || ''}. ${descricaoLimpa}`,
        `   Total: ${toNumber(item?.quantidade_total)} un.`,
        `   Principais lojas: ${resumoLojasRanking(item?.principais_lojas || item?.lojas || [], 8)}`,
      ].join('\n');
    });

    return [
      `🏆 Ranking de estoque${first.categoria_solicitada ? ` — ${first.categoria_solicitada}` : ''}`,
      '',
      `Modelos encontrados: ${ranking.length}`,
      '',
      ...linhas,
    ].join('\n');
  }

  if (tool === 'consultar_estoque_produto') {
    const produtos = Array.isArray(first.produtos) ? first.produtos : [];
    const p = first.produto_planejado || {};
    const criterio = montarCriterioProduto(p, first.termo_pesquisado);
    const nivelBusca = normalizarNivelBuscaProduto(first);

    if (!produtos.length || first.produto_nao_encontrado_exato) {
      if (nivelBusca === 'familia') {
        return [
          `Não encontrei estoque para ${p.family || p.model || first.termo_pesquisado || 'a família solicitada'}.`,
          'Como você não informou memória nem cor, procurei a família inteira e não trouxe variações fora dela.',
        ].join('\n');
      }

      if (nivelBusca === 'memoria') {
        return [
          `Não encontrei estoque para ${criterio || first.termo_pesquisado || 'o produto solicitado'}.`,
          'Como você informou memória, procurei essa família com essa memória em todas as cores disponíveis.',
        ].join('\n');
      }

      return [
        `Não encontrei estoque exato para ${criterio || first.termo_pesquisado || 'o produto solicitado'}.`,
        'Não retornei modelos parecidos porque produto específico exige bater os filtros informados pelo usuário.',
      ].join('\n');
    }

    return formatarListaProdutosEstoque({
      produtos,
      first,
      nivelBusca,
    });
  }


  if (
    tool === 'consultar_analise_produto_comercial' ||
    tool === 'consultar_vendas_vs_estoque' ||
    tool === 'consultar_risco_stockout' ||
    tool === 'consultar_excesso_estoque' ||
    tool === 'consultar_redistribuicao_estoque'
  ) {
    return formatarAnaliseProdutoComercial(first);
  }

  if (tool === 'consultar_modo_diretoria') {
    return formatarModoDiretoria(first);
  }

  if (tool === 'consultar_vendas_resumo') {
    return [
      `💰 Resumo de vendas — ${first.periodo?.descricao || params.periodo.descricao}`,
      '',
      `Total vendido: ${first.total_vendas_formatado || formatBRL(first.total_vendas)}`,
      `Peças vendidas: ${toNumber(first.total_pecas)}`,
      `Ticket médio: ${first.ticket_medio_formatado || formatBRL(first.ticket_medio)}`,
    ].join('\n');
  }

  if (tool === 'consultar_vendas_por_loja') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];

    if (!ranking.length) {
      return `Não encontrei vendas por loja no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    }

    const linhas = ranking.map((item: any) => {
      return [
        `${item?.posicao || ''}. ${item?.loja}`,
        `   Total: ${item?.total_vendas_formatado || formatBRL(item?.total_vendas)}`,
        `   Peças: ${toNumber(item?.total_pecas)}`,
      ].join('\n');
    });

    return [
      `💰 Vendas por loja — ${first.periodo?.descricao || params.periodo.descricao}`,
      '',
      `Lojas encontradas: ${ranking.length}`,
      '',
      ...linhas,
    ].join('\n');
  }

  if (tool === 'consultar_vendas_por_vendedor') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];

    if (!ranking.length) {
      return `Não encontrei vendas por vendedor no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    }

    const linhas = ranking.map((item: any) => {
      return [
        `${item?.posicao || ''}. ${item?.vendedor}`,
        `   Loja: ${item?.loja || 'Não informada'}`,
        `   Total: ${item?.total_vendas_formatado || formatBRL(item?.total_vendas)}`,
        `   Peças: ${toNumber(item?.total_pecas)}`,
      ].join('\n');
    });

    return [
      `👤 Ranking de vendedores — ${first.periodo?.descricao || params.periodo.descricao}`,
      '',
      `Vendedores encontrados: ${ranking.length}`,
      '',
      ...linhas,
    ].join('\n');
  }

  if (tool === 'consultar_vendas_por_categoria') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];

    if (!ranking.length) {
      return `Não encontrei vendas por categoria no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    }

    const linhas = ranking.map((item: any) => {
      return [
        `${item?.posicao || ''}. ${item?.categoria}`,
        `   Total: ${item?.total_vendas_formatado || formatBRL(item?.total_vendas)}`,
        `   Peças: ${toNumber(item?.total_pecas)}`,
      ].join('\n');
    });

    return [
      `📊 Vendas por categoria — ${first.periodo?.descricao || params.periodo.descricao}`,
      '',
      `Categorias encontradas: ${ranking.length}`,
      '',
      ...linhas,
    ].join('\n');
  }

  if (tool === 'consultar_seguros_por_vendedor' || tool === 'consultar_seguros_por_loja') {
    const ranking = Array.isArray(first.ranking) ? first.ranking : [];

    if (!ranking.length) {
      return `Não encontrei seguros no período ${first.periodo?.descricao || params.periodo.descricao}.`;
    }

    const linhas = ranking.map((item: any) => {
      return [
        `${item?.posicao || ''}. ${item?.vendedor || item?.loja}`,
        `   Total: ${item?.seguros_total_formatado || formatBRL(item?.seguros_total)}`,
        `   Quantidade: ${toNumber(item?.seguros_qtd)}`,
      ].join('\n');
    });

    return [
      `🛡️ Ranking de seguros — ${first.periodo?.descricao || params.periodo.descricao}`,
      '',
      `Registros encontrados: ${ranking.length}`,
      '',
      ...linhas,
    ].join('\n');
  }

  if (tool === 'gerar_relatorio_executivo') {
    return String(first.relatorio || first.resumo || '').trim() || clip(JSON.stringify(first, null, 2), 6000);
  }

  if (tool === 'executar_sql_analitico') {
    const rows = Array.isArray(first.rows) ? first.rows : [];

    if (!rows.length) {
      return 'Executei a consulta analítica, mas não encontrei registros para responder com segurança.';
    }

    const linhas = rows.slice(0, 15).map((row: any, i: number) => {
      return `${i + 1}. ${Object.entries(row)
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ')}`;
    });

    return [
      `Consulta analítica concluída. Encontrei ${first.total_linhas || rows.length} linha(s).`,
      '',
      ...linhas,
    ].join('\n');
  }

  return clip(JSON.stringify(first, null, 2), 5000);
}

function promptFinal(params: {
  pergunta: string;
  plan: ClarkAgentPlan;
  results: ClarkToolResult[];
  verifier: ClarkVerificationResult;
  fallback: string;
}) {
  return `Você é a Clark, IA analítica executiva do TeleFluxo.

Responda em português do Brasil com clareza, precisão e formato profissional.

PERGUNTA:
${params.pergunta}

PLANO EXECUTADO:
${JSON.stringify(params.plan, null, 2)}

VALIDAÇÃO:
${JSON.stringify(params.verifier, null, 2)}

DADOS REAIS DAS FERRAMENTAS:
${clip(
  JSON.stringify(
    params.results.map((r) => ({
      tool: r.tool,
      ok: r.ok,
      args: r.args,
      result: r.result,
      error: r.error,
    })),
    null,
    2,
  ),
  30000,
)}

FALLBACK SEGURO:
${params.fallback}

REGRAS OBRIGATÓRIAS:
- Nunca invente números, lojas, produtos, vendedores ou períodos.
- Nunca mostre JSON bruto, trace, candidates, score, args ou nome de ferramenta interna.
- Nunca mostre referência técnica/código do produto, como "SM-A566EZKSZTO", salvo se o usuário pedir código/referência.
- Para consulta de estoque de produto, mostre TODAS as lojas com estoque. Não use "+N lojas com estoque".
- Não trate toda menção de produto como produto exato.
- Família apenas, exemplo "Galaxy A56", deve buscar todas as variações da família.
- Família + memória, exemplo "Galaxy A56 128GB", deve buscar todas as cores dessa memória.
- Família + cor, exemplo "Galaxy A56 Preto", deve buscar todas as memórias dessa cor.
- Família + memória + cor, exemplo "Galaxy A56 128GB Preto", deve buscar a variação específica.
- Referência/código, exemplo "SM-A566", deve ser busca específica.
- Responda com layout limpo, usando título, total geral, variações e todas as lojas.
- Para análise comercial de produto, organize em: resumo, alertas, risco de ruptura, excesso, redistribuição e ações recomendadas.
- Para modo diretoria, organize em: indicadores principais, pontos de atenção, top lojas, maiores estoques e ações recomendadas.
- Se não houver dado exato, diga claramente.
- Se o fallback já estiver bom e fiel aos dados, apenas melhore a formatação sem mudar números.

Se não conseguir melhorar o fallback com segurança, retorne o fallback reformatado.`;
}

export async function responderFinalClark(params: {
  pergunta: string;
  plan: ClarkAgentPlan;
  results: ClarkToolResult[];
  verifier: ClarkVerificationResult;
  periodo: ClarkPeriodo;
}): Promise<{ text: string; usedGemini: boolean }> {
  const fallback = respostaLocalExecutiva({
    plan: params.plan,
    results: params.results,
    periodo: params.periodo,
  });

  const conteudoPrompt = promptFinal({
    pergunta: params.pergunta,
    plan: params.plan,
    results: params.results,
    verifier: params.verifier,
    fallback,
  });

  // 1. Fluxo de Execução com Anthropic Claude
  if (PROVIDER === 'claude') {
    try {
      const text = await gerarRespostaAnaliticaClaudeClark(conteudoPrompt);

      if (isBadAnswer(text)) {
        return { text: fallback, usedGemini: false };
      }

      // Mantemos 'usedGemini' como true para preservar a integração no frontend/controller
      return { text, usedGemini: true }; 
    } catch (error) {
      console.warn('⚠️ Responder Claude falhou. Usando fallback local:', error);
      return { text: fallback, usedGemini: false };
    }
  }

  // 2. Fluxo de Execução Original com Google Gemini
  if (!genAI) {
    return {
      text: fallback,
      usedGemini: false,
    };
  }

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: conteudoPrompt,
      config: {
        temperature: 0.25,
      } as any,
    });

    const text = String(response.text || '').trim();

    if (isBadAnswer(text)) {
      return {
        text: fallback,
        usedGemini: false,
      };
    }

    return {
      text,
      usedGemini: true,
    };
  } catch (error) {
    console.warn('⚠️ Responder Gemini falhou. Usando fallback local:', error);

    return {
      text: fallback,
      usedGemini: false,
    };
  }
}