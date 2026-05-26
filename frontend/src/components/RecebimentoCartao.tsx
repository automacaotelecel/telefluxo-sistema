import React, { useEffect, useMemo, useState } from 'react';
import {
  UploadCloud,
  CreditCard,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Search,
  X,
  Download,
  Database,
  BarChart3,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  CalendarDays,
  ShieldCheck,
  Clock3,
  Activity,
  FileCheck2,
} from 'lucide-react';

type MonthlyRow = {
  mes: string;
  projetado: number;
  vlrExtrato: number;
  diferenca: number;
  status: string;
};

type DailyRow = {
  data: string;
  mes: string;
  diaSemana: string;
  projetado: number;
  vlrExtrato: number;
  diferenca: number;
  status: string;
  qtdPrevista: number;
  qtdExtrato: number;
  detalhesPrevisto: string;
  detalhesExtrato: string;
};

type RecebimentoResponse = {
  ok: boolean;
  generatedAt?: string;
  persistedAt?: string;
  processedBy?: string;
  fileName?: string;
  resumo?: {
    totalProjetado: number;
    totalExtrato: number;
    diferencaTotal: number;
    qtdVendasProcessadas: number;
    qtdLancamentosExtrato: number;
    diasOk: number;
    diasPgtMaior: number;
    diasPgtMenor: number;
    periodoInicio: string | null;
    periodoFim: string | null;
  };
  mensal?: MonthlyRow[];
  diario?: DailyRow[];
  descartadas?: Array<Record<string, unknown>>;
  meta?: {
    baseSheetName?: string;
    extratoSheetName?: string;
    linhasValidasBase?: number;
    linhasValidasExtrato?: number;
    linhasDescartadas?: number;
  };
};

