import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Download,
  Filter,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

type AlertSeverity = 'critica' | 'alta' | 'media' | 'baixa';
type AlertStatus = 'aberto' | 'visto' | 'resolvido';

type IntelligentAlert = {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  module: 'estoque' | 'vendas' | 'remanejamento' | 'operacao';
  store?: string;
  product?: string;
  category?: string;
  metric?: {
    label: string;
    value: string | number;
    helper?: string;
  };
  action?: string;
  createdAt: string;
  details?: Record<string, any>;
};

type AlertSummary = {
  total: number;
  criticas: number;
  altas: number;
  medias: number;
  baixas: number;
  estoque: number;
  vendas: number;
  remanejamento: number;
};

type ApiResponse = {
  success: boolean;
  generatedAt?: string;
  summary?: AlertSummary;
  alerts?: IntelligentAlert[];
  sources?: Record<string, string>;
  error?: string;
};

type Props = {
  currentUser?: any;
  onNavigateStock?: () => void;
};

const severityRank: Record<AlertSeverity, number> = {
  critica: 4,
  alta: 3,
  media: 2,
  baixa: 1,
};

const severityLabels: Record<AlertSeverity, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

const severityClasses: Record<AlertSeverity, string> = {
  critica: 'bg-red-50 text-red-700 border-red-200',
  alta: 'bg-orange-50 text-orange-700 border-orange-200',
  media: 'bg-amber-50 text-amber-700 border-amber-200',
  baixa: 'bg-sky-50 text-sky-700 border-sky-200',
};

