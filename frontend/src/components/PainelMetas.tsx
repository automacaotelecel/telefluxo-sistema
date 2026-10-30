import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownRight, CalendarClock, Calculator, ChevronDown, ChevronRight, FileSpreadsheet, LockKeyhole, RefreshCw, Target, TrendingUp, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ============================== Tipos ============================== */
type Group = 'APARELHOS' | 'ACESSORIOS' | 'SEGUROS';
type Status = 'confirmado' | 'provisorio' | 'indisponivel';
type QuarterRow = {
  quarter: number; region: string; uf: string; store: string; cnpj: string; group: Group;
  base: number; actual: number; carryIn: number;
  carryStatus: 'inicial' | 'confirmado' | 'aguardando'; carryAwaiting: number | null;
  adjustedRaw: number; adjusted: number; unusedCredit: number;
  balance: number | null; balanceStatus: Status;
  dataStatus: 'disponivel' | 'indisponivel' | 'nao_iniciado'; resultStatus: string;
  pending: number; exceeded: number; closed: boolean; closureStatus: string; dueDate: string;
};
type MonthRow = {
  month: number; quarter: number; region: string; store: string; cnpj: string;
  group: Group; value: number; actual: number;
};
type Closure = { label: string; configured: boolean; listedQuarters: number[]; confirmedQuarters: number[] };
type Data = {
  success: boolean; year: number; currentQuarter: number; scope: 'network' | 'stores';
  todayBR: string; closure: Closure;
  generatedAt: string; sheetUpdatedAt: string; sheetStale: boolean;
  months: MonthRow[]; quarters: QuarterRow[]; notes: string[];
  sourceByMonth: Record<number, string>;
  access: { canCompareStores: boolean; stores: number };
};
type Line = {
  cnpj: string; store: string; region: string; uf: string; group: Group;
  base: number; pend: number; cred: number; adjusted: number; unused: number; actual: number;
  falta: number; excedente: number; balance: number | null; balanceStatus: Status;
  unavailable: boolean; awaitingFlag: boolean; awaitingValue: number | null;
};
type Agg = {
  lines: number; base: number; pend: number; cred: number; adjusted: number; unused: number; actual: number;
  validAdjusted: number; validActual: number; falta: number; excedente: number; unavailable: number;
  awaitingPend: number; awaitingCred: number; awaitingUnknown: number;
};
type PeriodCtx = { state: 'encerrado' | 'andamento' | 'futuro'; remaining: number; totalDays: number; start: number; end: number };
type Tone = 'done' | 'ok' | 'warn' | 'bad' | 'neutral';

