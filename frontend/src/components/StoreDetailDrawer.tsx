import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CircleDollarSign,
  Gauge,
  Loader2,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  UserRound,
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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Props = {
  open: boolean;
  store: string | null;
  currentUser: any;
  onClose: () => void;
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

function sellerPct(value: any) {
  const n = Number(value || 0);
  const percent = Math.abs(n) <= 5 ? n * 100 : n;
  return `${percent.toFixed(1).replace('.', ',')}%`;
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={14} />
        <span className="text-[9px] font-black uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-black tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

export default function StoreDetailDrawer({ open, store, currentUser, onClose }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !store || !currentUser?.id) return;

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);

    fetch(`${API_URL}/api/home/store-detail?userId=${encodeURIComponent(currentUser.id)}&store=${encodeURIComponent(store)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar a loja.');
        return payload;
      })
      .then(setData)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err?.message || 'Erro ao carregar detalhes da loja.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open, store, currentUser?.id]);

  const sellers = useMemo(() => Array.isArray(data?.sellers) ? data.sellers : [], [data?.sellers]);
  const trend = useMemo(() => Array.isArray(data?.trend) ? data.trend : [], [data?.trend]);

  if (!open || !store) return null;

  const kpis = data?.kpis || {};

  return (
    <>
      <div className="fixed inset-0 z-[10040] bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-[10050] flex w-full max-w-[620px] flex-col border-l border-slate-200 bg-[#f7f8fb] shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Building2 size={19} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-600">Detalhes da loja</p>
                <h2 className="mt-1 truncate text-xl font-black tracking-tight text-slate-950">{store}</h2>
                <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{data?.period?.label || 'Este mês'}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-[380px] items-center justify-center gap-2 text-sm font-bold text-slate-400">
              <Loader2 size={18} className="animate-spin" /> Carregando dados da loja...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
          ) : (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Metric icon={TrendingUp} label="Faturamento" value={money(kpis.faturamento)} />
                <Metric icon={ShoppingBag} label="Acessórios" value={pct(kpis.conversaoAcessorios)} />
                <Metric icon={PackageCheck} label="Películas" value={pct(kpis.conversaoPeliculas)} />
                <Metric icon={ShieldCheck} label="Seguro %" value={pct(kpis.seguroPct)} />
                <Metric icon={CircleDollarSign} label="R$ Seguros" value={money(kpis.seguros)} />
                <Metric icon={Gauge} label="Ticket médio" value={money(kpis.ticketMedio)} />
                <Metric icon={UserRound} label="Vendedores" value={String(kpis.vendedores || 0)} />
              </section>

              <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="mb-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Evolução</p>
                  <h3 className="mt-1 text-sm font-black text-slate-900">Faturamento diário da unidade</h3>
                </div>
                <div className="h-[220px]">
                  {trend.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#e2e8f0" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => String(v).slice(8, 10)} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                        <Tooltip formatter={(v: any) => [money(v), 'Faturamento']} />
                        <Area type="monotone" dataKey="faturamento" stroke="#f97316" strokeWidth={2.5} fill="#fff7ed" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">Sem movimento suficiente.</div>
                  )}
                </div>
              </section>

              <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Equipe</p>
                    <h3 className="mt-1 text-sm font-black text-slate-900">Performance dos vendedores</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black text-slate-500">{sellers.length}</span>
                </div>
                <div className="space-y-2">
                  {sellers.length ? sellers.slice(0, 12).map((seller: any, index: number) => (
                    <div key={`${seller.vendedor}-${index}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                      <span className="text-[10px] font-black text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-slate-850">{seller.vendedor}</p>
                        <p className="mt-0.5 text-[9px] font-semibold text-slate-400">Acessórios {sellerPct(seller.pct_acessorios)} • Películas {sellerPct(seller.conv_peliculas)}</p>
                      </div>
                      <span className="text-xs font-black text-slate-950">{money(seller.faturamento)}</span>
                    </div>
                  )) : (
                    <div className="py-8 text-center text-xs font-bold text-slate-400">Nenhum vendedor encontrado.</div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
