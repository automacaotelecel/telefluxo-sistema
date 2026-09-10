import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Crown,
  Megaphone,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
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
import ExecutiveReportButton from './ExecutiveReportButton';
import KpiDrilldownDrawer from './KpiDrilldownDrawer';
import StoreDetailDrawer from './StoreDetailDrawer';

type MetricKey =
  | 'faturamentoMes'
  | 'conversaoAcessorios'
  | 'conversaoPeliculas'
  | 'seguroPct'
  | 'ticketMedio';

type DashboardData = {
  success: boolean;
  generatedAt?: string;
  scope?: {
    type: 'network' | 'store';
    label: string;
    stores: string[];
    canCompareStores: boolean;
    canUseClark: boolean;
  };
  period?: { startDate: string; endDate: string; label: string };
  kpis?: {
    faturamentoMes?: number;
    faturamentoAnterior?: number;
    crescimento?: number | null;
    pecasMes?: number;
    ticketMedio?: number;
    tendenciaMes?: number;
    tendenciaAno?: number;
    realizadoAno?: number;
    crescimentoTendencia?: number | null;
    conversaoAcessorios?: number;
    conversaoPeliculas?: number;
    seguroPct?: number;
    seguros?: number;
    lojasAtivas?: number;
  };
  trend?: Array<{ date: string; faturamento: number; quantidade: number }>;
  stores?: Array<{
    loja: string;
    faturamento: number;
    quantidade: number;
    conversaoAcessorios: number;
    conversaoPeliculas: number;
    seguroPct: number;
    vendedores: number;
  }>;
  radar?: Array<{
    level: 'positive' | 'warning' | 'info';
    title: string;
    text: string;
    metric: string;
  }>;
  clarkBriefing?: string | null;
};

type Props = {
  currentUser: any;
  onNavigate?: (view: string) => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function money(value: any) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function number(value: any, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function shortDate(value: string) {
  if (!value) return '';
  const [, month, day] = value.split('-');
  return `${day}/${month}`;
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  change,
  onClick,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
  change?: number | null;
  onClick?: () => void;
}) {
  const positive = Number(change || 0) >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-[24px] border border-slate-200/80 bg-white p-5 text-left shadow-[0_12px_35px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_16px_42px_rgba(15,23,42,0.08)]"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{title}</p>
          <p className="mt-2 text-[26px] font-black tracking-tight text-slate-900">{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white transition group-hover:bg-orange-600">
          <Icon size={18} />
        </div>
      </div>

      <div className="flex min-h-6 items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-slate-400">{subtitle}</p>
        {typeof change === 'number' && Number.isFinite(change) && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black ${positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(change).toFixed(1).replace('.', ',')}%
          </span>
        )}
      </div>
    </button>
  );
}


