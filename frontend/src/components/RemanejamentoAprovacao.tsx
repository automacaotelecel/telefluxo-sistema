import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Store,
  Truck,
  XCircle,
} from 'lucide-react';

type UserLike = {
  id?: string;
  name?: string;
  role?: string;
  isAdmin?: boolean | number;
  allowedStores?: string;
};

type RemapPriority = 'critica' | 'alta' | 'media' | 'baixa';

type RemapSuggestion = {
  id: string;
  product: string;
  reference: string;
  category: string;
  fromStore: string;
  toStore: string;
  suggestedQty: number;
  priority: RemapPriority;
  reason: string;
  originStock: number;
  originSales90: number;
  originCoverageDays: number | null;
  destinationStock: number;
  destinationSales90: number;
  destinationCoverageDays: number | null;
  networkStock: number;
  networkSales90: number;
  createdFrom: 'engine';
};

type RemapRequestStatus =
  | 'solicitado'
  | 'aprovado'
  | 'em_separacao'
  | 'enviado'
  | 'recebido'
  | 'cancelado';

type RemapRequest = {
  id: string;
  product: string;
  reference: string;
  category: string;
  fromStore: string;
  toStore: string;
  requestedQty: number;
  approvedQty: number;
  status: RemapRequestStatus;
  priority: RemapPriority;
  reason: string;
  metrics: Partial<RemapSuggestion>;
  createdByName: string;
  approvedByName?: string;
  lastActionByName?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  sentAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
};

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  suggestions?: RemapSuggestion[];
  requests?: RemapRequest[];
  error?: string;
};

type Props = {
  currentUser?: UserLike;
};