const moduleLabels: Record<string, string> = {
  estoque: 'Estoque',
  vendas: 'Vendas',
  remanejamento: 'Remanejamento',
  operacao: 'Operação',
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

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatDate(value?: string) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function safeCsv(value: unknown) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function getIcon(alert: IntelligentAlert) {
  if (alert.type.includes('stockout') || alert.type.includes('ruptura')) return PackageX;
  if (alert.type.includes('remanejamento')) return ArrowRightLeft;
  if (alert.type.includes('queda')) return TrendingDown;
  if (alert.module === 'vendas') return TrendingUp;
  if (alert.severity === 'critica') return ShieldAlert;
  return AlertTriangle;
}

function StatCard({
  title,
  value,
  helper,
  variant = 'default',
}: {
  title: string;
  value: number | string;
  helper: string;
  variant?: 'default' | 'red' | 'orange' | 'blue' | 'green';
}) {
  const variants = {
    default: 'bg-white border-slate-200 text-slate-900',
    red: 'bg-red-50 border-red-100 text-red-700',
    orange: 'bg-orange-50 border-orange-100 text-orange-700',
    blue: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    green: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${variants[variant]}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">
        {title}
      </p>
      <div className="mt-3 text-3xl font-black tracking-tight">{value}</div>
      <p className="mt-1 text-xs font-bold opacity-70">{helper}</p>
    </div>
  );
}

export default function IntelligentAlerts({ currentUser, onNavigateStock }: Props) {
  const API_URL = getApiUrl();

  const [alerts, setAlerts] = useState<IntelligentAlert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'todos' | AlertSeverity>('todos');
  const [moduleFilter, setModuleFilter] = useState<'todos' | string>('todos');
  const [selectedAlert, setSelectedAlert] = useState<IntelligentAlert | null>(null);

  const userId = String(currentUser?.id || '');

  const fetchAlerts = async () => {
    if (!userId) {
      setError('Usuário não identificado. Faça login novamente.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/intelligent-alerts?userId=${encodeURIComponent(userId)}`);
      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Não foi possível carregar os alertas.');
      }

      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      setSummary(data.summary || null);
      setGeneratedAt(data.generatedAt || '');
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar Central de Alertas.');
      setAlerts([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const filteredAlerts = useMemo(() => {
    const q = normalizeText(query);

    return alerts
      .filter((alert) => {
        if (severityFilter !== 'todos' && alert.severity !== severityFilter) return false;
        if (moduleFilter !== 'todos' && alert.module !== moduleFilter) return false;

        if (!q) return true;

        const haystack = normalizeText([
          alert.title,
          alert.description,
          alert.store,
          alert.product,
          alert.category,
          alert.action,
          alert.module,
          alert.severity,
        ].join(' '));

        return haystack.includes(q);
      })
      .sort((a, b) => {
        const sevDiff = severityRank[b.severity] - severityRank[a.severity];
        if (sevDiff !== 0) return sevDiff;

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [alerts, moduleFilter, query, severityFilter]);

  const exportCsv = () => {
    const header = [
      'Severidade',
      'Módulo',
      'Título',
      'Descrição',
      'Loja',
      'Produto',
      'Categoria',
      'Métrica',
      'Valor',
      'Ação recomendada',
      'Gerado em',
    ];

    const rows = filteredAlerts.map((alert) => [
      severityLabels[alert.severity],
      moduleLabels[alert.module] || alert.module,
      alert.title,
      alert.description,
      alert.store || '',
      alert.product || '',
      alert.category || '',
      alert.metric?.label || '',
      alert.metric?.value ?? '',
      alert.action || '',
      formatDate(alert.createdAt),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(safeCsv).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `central-alertas-telefluxo-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  };

  const emptyState = !loading && !error && filteredAlerts.length === 0;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-200">
                <BellRing size={26} />
              </div>

              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-slate-950 md:text-3xl">
                  Central de Alertas Inteligentes
                </h1>
                <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
                  Alertas automáticos gerados a partir de estoque, vendas, giro, risco de ruptura,
                  excesso e oportunidades de remanejamento.
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    Atualizado: {formatDate(generatedAt)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {filteredAlerts.length} exibido(s)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={fetchAlerts}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                Atualizar
              </button>

              <button
                onClick={exportCsv}
                disabled={filteredAlerts.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={15} />
                Exportar CSV
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Alertas"
            value={summary?.total ?? alerts.length}
            helper="Total em aberto"
            variant="default"
          />
          <StatCard
            title="Críticos"
            value={summary?.criticas ?? alerts.filter((a) => a.severity === 'critica').length}
            helper="Ação imediata"
            variant="red"
          />
          <StatCard
            title="Altos"
            value={summary?.altas ?? alerts.filter((a) => a.severity === 'alta').length}
            helper="Prioridade alta"
            variant="orange"
          />
          <StatCard
            title="Remanejamento"
            value={summary?.remanejamento ?? alerts.filter((a) => a.module === 'remanejamento').length}
            helper="Oportunidades"
            variant="blue"
          />
          <StatCard
            title="Estoque"
            value={summary?.estoque ?? alerts.filter((a) => a.module === 'estoque').length}
            helper="Ruptura/excesso"
            variant="green"
          />
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_190px_190px]">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por loja, produto, alerta ou ação..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm font-bold text-slate-700 outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-50"
              />
            </div>

            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as any)}
              className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-black uppercase text-slate-600 outline-none focus:border-red-300 focus:bg-white"
            >
              <option value="todos">Todas severidades</option>
              <option value="critica">Crítica</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>

            <select
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
              className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-black uppercase text-slate-600 outline-none focus:border-red-300 focus:bg-white"
            >
              <option value="todos">Todos módulos</option>
              <option value="estoque">Estoque</option>
              <option value="vendas">Vendas</option>
              <option value="remanejamento">Remanejamento</option>
              <option value="operacao">Operação</option>
            </select>
          </div>
        </section>

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center">
            <RefreshCw className="mx-auto animate-spin text-slate-400" size={28} />
            <p className="mt-3 text-sm font-black uppercase tracking-widest text-slate-400">
              Gerando alertas inteligentes...
            </p>
          </div>
        )}

        {emptyState && (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={34} />
            <h3 className="mt-3 text-lg font-black uppercase text-slate-900">
              Nenhum alerta encontrado
            </h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Não há alertas para os filtros selecionados neste momento.
            </p>
          </div>
        )}

        {!loading && filteredAlerts.length > 0 && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">
                    Alertas em aberto
                  </h2>
                  <p className="text-xs font-semibold text-slate-400">
                    Ordenado por severidade e data de geração.
                  </p>
                </div>

                <Filter size={18} className="text-slate-300" />
              </div>

              <div className="max-h-[calc(100vh-360px)] min-h-[420px] overflow-y-auto">
                {filteredAlerts.map((alert) => {
                  const Icon = getIcon(alert);
                  const selected = selectedAlert?.id === alert.id;

                  return (
                    <button
                      key={alert.id}
                      onClick={() => setSelectedAlert(alert)}
                      className={`w-full border-b border-slate-100 p-4 text-left transition hover:bg-slate-50 ${
                        selected ? 'bg-red-50/60' : 'bg-white'
                      }`}
                    >
                      <div className="flex gap-4">
                        <div className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${severityClasses[alert.severity]}`}>
                          <Icon size={19} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${severityClasses[alert.severity]}`}>
                              {severityLabels[alert.severity]}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {moduleLabels[alert.module] || alert.module}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {formatDate(alert.createdAt)}
                            </span>
                          </div>

                          <h3 className="mt-2 line-clamp-2 text-sm font-black uppercase leading-snug text-slate-950">
                            {alert.title}
                          </h3>

                          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-relaxed text-slate-500">
                            {alert.description}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {alert.store && (
                              <span className="rounded-lg bg-slate-100 px-2 py-1">
                                Loja: {alert.store}
                              </span>
                            )}
                            {alert.product && (
                              <span className="rounded-lg bg-slate-100 px-2 py-1">
                                Produto: {alert.product}
                              </span>
                            )}
                            {alert.metric && (
                              <span className="rounded-lg bg-slate-100 px-2 py-1">
                                {alert.metric.label}: {alert.metric.value}
                              </span>
                            )}
                          </div>
                        </div>

                        <ChevronRight className="mt-4 shrink-0 text-slate-300" size={18} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="rounded-[2rem] border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4 xl:self-start">
              {selectedAlert ? (
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${severityClasses[selectedAlert.severity]}`}>
                      {severityLabels[selectedAlert.severity]}
                    </span>

                    <button
                      onClick={() => setSelectedAlert(null)}
                      className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <h3 className="mt-4 text-xl font-black uppercase leading-tight text-slate-950">
                    {selectedAlert.title}
                  </h3>

                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">
                    {selectedAlert.description}
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3">
                    {selectedAlert.store && (
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Loja
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {selectedAlert.store}
                        </p>
                      </div>
                    )}

                    {selectedAlert.product && (
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Produto
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {selectedAlert.product}
                        </p>
                      </div>
                    )}

                    {selectedAlert.metric && (
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Métrica
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {selectedAlert.metric.label}: {selectedAlert.metric.value}
                        </p>
                        {selectedAlert.metric.helper && (
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {selectedAlert.metric.helper}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedAlert.action && (
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">
                          Ação recomendada
                        </p>
                        <p className="mt-1 text-sm font-black leading-relaxed text-indigo-900">
                          {selectedAlert.action}
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={onNavigateStock}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition hover:bg-slate-800"
                  >
                    <Store size={15} />
                    Abrir estoque detalhado
                  </button>
                </div>
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                  <AlertTriangle size={34} className="text-slate-300" />
                  <h3 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-700">
                    Selecione um alerta
                  </h3>
                  <p className="mt-2 text-sm font-semibold text-slate-400">
                    Clique em qualquer alerta da lista para ver o detalhe e a ação recomendada.
                  </p>
                </div>
              )}
            </aside>
          </section>
        )}

    
      </div>
    </div>
  );
}
