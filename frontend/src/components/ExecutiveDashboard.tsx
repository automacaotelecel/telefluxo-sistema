import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  BrainCircuit,
  Building2,
  Download,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Store,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

type ExecutiveKpi = {
  faturamentoMes: number;
  pecasMes: number;
  ticketMedio: number;
  vendasUltimos30: number;
  faturamentoUltimos30: number;
  faturamento30Anterior: number;
  crescimentoVs30Anterior: number | null;
  estoqueTotal: number;
  valorEstoque: number;
  lojasAtivas: number;
  produtosAtivos: number;
  alertasCriticos: number;
  sugestoesRemanejamento: number;
};

type StoreRanking = {
  loja: string;
  faturamentoMes: number;
  pecasMes: number;
  vendas90: number;
  estoque: number;
  coberturaDias: number | null;
  status: 'saudavel' | 'atencao' | 'critico';
};

type ProductRanking = {
  produto: string;
  referencia: string;
  categoria: string;
  faturamentoMes: number;
  pecasMes: number;
  vendas90: number;
  estoque: number;
  coberturaDias: number | null;
};

type ExecutiveInsight = {
  id: string;
  tipo: 'risco' | 'oportunidade' | 'acao' | 'alerta';
  prioridade: 'critica' | 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  loja?: string;
  produto?: string;
  acao?: string;
};

type ExecutiveDashboardResponse = {
  success: boolean;
  generatedAt?: string;
  periodo?: {
    mesInicio: string;
    hoje: string;
    ultimos30Inicio: string;
    ultimos90Inicio: string;
  };
  kpis?: ExecutiveKpi;
  topStores?: StoreRanking[];
  bottomStores?: StoreRanking[];
  topProducts?: ProductRanking[];
  risks?: ExecutiveInsight[];
  opportunities?: ExecutiveInsight[];
  actions?: ExecutiveInsight[];
  clarkBriefing?: string;
  error?: string;
};

type Props = {
  currentUser?: any;
};

const EMPTY_KPIS: ExecutiveKpi = {
  faturamentoMes: 0,
  pecasMes: 0,
  ticketMedio: 0,
  vendasUltimos30: 0,
  faturamentoUltimos30: 0,
  faturamento30Anterior: 0,
  crescimentoVs30Anterior: null,
  estoqueTotal: 0,
  valorEstoque: 0,
  lojasAtivas: 0,
  produtosAtivos: 0,
  alertasCriticos: 0,
  sugestoesRemanejamento: 0,
};

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');

  const isLocal =
    window.location.hostname === 'localhost' ||
    /^[0-9.]+$/.test(window.location.hostname);

  return isLocal
    ? `http://${window.location.hostname}:3000`
    : 'https://telefluxo-aplicacao.onrender.com';
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Sem base';
  return `${Number(value).toFixed(1).replace('.', ',')}%`;
}

