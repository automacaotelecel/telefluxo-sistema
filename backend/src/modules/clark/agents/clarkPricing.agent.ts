import { listarHistoricoPrecosOnline } from '../onlinePrices/onlinePricesAgent.service';
import { OnlinePriceResult } from '../onlinePrices/onlinePrices.types';
import { ClarkExecutiveReport } from '../executive/clarkExecutive.types';
import { ClarkBrainContext } from '../brain/clarkBrain.types';

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const pct = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const norm = (v: string) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
const shortDate = (v: string) => {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'data não informada';
};

function matchesQuestion(item: OnlinePriceResult, ctx: ClarkBrainContext): boolean {
  const products = ctx.requirements.products;
  // Não transforme texto aproximado em identidade permanente de produto.
  if (products.length > 0) {
    const model = norm(item.modelo);
    return products.some((p) => {
      const wanted = norm(p.raw);
      const family = norm(p.family || '');
      const storage = norm(p.storage || '');
      const color = norm(p.color || '');
      return Boolean((wanted && model.includes(wanted)) ||
        (family && model.includes(family) && (!storage || model.includes(storage)) && (!color || model.includes(color))));
    });
  }
  return true;
}

function emptyReport(message: string): ClarkExecutiveReport {
  return {
    version: 1,
    title: 'Precificação e concorrência',
    subtitle: 'Última pesquisa disponível no Preços Online',
    agent: 'Precificação e Concorrência',
    generatedAt: new Date().toISOString(),
    status: 'unavailable',
    metrics: [], columns: [], rows: [],
    diagnosis: [message], risks: [],
    actions: ['Abra Preços Online, envie a planilha e execute uma nova análise. Depois consulte a Clark novamente.'],
    caveats: ['Não houve consulta ao vivo a lojas nesta pergunta.'],
    sources: ['Módulo Preços Online do TeleFluxo'],
  };
}