function ConversionCard({
  acessorios,
  peliculas,
  seguro,
  loading,
  onSelectMetric,
}: {
  acessorios: number;
  peliculas: number;
  seguro: number;
  loading: boolean;
  onSelectMetric: (metric: MetricKey) => void;
}) {
  const items = [
    { key: 'conversaoAcessorios' as MetricKey, label: 'Acessórios', value: acessorios, icon: ShoppingBag },
    { key: 'conversaoPeliculas' as MetricKey, label: 'Películas', value: peliculas, icon: PackageCheck },
    { key: 'seguroPct' as MetricKey, label: 'Seguro', value: seguro, icon: ShieldCheck },
  ];

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Conversões</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">Acessórios, películas e seguro</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <BarChart3 size={18} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {items.map(({ key, label, value, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectMetric(key)}
            className="rounded-2xl bg-slate-50 px-2.5 py-3 text-left transition hover:bg-orange-50"
          >
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon size={12} />
              <span className="truncate text-[8px] font-black uppercase tracking-wide">{label}</span>
            </div>
            <p className="mt-2 text-[17px] font-black tracking-tight text-slate-950">
              {loading ? '—' : `${number(value, 1)}%`}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home({ currentUser, onNavigate }: Props) {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newNotice, setNewNotice] = useState({ title: '', content: '', priority: 'Normal', category: 'Aviso' });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [storeView, setStoreView] = useState<any | null>(null);
  const [storeViewLoading, setStoreViewLoading] = useState(false);
  const [storeViewError, setStoreViewError] = useState('');

  const role = String(currentUser?.role || '').toUpperCase();
  const isAdminOrManager =
    role !== 'LOJA' &&
    (currentUser?.isAdmin === true ||
      Number(currentUser?.isAdmin) === 1 ||
      ['CEO', 'DIRETOR', 'DIRETORIA', 'ADM', 'ADMIN', 'GESTOR'].includes(role));

  const isNetworkView = dashboard?.scope?.type === 'network';
  const firstName = String(currentUser?.name || 'Usuário').split(' ')[0];

  const fetchAnnouncements = useCallback(() => {
    fetch(`${API_URL}/announcements`)
      .then((r) => r.json())
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => setAnnouncements([]));
  }, []);

  const loadDashboard = useCallback(async () => {
    const userId = String(currentUser?.id || '').trim();
    if (!userId) {
      setDashboardError('Usuário não identificado. Faça login novamente.');
      setDashboardLoading(false);
      return;
    }

    try {
      setDashboardLoading(true);
      setDashboardError('');
      const response = await fetch(`${API_URL}/api/home/resumo?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar o painel.');
      setDashboard(data);
    } catch (error: any) {
      console.error('Erro ao carregar Home:', error);
      setDashboardError(error?.message || 'Erro ao carregar os indicadores.');
    } finally {
      setDashboardLoading(false);
    }
  }, [currentUser?.id]);

  const loadStoreView = useCallback(async (store: string) => {
    const userId = String(currentUser?.id || '').trim();
    const normalizedStore = String(store || '').trim();

    if (!userId || !normalizedStore) return;

    try {
      setStoreViewLoading(true);
      setStoreViewError('');

      const response = await fetch(
        `${API_URL}/api/home/store-detail?userId=${encodeURIComponent(userId)}&store=${encodeURIComponent(normalizedStore)}`,
        { cache: 'no-store' },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível carregar a loja.');
      }

      setStoreView(data);
    } catch (error: any) {
      console.error('Erro ao carregar visão da loja:', error);
      setStoreView(null);
      setStoreViewError(error?.message || 'Erro ao carregar a unidade.');
    } finally {
      setStoreViewLoading(false);
    }
  }, [currentUser?.id]);

  const selectStoreForAnalysis = useCallback((store: string) => {
    const normalized = String(store || '').trim();
    if (!normalized) return;
    setStoreFilter(normalized);
  }, []);

  const clearStoreAnalysis = useCallback(() => {
    setStoreFilter(null);
    setStoreView(null);
    setStoreViewError('');
  }, []);


  useEffect(() => {
    fetchAnnouncements();
    loadDashboard();
  }, [fetchAnnouncements, loadDashboard]);

  useEffect(() => {
    if (storeFilter) {
      loadStoreView(storeFilter);
    }
  }, [storeFilter, loadStoreView]);

  useEffect(() => {
    const openStore = (event: Event) => {
      const custom = event as CustomEvent<{ store?: string }>;
      const store = String(custom.detail?.store || '').trim();
      if (store) selectStoreForAnalysis(store);
    };
    window.addEventListener('telefluxo:open-store', openStore as EventListener);
    return () => window.removeEventListener('telefluxo:open-store', openStore as EventListener);
  }, [selectStoreForAnalysis]);

  const handleCreate = async () => {
    if (!newNotice.title || !newNotice.content) return alert('Preencha título e conteúdo!');
    await fetch(`${API_URL}/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newNotice, author: currentUser.name }),
    });
    setShowModal(false);
    setNewNotice({ title: '', content: '', priority: 'Normal', category: 'Aviso' });
    fetchAnnouncements();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja remover este informativo?')) return;
    await fetch(`${API_URL}/announcements/${id}`, { method: 'DELETE' });
    fetchAnnouncements();
  };

  const notices = announcements.filter((a) => a.category === 'Aviso');
  const dailyTip = announcements.find((a) => a.category === 'Dica');
  const groupAgenda = announcements.filter((a) => a.category === 'Agenda');
  const networkKpis = dashboard?.kpis || {};
  const stores = dashboard?.stores || [];
  const isStoreAnalysis = Boolean(storeFilter && storeView?.success);

  const kpis = isStoreAnalysis
    ? {
        ...networkKpis,
        faturamentoMes: storeView?.kpis?.faturamento || 0,
        faturamentoAnterior: storeView?.kpis?.faturamentoAnterior || 0,
        crescimentoTendencia: storeView?.kpis?.crescimentoTendencia ?? null,
        tendenciaMes: storeView?.kpis?.tendenciaMes || 0,
        tendenciaAno: storeView?.kpis?.tendenciaAno || 0,
        realizadoAno: storeView?.kpis?.realizadoAno || 0,
        pecasMes: storeView?.kpis?.quantidade || 0,
        conversaoAcessorios: storeView?.kpis?.conversaoAcessorios || 0,
        conversaoPeliculas: storeView?.kpis?.conversaoPeliculas || 0,
        seguroPct: storeView?.kpis?.seguroPct || 0,
        seguros: storeView?.kpis?.seguros || 0,
      }
    : networkKpis;

  const radar = useMemo(() => {
    if (!isStoreAnalysis) return dashboard?.radar || [];

    return [
      {
        level: 'info' as const,
        title: storeFilter || 'Loja selecionada',
        text: `Tendência de fechamento do mês: ${money(kpis.tendenciaMes)}.`,
        metric: 'Tendência mês',
      },
      {
        level: 'positive' as const,
        title: storeFilter || 'Loja selecionada',
        text: `Acessórios ${number(kpis.conversaoAcessorios, 1)}% • Películas ${number(kpis.conversaoPeliculas, 1)}% • Seguro ${number(kpis.seguroPct, 1)}%.`,
        metric: 'Conversões',
      },
    ];
  }, [
    dashboard?.radar,
    isStoreAnalysis,
    storeFilter,
    kpis.tendenciaMes,
    kpis.conversaoAcessorios,
    kpis.conversaoPeliculas,
    kpis.seguroPct,
  ]);

  const trend = useMemo(
    () =>
      ((isStoreAnalysis ? storeView?.trend : dashboard?.trend) || []).map((item: any) => ({
        ...item,
        label: shortDate(item.date),
      })),
    [dashboard?.trend, isStoreAnalysis, storeView?.trend],
  );

  const viewLoading = dashboardLoading || (Boolean(storeFilter) && storeViewLoading);
  const scopeLabel = isStoreAnalysis
    ? `Análise da loja • ${storeFilter}`
    : dashboard?.scope?.label || 'Validando seu acesso';

  const reportDashboard = useMemo(() => {
    if (!dashboard || !isStoreAnalysis || !storeFilter) return dashboard;

    const selectedStoreData = stores.find(
      (store) => String(store.loja).toUpperCase() === String(storeFilter).toUpperCase(),
    );

    return {
      ...dashboard,
      scope: {
        ...(dashboard.scope || {
          type: 'store' as const,
          label: '',
          stores: [],
          canCompareStores: false,
          canUseClark: false,
        }),
        type: 'store' as const,
        label: `Análise da loja • ${storeFilter}`,
        stores: [storeFilter],
        canCompareStores: false,
      },
      kpis,
      trend: storeView?.trend || [],
      stores: selectedStoreData ? [selectedStoreData] : [],
      radar,
    };
  }, [dashboard, isStoreAnalysis, kpis, radar, storeFilter, storeView?.trend, stores]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#f5f7fb]">
      <div className="mx-auto w-full max-w-[1540px] px-5 py-6 md:px-8 lg:px-10 lg:py-8">
        <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                <Activity size={13} /> TeleFluxo Intelligence
              </span>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${isNetworkView && !isStoreAnalysis ? 'bg-slate-950 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
                {isNetworkView && !isStoreAnalysis ? <Crown size={12} /> : <ShieldCheck size={12} />}
                {scopeLabel}
              </span>
              {isStoreAnalysis && (
                <button
                  type="button"
                  onClick={clearStoreAnalysis}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-black uppercase tracking-wide text-slate-600 transition hover:border-orange-200 hover:text-orange-700"
                >
                  <X size={11} /> Voltar para rede
                </button>
              )}
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl">
              Olá, {firstName}. <span className="text-orange-500">👋</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm">
              <CalendarDays size={15} className="text-orange-500" />
              {dashboard?.period?.label || 'Este mês'}
            </div>
            <ExecutiveReportButton currentUser={currentUser} dashboard={reportDashboard} disabled={viewLoading} />
            <button
              onClick={() => { loadDashboard(); if (storeFilter) loadStoreView(storeFilter); }}
              disabled={viewLoading}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-4 text-[11px] font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-orange-600 disabled:opacity-50"
            >
              <RefreshCw size={14} className={viewLoading ? 'animate-spin' : ''} /> Atualizar
            </button>
            {isAdminOrManager && (
              <button onClick={() => setShowModal(true)} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-orange-600 px-4 text-[11px] font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-orange-700">
                <Plus size={15} /> Mural
              </button>
            )}
          </div>
        </section>

        {(dashboardError || storeViewError) && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {dashboardError || storeViewError}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Faturamento do mês"
            value={viewLoading ? '—' : money(kpis.faturamentoMes)}
            subtitle={isStoreAnalysis ? storeFilter || 'Loja selecionada' : 'realizado até agora'}
            icon={CircleDollarSign}
            onClick={() => setSelectedMetric('faturamentoMes')}
          />
          <KpiCard
            title="Tendência mês"
            value={viewLoading ? '—' : money(kpis.tendenciaMes)}
            subtitle="projeção de fechamento"
            icon={BarChart3}
            change={kpis.crescimentoTendencia}
          />
          <KpiCard
            title="Tendência ano"
            value={viewLoading ? '—' : money(kpis.tendenciaAno)}
            subtitle={viewLoading ? 'calculando projeção' : `${money(kpis.realizadoAno)} realizado no ano`}
            icon={Activity}
          />
          <ConversionCard
            acessorios={Number(kpis.conversaoAcessorios || 0)}
            peliculas={Number(kpis.conversaoPeliculas || 0)}
            seguro={Number(kpis.seguroPct || 0)}
            loading={viewLoading}
            onSelectMetric={setSelectedMetric}
          />
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_0.85fr]">
          <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Performance</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">{isStoreAnalysis ? `Faturamento diário • ${storeFilter}` : 'Faturamento diário'}</h2>
              </div>
              <div className="hidden rounded-2xl bg-slate-50 px-4 py-2 text-right sm:block">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</p>
                <p className="text-sm font-black text-slate-900">{money(kpis.faturamentoMes)}</p>
              </div>
            </div>

            <div className="h-[290px] w-full">
              {trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="telefluxoArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={0.24} /><stop offset="100%" stopColor="#f97316" stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(value: any) => [money(value), 'Faturamento']} labelFormatter={(label) => `Dia ${label}`} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 15px 40px rgba(15,23,42,.12)' }} />
                    <Area type="monotone" dataKey="faturamento" stroke="#f97316" strokeWidth={3} fill="url(#telefluxoArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm font-bold text-slate-400">Sem movimento suficiente para montar o gráfico.</div>
              )}
            </div>
          </div>

          <button
            onClick={() => onNavigate?.('alertas_inteligentes')}
            className="group rounded-[28px] bg-slate-950 p-5 text-left text-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 md:p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-orange-400"><Sparkles size={16} /><span className="text-[10px] font-black uppercase tracking-[0.18em]">Clark • Radar</span></div>
                <h2 className="mt-2 text-xl font-black tracking-tight">Pontos que merecem atenção</h2>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 transition group-hover:bg-orange-600"><BarChart3 size={17} /></div>
            </div>

            <div className="mt-5 space-y-3">
              {radar.length ? radar.slice(0, 4).map((item, index) => (
                <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="flex items-center justify-between gap-3"><span className={`h-2.5 w-2.5 rounded-full ${item.level === 'positive' ? 'bg-emerald-400' : item.level === 'warning' ? 'bg-amber-400' : 'bg-sky-400'}`} /><span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.metric}</span></div>
                  <p className="mt-2 text-sm font-black text-white">{item.title}</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-slate-300">{item.text}</p>
                </div>
              )) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 text-sm font-semibold text-slate-300">Nenhum alerta relevante encontrado até agora.</div>
              )}
            </div>
          </button>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm md:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{isNetworkView ? 'Rede' : 'Sua unidade'}</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">{isNetworkView ? 'Performance das lojas' : 'Resumo da loja'}</h2>
                {isNetworkView && (
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">
                    Clique em uma loja para recalcular os indicadores somente para aquela unidade.
                  </p>
                )}
              </div>
              <Store size={20} className="text-orange-500" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[690px] border-separate border-spacing-y-2 text-left">
                <thead>
                  <tr className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <th className="px-3 py-2">{isNetworkView ? '#' : 'Escopo'}</th><th className="px-3 py-2">Loja</th><th className="px-3 py-2 text-right">Faturamento</th><th className="px-3 py-2 text-right">Acessórios</th><th className="px-3 py-2 text-right">Películas</th><th className="px-3 py-2 text-right">Seguro</th><th className="px-3 py-2 text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.length ? stores.slice(0, isNetworkView ? 10 : 1).map((store, index) => {
                    const active = Boolean(storeFilter) && String(storeFilter).toUpperCase() === String(store.loja).toUpperCase();

                    return (
                      <tr
                        key={store.loja}
                        onClick={() => selectStoreForAnalysis(store.loja)}
                        className={`cursor-pointer text-xs font-bold text-slate-700 transition ${
                          active ? 'bg-orange-50 ring-1 ring-inset ring-orange-200' : 'bg-slate-50/80 hover:bg-orange-50'
                        }`}
                      >
                        <td className="rounded-l-2xl px-3 py-3.5 text-slate-400">
                          {isNetworkView ? String(index + 1).padStart(2, '0') : <ShieldCheck size={15} className="text-emerald-600" />}
                        </td>
                        <td className="px-3 py-3.5 font-black text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{store.loja}</span>
                            {active && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[8px] font-black uppercase text-orange-700">Em análise</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right">{money(store.faturamento)}</td>
                        <td className="px-3 py-3.5 text-right">{number(store.conversaoAcessorios, 1)}%</td>
                        <td className="px-3 py-3.5 text-right">{number(store.conversaoPeliculas, 1)}%</td>
                        <td className="px-3 py-3.5 text-right">{number(store.seguroPct, 1)}%</td>
                        <td className="rounded-r-2xl px-3 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedStore(store.loja);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:text-orange-600"
                            title="Abrir detalhes da loja"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={7} className="py-10 text-center text-sm font-semibold text-slate-400">Nenhum dado disponível.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm md:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Informativos</p><h2 className="mt-1 text-lg font-black text-slate-950">Mural oficial</h2></div>
                <Megaphone size={19} className="text-orange-500" />
              </div>
              <div className="space-y-3">
                {notices.slice(0, 2).map((ann) => (
                  <div key={ann.id} className="relative rounded-2xl bg-slate-50 p-4">
                    {isAdminOrManager && <button onClick={() => handleDelete(ann.id)} className="absolute right-3 top-3 text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>}
                    <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${ann.priority === 'Urgente' ? 'bg-rose-100 text-rose-700' : 'bg-white text-slate-500'}`}>{ann.priority}</span>
                    <p className="mt-3 pr-6 text-sm font-black text-slate-900">{ann.title}</p><p className="mt-1 line-clamp-3 text-xs font-medium leading-relaxed text-slate-500">{ann.content}</p>
                  </div>
                ))}
                {!notices.length && <p className="rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-400">Sem novos informativos.</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="rounded-[24px] bg-orange-600 p-5 text-white"><Bell size={17} /><p className="mt-4 text-[9px] font-black uppercase tracking-[0.18em] text-orange-100">Frase do dia</p><p className="mt-2 text-sm font-black leading-relaxed">{dailyTip ? dailyTip.content : 'Organização é a base de tudo. Bom trabalho!'}</p></div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5"><CalendarDays size={17} className="text-slate-900" /><p className="mt-4 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Agenda grupo</p><p className="mt-2 text-sm font-black text-slate-900">{groupAgenda.length ? `${groupAgenda.length} compromisso(s)` : 'Sem reuniões hoje'}</p>{groupAgenda[0] && <p className="mt-1 text-xs font-semibold text-slate-400">{groupAgenda[0].title}</p>}</div>
            </div>
          </div>
        </section>
      </div>

      <KpiDrilldownDrawer open={Boolean(selectedMetric)} metric={selectedMetric} dashboard={reportDashboard} onClose={() => setSelectedMetric(null)} onOpenStore={(store) => { setSelectedMetric(null); setSelectedStore(store); }} />
      <StoreDetailDrawer open={Boolean(selectedStore)} store={selectedStore} currentUser={currentUser} onClose={() => setSelectedStore(null)} />

      {showModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[30px] bg-white p-7 shadow-2xl md:p-9">
            <div className="mb-6 flex items-center justify-between">
              <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Comunicação interna</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Novo conteúdo</h2></div>
              <button onClick={() => setShowModal(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <select className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500" value={newNotice.category} onChange={(e) => setNewNotice({ ...newNotice, category: e.target.value })}><option value="Aviso">Mural central</option><option value="Dica">Frase do dia</option><option value="Agenda">Agenda grupo</option></select>
              <input placeholder="Título / assunto" className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500" value={newNotice.title} onChange={(e) => setNewNotice({ ...newNotice, title: e.target.value })} />
              <textarea placeholder="Conteúdo ou mensagem..." rows={4} className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500" value={newNotice.content} onChange={(e) => setNewNotice({ ...newNotice, content: e.target.value })} />
              {newNotice.category === 'Aviso' && <select className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none" value={newNotice.priority} onChange={(e) => setNewNotice({ ...newNotice, priority: e.target.value })}><option value="Normal">Prioridade normal</option><option value="Urgente">Prioridade urgente</option></select>}
            </div>
            <button onClick={handleCreate} className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-4 text-xs font-black uppercase tracking-wide text-white shadow-lg hover:bg-orange-700">Publicar <ChevronRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
