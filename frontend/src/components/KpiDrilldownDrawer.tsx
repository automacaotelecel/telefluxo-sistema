import { useMemo } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type MetricKey =
  | 'faturamentoMes'
  | 'conversaoAcessorios'
  | 'conversaoPeliculas'
  | 'seguroPct'
  | 'ticketMedio';

type Props = {
  open: boolean;
  metric: MetricKey | null;
  dashboard: any;
  onClose: () => void;
  onOpenStore?: (store: string) => void;
};

const metricConfig: Record<MetricKey, { label: string; type: 'money' | 'percent'; storeField?: string }> = {
  faturamentoMes: { label: 'Faturamento do mês', type: 'money', storeField: 'faturamento' },
  conversaoAcessorios: { label: 'Conversão de acessórios', type: 'percent', storeField: 'conversaoAcessorios' },
  conversaoPeliculas: { label: 'Conversão de películas', type: 'percent', storeField: 'conversaoPeliculas' },
  seguroPct: { label: 'Seguro', type: 'percent', storeField: 'seguroPct' },
  ticketMedio: { label: 'Ticket médio', type: 'money', storeField: '__ticketMedio' },
};

function money(value: any) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function pct(value: any) {
  return `${Number(value || 0).toFixed(1).replace('.', ',')}%`;
}

export default function KpiDrilldownDrawer({ open, metric, dashboard, onClose, onOpenStore }: Props) {
  const config = metric ? metricConfig[metric] : null;
  const kpis = dashboard?.kpis || {};
  const stores = Array.isArray(dashboard?.stores) ? dashboard.stores : [];
  const trend = Array.isArray(dashboard?.trend) ? dashboard.trend : [];

  const storeMetricValue = (store: any) => {
    if (!config?.storeField) return 0;
    if (config.storeField === '__ticketMedio') {
      const qtd = Number(store?.quantidade || 0);
      return qtd > 0 ? Number(store?.faturamento || 0) / qtd : 0;
    }
    return Number(store?.[config.storeField] || 0);
  };

  const rankedStores = useMemo(() => {
    if (!config?.storeField) return [];
    return [...stores]
      .sort((a, b) => storeMetricValue(b) - storeMetricValue(a))
      .slice(0, 10);
  }, [config?.storeField, stores]);

  if (!open || !metric || !config) return null;

  const value = kpis?.[metric];
  const formatted = config.type === 'money' ? money(value) : pct(value);
  const change = metric === 'faturamentoMes' ? kpis?.crescimento : null;

  return (
    <>
      <div className="fixed inset-0 z-[10020] bg-slate-950/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-[10030] flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-[#f7f8fb] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Drill-down</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">{config.label}</h2>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <section className="rounded-[24px] bg-slate-950 p-5 text-white shadow-lg">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Resultado atual</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className="text-3xl font-black tracking-tight">{formatted}</p>
              {typeof change === 'number' && Number.isFinite(change) && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black ${change >= 0 ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
                  {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {Math.abs(change).toFixed(1).replace('.', ',')}%
                </span>
              )}
            </div>
          </section>

          {metric === 'faturamentoMes' && (
            <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Evolução</p>
                  <h3 className="mt-1 text-sm font-black text-slate-900">Faturamento diário</h3>
                </div>
                <BarChart3 size={17} className="text-orange-500" />
              </div>
              <div className="h-[210px]">
                {trend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => String(v).slice(8, 10)} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <Tooltip formatter={(v: any) => money(v)} />
                      <Area type="monotone" dataKey="faturamento" stroke="#f97316" strokeWidth={2.5} fill="#fff7ed" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">Sem dados suficientes.</div>
                )}
              </div>
            </section>
          )}

          {rankedStores.length > 0 && (
            <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
              <div className="mb-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Por loja</p>
                <h3 className="mt-1 text-sm font-black text-slate-900">Ranking do indicador</h3>
              </div>
              <div className="space-y-2">
                {rankedStores.map((store: any, index: number) => {
                  const storeValue = storeMetricValue(store);
                  return (
                    <button
                      key={store.loja}
                      onClick={() => onOpenStore?.(store.loja)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-left transition hover:bg-orange-50"
                    >
                      <span className="w-6 text-[10px] font-black text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{store.loja}</span>
                      <span className="text-xs font-black text-slate-950">
                        {config.type === 'money' ? money(storeValue) : pct(storeValue)}
                      </span>
                      <ChevronRight size={14} className="text-slate-300" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