export function executarAgentePrecificacaoClark(ctx: ClarkBrainContext): ClarkExecutiveReport {
  // Histórico do usuário autenticado no fluxo existente. Não expor pesquisas de terceiros.
  const historico = listarHistoricoPrecosOnline(100);
  const latest = historico.find((entry) => entry.userId === ctx.userId);
  if (!latest) {
    return emptyReport('Não encontrei pesquisa de preços associada ao seu usuário. Não é possível informar preços atuais sem evidência.');
  }

  const matching = (latest.results || []).filter((r) => matchesQuestion(r, ctx));
  const valid = matching.filter((r) =>
    r.disponibilidade === 'encontrado' &&
    r.pesquisaStatus !== 'oferta_estimada' &&
    r.prazoEstimado !== true &&
    num(r.precoAvistaOnline) !== null &&
    r.url && /^https?:\/\//i.test(r.url) &&
    r.ofertaCompleta === true
  );

  // Uma linha por modelo/loja (menor preço válido), sem misturar 12x de outra URL.
  const unique = new Map<string, OnlinePriceResult>();
  for (const r of valid) {
    const key = `${norm(r.modelo)}::${norm(r.loja)}`;
    const prev = unique.get(key);
    if (!prev || Number(r.precoAvistaOnline) < Number(prev.precoAvistaOnline)) unique.set(key, r);
  }
  const ranked = [...unique.values()].sort((a, b) => Number(a.precoAvistaOnline) - Number(b.precoAvistaOnline));
  const compared = ranked.filter((r) => num(r.precoAvistaPlanilha) !== null);
  const below = compared.filter((r) => Number(r.precoAvistaOnline) < Number(r.precoAvistaPlanilha));
  const above = compared.filter((r) => Number(r.precoAvistaOnline) > Number(r.precoAvistaPlanilha));
  const creationDate = new Date(latest.createdAt);
  const ageHours = (Date.now() - creationDate.getTime()) / 3_600_000;
  const old = Number.isFinite(ageHours) && ageHours > 48;
  const models = new Set(ranked.map((r) => norm(r.modelo)));

  const risks: string[] = [];
  if (old) risks.push(`O levantamento tem mais de 48 horas (feito em ${shortDate(latest.createdAt)}). Os valores podem ter mudado.`);
  if (matching.length > ranked.length) risks.push(`${matching.length - ranked.length} resultado(s) não entraram na comparação por falta de evidência completa, preço válido ou indisponibilidade.`);
  if (above.length) risks.push(`${above.length} oferta(s) online ficaram acima do valor de referência da planilha. Conferir condições, produto e vendedor.`);
  const actions: string[] = [];
  if (below.length) actions.push(`Revisar as ${below.length} oferta(s) abaixo dos valores anotados na planilha, conferindo SKU, vendedor e condições antes de qualquer decisão.`);
  if (old || !valid.length) actions.push('Executar nova pesquisa na tela Preços Online para obter evidências mais recentes.');
  if (actions.length === 0) actions.push('Acompanhar as diferenças de preço nos próximos levantamentos; não há evidência suficiente para recomendar alterações automáticas.');

  const caveats = [
    'Os valores são da pesquisa salva, não de uma consulta ao vivo.',
    '“Planilha” representa a referência informada no levantamento; não foi comprovado que seja o preço interno da Telecel.',
    'Comparações entre variantes, memória, condições de pagamento ou vendedores podem não ser equivalentes.',
  ];
  if (ctx.requirements.products.length > 0 && matching.length === 0) caveats.push('O modelo solicitado não foi localizado na pesquisa mais recente.');
  if ((latest.results || []).length === 5000) caveats.push('O histórico pode conter apenas parte dos resultados da pesquisa original.');

  const rows = ranked.slice(0, 15).map((r) => {
    const price = Number(r.precoAvistaOnline);
    const baseline = num(r.precoAvistaPlanilha);
    const difference = baseline === null ? null : ((price - baseline) / baseline) * 100;
    return {
      modelo: r.modelo,
      loja: r.loja,
      online: moeda(price),
      referencia: baseline === null ? '—' : moeda(baseline),
      variacao: difference === null ? '—' : `${difference > 0 ? '+' : ''}${pct(difference)}`,
      consultado: shortDate(r.pesquisadoEm || latest.createdAt),
      url: r.url,
    };
  });

  return {
    version: 1,
    title: 'Precificação e concorrência',
    subtitle: `Pesquisa: ${shortDate(latest.createdAt)} · ${latest.originalName}`,
    agent: 'Precificação e Concorrência',
    generatedAt: new Date().toISOString(),
    dataAsOf: latest.createdAt,
    status: !matching.length ? 'unavailable' : !ranked.length || old ? 'partial' : 'complete',
    metrics: [
      { label: 'Ofertas verificadas', value: String(ranked.length), detail: 'Preço à vista e evidência completa' },
      { label: 'Modelos comparados', value: String(models.size) },
      { label: 'Abaixo da planilha', value: String(below.length), detail: 'Comparação somente quando há referência' },
      { label: 'Acima da planilha', value: String(above.length) },
    ],
    columns: [
      { key: 'modelo', label: 'Modelo' }, { key: 'loja', label: 'Loja' },
      { key: 'online', label: 'À vista online' }, { key: 'referencia', label: 'Na planilha' },
      { key: 'variacao', label: 'Diferença' }, { key: 'consultado', label: 'Pesquisado em' },
    ],
    rows,
    diagnosis: [
      ranked.length
        ? `Encontrei ${ranked.length} oferta(s) com evidência de preço à vista em ${models.size} modelo(s). Os menores valores encontrados aparecem na tabela.`
        : 'Não há ofertas verificadas para essa consulta na última pesquisa salva.',
      compared.length
        ? `${compared.length} oferta(s) têm valor de referência comparável na planilha; ${below.length} abaixo e ${above.length} acima.`
        : 'Não há referência de preço à vista preenchida para comparação; não é possível concluir vantagem comercial.',
    ],
    risks,
    actions,
    caveats,
    sources: [`Pesquisa Preços Online: ${latest.originalName}`, `Atualizada: ${shortDate(latest.createdAt)}`],
  };
}