function formatCoverage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Sem giro';
  if (Number(value) > 999) return '+999 dias';
  return `${Number(value).toFixed(0)} dias`;
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function safeCsv(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function priorityClass(priority: ExecutiveInsight['prioridade']) {
  if (priority === 'critica') return 'border-red-200 bg-red-50 text-red-700';
  if (priority === 'alta') return 'border-orange-200 bg-orange-50 text-orange-700';
  if (priority === 'media') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function statusClass(status: StoreRanking['status']) {
  if (status === 'critico') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'atencao') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function StatusBadge({ status }: { status: StoreRanking['status'] }) {
  const label = status === 'critico' ? 'Crítico' : status === 'atencao' ? 'Atenção' : 'Saudável';

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(status)}`}>
      {label}
    </span>
  );
}

function KpiCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: any;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon size={20} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diretoria</span>
      </div>
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{title}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-xs font-semibold text-slate-500">{helper}</p>
    </div>
  );
}

function RankingBar({ label, value, max, helper }: { label: string; value: number; max: number; helper: string }) {
  const percentage = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 4;

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-800">{label}</p>
          <p className="text-[11px] font-bold text-slate-400">{helper}</p>
        </div>
        <p className="shrink-0 text-sm font-black text-slate-900">{formatCurrency(value)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-slate-900" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export default function ExecutiveDashboard({ currentUser }: Props) {
  const [data, setData] = useState<ExecutiveDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userRole = String(currentUser?.role || '').toUpperCase();
  const isAdmin = currentUser?.isAdmin === true || Number(currentUser?.isAdmin) === 1;
  const canAccess = userRole === 'ADM' || isAdmin;

  const kpis = data?.kpis || EMPTY_KPIS;
  const topStores = data?.topStores || [];
  const bottomStores = data?.bottomStores || [];
  const topProducts = data?.topProducts || [];
  const risks = data?.risks || [];
  const opportunities = data?.opportunities || [];
  const actions = data?.actions || [];

  const maxStoreRevenue = useMemo(() => {
    return Math.max(1, ...topStores.map((item) => Number(item.faturamentoMes || 0)));
  }, [topStores]);

  const maxProductRevenue = useMemo(() => {
    return Math.max(1, ...topProducts.map((item) => Number(item.faturamentoMes || 0)));
  }, [topProducts]);

  const loadDashboard = async () => {
    if (!currentUser?.id) return;

    setLoading(true);
    setError('');

    try {
      const url = `${getApiUrl()}/api/painel-diretoria/resumo?userId=${encodeURIComponent(currentUser.id)}`;
      const response = await fetch(url);
      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Erro ao carregar painel diretoria.');
      }

      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar painel diretoria.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [currentUser?.id]);

  const exportCsv = () => {
    const rows = [
      ['Tipo', 'Nome', 'Faturamento Mes', 'Pecas Mes', 'Estoque', 'Cobertura', 'Status'],
      ...topStores.map((item) => [
        'Loja Top',
        item.loja,
        item.faturamentoMes,
        item.pecasMes,
        item.estoque,
        item.coberturaDias ?? '',
        item.status,
      ]),
      ...bottomStores.map((item) => [
        'Loja Atenção',
        item.loja,
        item.faturamentoMes,
        item.pecasMes,
        item.estoque,
        item.coberturaDias ?? '',
        item.status,
      ]),
      ...topProducts.map((item) => [
        'Produto Top',
        item.produto,
        item.faturamentoMes,
        item.pecasMes,
        item.estoque,
        item.coberturaDias ?? '',
        item.categoria,
      ]),
    ];

    const csv = rows.map((row) => row.map(safeCsv).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `painel-diretoria-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!canAccess) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-8">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700">
          <ShieldCheck size={32} />
          <h1 className="mt-4 text-2xl font-black uppercase">Acesso restrito</h1>
          <p className="mt-2 text-sm font-semibold">O Painel Diretoria é exclusivo para usuários ADM.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-xl">
          <div className="relative p-6 md:p-8">
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-orange-500/20 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-blue-500/20 blur-3xl" />

            <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-orange-200">
                  <ShieldCheck size={14} />
                  Acesso ADM
                </div>
                <h1 className="text-3xl font-black tracking-tight md:text-5xl">
                  Painel Diretoria
                </h1>
                <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-300 md:text-base">
                  Resumo executivo automático com vendas, estoque, riscos, oportunidades e ações recomendadas para a operação.
                </p>
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-500">
                  Atualizado em {formatDate(data?.generatedAt)}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={loadDashboard}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/15 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  Atualizar
                </button>
                <button
                  onClick={exportCsv}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition hover:bg-orange-600"
                >
                  <Download size={16} />
                  Exportar CSV
                </button>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-slate-200 bg-white">
            <div className="text-center">
              <Loader2 className="mx-auto animate-spin text-orange-600" size={36} />
              <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-400">
                Montando resumo executivo...
              </p>
            </div>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Faturamento do mês"
                value={formatCurrency(kpis.faturamentoMes)}
                helper={`${formatNumber(kpis.pecasMes)} peças • Ticket ${formatCurrency(kpis.ticketMedio)}`}
                icon={TrendingUp}
              />
              <KpiCard
                title="Crescimento 30 dias"
                value={formatPercent(kpis.crescimentoVs30Anterior)}
                helper={`${formatCurrency(kpis.faturamentoUltimos30)} nos últimos 30 dias`}
                icon={BarChart3}
              />
              <KpiCard
                title="Estoque atual"
                value={`${formatNumber(kpis.estoqueTotal)} un.`}
                helper={`${formatCurrency(kpis.valorEstoque)} em preço de venda`}
                icon={Package}
              />
              <KpiCard
                title="Pontos de atenção"
                value={`${formatNumber(kpis.alertasCriticos)} alertas`}
                helper={`${formatNumber(kpis.sugestoesRemanejamento)} sugestões de remanejamento`}
                icon={AlertTriangle}
              />
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resumo da Clark</p>
                    <h2 className="text-xl font-black text-slate-900">Leitura executiva da operação</h2>
                  </div>
                  <BrainCircuit className="text-orange-600" size={28} />
                </div>
                <div className="rounded-3xl bg-slate-50 p-5 text-sm font-semibold leading-7 text-slate-700">
                  {data?.clarkBriefing || 'Sem dados suficientes para montar o resumo executivo agora.'}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operação</p>
                <h2 className="text-xl font-black text-slate-900">Base monitorada</h2>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <Store className="mb-3 text-slate-500" size={20} />
                    <p className="text-2xl font-black">{formatNumber(kpis.lojasAtivas)}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Lojas</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <Building2 className="mb-3 text-slate-500" size={20} />
                    <p className="text-2xl font-black">{formatNumber(kpis.produtosAtivos)}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Produtos</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <Target className="mb-3 text-slate-500" size={20} />
                    <p className="text-2xl font-black">{formatNumber(kpis.vendasUltimos30)}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Peças 30D</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <ArrowRightLeft className="mb-3 text-slate-500" size={20} />
                    <p className="text-2xl font-black">{formatNumber(kpis.sugestoesRemanejamento)}</p>
                    <p className="text-[10px] font-black uppercase text-slate-400">Remanej.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Top lojas do mês</h2>
                  <TrendingUp className="text-emerald-600" size={22} />
                </div>
                <div className="space-y-3">
                  {topStores.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-400">Sem vendas encontradas no mês.</p>
                  ) : topStores.map((item) => (
                    <RankingBar
                      key={item.loja}
                      label={item.loja}
                      value={item.faturamentoMes}
                      max={maxStoreRevenue}
                      helper={`${formatNumber(item.pecasMes)} peças • cobertura ${formatCoverage(item.coberturaDias)}`}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Lojas em atenção</h2>
                  <TrendingDown className="text-red-600" size={22} />
                </div>
                <div className="space-y-3">
                  {bottomStores.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-400">Nenhuma loja crítica encontrada.</p>
                  ) : bottomStores.map((item) => (
                    <div key={item.loja} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-900">{item.loja}</p>
                          <p className="mt-1 text-xs font-bold text-slate-400">
                            {formatCurrency(item.faturamentoMes)} • {formatNumber(item.pecasMes)} peças • cobertura {formatCoverage(item.coberturaDias)}
                          </p>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Top produtos</h2>
                  <Package className="text-indigo-600" size={22} />
                </div>
                <div className="space-y-3">
                  {topProducts.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-400">Sem produtos vendidos no período.</p>
                  ) : topProducts.map((item) => (
                    <RankingBar
                      key={`${item.referencia}-${item.produto}`}
                      label={item.produto}
                      value={item.faturamentoMes}
                      max={maxProductRevenue}
                      helper={`${formatNumber(item.pecasMes)} peças • estoque ${formatNumber(item.estoque)} • cobertura ${formatCoverage(item.coberturaDias)}`}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Ações recomendadas</h2>
                  <Target className="text-orange-600" size={22} />
                </div>
                <div className="space-y-3">
                  {[...risks, ...opportunities, ...actions].slice(0, 10).map((item) => (
                    <div key={item.id} className={`rounded-2xl border p-4 ${priorityClass(item.prioridade)}`}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-black uppercase">{item.titulo}</p>
                        <span className="rounded-full bg-white/70 px-2 py-1 text-[9px] font-black uppercase">
                          {item.prioridade}
                        </span>
                      </div>
                      <p className="text-xs font-semibold leading-5 opacity-90">{item.descricao}</p>
                      {item.acao && (
                        <p className="mt-2 text-xs font-black uppercase tracking-wide">Ação: {item.acao}</p>
                      )}
                    </div>
                  ))}
                  {[...risks, ...opportunities, ...actions].length === 0 && (
                    <p className="text-sm font-semibold text-slate-400">Nenhuma ação crítica gerada agora.</p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