/* ============================== Constantes / formatadores ============================== */
const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);
const pct = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const fmt = (v: string) => v ? new Date(v).toLocaleString('pt-BR') : '—';
const groupLabels: Record<Group, string> = { APARELHOS: 'Aparelhos + Wearables', ACESSORIOS: 'Acessórios', SEGUROS: 'Seguros' };
const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* Paleta de status: verde = meta batida / no ritmo, âmbar = atenção, vermelho = abaixo, cinza = sem leitura */
const toneStyle: Record<Tone, { text: string; bar: string; border: string; row: string; pill: string; dot: string }> = {
  done: { text: 'text-emerald-700', bar: 'bg-emerald-500', border: 'border-l-emerald-500', row: 'bg-emerald-50/70', pill: 'bg-emerald-600 text-white', dot: 'bg-emerald-600' },
  ok: { text: 'text-emerald-700', bar: 'bg-emerald-400', border: 'border-l-emerald-300', row: 'bg-emerald-50/30', pill: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-300' },
  warn: { text: 'text-amber-700', bar: 'bg-amber-400', border: 'border-l-amber-400', row: 'bg-amber-50/60', pill: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400' },
  bad: { text: 'text-rose-700', bar: 'bg-rose-500', border: 'border-l-rose-500', row: 'bg-rose-50/60', pill: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
  neutral: { text: 'text-slate-600', bar: 'bg-slate-400', border: 'border-l-slate-300', row: 'bg-white', pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-300' },
};

/* ============================== Datas / períodos ============================== */
const DAY_MS = 86400000;
const isoMs = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const dayBR = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const periodRange = (selected: number): [number, number] => {
  if (selected === -1) return [1, 2];
  if (selected === -2) return [3, 4];
  if (selected >= 1 && selected <= 4) return [selected, selected];
  return [1, 4];
};
// Datas pelo calendário de São Paulo informado pelo backend (todayBR). Dias restantes = a partir de amanhã até o fim do período.
function rangeContext(start: number, end: number, todayBR: string): PeriodCtx {
  const totalDays = Math.round((end - start) / DAY_MS) + 1;
  const today = isoMs(todayBR);
  if (today > end) return { state: 'encerrado', remaining: 0, totalDays, start, end };
  if (today < start) return { state: 'futuro', remaining: totalDays, totalDays, start, end };
  return { state: 'andamento', remaining: Math.max(0, Math.round((end - today) / DAY_MS)), totalDays, start, end };
}
const periodContext = (year: number, from: number, to: number, todayBR: string) =>
  rangeContext(Date.UTC(year, (from - 1) * 3, 1), Date.UTC(year, to * 3, 0), todayBR);
const monthContext = (year: number, month: number, todayBR: string) =>
  rangeContext(Date.UTC(year, month - 1, 1), Date.UTC(year, month, 0), todayBR);
const defaultMonth = (d: Data) => {
  const y = Number(d.todayBR.slice(0, 4));
  const m = Number(d.todayBR.slice(5, 7));
  return y === d.year ? m : y > d.year ? 12 : 1;
};

/* ============================== Cálculos ============================== */
// Consolida por loja/CNPJ + categoria. Meta do período = Σ originais + saldo recebido ANTES do período
// (carryIn do 1º trimestre). Transferências entre trimestres do mesmo período não entram (sem dupla contagem).
function consolidate(rows: QuarterRow[], from: number, to: number): Line[] {
  const groups = new Map<string, QuarterRow[]>();
  rows.filter(r => r.quarter >= from && r.quarter <= to).forEach(r => {
    const key = `${r.cnpj}|${r.group}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  });
  return [...groups.values()].map(list => {
    const sorted = [...list].sort((a, b) => a.quarter - b.quarter);
    const first = sorted[0]!;
    const base = sorted.reduce((s, r) => s + r.base, 0);
    const actual = sorted.reduce((s, r) => s + r.actual, 0);
    const adjusted = Math.max(0, base + first.carryIn);
    const unavailable = sorted.some(r => r.dataStatus === 'indisponivel');
    const notStarted = sorted.every(r => r.dataStatus === 'nao_iniciado');
    const awaitingFlag = first.carryStatus === 'aguardando';
    const carryForBalance = awaitingFlag ? first.carryAwaiting : first.carryIn;
    const allClosed = sorted.every(r => r.closed);
    const balance = unavailable || notStarted || carryForBalance === null ? null : base + carryForBalance - actual;
    const balanceStatus: Status = balance === null ? 'indisponivel' : allClosed ? 'confirmado' : 'provisorio';
    return {
      cnpj: first.cnpj, store: first.store, region: first.region, uf: first.uf, group: first.group,
      base, pend: Math.max(0, first.carryIn), cred: Math.max(0, -first.carryIn), adjusted,
      unused: Math.max(0, -(base + first.carryIn)), actual,
      falta: unavailable ? 0 : Math.max(0, adjusted - actual),
      excedente: unavailable ? 0 : Math.max(0, actual - adjusted),
      balance, balanceStatus, unavailable, awaitingFlag, awaitingValue: awaitingFlag ? first.carryAwaiting : null,
    };
  });
}
const emptyAgg: Agg = {
  lines: 0, base: 0, pend: 0, cred: 0, adjusted: 0, unused: 0, actual: 0, validAdjusted: 0, validActual: 0,
  falta: 0, excedente: 0, unavailable: 0, awaitingPend: 0, awaitingCred: 0, awaitingUnknown: 0,
};
const aggregate = (ls: Line[]): Agg => ls.reduce((a, l) => ({
  lines: a.lines + 1, base: a.base + l.base, pend: a.pend + l.pend, cred: a.cred + l.cred,
  adjusted: a.adjusted + l.adjusted, unused: a.unused + l.unused, actual: a.actual + l.actual,
  validAdjusted: a.validAdjusted + (l.unavailable ? 0 : l.adjusted), validActual: a.validActual + (l.unavailable ? 0 : l.actual),
  falta: a.falta + l.falta, excedente: a.excedente + l.excedente, unavailable: a.unavailable + (l.unavailable ? 1 : 0),
  awaitingPend: a.awaitingPend + (l.awaitingFlag && l.awaitingValue !== null ? Math.max(0, l.awaitingValue) : 0),
  awaitingCred: a.awaitingCred + (l.awaitingFlag && l.awaitingValue !== null ? Math.max(0, -l.awaitingValue) : 0),
  awaitingUnknown: a.awaitingUnknown + (l.awaitingFlag && l.awaitingValue === null ? 1 : 0),
}), emptyAgg);
// Agregação mensal (meta original do mês × realizado). Linhas com vendas indisponíveis ficam fora do cálculo.
function aggregateMonth(rows: MonthRow[], unavail: Set<string>): Agg {
  return rows.reduce((a, m) => {
    const un = unavail.has(`${m.cnpj}|${m.group}|${m.quarter}`);
    return {
      ...a, lines: a.lines + 1, base: a.base + m.value, adjusted: a.adjusted + m.value, actual: a.actual + m.actual,
      validAdjusted: a.validAdjusted + (un ? 0 : m.value), validActual: a.validActual + (un ? 0 : m.actual),
      falta: a.falta + (un ? 0 : Math.max(0, m.value - m.actual)),
      excedente: a.excedente + (un ? 0 : Math.max(0, m.actual - m.value)),
      unavailable: a.unavailable + (un ? 1 : 0),
    };
  }, emptyAgg);
}
// Saldos nunca são compensados entre lojas ou categorias.
const saldoAll = (ls: Line[]) => ls.filter(l => l.balance !== null)
  .reduce((a, l) => ({ pend: a.pend + Math.max(0, l.balance!), cred: a.cred + Math.max(0, -l.balance!) }), { pend: 0, cred: 0 });

const atingText = (a: Agg) => a.lines === 0 ? '—'
  : a.unavailable === a.lines ? 'Sem dados'
  : a.validAdjusted <= 0 ? 'Meta zero'
  : `${pct(100 * a.validActual / a.validAdjusted)}${a.unavailable ? ' *' : ''}`;
const faltaText = (a: Agg) => a.lines === 0 ? '—'
  : a.unavailable === a.lines ? 'Sem dados'
  : a.validAdjusted <= 0 ? 'Meta zero'
  : a.falta === 0 ? 'Meta batida'
  : `${money(a.falta)}${a.unavailable ? ' *' : ''}`;
function dailyText(a: Agg, ctx: PeriodCtx): string {
  if (a.lines === 0) return '—';
  if (a.unavailable === a.lines) return 'Sem dados';
  if (ctx.state === 'encerrado') return '—';
  if (ctx.state === 'futuro') return `${money(a.adjusted / ctx.totalDays)} (plano)`;
  if (a.validAdjusted > 0 && a.falta === 0) return '—';
  if (ctx.remaining === 0) return a.falta > 0 ? 'Sem dias futuros' : '—';
  return `${money(a.falta / ctx.remaining)}${a.unavailable ? ' *' : ''}`;
}
// Situação: batida | no ritmo | atenção (até 20% abaixo do ritmo esperado) | abaixo.
function toneOf(a: Agg, ctx: PeriodCtx | null): Tone {
  if (!ctx || a.lines === 0 || a.unavailable === a.lines || a.validAdjusted <= 0) return 'neutral';
  if (a.falta === 0) return 'done';
  if (ctx.state === 'futuro') return 'neutral';
  if (ctx.state === 'encerrado') return 'bad';
  const elapsed = ctx.totalDays - ctx.remaining;
  const expected = a.validAdjusted * elapsed / ctx.totalDays;
  const ratio = expected > 0 ? a.validActual / expected : 1;
  return ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad';
}
function toneLabel(t: Tone, ctx: PeriodCtx | null, a: Agg): string {
  if (a.lines === 0) return '—';
  if (a.unavailable === a.lines) return 'Sem dados';
  if (a.validAdjusted <= 0) return 'Meta zero';
  if (t === 'done') return 'Meta batida';
  if (ctx?.state === 'futuro') return 'Não iniciado';
  if (t === 'ok') return 'No ritmo';
  if (t === 'warn') return 'Atenção';
  if (t === 'bad') return ctx?.state === 'encerrado' ? 'Não atingida' : 'Abaixo do ritmo';
  return '—';
}
const parseNum = (v: string): number | null => {
  let s = v.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* ============================== Componentes visuais ============================== */
const selectClass = 'min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-orange-400';
const labelClass = 'text-[10px] font-black uppercase tracking-wider text-slate-500';

function StatusPill({ a, ctx }: { a: Agg; ctx: PeriodCtx | null }) {
  const t = toneOf(a, ctx);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${toneStyle[t].pill}`}>{toneLabel(t, ctx, a)}</span>;
}
function ProgressBar({ a, ctx }: { a: Agg; ctx: PeriodCtx | null }) {
  const t = toneOf(a, ctx);
  const ratio = a.validAdjusted > 0 ? Math.min(1, a.validActual / a.validAdjusted) : 0;
  return <div className="min-w-[96px]">
    <div className={`font-black ${toneStyle[t].text}`}>{atingText(a)}</div>
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${toneStyle[t].bar}`} style={{ width: `${ratio * 100}%` }} /></div>
  </div>;
}
// Saldo da meta anterior: vermelho = débito (aumenta a meta), verde = crédito (reduz a meta).
function SaldoCell({ pend, cred }: { pend: number; cred: number }) {
  if (pend <= 0 && cred <= 0) return <span className="text-slate-400">—</span>;
  return <div className="space-y-0.5 whitespace-nowrap font-bold">
    {pend > 0 && <div className="text-rose-600" title="Débito: aumenta a meta">− {money(pend)}</div>}
    {cred > 0 && <div className="text-emerald-600" title="Crédito: reduz a meta">+ {money(cred)}</div>}
  </div>;
}
function AggCells({ a, ctx }: { a: Agg; ctx: PeriodCtx | null }) {
  const batida = a.validAdjusted > 0 && a.falta === 0 && a.unavailable < a.lines;
  return <>
    <td className="px-4 py-3">{money(a.base)}</td>
    <td className="px-4 py-3"><SaldoCell pend={a.pend} cred={a.cred} /></td>
    <td className="px-4 py-3 font-bold">{money(a.adjusted)}</td>
    <td className="px-4 py-3">{money(a.actual)}</td>
    <td className="px-4 py-3"><ProgressBar a={a} ctx={ctx} /></td>
    <td className={`whitespace-nowrap px-4 py-3 font-semibold ${batida ? 'text-emerald-700' : 'text-rose-600'}`}>{faltaText(a)}</td>
    <td className="whitespace-nowrap px-4 py-3">{ctx ? dailyText(a, ctx) : '—'}</td>
    <td className="px-4 py-3"><StatusPill a={a} ctx={ctx} /></td>
  </>;
}
function KpiCard({ title, icon: Icon, value, valueClass = 'text-slate-900', children }: { title: string; icon: LucideIcon; value: string; valueClass?: string; children?: ReactNode }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{title}</span><Icon size={18} className="shrink-0 text-orange-600" /></div>
    <div className={`mt-3 break-words text-2xl font-black tracking-tight lg:text-[26px] ${valueClass}`}>{value}</div>
    {children}
  </div>;
}
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className={labelClass}>{label}</div><div className="mt-1 text-sm font-semibold text-slate-800">{children}</div></div>;
}

/* ============================== Aba Fechamentos ============================== */
const stageStyle = {
  fechado: { label: 'Fechamento confirmado', cls: 'bg-emerald-100 text-emerald-800' },
  aguardando: { label: 'Encerrado · aguardando confirmação', cls: 'bg-amber-100 text-amber-800' },
  andamento: { label: 'Em andamento', cls: 'bg-sky-100 text-sky-800' },
  futuro: { label: 'Não iniciado', cls: 'bg-slate-100 text-slate-600' },
} as const;

function ClosureView({ scoped, rangeQuarters, year, todayBR, confirmedQs }: {
  scoped: QuarterRow[]; rangeQuarters: number[]; year: number; todayBR: string; confirmedQs: number[];
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const blocks = useMemo(() => rangeQuarters.map(q => {
    const ls = consolidate(scoped, q, q);
    const agg = aggregate(ls);
    const ctx = periodContext(year, q, q, todayBR);
    const confirmed = confirmedQs.includes(q);
    const stage: keyof typeof stageStyle = confirmed ? 'fechado' : ctx.state === 'encerrado' ? 'aguardando' : ctx.state === 'futuro' ? 'futuro' : 'andamento';
    const byStore = new Map<string, Line[]>();
    ls.forEach(l => byStore.set(l.cnpj, [...(byStore.get(l.cnpj) || []), l]));
    const stores = [...byStore.entries()].map(([cnpj, items]) => ({
      cnpj, store: items[0]!.store, uf: items[0]!.uf, agg: aggregate(items), saldo: saldoAll(items),
    })).sort((x, y) => x.store.localeCompare(y.store));
    return { q, ctx, agg, stage, confirmed, saldo: saldoAll(ls), semSaldo: ls.filter(l => l.balance === null).length, stores };
  }), [scoped, rangeQuarters, year, todayBR, confirmedQs]);

  if (blocks.every(b => b.agg.lines === 0)) return <p className="p-6 text-center text-sm text-slate-500">Nenhum dado para os filtros selecionados.</p>;
  return <div className="space-y-4">
    {blocks.filter(b => b.agg.lines > 0).map(b => <article key={b.q} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{b.q}º trimestre</h3>
          <p className="text-xs text-slate-500">{dayBR(b.ctx.start)} a {dayBR(b.ctx.end)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${stageStyle[b.stage].cls}`}>{stageStyle[b.stage].label}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
        <Metric label="Meta ajustada">{money(b.agg.adjusted)}</Metric>
        <Metric label="Realizado">{money(b.agg.actual)}</Metric>
        <Metric label="Atingimento"><ProgressBar a={b.agg} ctx={b.ctx} /></Metric>
        <Metric label={b.q === 4 ? 'Saldo final do ano' : 'Saldo para o próximo trimestre'}>
          <SaldoCell pend={b.saldo.pend} cred={b.saldo.cred} />
          <div className="mt-0.5 text-[11px] font-medium text-slate-500">
            {b.semSaldo === b.agg.lines ? 'Sem saldo calculável'
              : b.confirmed ? (b.q === 4 ? 'Confirmado · apenas registro do ano' : 'Confirmado · será transportado')
              : 'Provisório · não é transportado'}
          </div>
        </Metric>
      </div>
      <button className="flex w-full items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50" onClick={() => setOpen(o => ({ ...o, [b.q]: !o[b.q] }))}>
        {open[b.q] ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {open[b.q] ? 'Ocultar' : 'Ver'} lojas ({b.stores.length})
      </button>
      {open[b.q] && <div className="overflow-x-auto border-t border-slate-100">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>
            {['Loja', 'Meta ajustada', 'Realizado', 'Atingimento', 'Saldo', 'Situação'].map(c => <th key={c} className="whitespace-nowrap px-4 py-3 font-black">{c}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {b.stores.map(s => {
              const t = toneOf(s.agg, b.ctx);
              return <tr key={s.cnpj} className={toneStyle[t].row}>
                <td className={`whitespace-nowrap border-l-4 px-4 py-3 font-semibold ${toneStyle[t].border}`}>{s.store}{s.uf ? <span className="ml-2 font-medium text-slate-400">{s.uf}</span> : null}</td>
                <td className="px-4 py-3">{money(s.agg.adjusted)}</td>
                <td className="px-4 py-3">{s.agg.unavailable === s.agg.lines ? 'Indisponível' : money(s.agg.actual)}</td>
                <td className="px-4 py-3"><ProgressBar a={s.agg} ctx={b.ctx} /></td>
                <td className="px-4 py-3"><SaldoCell pend={s.saldo.pend} cred={s.saldo.cred} /></td>
                <td className="px-4 py-3"><StatusPill a={s.agg} ctx={b.ctx} /></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </article>)}
    <p className="text-xs text-slate-500">
      O fechamento é confirmado manualmente por configuração do sistema e vale para todas as lojas e categorias do trimestre. Sem confirmação, o saldo é provisório e não é transportado.
      Saldos nunca são compensados entre lojas ou categorias.
    </p>
  </div>;
}

/* ============================== Simulador ============================== */
type Prefill = { original: number; actual: number; days: number | null; note: string };

function Field({ label, prefix, value, onChange, placeholder }: { label: string; prefix?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block space-y-1">
    <span className={labelClass}>{label}</span>
    <div className="flex items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-orange-400">
      {prefix && <span className="mr-2 text-sm font-semibold text-slate-400">{prefix}</span>}
      <input className="w-full bg-transparent py-2.5 text-sm font-semibold text-slate-800 outline-none" inputMode="decimal" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  </label>;
}

function SimuladorModal({ onClose, prefill }: { onClose: () => void; prefill: Prefill }) {
  const [f, setF] = useState({ original: '', saldo: '', actual: '', days: '' });
  const [saldoType, setSaldoType] = useState<'debito' | 'credito'>('debito');
  const [note, setNote] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const sim = useMemo(() => {
    const errors: string[] = [];
    if (!f.original.trim() && !f.actual.trim()) return { errors, result: null, empty: true };
    const read = (label: string, raw: string, required: boolean) => {
      if (!raw.trim()) { if (required) errors.push(`${label}: informe um valor.`); return 0; }
      const v = parseNum(raw);
      if (v === null) { errors.push(`${label}: valor inválido.`); return 0; }
      if (v < 0) { errors.push(`${label}: não aceita valor negativo.`); return 0; }
      if (v > 1e12) { errors.push(`${label}: valor acima do limite aceito.`); return 0; }
      return v;
    };
    const original = read('Meta original', f.original, true);
    const saldo = read('Saldo da meta anterior', f.saldo, false);
    const actual = read('Realizado', f.actual, true);
    const daysRaw = read('Dias restantes', f.days, false);
    const days = f.days.trim() ? daysRaw : null;
    if (days !== null && (!Number.isInteger(days) || days > 366)) errors.push('Dias restantes: informe um número inteiro entre 0 e 366.');
    if (errors.length) return { errors, result: null, empty: false };
    const raw = original + (saldoType === 'debito' ? saldo : -saldo);
    const adjusted = Math.max(0, raw);
    const falta = Math.max(0, adjusted - actual);
    const excedente = Math.max(0, actual - adjusted);
    const unused = Math.max(0, -raw);
    const ratio = adjusted > 0 ? actual / adjusted : 0;
    const perDay = days === null ? '—' : days > 0 ? money(falta / days) : falta > 0 ? 'Sem dias disponíveis' : money(0);
    const message = falta > 0
      ? (days !== null && days > 0 ? `Faltam ${money(falta)}. Em ${days} dia(s), é preciso vender ${money(falta / days)} por dia.` : `Faltam ${money(falta)} para atingir a meta.`)
      : adjusted > 0 ? `Meta atingida, com excedente de ${money(excedente)}.` : 'A meta ajustada é zero.';
    return { errors, empty: false, result: { adjusted, falta, excedente, unused, ratio, perDay, message, ating: adjusted > 0 ? pct(100 * ratio) : 'Meta zero' } };
  }, [f, saldoType]);

  const applyPrefill = () => {
    const n = (v: number) => String(Number(v.toFixed(2)));
    setF({ original: n(prefill.original), saldo: '', actual: n(prefill.actual), days: prefill.days === null ? '' : String(prefill.days) });
    setSaldoType('debito');
    setNote(prefill.note);
  };
  const r = sim.result;
  const done = !!r && r.falta === 0 && r.adjusted > 0;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Simulador de metas" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-orange-600"><Calculator size={15} /> Simulador</div>
          <h2 className="mt-1 text-lg font-black text-slate-900">Quanto preciso vender?</h2>
          <p className="text-xs text-slate-500">Simulação livre. Não altera as metas oficiais.</p>
        </div>
        <button aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-4">
          <button className="w-full rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-bold text-orange-700 hover:bg-orange-100" onClick={applyPrefill}>Usar dados do mês selecionado no painel</button>
          {note && <p className="text-xs text-amber-800">{note}</p>}
          <Field label="Meta original" prefix="R$" value={f.original} onChange={v => setF(s => ({ ...s, original: v }))} placeholder="0" />
          <div className="space-y-1">
            <span className={labelClass}>Saldo da meta anterior</span>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSaldoType('debito')} className={`rounded-xl border px-3 py-2 text-xs font-bold ${saldoType === 'debito' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500'}`}>Débito (soma)</button>
              <button onClick={() => setSaldoType('credito')} className={`rounded-xl border px-3 py-2 text-xs font-bold ${saldoType === 'credito' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>Crédito (subtrai)</button>
            </div>
            <Field label="" prefix="R$" value={f.saldo} onChange={v => setF(s => ({ ...s, saldo: v }))} placeholder="0 (opcional)" />
          </div>
          <Field label="Realizado até agora" prefix="R$" value={f.actual} onChange={v => setF(s => ({ ...s, actual: v }))} placeholder="0" />
          <Field label="Dias restantes para vender" value={f.days} onChange={v => setF(s => ({ ...s, days: v }))} placeholder="ex.: 15 (opcional)" />
        </div>
        <div className="rounded-2xl bg-slate-50 p-5">
          {sim.errors.length > 0 && <ul className="space-y-1 text-xs font-semibold text-red-700">{sim.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {sim.empty && <p className="text-sm text-slate-500">Informe a meta original e o realizado para ver o resultado.</p>}
          {r && <div className="space-y-4">
            <div>
              <div className={labelClass}>Atingimento</div>
              <div className={`text-4xl font-black ${done ? 'text-emerald-600' : 'text-slate-900'}`}>{r.ating}</div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(100, r.ratio * 100)}%` }} /></div>
            </div>
            <p className={`rounded-xl p-3 text-sm font-semibold ${done ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-900'}`}>{r.message}</p>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Meta ajustada">{money(r.adjusted)}</Metric>
              <Metric label="Vender por dia">{r.perDay}</Metric>
              <Metric label="Falta atingir">{money(r.falta)}</Metric>
              <Metric label="Excedente">{money(r.excedente)}</Metric>
            </div>
            {r.unused > 0 && <p className="text-xs text-slate-500">Crédito de {money(r.unused)} não utilizado (a meta mínima é zero); seria preservado para o período seguinte.</p>}
          </div>}
        </div>
      </div>
    </div>
  </div>;
}

/* ============================== Painel ============================== */
type Tab = 'lojas' | 'regioes' | 'meses' | 'fechamentos';

export default function PainelMetas({ currentUser }: { currentUser: any }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [month, setMonth] = useState<number | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [region, setRegion] = useState('TODAS');
  const [store, setStore] = useState('TODAS');
  const [group, setGroup] = useState('TODAS');
  const [tab, setTab] = useState<Tab>('lojas');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // Reutiliza o usuário autenticado e o token de sessão emitido no login atual do TeleFluxo.
    const userId = String(currentUser?.id || '').trim();
    if (!userId) {
      setError('Usuário não identificado. Entre novamente no TeleFluxo.');
      setLoading(false);
      return;
    }
    const token = sessionStorage.getItem('telefluxo_metas_token') || '';
    if (!token) {
      setError('Sessão de metas ausente. Entre novamente no TeleFluxo.');
      setLoading(false);
      return;
    }
    setLoading(true); setError('');
    fetch(`${API}/api/metas/resumo?year=2026&userId=${encodeURIComponent(userId)}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const contentType = res.headers.get('content-type')?.toLowerCase() || '';
        // Detecta HTML (erro 404 ou redirecionamento para o frontend) antes de tentar ler JSON.
        if (!contentType.includes('application/json')) {
          const url = res.url || `${API}/api/metas/resumo`;
          throw new Error(
            `O backend não retornou JSON para o Painel de Metas (HTTP ${res.status}). ` +
            `Verifique se a rota /api/metas/resumo está registrada e publicada na API configurada: ${url}`
          );
        }
        const body = (await res.json()) as Data & { error?: string };
        if (!res.ok || body.success === false) {
          throw new Error(body.error || `Erro ao consultar o Painel de Metas (HTTP ${res.status}).`);
        }
        return body;
      })
      .then(body => setData(body))
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha na consulta.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentUser?.id, refresh]);

  const quarters = data?.quarters || [];
  const regions = useMemo(() => [...new Set(quarters.map(r => r.region))].sort(), [quarters]);
  const stores = useMemo(() => [...new Map(quarters.filter(r => region === 'TODAS' || r.region === region).map(r => [r.cnpj, { cnpj: r.cnpj, store: r.store }])).values()].sort((a, b) => a.store.localeCompare(b.store)), [quarters, region]);
  useEffect(() => { setStore('TODAS'); }, [region]);

  const monthSel = month ?? (data ? defaultMonth(data) : 1);
  const periodSel = period ?? data?.currentQuarter ?? 0;
  const [from, to] = periodRange(periodSel);

  const scoped = useMemo(() => quarters.filter(r => (region === 'TODAS' || r.region === region) && (store === 'TODAS' || r.cnpj === store) && (group === 'TODAS' || r.group === group)), [quarters, region, store, group]);
  const monthsScoped = useMemo(() => (data?.months || []).filter(m => (region === 'TODAS' || m.region === region) && (store === 'TODAS' || m.cnpj === store) && (group === 'TODAS' || m.group === group)), [data, region, store, group]);
  const unavailSet = useMemo(() => new Set(quarters.filter(q => q.dataStatus === 'indisponivel').map(q => `${q.cnpj}|${q.group}|${q.quarter}`)), [quarters]);

  // Cartões (mês selecionado + visão do ano)
  const yearAgg = useMemo(() => aggregate(consolidate(scoped, 1, 4)), [scoped]);
  const monthAgg = useMemo(() => aggregateMonth(monthsScoped.filter(m => m.month === monthSel), unavailSet), [monthsScoped, monthSel, unavailSet]);
  const monthCtx = data ? monthContext(data.year, monthSel, data.todayBR) : null;
  const monthTone = toneOf(monthAgg, monthCtx);

  // Detalhamento (período escolhido na ilha)
  const lines = useMemo(() => consolidate(scoped, from, to), [scoped, from, to]);
  const totals = useMemo(() => aggregate(lines), [lines]);
  const ctx = data ? periodContext(data.year, from, to, data.todayBR) : null;
  const rangeQuarters = useMemo(() => Array.from({ length: to - from + 1 }, (_, i) => from + i), [from, to]);
  const anyAwaiting = ctx?.state !== 'futuro' && lines.some(l => l.awaitingFlag);

  const ufGroups = useMemo(() => {
    const storeLines = new Map<string, Line[]>();
    lines.forEach(l => storeLines.set(l.cnpj, [...(storeLines.get(l.cnpj) || []), l]));
    const ufMap = new Map<string, { store: string; cnpj: string; lines: Line[] }[]>();
    storeLines.forEach((ls, cnpj) => {
      const first = ls[0]!;
      const uf = first.uf || 'SEM UF';
      ufMap.set(uf, [...(ufMap.get(uf) || []), { store: first.store, cnpj, lines: ls }]);
    });
    return [...ufMap.entries()]
      .sort(([a], [b]) => (a === 'SEM UF' ? 1 : b === 'SEM UF' ? -1 : a.localeCompare(b)))
      .map(([uf, items]) => ({
        uf,
        agg: aggregate(items.flatMap(i => i.lines)),
        stores: [...items].sort((x, y) => x.store.localeCompare(y.store)).map(i => ({ cnpj: i.cnpj, store: i.store, agg: aggregate(i.lines) })),
      }));
  }, [lines]);
  const toneCounts = useMemo(() => {
    const c: Record<Tone, number> = { done: 0, ok: 0, warn: 0, bad: 0, neutral: 0 };
    ufGroups.forEach(g => g.stores.forEach(s => { c[toneOf(s.agg, ctx)]++; }));
    return c;
  }, [ufGroups, ctx]);
  const regionRows = useMemo(() => [...new Set(lines.map(l => l.region))].sort().map(r => ({ region: r || 'SEM REGIÃO', agg: aggregate(lines.filter(l => l.region === r)) })), [lines]);
  const monthRows = useMemo(() => {
    if (!data) return [];
    const list: { month: number; agg: Agg; ctx: PeriodCtx }[] = [];
    for (let m = (from - 1) * 3 + 1; m <= to * 3; m++) {
      const agg = aggregateMonth(monthsScoped.filter(x => x.month === m), unavailSet);
      if (agg.lines > 0) list.push({ month: m, agg, ctx: monthContext(data.year, m, data.todayBR) });
    }
    return list;
  }, [data, monthsScoped, unavailSet, from, to]);

  const prefill: Prefill = {
    original: monthAgg.validAdjusted,
    actual: monthAgg.validActual,
    days: monthCtx?.state === 'andamento' ? monthCtx.remaining : null,
    note: monthAgg.lines > 1 ? 'Valores consolidados da seleção: na simulação, o excedente de uma loja abate a falta de outra.' : '',
  };

  const headers = tab === 'lojas' ? ['Loja', 'Meta original', 'Saldo meta anterior', 'Meta ajustada', 'Realizado', 'Atingimento', 'Falta atingir', 'Vender por dia', 'Situação']
    : tab === 'regioes' ? ['Região', 'Meta original', 'Saldo meta anterior', 'Meta ajustada', 'Realizado', 'Atingimento', 'Falta atingir', 'Vender por dia', 'Situação']
    : ['Mês', 'Meta', 'Realizado', 'Diferença', 'Atingimento', 'Vender por dia', 'Situação'];
  const tabLabels: Record<Tab, string> = { lojas: 'Por estado', regioes: 'Regiões', meses: 'Mensal', fechamentos: 'Fechamentos' };

  return <div className="h-full w-full overflow-y-auto bg-slate-50 p-4 pb-12 md:p-7">
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-orange-600"><Target size={15} /> Planejamento e performance</div>
          <h1 className="mt-1 text-2xl font-black text-slate-900 md:text-3xl">Painel de Metas</h1>
          <p className="mt-1 text-sm text-slate-500">Metas 2026 do Google Sheets × vendas oficiais do TeleFluxo</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50" onClick={() => setSimOpen(true)} disabled={!data}><Calculator size={16} /> Simulador</button>
          <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-orange-300" onClick={() => setRefresh(x => x + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar</button>
        </div>
      </div>

      {loading && !data && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Consultando metas e vendas autorizadas...</div>}
      {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><LockKeyhole size={18} className="shrink-0" />{error}</div>}

      {data && <>
        {/* Filtros */}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className={labelClass}>Mês</span>
            <select className={selectClass} value={monthSel} onChange={e => setMonth(Number(e.target.value))}>{monthNames.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
          </label>
          {data.scope === 'network' && <label className="space-y-1"><span className={labelClass}>Região</span>
            <select className={selectClass} value={region} onChange={e => setRegion(e.target.value)}><option value="TODAS">Todas as regiões</option>{regions.map(x => <option key={x}>{x}</option>)}</select>
          </label>}
          {data.access.canCompareStores && <label className="space-y-1"><span className={labelClass}>Loja</span>
            <select className={selectClass} value={store} onChange={e => setStore(e.target.value)}><option value="TODAS">Todas as lojas autorizadas</option>{stores.map(x => <option key={x.cnpj} value={x.cnpj}>{x.store}</option>)}</select>
          </label>}
          <label className="space-y-1"><span className={labelClass}>Categoria</span>
            <select className={selectClass} value={group} onChange={e => setGroup(e.target.value)}><option value="TODAS">Todas as categorias</option>{(['APARELHOS', 'ACESSORIOS', 'SEGUROS'] as Group[]).map(x => <option key={x} value={x}>{groupLabels[x]}</option>)}</select>
          </label>
        </div>

        {/* 4 cartões */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title={`Meta inicial ${data.year}`} icon={Target} value={money(yearAgg.base)}>
            <p className="mt-2 text-xs text-slate-500">Planejamento original da planilha, sem saldos.</p>
          </KpiCard>
          <KpiCard title={`Meta de ${monthNames[monthSel - 1] ?? ''}`} icon={CalendarClock} value={money(monthAgg.base)}>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <span>Ano: <strong className="text-slate-700">{atingText(yearAgg)}</strong> da meta</span>
              <span>Por dia: <strong className="text-slate-700">{monthCtx ? dailyText(monthAgg, monthCtx) : '—'}</strong></span>
            </div>
          </KpiCard>
          <KpiCard title="Atingimento no mês" icon={TrendingUp} value={atingText(monthAgg)} valueClass={toneStyle[monthTone].text}>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full rounded-full ${toneStyle[monthTone].bar}`} style={{ width: `${monthAgg.validAdjusted > 0 ? Math.min(100, 100 * monthAgg.validActual / monthAgg.validAdjusted) : 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>Realizado: <strong className="text-slate-700">{money(monthAgg.actual)}</strong></span>
              <StatusPill a={monthAgg} ctx={monthCtx} />
            </div>
          </KpiCard>
          <KpiCard title="Falta vender no mês" icon={ArrowDownRight} value={faltaText(monthAgg)} valueClass={monthAgg.validAdjusted > 0 && monthAgg.falta === 0 && monthAgg.lines > 0 ? 'text-emerald-600' : 'text-rose-600'}>
            <p className="mt-2 text-xs text-slate-500">
              Soma por loja/categoria; excedente de uma não quita outra.
              {monthAgg.excedente > 0 ? ` Excedente: ${money(monthAgg.excedente)}.` : ''}
            </p>
          </KpiCard>
        </div>
        {monthAgg.unavailable > 0 && <p className="-mt-2 text-xs text-amber-800">* {monthAgg.unavailable} loja/categoria sem dados de vendas no mês: ficam fora do cálculo e não são tratadas como realizado zero.</p>}

        {/* Detalhamento */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Detalhamento</h2>
              <p className="text-xs text-slate-500">Somente dados pertencentes às lojas autorizadas.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Período do detalhamento" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-orange-400" value={periodSel} onChange={e => setPeriod(Number(e.target.value))}>
                <option value={0}>Ano completo</option><option value={-1}>1º semestre</option><option value={-2}>2º semestre</option>
                {[1, 2, 3, 4].map(q => <option value={q} key={q}>{q}º trimestre</option>)}
              </select>
              <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
                {(Object.keys(tabLabels) as Tab[]).map(x => <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === x ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}>{tabLabels[x]}</button>)}
              </div>
            </div>
          </div>

          {tab === 'lojas' && ufGroups.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs">
            <span className="mr-1 font-bold text-slate-500">Lojas:</span>
            {([['done', 'Meta batida'], ['ok', 'No ritmo'], ['warn', 'Atenção'], ['bad', ctx?.state === 'encerrado' ? 'Não atingida' : 'Abaixo do ritmo']] as [Tone, string][]).map(([t, label]) =>
              <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600">
                <span className={`h-2 w-2 rounded-full ${toneStyle[t].dot}`} />{label} <strong className="text-slate-900">{toneCounts[t]}</strong>
              </span>)}
            <span className="ml-auto text-slate-500">Saldo meta anterior: <strong className="text-rose-600">− débito</strong> · <strong className="text-emerald-600">+ crédito</strong></span>
          </div>}

          {tab === 'fechamentos'
            ? <div className="p-4"><ClosureView scoped={scoped} rangeQuarters={rangeQuarters} year={data.year} todayBR={data.todayBR} confirmedQs={data.closure.confirmedQuarters} /></div>
            : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{headers.map(col => <th key={col} className="whitespace-nowrap px-4 py-3 font-black">{col}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {tab === 'lojas' && ufGroups.map(g => <Fragment key={g.uf}>
                  <tr className="cursor-pointer bg-slate-100 font-bold text-slate-900 hover:bg-slate-200/70" onClick={() => setCollapsed(c => ({ ...c, [g.uf]: !c[g.uf] }))}>
                    <td className={`whitespace-nowrap border-l-4 px-4 py-3 ${toneStyle[toneOf(g.agg, ctx)].border}`}>{collapsed[g.uf] ? '▸' : '▾'} {g.uf} <span className="font-medium text-slate-500">· {g.stores.length} loja(s)</span></td>
                    <AggCells a={g.agg} ctx={ctx} />
                  </tr>
                  {!collapsed[g.uf] && g.stores.map(s => {
                    const t = toneOf(s.agg, ctx);
                    return <tr key={s.cnpj} className={toneStyle[t].row}>
                      <td className={`whitespace-nowrap border-l-4 py-3 pl-8 pr-4 font-semibold ${toneStyle[t].border}`}>{s.store}</td>
                      <AggCells a={s.agg} ctx={ctx} />
                    </tr>;
                  })}
                </Fragment>)}
                {tab === 'lojas' && ufGroups.length > 0 && <tr className="bg-slate-200 font-black text-slate-900">
                  <td className={`border-l-4 px-4 py-3 ${toneStyle[toneOf(totals, ctx)].border}`}>TOTAL GERAL</td>
                  <AggCells a={totals} ctx={ctx} />
                </tr>}
                {tab === 'regioes' && regionRows.map(r => {
                  const t = toneOf(r.agg, ctx);
                  return <tr key={r.region} className={toneStyle[t].row}>
                    <td className={`border-l-4 px-4 py-3 font-bold ${toneStyle[t].border}`}>{r.region}</td>
                    <AggCells a={r.agg} ctx={ctx} />
                  </tr>;
                })}
                {tab === 'meses' && monthRows.map(m => {
                  const t = toneOf(m.agg, m.ctx);
                  const diff = m.agg.validActual - m.agg.validAdjusted;
                  return <tr key={m.month} className={toneStyle[t].row}>
                    <td className={`border-l-4 px-4 py-3 font-bold ${toneStyle[t].border}`}>{monthLabels[m.month - 1]}</td>
                    <td className="px-4 py-3">{money(m.agg.base)}</td>
                    <td className="px-4 py-3">{money(m.agg.actual)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 font-semibold ${diff >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{m.agg.unavailable === m.agg.lines ? '—' : `${diff >= 0 ? '+' : '−'} ${money(Math.abs(diff))}`}</td>
                    <td className="px-4 py-3"><ProgressBar a={m.agg} ctx={m.ctx} /></td>
                    <td className="whitespace-nowrap px-4 py-3">{dailyText(m.agg, m.ctx)}</td>
                    <td className="px-4 py-3"><StatusPill a={m.agg} ctx={m.ctx} /></td>
                  </tr>;
                })}
              </tbody>
            </table></div>}

          {(tab === 'lojas' || tab === 'regioes') && <div className="space-y-1 border-t border-slate-100 p-3 text-xs text-slate-500">
            {totals.unavailable > 0 && <p className="text-amber-800">* {totals.unavailable} loja/categoria com vendas indisponíveis: ficam fora de atingimento, falta e valor por dia.</p>}
            {anyAwaiting && <p className="text-amber-800">Há saldo anterior aguardando confirmação: ele não está incluído na meta ajustada.</p>}
            <p>Situação: <strong>No ritmo</strong> = realizado acompanha o tempo decorrido; <strong>Atenção</strong> = até 20% abaixo do ritmo; <strong>Abaixo</strong> = mais de 20% abaixo. Subtotais: atingimento = Σ realizado ÷ Σ meta ajustada; falta e valor por dia somam os individuais (a partir de amanhã).</p>
          </div>}
        </section>

        {/* Fontes */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-black text-slate-900"><FileSpreadsheet size={17} className="text-orange-600" /> Fontes e conferência</h2>
          <p className="mt-2 text-xs text-slate-600">Metas: Google Sheets / aba META ({data.sheetStale ? 'cache antigo — verificar atualização' : 'cache verificado'}). Última leitura: {fmt(data.sheetUpdatedAt)}. Dados processados: {fmt(data.generatedAt)}.</p>
          <p className="mt-2 text-xs text-slate-500">Vendas de 2026: base mensal no período corrente, preferindo a base anual para meses encerrados. Uma única fonte por mês para todas as lojas e categorias; nenhuma fonte é somada à outra.</p>
          <details className="mt-3 text-xs text-slate-600">
            <summary className="flex cursor-pointer items-center gap-1 font-bold"><ChevronDown size={14} /> Detalhes e alertas ({data.notes.length})</summary>
            <ul className="mt-2 space-y-1 pl-5">{data.notes.map((n, i) => <li key={i} className="list-disc">{n}</li>)}</ul>
            <p className="mt-3">Fonte por mês: {Object.entries(data.sourceByMonth).map(([m, v]) => `${monthLabels[Number(m) - 1]}: ${v}`).join(' • ')}</p>
          </details>
        </section>
      </>}
    </div>
    {simOpen && <SimuladorModal onClose={() => setSimOpen(false)} prefill={prefill} />}
  </div>;
}