type Props = {
  currentUser?: any;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function normalizeRole(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isAdministrativeUser(user: any) {
  const role = normalizeRole(user?.role);

  return Boolean(
    user?.isAdmin ||
      ['ADMIN', 'ADM', 'CEO', 'DIRETOR', 'DIRETORIA', 'MASTER', 'SOCIO', 'SÓCIO'].includes(role)
  );
}

function formatCurrency(value: number | null | undefined) {
  const safeValue = Number(value || 0);
  return safeValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatNumber(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatDate(date: string | null | undefined) {
  if (!date) return '-';

  const clean = String(date).slice(0, 10);
  const [year, month, day] = clean.split('-');

  if (!year || !month || !day) return String(date);

  return `${day}/${month}/${year}`;
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return '-';

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return formatDate(date);

  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function monthToComparable(mes: string) {
  const [mm, yyyy] = String(mes || '').split('/');
  const month = Number(mm);
  const year = Number(yyyy);

  if (!month || !year) return 0;

  return year * 100 + month;
}

function statusBadge(status: string) {
  const normalized = String(status || '').toUpperCase();

  if (normalized === 'OK') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  if (normalized === 'PGT MAIOR') {
    return 'bg-green-50 text-green-700 border-green-200';
  }

  if (normalized === 'PGT MENOR') {
    return 'bg-red-50 text-red-700 border-red-200';
  }

  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function splitDetails(details: string) {
  return String(details || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function differenceClass(value: number) {
  return value >= 0 ? 'text-green-700' : 'text-red-700';
}

export default function RecebimentoCartao({ currentUser }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [resultado, setResultado] = useState<RecebimentoResponse | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'OK' | 'PGT MAIOR' | 'PGT MENOR'>('TODOS');
  const [loading, setLoading] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [deletingSaved, setDeletingSaved] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'resumo' | 'motor'>('resumo');
  const [showFutureMonths, setShowFutureMonths] = useState(false);

  const isAdminUser = useMemo(() => isAdministrativeUser(currentUser), [currentUser]);

  const monthlyRows = useMemo(() => resultado?.mensal || [], [resultado]);
  const dailyRows = useMemo(() => resultado?.diario || [], [resultado]);

  const currentMonthComparable = useMemo(() => {
    const now = new Date();
    return now.getFullYear() * 100 + (now.getMonth() + 1);
  }, []);

  const monthlyRowsFilteredByFuture = useMemo(() => {
    if (showFutureMonths) return monthlyRows;
    return monthlyRows.filter((row) => monthToComparable(row.mes) <= currentMonthComparable);
  }, [monthlyRows, showFutureMonths, currentMonthComparable]);

  const dailyRowsFilteredByFuture = useMemo(() => {
    if (showFutureMonths) return dailyRows;
    return dailyRows.filter((row) => monthToComparable(row.mes) <= currentMonthComparable);
  }, [dailyRows, showFutureMonths, currentMonthComparable]);

  const filteredDailyRows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return dailyRowsFilteredByFuture.filter((row) => {
      const matchStatus = statusFilter === 'TODOS' || row.status === statusFilter;

      if (!q) return matchStatus;

      const haystack = [
        row.data,
        row.mes,
        row.diaSemana,
        row.status,
        row.detalhesPrevisto,
        row.detalhesExtrato,
      ]
        .join(' ')
        .toLowerCase();

      return matchStatus && haystack.includes(q);
    });
  }, [dailyRowsFilteredByFuture, query, statusFilter]);

  const filteredRowsByMonth = useMemo(() => {
    return filteredDailyRows.reduce<Record<string, DailyRow[]>>((acc, row) => {
      const key = row.mes || 'Sem mês';

      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(row);
      return acc;
    }, {});
  }, [filteredDailyRows]);

  const resumoVisivel = useMemo(() => {
    return dailyRowsFilteredByFuture.reduce(
      (acc, row) => {
        acc.totalProjetado += row.projetado || 0;
        acc.totalExtrato += row.vlrExtrato || 0;
        acc.diferencaTotal += row.diferenca || 0;
        acc.qtdPrevista += row.qtdPrevista || 0;
        acc.qtdExtrato += row.qtdExtrato || 0;

        if (row.status === 'OK') acc.diasOk += 1;
        if (row.status === 'PGT MAIOR') acc.diasPgtMaior += 1;
        if (row.status === 'PGT MENOR') acc.diasPgtMenor += 1;

        return acc;
      },
      {
        totalProjetado: 0,
        totalExtrato: 0,
        diferencaTotal: 0,
        qtdPrevista: 0,
        qtdExtrato: 0,
        diasOk: 0,
        diasPgtMaior: 0,
        diasPgtMenor: 0,
      }
    );
  }, [dailyRowsFilteredByFuture]);

  const totalFiltrado = useMemo(() => {
    return filteredDailyRows.reduce(
      (acc, row) => {
        acc.projetado += row.projetado || 0;
        acc.extrato += row.vlrExtrato || 0;
        acc.diferenca += row.diferenca || 0;
        return acc;
      },
      { projetado: 0, extrato: 0, diferenca: 0 }
    );
  }, [filteredDailyRows]);

  const hasSavedData = Boolean(resultado?.mensal?.length || resultado?.diario?.length);

  async function carregarUltimoResultado() {
    if (!currentUser?.id || !isAdminUser) return;

    setLoadingSaved(true);
    setError('');

    try {
      const response = await fetch(
        `${API_URL}/api/financeiro/recebimento-cartao/ultimo?userId=${encodeURIComponent(String(currentUser.id))}`
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Não foi possível carregar o último processamento.');
      }

      if (payload?.data) {
        setResultado(payload.data);
      }
    } catch (err: any) {
      console.warn('Não consegui carregar o último recebimento cartão:', err);
      setError(err?.message || 'Não foi possível carregar o último processamento salvo.');
    } finally {
      setLoadingSaved(false);
    }
  }

  useEffect(() => {
    carregarUltimoResultado();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, isAdminUser]);

  async function handleProcessar() {
    if (!file) {
      setError('Selecione a planilha original da Stone primeiro.');
      return;
    }

    if (!currentUser?.id) {
      setError('Usuário não identificado. Faça login novamente.');
      return;
    }

    setLoading(true);
    setError('');
    setExpandedMonths({});
    setExpandedDays({});

    const endpoint = `${API_URL}/api/financeiro/recebimento-cartao/processar`;

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('userId', String(currentUser.id));

      const response = await fetch(endpoint, {
        method: 'POST',
        body: form,
      });

      const rawText = await response.text();

      let payload: any = null;

      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error ||
            rawText ||
            `Não foi possível processar a planilha. Status HTTP: ${response.status}`
        );
      }

      setResultado(payload);
      setActiveTab('resumo');

      const firstMonth = payload?.mensal?.[0]?.mes;

      if (firstMonth) {
        setExpandedMonths({ [firstMonth]: true });
      }
    } catch (err: any) {
      console.error('❌ Recebimento Cartão - erro frontend:', err);

      setError(err?.message || 'Erro ao processar recebimentos de cartão.');
    } finally {
      setLoading(false);
    }
  }

  async function apagarResultadoSalvo() {
    if (!currentUser?.id) return;

    const confirmou = window.confirm('Deseja apagar o último resultado salvo de Recebimento Cartão?');

    if (!confirmou) return;

    setDeletingSaved(true);
    setError('');

    try {
      const response = await fetch(
        `${API_URL}/api/financeiro/recebimento-cartao/ultimo?userId=${encodeURIComponent(String(currentUser.id))}`,
        {
          method: 'DELETE',
        }
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Não foi possível apagar o resultado salvo.');
      }

      setResultado(null);
      setFile(null);
      setExpandedMonths({});
      setExpandedDays({});
      setQuery('');
      setStatusFilter('TODOS');
    } catch (err: any) {
      setError(err?.message || 'Erro ao apagar resultado salvo.');
    } finally {
      setDeletingSaved(false);
    }
  }

  function exportCsv() {
    if (!resultado?.diario?.length) return;

    const header = [
      'Data',
      'Mes',
      'Dia da semana',
      'Projetado',
      'Vlr extrato',
      'Diferenca',
      'Status',
      'Qtd prevista',
      'Qtd extrato',
      'Detalhes previsto',
      'Detalhes extrato',
    ];

    const lines = dailyRowsFilteredByFuture.map((row) =>
      [
        row.data,
        row.mes,
        row.diaSemana,
        row.projetado,
        row.vlrExtrato,
        row.diferenca,
        row.status,
        row.qtdPrevista,
        row.qtdExtrato,
        `"${String(row.detalhesPrevisto || '').replace(/"/g, '""')}"`,
        `"${String(row.detalhesExtrato || '').replace(/"/g, '""')}"`,
      ].join(';')
    );

    const blob = new Blob([[header.join(';'), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `recebimento-cartao-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  function toggleMonth(mes: string) {
    setExpandedMonths((prev) => ({ ...prev, [mes]: !prev[mes] }));
  }

  function toggleDay(data: string) {
    setExpandedDays((prev) => ({ ...prev, [data]: !prev[data] }));
  }

  if (!isAdminUser) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 text-red-700">
            <AlertTriangle />
            <h1 className="text-2xl font-black">Acesso restrito</h1>
          </div>
          <p className="mt-3 text-slate-600">
            O menu Recebimento Cartão está disponível apenas para usuários administrativos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
                <CreditCard size={14} />
                Controle Financeiro
              </div>
              <h1 className="mt-4 text-2xl font-black tracking-tight md:text-4xl">
                Recebimento Cartão
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-200 md:text-base">
                Dashboard de recebimentos Stone, projeção x extrato, persistência do último processamento e motor de cálculo em Python.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Motor de cálculo
              </div>
              <div className="mt-1 flex items-center gap-2 text-lg font-black">
                <Database size={18} />
                Python Stone
              </div>
              <div className="mt-1 text-xs text-slate-300">
                Regras D+1+30, crédito, débito, PIX e feriados.
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('resumo')}
              className={`rounded-2xl px-5 py-2 text-sm font-black transition ${
                activeTab === 'resumo'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Resumo
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('motor')}
              className={`rounded-2xl px-5 py-2 text-sm font-black transition ${
                activeTab === 'motor'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Motor de cálculo
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowFutureMonths((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              {showFutureMonths ? <EyeOff size={16} /> : <Eye size={16} />}
              {showFutureMonths ? 'Ocultar meses futuros' : 'Mostrar meses futuros'}
            </button>

            <button
              type="button"
              onClick={carregarUltimoResultado}
              disabled={loadingSaved}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loadingSaved ? 'animate-spin' : ''} />
              Atualizar
            </button>

            {hasSavedData && (
              <button
                type="button"
                onClick={apagarResultadoSalvo}
                disabled={deletingSaved}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                {deletingSaved ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Apagar salvo
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {activeTab === 'resumo' && (
          <section className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-500">
                    Projetado {showFutureMonths ? 'total' : 'até mês atual'}
                  </div>
                  <TrendingUp className="text-emerald-600" size={20} />
                </div>
                <div className="mt-3 text-2xl font-black text-slate-900">
                  {formatCurrency(resumoVisivel.totalProjetado)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-500">Recebido no extrato</div>
                  <CheckCircle2 className="text-blue-600" size={20} />
                </div>
                <div className="mt-3 text-2xl font-black text-slate-900">
                  {formatCurrency(resumoVisivel.totalExtrato)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-500">Diferença acumulada</div>
                  {resumoVisivel.diferencaTotal >= 0 ? (
                    <TrendingUp className="text-green-600" size={20} />
                  ) : (
                    <TrendingDown className="text-red-600" size={20} />
                  )}
                </div>
                <div className={`mt-3 text-2xl font-black ${differenceClass(resumoVisivel.diferencaTotal)}`}>
                  {formatCurrency(resumoVisivel.diferencaTotal)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-500">Último processamento</div>
                  <Clock3 className="text-slate-500" size={20} />
                </div>
                <div className="mt-3 text-sm font-black text-slate-900">
                  {resultado?.persistedAt || resultado?.generatedAt
                    ? formatDateTime(resultado?.persistedAt || resultado?.generatedAt)
                    : 'Nenhum processamento'}
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {resultado?.fileName || 'Importe uma base na aba Motor'}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <FileCheck2 size={16} />
                  Vendas processadas
                </div>
                <div className="mt-3 text-2xl font-black text-slate-900">
                  {formatNumber(resultado?.meta?.linhasValidasBase || resultado?.resumo?.qtdVendasProcessadas || 0)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <Activity size={16} />
                  Lançamentos extrato
                </div>
                <div className="mt-3 text-2xl font-black text-slate-900">
                  {formatNumber(resultado?.meta?.linhasValidasExtrato || resultado?.resumo?.qtdLancamentosExtrato || 0)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <ShieldCheck size={16} />
                  Dias OK
                </div>
                <div className="mt-3 text-2xl font-black text-emerald-700">
                  {formatNumber(resumoVisivel.diasOk)}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                  <AlertTriangle size={16} />
                  Dias divergentes
                </div>
                <div className="mt-3 text-2xl font-black text-amber-700">
                  {formatNumber(resumoVisivel.diasPgtMaior + resumoVisivel.diasPgtMenor)}
                </div>
              </div>
            </div>

            <ConsolidadoMensalResumo
              rows={monthlyRowsFilteredByFuture}
              resumoVisivel={resumoVisivel}
              showFutureMonths={showFutureMonths}
              hasSavedData={hasSavedData}
              exportCsv={exportCsv}
            />
          </section>
        )}

        {activeTab === 'motor' && (
          <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <UploadCloud />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900">Importar base Stone</h2>
                  <p className="text-sm text-slate-500">
                    Use a base original com abas BASE TRATADA e EXTRATO BANCARIO.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                Não envie o arquivo tratado/gerado pelo motor. Envie a planilha original da Stone.
              </div>

              <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
                <FileSpreadsheet className="mb-3 text-emerald-700" size={34} />
                <span className="text-sm font-black text-slate-800">
                  {file ? file.name : 'Clique para selecionar a planilha'}
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  O backend processa, salva e devolve o consolidado pronto.
                </span>
                <input
                  type="file"
                  accept=".xlsb,.xlsx,.xlsm"
                  className="hidden"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setError('');
                  }}
                />
              </label>

              {file && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setError('');
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  <X size={16} />
                  Limpar arquivo
                </button>
              )}

              <button
                type="button"
                disabled={loading || !file}
                onClick={handleProcessar}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <BarChart3 size={18} />}
                {loading ? 'Processando...' : 'Processar recebimentos'}
              </button>

              {resultado?.meta && (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="font-black text-slate-900">Arquivo processado</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <span>Aba base</span>
                    <strong className="text-right">{resultado.meta.baseSheetName || '-'}</strong>
                    <span>Aba extrato</span>
                    <strong className="text-right">{resultado.meta.extratoSheetName || '-'}</strong>
                    <span>Vendas válidas</span>
                    <strong className="text-right">{formatNumber(resultado.meta.linhasValidasBase || 0)}</strong>
                    <span>Extrato válido</span>
                    <strong className="text-right">{formatNumber(resultado.meta.linhasValidasExtrato || 0)}</strong>
                    <span>Descartadas</span>
                    <strong className="text-right">{formatNumber(resultado.meta.linhasDescartadas || 0)}</strong>
                  </div>
                </div>
              )}
            </section>

            <MotorConsolidado
              monthlyRowsFilteredByFuture={monthlyRowsFilteredByFuture}
              filteredRowsByMonth={filteredRowsByMonth}
              expandedMonths={expandedMonths}
              expandedDays={expandedDays}
              query={query}
              statusFilter={statusFilter}
              resumoVisivel={resumoVisivel}
              totalFiltrado={totalFiltrado}
              setQuery={setQuery}
              setStatusFilter={setStatusFilter}
              toggleMonth={toggleMonth}
              toggleDay={toggleDay}
            />
          </div>
        )}
      </div>
    </div>
  );
}

type ResumoTableProps = {
  rows: MonthlyRow[];
  resumoVisivel: {
    totalProjetado: number;
    totalExtrato: number;
    diferencaTotal: number;
  };
  showFutureMonths: boolean;
  hasSavedData: boolean;
  exportCsv: () => void;
};

function ConsolidadoMensalResumo({ rows, resumoVisivel, showFutureMonths, hasSavedData, exportCsv }: ResumoTableProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">Resumo mensal</h2>
          <p className="text-sm text-slate-500">
            Exibindo {showFutureMonths ? 'todos os meses processados' : 'somente até o mês atual'}.
          </p>
        </div>

        {hasSavedData && (
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
          >
            <Download size={16} />
            Exportar CSV
          </button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-300">
        <div className="bg-blue-900 px-4 py-2 text-center text-sm font-black uppercase tracking-wide text-white">
          Consolidado por mês
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-200 text-slate-900">
                <th className="px-3 py-3 text-left font-black">DIA/MÊS</th>
                <th className="px-3 py-3 text-right font-black">PROJETADO</th>
                <th className="px-3 py-3 text-right font-black">VLR EXTRATO</th>
                <th className="px-3 py-3 text-right font-black">DIFERENÇA</th>
                <th className="px-3 py-3 text-left font-black">STATUS</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                    Nenhum processamento salvo ainda. Acesse a aba Motor de cálculo e importe a base original da Stone.
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((row) => (
                    <tr key={row.mes} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-3 py-3 font-black text-slate-900">{row.mes}</td>
                      <td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.projetado)}</td>
                      <td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.vlrExtrato)}</td>
                      <td className={`px-3 py-3 text-right font-black ${differenceClass(row.diferenca)}`}>
                        {formatCurrency(row.diferenca)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusBadge(row.status)}`}>
                          {row.status || '-'}
                        </span>
                      </td>
                    </tr>
                  ))}

                  <tr className="border-t border-slate-300 bg-slate-100 font-black">
                    <td className="px-3 py-3">TOTAL</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(resumoVisivel.totalProjetado)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(resumoVisivel.totalExtrato)}</td>
                    <td className={`px-3 py-3 text-right ${differenceClass(resumoVisivel.diferencaTotal)}`}>
                      {formatCurrency(resumoVisivel.diferencaTotal)}
                    </td>
                    <td className="px-3 py-3">-</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type MotorProps = {
  monthlyRowsFilteredByFuture: MonthlyRow[];
  filteredRowsByMonth: Record<string, DailyRow[]>;
  expandedMonths: Record<string, boolean>;
  expandedDays: Record<string, boolean>;
  query: string;
  statusFilter: 'TODOS' | 'OK' | 'PGT MAIOR' | 'PGT MENOR';
  resumoVisivel: {
    totalProjetado: number;
    totalExtrato: number;
    diferencaTotal: number;
  };
  totalFiltrado: {
    projetado: number;
    extrato: number;
    diferenca: number;
  };
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setStatusFilter: React.Dispatch<React.SetStateAction<'TODOS' | 'OK' | 'PGT MAIOR' | 'PGT MENOR'>>;
  toggleMonth: (mes: string) => void;
  toggleDay: (data: string) => void;
};

function MotorConsolidado({
  monthlyRowsFilteredByFuture,
  filteredRowsByMonth,
  expandedMonths,
  expandedDays,
  query,
  statusFilter,
  resumoVisivel,
  totalFiltrado,
  setQuery,
  setStatusFilter,
  toggleMonth,
  toggleDay,
}: MotorProps) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-500">Total projetado</div>
            <TrendingUp className="text-emerald-600" size={20} />
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900">
            {formatCurrency(resumoVisivel.totalProjetado)}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-500">Vlr extrato</div>
            <CheckCircle2 className="text-blue-600" size={20} />
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900">
            {formatCurrency(resumoVisivel.totalExtrato)}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-500">Diferença</div>
            {resumoVisivel.diferencaTotal >= 0 ? (
              <TrendingUp className="text-green-600" size={20} />
            ) : (
              <TrendingDown className="text-red-600" size={20} />
            )}
          </div>
          <div className={`mt-3 text-2xl font-black ${differenceClass(resumoVisivel.diferencaTotal)}`}>
            {formatCurrency(resumoVisivel.diferencaTotal)}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Consolidado por mês</h2>
            <p className="text-sm text-slate-500">
              Drilldown por data e detalhes dos lançamentos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por data/status/detalhe..."
                className="w-full rounded-2xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 md:w-72"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as any)}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            >
              <option value="TODOS">Todos</option>
              <option value="OK">OK</option>
              <option value="PGT MAIOR">PGT MAIOR</option>
              <option value="PGT MENOR">PGT MENOR</option>
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-300">
          <div className="bg-blue-900 px-4 py-2 text-center text-sm font-black uppercase tracking-wide text-white">
            Consolidado por mês
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-200 text-slate-900">
                  <th className="px-3 py-3 text-left font-black">DIA/MÊS</th>
                  <th className="px-3 py-3 text-right font-black">PROJETADO</th>
                  <th className="px-3 py-3 text-right font-black">VLR EXTRATO</th>
                  <th className="px-3 py-3 text-right font-black">DIFERENÇA</th>
                  <th className="px-3 py-3 text-left font-black">STATUS</th>
                </tr>
              </thead>

              <tbody>
                {monthlyRowsFilteredByFuture.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                      Importe a planilha para visualizar o consolidado.
                    </td>
                  </tr>
                ) : (
                  <>
                    {monthlyRowsFilteredByFuture.map((row) => {
                      const rowsForMonth = filteredRowsByMonth[row.mes] || [];

                      return (
                        <React.Fragment key={row.mes}>
                          <tr
                            className="cursor-pointer border-t border-slate-200 hover:bg-slate-50"
                            onClick={() => toggleMonth(row.mes)}
                          >
                            <td className="px-3 py-3 font-black text-slate-900">
                              <span className="inline-flex items-center gap-2">
                                {expandedMonths[row.mes] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                {row.mes}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.projetado)}</td>
                            <td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.vlrExtrato)}</td>
                            <td className={`px-3 py-3 text-right font-black ${differenceClass(row.diferenca)}`}>
                              {formatCurrency(row.diferenca)}
                            </td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusBadge(row.status)}`}>
                                {row.status || '-'}
                              </span>
                            </td>
                          </tr>

                          {expandedMonths[row.mes] && (
                            <tr className="border-t border-slate-200 bg-slate-50">
                              <td colSpan={5} className="p-0">
                                <div className="p-3">
                                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                    <table className="min-w-full text-xs">
                                      <thead>
                                        <tr className="bg-slate-100 text-slate-700">
                                          <th className="px-3 py-2 text-left font-black">Data</th>
                                          <th className="px-3 py-2 text-left font-black">Dia</th>
                                          <th className="px-3 py-2 text-right font-black">Projetado</th>
                                          <th className="px-3 py-2 text-right font-black">Extrato</th>
                                          <th className="px-3 py-2 text-right font-black">Diferença</th>
                                          <th className="px-3 py-2 text-left font-black">Status</th>
                                        </tr>
                                      </thead>

                                      <tbody>
                                        {rowsForMonth.length === 0 ? (
                                          <tr>
                                            <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                                              Nenhum dia encontrado para os filtros atuais.
                                            </td>
                                          </tr>
                                        ) : (
                                          rowsForMonth.map((day) => {
                                            const isExpanded = Boolean(expandedDays[day.data]);

                                            return (
                                              <React.Fragment key={day.data}>
                                                <tr
                                                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                                                  onClick={() => toggleDay(day.data)}
                                                >
                                                  <td className="px-3 py-2 font-black text-slate-800">
                                                    <span className="inline-flex items-center gap-2">
                                                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                      {formatDate(day.data)}
                                                    </span>
                                                  </td>
                                                  <td className="px-3 py-2 text-slate-600">{day.diaSemana}</td>
                                                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(day.projetado)}</td>
                                                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(day.vlrExtrato)}</td>
                                                  <td className={`px-3 py-2 text-right font-black ${differenceClass(day.diferenca)}`}>
                                                    {formatCurrency(day.diferenca)}
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusBadge(day.status)}`}>
                                                      {day.status || '-'}
                                                    </span>
                                                  </td>
                                                </tr>

                                                {isExpanded && (
                                                  <tr className="border-t border-slate-100 bg-white">
                                                    <td colSpan={6} className="px-3 py-3">
                                                      <div className="grid gap-3 md:grid-cols-2">
                                                        <DetalhesBox
                                                          title={`Detalhes previsto (${day.qtdPrevista})`}
                                                          icon={<CalendarDays size={14} />}
                                                          color="emerald"
                                                          details={day.detalhesPrevisto}
                                                          emptyText="Sem detalhes previstos."
                                                        />

                                                        <DetalhesBox
                                                          title={`Detalhes extrato (${day.qtdExtrato})`}
                                                          icon={<Database size={14} />}
                                                          color="blue"
                                                          details={day.detalhesExtrato}
                                                          emptyText="Sem detalhes no extrato."
                                                        />
                                                      </div>
                                                    </td>
                                                  </tr>
                                                )}
                                              </React.Fragment>
                                            );
                                          })
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    <tr className="border-t border-slate-300 bg-slate-100 font-black">
                      <td className="px-3 py-3">TOTAL FILTRADO</td>
                      <td className="px-3 py-3 text-right">{formatCurrency(totalFiltrado.projetado)}</td>
                      <td className="px-3 py-3 text-right">{formatCurrency(totalFiltrado.extrato)}</td>
                      <td className={`px-3 py-3 text-right ${differenceClass(totalFiltrado.diferenca)}`}>
                        {formatCurrency(totalFiltrado.diferenca)}
                      </td>
                      <td className="px-3 py-3">-</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

type DetalhesBoxProps = {
  title: string;
  icon: React.ReactNode;
  color: 'emerald' | 'blue';
  details: string;
  emptyText: string;
};

function DetalhesBox({ title, icon, color, details, emptyText }: DetalhesBoxProps) {
  const items = splitDetails(details);
  const colorClasses =
    color === 'emerald'
      ? 'border-emerald-100 bg-emerald-50/40 text-emerald-800'
      : 'border-blue-100 bg-blue-50/40 text-blue-800';

  return (
    <div className={`rounded-2xl border p-3 ${colorClasses}`}>
      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide">
        {icon}
        {title}
      </div>

      <div className="max-h-52 space-y-1 overflow-y-auto text-xs text-slate-700">
        {items.length === 0 ? (
          <div className="text-slate-400">{emptyText}</div>
        ) : (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded-xl bg-white px-3 py-2">
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
