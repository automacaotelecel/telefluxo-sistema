import { ClarkPeriodo } from '../clark.types';
import { ClarkExecutiveReport } from './clarkExecutive.types';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const label = (key: string) => `${key.slice(5, 7)}/${key.slice(0, 4)}`;

/** Todos os números vêm das consultas; meses ausentes permanecem desconhecidos. */
export function criarQuadroVendasClark(data: any, periodo: ClarkPeriodo): ClarkExecutiveReport | null {
  if (!Array.isArray(data.mensal)) return null;
  const start = periodo.inicio.slice(0, 7), end = periodo.fim.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || start > end) return null;
  const map = new Map<string, any>(data.mensal.map((r: any) => [String(r.mes), r]));
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end && months.length < 120) {
    months.push(cursor);
    const date = new Date(`${cursor}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    cursor = date.toISOString().slice(0, 7);
  }
  if (cursor <= end) return null;
  const full = (m: string) => {
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return periodo.inicio <= `${m}-01` && periodo.fim >= last;
  };
  const available = months.filter(m => num(map.get(m)?.total_vendas) !== null);
  const missing = months.filter(m => !available.includes(m));
  const revenue = available.reduce((sum, m) => sum + map.get(m).total_vendas, 0);
  const quantityKnown = available.every(m => num(map.get(m)?.total_pecas) !== null);
  const units = available.reduce((sum, m) => sum + (num(map.get(m)?.total_pecas) ?? 0), 0);
  const rows = months.map((m, i) => {
    const row = map.get(m), value = num(row?.total_vendas), qty = num(row?.total_pecas);
    const prevKey = months[i - 1];
    const prev = prevKey ? num(map.get(prevKey)?.total_vendas) : null;
    const growth = value !== null && prev !== null && prev > 0 && full(m) && prevKey && full(prevKey)
      ? (value / prev - 1) * 100 : null;
    return { mes: label(m), faturamento: value === null ? '—' : brl(value), unidades: qty ?? '—',
      media: value !== null && qty !== null && qty > 0 ? brl(value / qty) : '—',
      variacao: growth === null ? '—' : `${growth.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`,
      cobertura: value === null ? 'Sem registros' : full(m) ? 'Mês completo no recorte' : 'Período parcial' };
  });
  const diagnosis: string[] = [];
  const complete = available.filter(full);
  if (complete.length) {
    const ordered = [...complete].sort((a,b) => map.get(b).total_vendas - map.get(a).total_vendas);
    diagnosis.push(`Maior faturamento entre os meses completos com registros: ${label(ordered[0]!)} (${brl(map.get(ordered[0]!).total_vendas)}).`);
    if (ordered.length > 1) diagnosis.push(`Menor faturamento entre os meses completos com registros: ${label(ordered[ordered.length - 1]!)} (${brl(map.get(ordered[ordered.length - 1]!).total_vendas)}).`);
  }
  const summaryValue = num(data.resumo?.total_vendas);
  const mismatch = summaryValue !== null && Math.abs(summaryValue - revenue) > 0.02;
  const risks = missing.length ? [`Sem registros em ${missing.map(label).join(', ')}. Isso não comprova faturamento zero; confira a carga da base.`] : [];
  if (mismatch) risks.push('O total mensal diverge do resumo da consulta. Confira a sincronização antes de usar o total.');
  const source = String(data.resumo?.fonte_dados || data.fonte_dados || 'não informada');
  return {
    version: 1, title: `Análise de vendas · ${data.filtro_loja || 'Lojas do escopo autorizado'}`,
    subtitle: `${periodo.inicio} a ${periodo.fim}`, agent: 'Análise de Vendas', generatedAt: new Date().toISOString(),
    status: !available.length ? 'unavailable' : missing.length || mismatch ? 'partial' : 'complete',
    metrics: available.length ? [
      { label: 'Faturamento apurado', value: brl(revenue), detail: 'Soma dos meses com registros' },
      ...(quantityKnown ? [{ label: 'Unidades vendidas', value: units.toLocaleString('pt-BR') }] : []),
      ...(quantityKnown && units > 0 ? [{ label: 'Valor médio por unidade', value: brl(revenue / units), detail: 'Faturamento ÷ unidades; não é ticket por nota' }] : []),
      { label: 'Meses com registros', value: `${available.length} de ${months.length}` },
    ] : [],
    columns: [{key:'mes',label:'Mês'}, {key:'faturamento',label:'Faturamento'}, {key:'unidades',label:'Unidades'},
      {key:'media',label:'Média por unidade'}, {key:'variacao',label:'Variação mensal'}, {key:'cobertura',label:'Cobertura'}],
    rows, diagnosis, risks,
    actions: missing.length ? ['Conferir a importação dos meses sem registros antes de comparar o período completo.'] : [],
    caveats: ['A variação compara apenas meses consecutivos completos no recorte, com base anterior positiva.',
      'O recorte completo não comprova que a importação da base esteja completa. Horário de sincronização não informado.',
      'As causas do desempenho exigem dados adicionais; faturamento isolado não comprova efeito de campanhas, estoque ou equipe.'],
    sources: [`Vendas · ${source}`],
  };
}