const priorityConfig: Record<RemapPriority, { label: string; className: string; dot: string }> = {
  critica: {
    label: 'Crítica',
    className: 'border-red-200 bg-red-50 text-red-700',
    dot: 'bg-red-500',
  },
  alta: {
    label: 'Alta',
    className: 'border-orange-200 bg-orange-50 text-orange-700',
    dot: 'bg-orange-500',
  },
  media: {
    label: 'Média',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  baixa: {
    label: 'Baixa',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    dot: 'bg-slate-400',
  },
};

const statusConfig: Record<RemapRequestStatus, { label: string; className: string; icon: any }> = {
  solicitado: {
    label: 'Solicitado',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: Clock,
  },
  aprovado: {
    label: 'Aprovado',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: ShieldCheck,
  },
  em_separacao: {
    label: 'Em separação',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
    icon: PackageCheck,
  },
  enviado: {
    label: 'Enviado',
    className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    icon: Truck,
  },
  recebido: {
    label: 'Recebido',
    className: 'border-green-200 bg-green-50 text-green-700',
    icon: CheckCircle2,
  },
  cancelado: {
    label: 'Cancelado',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircle,
  },
};

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');
  return 'http://localhost:3000';
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function exportCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
  };

  const csv = [
    headers.map(escape).join(';'),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(';')),
  ].join('\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PriorityBadge({ priority }: { priority: RemapPriority }) {
  const config = priorityConfig[priority] || priorityConfig.baixa;

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${config.className}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function StatusBadge({ status }: { status: RemapRequestStatus }) {
  const config = statusConfig[status] || statusConfig.solicitado;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${config.className}`}>
      <Icon size={13} />
      {config.label}
    </span>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</p>
        </div>

        <div className="rounded-2xl bg-slate-900 p-3 text-white">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function RequestTimeline({ request }: { request: RemapRequest }) {
  const steps = [
    { key: 'solicitado', label: 'Solicitado', date: request.createdAt },
    { key: 'aprovado', label: 'Aprovado', date: request.approvedAt },
    { key: 'em_separacao', label: 'Separação', date: request.status === 'em_separacao' ? request.updatedAt : undefined },
    { key: 'enviado', label: 'Enviado', date: request.sentAt },
    { key: 'recebido', label: 'Recebido', date: request.receivedAt },
  ];

  const order: RemapRequestStatus[] = ['solicitado', 'aprovado', 'em_separacao', 'enviado', 'recebido'];
  const currentIndex = request.status === 'cancelado' ? -1 : order.indexOf(request.status);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {steps.map((step, index) => {
        const done = currentIndex >= index;

        return (
          <div
            key={step.key}
            className={`rounded-2xl border p-3 ${
              done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <p className={`text-[10px] font-black uppercase tracking-wider ${done ? 'text-emerald-700' : 'text-slate-400'}`}>
              {step.label}
            </p>
            <p className="mt-1 text-[11px] font-bold text-slate-600">{formatDate(step.date)}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function RemanejamentoAprovacao({ currentUser }: Props) {
  const [activeTab, setActiveTab] = useState<'sugestoes' | 'solicitacoes'>('sugestoes');
  const [suggestions, setSuggestions] = useState<RemapSuggestion[]>([]);
  const [requests, setRequests] = useState<RemapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'todos' | RemapPriority>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | RemapRequestStatus>('todos');
  const [selectedSuggestion, setSelectedSuggestion] = useState<RemapSuggestion | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<RemapRequest | null>(null);

  const apiUrl = useMemo(() => getApiUrl(), []);
  const userId = String(currentUser?.id || '');

  const canApprove = useMemo(() => {
    const role = normalizeText(currentUser?.role);
    return Boolean(
      currentUser?.isAdmin ||
        ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'GERENTE', 'MASTER'].includes(role)
    );
  }, [currentUser]);

  async function loadData() {
    if (!userId) {
      setError('Usuário não identificado. Faça login novamente.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [suggestionsResponse, requestsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/remanejamento-aprovacao/sugestoes?userId=${encodeURIComponent(userId)}`),
        fetch(`${apiUrl}/api/remanejamento-aprovacao/solicitacoes?userId=${encodeURIComponent(userId)}`),
      ]);

      const suggestionsData: ApiResponse<RemapSuggestion[]> = await suggestionsResponse.json();
      const requestsData: ApiResponse<RemapRequest[]> = await requestsResponse.json();

      if (!suggestionsResponse.ok || !suggestionsData.success) {
        throw new Error(suggestionsData.error || 'Erro ao carregar sugestões de remanejamento.');
      }

      if (!requestsResponse.ok || !requestsData.success) {
        throw new Error(requestsData.error || 'Erro ao carregar solicitações de remanejamento.');
      }

      setSuggestions(Array.isArray(suggestionsData.suggestions) ? suggestionsData.suggestions : []);
      setRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao carregar remanejamento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, userId]);

  const filteredSuggestions = useMemo(() => {
    const q = normalizeText(search);

    return suggestions.filter((item) => {
      const matchesSearch =
        !q ||
        normalizeText(item.product).includes(q) ||
        normalizeText(item.reference).includes(q) ||
        normalizeText(item.fromStore).includes(q) ||
        normalizeText(item.toStore).includes(q) ||
        normalizeText(item.category).includes(q);

      const matchesPriority = priorityFilter === 'todos' || item.priority === priorityFilter;

      return matchesSearch && matchesPriority;
    });
  }, [suggestions, search, priorityFilter]);

  const filteredRequests = useMemo(() => {
    const q = normalizeText(search);

    return requests.filter((item) => {
      const matchesSearch =
        !q ||
        normalizeText(item.product).includes(q) ||
        normalizeText(item.reference).includes(q) ||
        normalizeText(item.fromStore).includes(q) ||
        normalizeText(item.toStore).includes(q) ||
        normalizeText(item.createdByName).includes(q);

      const matchesPriority = priorityFilter === 'todos' || item.priority === priorityFilter;
      const matchesStatus = statusFilter === 'todos' || item.status === statusFilter;

      return matchesSearch && matchesPriority && matchesStatus;
    });
  }, [requests, search, priorityFilter, statusFilter]);

  const summary = useMemo(() => {
    const openRequests = requests.filter((item) => !['recebido', 'cancelado'].includes(item.status));
    const criticalSuggestions = suggestions.filter((item) => item.priority === 'critica').length;
    const approvedInTransit = requests.filter((item) => ['aprovado', 'em_separacao', 'enviado'].includes(item.status)).length;

    return {
      suggestions: suggestions.length,
      criticalSuggestions,
      openRequests: openRequests.length,
      approvedInTransit,
    };
  }, [suggestions, requests]);

  async function createRequestFromSuggestion(suggestion: RemapSuggestion) {
    if (!userId) return;

    setActionLoading(`create-${suggestion.id}`);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/api/remanejamento-aprovacao/solicitacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, suggestion }),
      });

      const data: ApiResponse<RemapRequest> = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao criar solicitação.');
      }

      await loadData();
      setActiveTab('solicitacoes');
      setSelectedSuggestion(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar solicitação.');
    } finally {
      setActionLoading(null);
    }
  }

  async function updateRequestStatus(request: RemapRequest, status: RemapRequestStatus) {
    if (!userId) return;

    setActionLoading(`${status}-${request.id}`);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/api/remanejamento-aprovacao/solicitacoes/${request.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status }),
      });

      const data: ApiResponse<RemapRequest> = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao atualizar status.');
      }

      await loadData();
      setSelectedRequest(data.data || null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar status.');
    } finally {
      setActionLoading(null);
    }
  }

  const requestActions = (request: RemapRequest) => {
    if (request.status === 'cancelado' || request.status === 'recebido') return [];

    const actions: Array<{ label: string; status: RemapRequestStatus; className: string }> = [];

    if (request.status === 'solicitado' && canApprove) {
      actions.push({
        label: 'Aprovar',
        status: 'aprovado',
        className: 'bg-emerald-600 hover:bg-emerald-700 text-white',
      });
    }

    if (request.status === 'aprovado') {
      actions.push({
        label: 'Iniciar separação',
        status: 'em_separacao',
        className: 'bg-violet-600 hover:bg-violet-700 text-white',
      });
    }

    if (request.status === 'em_separacao') {
      actions.push({
        label: 'Marcar enviado',
        status: 'enviado',
        className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      });
    }

    if (request.status === 'enviado') {
      actions.push({
        label: 'Confirmar recebido',
        status: 'recebido',
        className: 'bg-green-600 hover:bg-green-700 text-white',
      });
    }

    if (canApprove) {
      actions.push({
        label: 'Cancelar',
        status: 'cancelado',
        className: 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200',
      });
    }

    return actions;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-3xl bg-indigo-600 p-4 text-white shadow-lg shadow-indigo-200">
                <ArrowRightLeft size={28} />
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-500">
                  Estoque • Fluxo de aprovação
                </p>
                <h1 className="mt-1 text-2xl font-black uppercase tracking-tight text-slate-950 md:text-3xl">
                  Remanejamento com Aprovação
                </h1>
                <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">
                  Sugestões automáticas de transferência entre lojas, com solicitação, aprovação,
                  separação, envio e confirmação de recebimento.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={loadData}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Atualizar
              </button>

              <button
                onClick={() => {
                  if (activeTab === 'sugestoes') {
                    exportCsv('sugestoes_remanejamento.csv', filteredSuggestions as unknown as Array<Record<string, unknown>>);
                  } else {
                    exportCsv('solicitacoes_remanejamento.csv', filteredRequests as unknown as Array<Record<string, unknown>>);
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-sm transition hover:bg-slate-800"
              >
                <Download size={16} />
                Exportar
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Sugestões geradas"
            value={formatNumber(summary.suggestions)}
            subtitle="Oportunidades calculadas pelo sistema"
            icon={ArrowRightLeft}
          />
          <MetricCard
            title="Críticas"
            value={formatNumber(summary.criticalSuggestions)}
            subtitle="Destinos com ruptura ou cobertura baixa"
            icon={AlertTriangle}
          />
          <MetricCard
            title="Solicitações abertas"
            value={formatNumber(summary.openRequests)}
            subtitle="Aguardando alguma etapa operacional"
            icon={Clock}
          />
          <MetricCard
            title="Em andamento"
            value={formatNumber(summary.approvedInTransit)}
            subtitle="Aprovadas, em separação ou enviadas"
            icon={Truck}
          />
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 sm:w-fit">
              <button
                onClick={() => setActiveTab('sugestoes')}
                className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wider transition ${
                  activeTab === 'sugestoes' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Sugestões
              </button>
              <button
                onClick={() => setActiveTab('solicitacoes')}
                className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wider transition ${
                  activeTab === 'solicitacoes' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Solicitações
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_190px] xl:w-[820px]">
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar produto, loja, referência..."
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm font-bold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                />
              </div>

              <div className="relative">
                <Filter size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as any)}
                  className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-xs font-black uppercase tracking-wider text-slate-600 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                >
                  <option value="todos">Prioridade: todas</option>
                  <option value="critica">Crítica</option>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </div>

              {activeTab === 'solicitacoes' ? (
                <div className="relative">
                  <Filter size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as any)}
                    className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-xs font-black uppercase tracking-wider text-slate-600 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
                  >
                    <option value="todos">Status: todos</option>
                    <option value="solicitado">Solicitado</option>
                    <option value="aprovado">Aprovado</option>
                    <option value="em_separacao">Em separação</option>
                    <option value="enviado">Enviado</option>
                    <option value="recebido">Recebido</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              ) : (
                <div className="hidden xl:block" />
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-[2rem] border border-slate-200 bg-white">
            <div className="text-center">
              <Loader2 className="mx-auto animate-spin text-indigo-600" size={36} />
              <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-400">
                Calculando remanejamentos...
              </p>
            </div>
          </div>
        ) : activeTab === 'sugestoes' ? (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filteredSuggestions.length === 0 ? (
              <div className="col-span-full rounded-[2rem] border border-slate-200 bg-white p-10 text-center">
                <CheckCircle2 className="mx-auto text-emerald-500" size={40} />
                <h3 className="mt-4 text-lg font-black uppercase text-slate-900">
                  Nenhuma sugestão encontrada
                </h3>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  Ajuste os filtros ou atualize os dados de estoque e vendas.
                </p>
              </div>
            ) : (
              filteredSuggestions.map((suggestion) => (
                <article
                  key={suggestion.id}
                  className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityBadge priority={suggestion.priority} />
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                          {suggestion.category || 'Geral'}
                        </span>
                      </div>

                      <h3 className="mt-3 line-clamp-2 text-base font-black uppercase tracking-tight text-slate-950">
                        {suggestion.product}
                      </h3>

                      <p className="mt-1 text-xs font-bold text-slate-400">
                        Ref.: {suggestion.reference || 'não informada'}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-indigo-50 px-4 py-3 text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">
                        Sugerido
                      </p>
                      <p className="text-2xl font-black text-indigo-700">
                        {formatNumber(suggestion.suggestedQty)}
                      </p>
                      <p className="text-[10px] font-black uppercase text-indigo-500">unidades</p>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <Store size={14} />
                        Origem
                      </div>
                      <p className="mt-2 text-sm font-black uppercase text-slate-900">{suggestion.fromStore}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        Estoque: {formatNumber(suggestion.originStock)} • Cobertura:{' '}
                        {suggestion.originCoverageDays === null ? 'sem giro' : `${formatNumber(suggestion.originCoverageDays)} dias`}
                      </p>
                    </div>

                    <div className="flex justify-center text-indigo-500">
                      <ArrowRightLeft size={24} />
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <Store size={14} />
                        Destino
                      </div>
                      <p className="mt-2 text-sm font-black uppercase text-slate-900">{suggestion.toStore}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        Estoque: {formatNumber(suggestion.destinationStock)} • Cobertura:{' '}
                        {suggestion.destinationCoverageDays === null
                          ? 'sem estoque'
                          : `${formatNumber(suggestion.destinationCoverageDays)} dias`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-3xl bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Motivo da sugestão
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{suggestion.reason}</p>
                  </div>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                      onClick={() => setSelectedSuggestion(suggestion)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50"
                    >
                      Ver detalhes
                    </button>

                    <button
                      onClick={() => createRequestFromSuggestion(suggestion)}
                      disabled={actionLoading === `create-${suggestion.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {actionLoading === `create-${suggestion.id}` ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      Criar solicitação
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        ) : (
          <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[1200px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <th className="px-5 py-4">Produto</th>
                    <th className="px-5 py-4">Origem</th>
                    <th className="px-5 py-4">Destino</th>
                    <th className="px-5 py-4 text-center">Qtd</th>
                    <th className="px-5 py-4">Prioridade</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Criado por</th>
                    <th className="px-5 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm font-bold text-slate-400">
                        Nenhuma solicitação encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((request) => (
                      <tr key={request.id} className="border-b border-slate-100 text-sm last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <p className="max-w-[320px] truncate font-black uppercase text-slate-900">{request.product}</p>
                          <p className="text-xs font-bold text-slate-400">Ref.: {request.reference || '-'}</p>
                        </td>
                        <td className="px-5 py-4 font-bold uppercase text-slate-700">{request.fromStore}</td>
                        <td className="px-5 py-4 font-bold uppercase text-slate-700">{request.toStore}</td>
                        <td className="px-5 py-4 text-center text-lg font-black text-indigo-700">{formatNumber(request.approvedQty || request.requestedQty)}</td>
                        <td className="px-5 py-4"><PriorityBadge priority={request.priority} /></td>
                        <td className="px-5 py-4"><StatusBadge status={request.status} /></td>
                        <td className="px-5 py-4">
                          <p className="font-bold text-slate-700">{request.createdByName || '-'}</p>
                          <p className="text-xs font-semibold text-slate-400">{formatDate(request.createdAt)}</p>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => setSelectedRequest(request)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 xl:hidden">
              {filteredRequests.length === 0 ? (
                <div className="rounded-3xl bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
                  Nenhuma solicitação encontrada.
                </div>
              ) : (
                filteredRequests.map((request) => (
                  <article key={request.id} className="rounded-3xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <PriorityBadge priority={request.priority} />
                      <StatusBadge status={request.status} />
                    </div>

                    <h3 className="mt-3 text-sm font-black uppercase text-slate-900">{request.product}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">Ref.: {request.reference || '-'}</p>

                    <div className="mt-4 grid grid-cols-1 gap-3">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase text-slate-400">Origem</p>
                        <p className="text-sm font-black uppercase text-slate-800">{request.fromStore}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase text-slate-400">Destino</p>
                        <p className="text-sm font-black uppercase text-slate-800">{request.toStore}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedRequest(request)}
                      className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wider text-white"
                    >
                      Abrir solicitação
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {selectedSuggestion && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/50 p-4 backdrop-blur-sm md:items-stretch">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Detalhe da sugestão</p>
                  <h2 className="mt-1 text-xl font-black uppercase text-slate-950">{selectedSuggestion.product}</h2>
                  <p className="mt-1 text-xs font-bold text-slate-400">Ref.: {selectedSuggestion.reference || '-'}</p>
                </div>
                <button
                  onClick={() => setSelectedSuggestion(null)}
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                >
                  <XCircle size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Origem</p>
                  <p className="mt-2 font-black uppercase text-slate-900">{selectedSuggestion.fromStore}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">
                    Estoque: {formatNumber(selectedSuggestion.originStock)}
                  </p>
                  <p className="text-sm font-semibold text-slate-600">
                    Vendas 90d: {formatNumber(selectedSuggestion.originSales90)}
                  </p>
                  <p className="text-sm font-semibold text-slate-600">
                    Cobertura:{' '}
                    {selectedSuggestion.originCoverageDays === null
                      ? 'sem giro'
                      : `${formatNumber(selectedSuggestion.originCoverageDays)} dias`}
                  </p>
                </div>

                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Destino</p>
                  <p className="mt-2 font-black uppercase text-slate-900">{selectedSuggestion.toStore}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">
                    Estoque: {formatNumber(selectedSuggestion.destinationStock)}
                  </p>
                  <p className="text-sm font-semibold text-slate-600">
                    Vendas 90d: {formatNumber(selectedSuggestion.destinationSales90)}
                  </p>
                  <p className="text-sm font-semibold text-slate-600">
                    Cobertura:{' '}
                    {selectedSuggestion.destinationCoverageDays === null
                      ? 'sem estoque'
                      : `${formatNumber(selectedSuggestion.destinationCoverageDays)} dias`}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-3xl bg-indigo-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Ação recomendada</p>
                <p className="mt-1 text-sm font-bold text-indigo-900">{selectedSuggestion.reason}</p>
                <p className="mt-3 text-3xl font-black text-indigo-700">
                  {formatNumber(selectedSuggestion.suggestedQty)} un.
                </p>
              </div>
            </div>

            <div className="border-t border-slate-200 p-5">
              <button
                onClick={() => createRequestFromSuggestion(selectedSuggestion)}
                disabled={actionLoading === `create-${selectedSuggestion.id}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {actionLoading === `create-${selectedSuggestion.id}` ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Criar solicitação de remanejamento
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/50 p-4 backdrop-blur-sm md:items-stretch">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedRequest.status} />
                    <PriorityBadge priority={selectedRequest.priority} />
                  </div>
                  <h2 className="mt-3 text-xl font-black uppercase text-slate-950">{selectedRequest.product}</h2>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    Solicitação #{selectedRequest.id.slice(0, 8)} • Ref.: {selectedRequest.reference || '-'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                >
                  <XCircle size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <RequestTimeline request={selectedRequest} />

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Origem</p>
                  <p className="mt-2 font-black uppercase text-slate-900">{selectedRequest.fromStore}</p>
                </div>

                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Destino</p>
                  <p className="mt-2 font-black uppercase text-slate-900">{selectedRequest.toStore}</p>
                </div>

                <div className="rounded-3xl bg-indigo-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Quantidade</p>
                  <p className="mt-2 text-3xl font-black text-indigo-700">
                    {formatNumber(selectedRequest.approvedQty || selectedRequest.requestedQty)}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-3xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Justificativa</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">{selectedRequest.reason}</p>
              </div>

              <div className="mt-5 rounded-3xl border border-slate-200 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Responsáveis</p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">Criado por</p>
                    <p className="text-sm font-bold text-slate-700">{selectedRequest.createdByName || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">Aprovado por</p>
                    <p className="text-sm font-bold text-slate-700">{selectedRequest.approvedByName || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">Última ação</p>
                    <p className="text-sm font-bold text-slate-700">{selectedRequest.lastActionByName || '-'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {requestActions(selectedRequest).map((action) => (
                  <button
                    key={action.status}
                    onClick={() => updateRequestStatus(selectedRequest, action.status)}
                    disabled={actionLoading === `${action.status}-${selectedRequest.id}`}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wider transition disabled:opacity-60 ${action.className}`}
                  >
                    {actionLoading === `${action.status}-${selectedRequest.id}` && <Loader2 size={16} className="animate-spin" />}
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
