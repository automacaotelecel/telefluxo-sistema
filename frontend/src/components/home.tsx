import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Download,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Crown,
  Gauge,
  MapPin,
  Package,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import ExecutiveReportButton from './ExecutiveReportButton';
import KpiDrilldownDrawer from './KpiDrilldownDrawer';
import StoreDetailDrawer from './StoreDetailDrawer';
import {
  CLASSIFICACAO_LOJAS_STORAGE_KEY,
  lerClassificacaoPersonalizada,
  lojaEhLiquida,
  normalizarLojaLiquida,
  type StatusLojaLiquida,
} from '../utils/lojasLiquidas';

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
  period?: {
    startDate: string;
    endDate: string;
    monthStart?: string;
    monthEnd?: string;
    label: string;
    isCurrentMonth?: boolean;
    isHistorical?: boolean;
    isFullMonth?: boolean;
    daysSelected?: number;
    daysInMonth?: number;
  };
  kpis?: {
    faturamentoMes?: number;
    faturamentoAnterior?: number;
    faturamentoAnteriorMesCompleto?: number;
    referenciaAnoAnterior?: string;
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
    vendasDia?: number;
  };
  trend?: Array<{ date: string; faturamento: number; quantidade: number }>;
  stores?: Array<{
    loja: string;
    faturamento: number;
    quantidade: number;
    conversaoAcessorios: number;
    conversaoPeliculas: number;
    seguroPct: number;
    seguros?: number;
    qtdSeguros?: number;
    qtdAparelhosSeguro?: number;
    vendedores: number;
    regiao?: string;
  }>;
  operations?: {
    mediaDiaria?: number;
    quantidade?: number;
    lojasAtivas?: number;
    vendedoresAtivos?: number;
    topLoja?: { loja: string; faturamento: number } | null;
    categorias?: Array<{
      categoria: string;
      faturamento: number;
      quantidade: number;
      participacao: number;
    }>;
    regioes?: Array<{
      regiao: string;
      faturamento: number;
      quantidade: number;
      participacao: number;
    }>;
    source?: string;
    insuranceScope?: 'month_to_date' | 'selected_period';
  };
  clarkBriefing?: string | null;
};

type Props = {
  currentUser: any;
  onNavigate?: (view: string) => void;
};

type AnnualStoreRow = {
  ano: number;
  mes: number;
  loja: string;
  cnpj_empresa?: string;
  venda_total: number;
};

type LiquidSources = {
  previousStores: NonNullable<DashboardData['stores']>;
  annualRows: AnnualStoreRow[];
  monthToDateStores: NonNullable<DashboardData['stores']> | null;
  previousAvailable: boolean;
  annualAvailable: boolean;
  error: string;
};

const EMPTY_LIQUID_SOURCES: LiquidSources = {
  previousStores: [], annualRows: [], monthToDateStores: null,
  previousAvailable: false, annualAvailable: false, error: '',
};

function comparablePreviousDate(date: string): string {
  const year = Number(date.slice(0, 4)) - 1;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function changePercent(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function validNumber(value: unknown): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function sumRevenue(items: Array<{ faturamento: number }>): number {
  return items.reduce((sum, store) => sum + validNumber(store.faturamento), 0);
}



type PeriodRequest = {
  startDate: string;
  endDate: string;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const REGION_COLORS = ['#0f172a', '#f97316', '#2563eb', '#10b981', '#8b5cf6', '#eab308'];

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentPeriod(): PeriodRequest {
  const today = localIsoDate();
  return {
    startDate: `${today.slice(0, 7)}-01`,
    endDate: today,
  };
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function money(value: any) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function moneyCompact(value: any) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';

  if (amount >= 1_000_000) {
    const compact = amount / 1_000_000;
    return `R$ ${compact.toLocaleString('pt-BR', {
      minimumFractionDigits: compact >= 10 ? 0 : 1,
      maximumFractionDigits: 1,
    })} MM`;
  }

  if (amount >= 1_000) {
    return `R$ ${Math.round(amount / 1_000).toLocaleString('pt-BR')}k`;
  }

  return `R$ ${Math.round(amount).toLocaleString('pt-BR')}`;
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

function formatCategory(value: string) {
  const text = String(value || 'OUTROS')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return text.length > 23 ? `${text.slice(0, 22)}…` : text;
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  change,
  onClick,
  secondary,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
  change?: number | null;
  onClick?: () => void;
  secondary?: { label: string; value: string; change?: number | null; detail?: string };
}) {
  const positive = Number(change || 0) >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 rounded-[18px] border border-slate-200/80 bg-white p-3 text-left shadow-[0_10px_28px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_14px_34px_rgba(15,23,42,0.07)] sm:rounded-[22px] sm:p-4"
    >
      <div className="mb-2.5 flex items-start justify-between gap-2 sm:mb-3.5 sm:gap-2.5">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400 sm:text-[10px] sm:tracking-[0.16em]">{title}</p>
          <p className="mt-1.5 break-words text-[17px] font-black leading-tight tracking-tight text-slate-900 sm:text-[23px]">{value}</p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white transition group-hover:bg-orange-600 sm:h-9 sm:w-9 sm:rounded-xl">
          <Icon size={18} />
        </div>
      </div>

      <div className="flex min-h-5 items-center justify-between gap-2">
        <p className="line-clamp-2 text-[9px] font-semibold leading-snug text-slate-400 sm:text-[11px]">{subtitle}</p>
        {typeof change === 'number' && Number.isFinite(change) && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black ${
              positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
            }`}
          >
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(change).toFixed(1).replace('.', ',')}%
          </span>
        )}
      </div>
      {secondary && (
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="min-w-0">
              <span className="block text-[9px] font-extrabold uppercase tracking-wide text-slate-500">{secondary.label}</span>
              <span className="block text-[13px] font-black tabular-nums text-slate-900 sm:text-[15px]">{secondary.value}</span>
            </div>
            {typeof secondary.change === 'number' && Number.isFinite(secondary.change) && (
              <span className={`rounded-lg px-2 py-1 text-[10px] font-black tabular-nums ${secondary.change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {secondary.change >= 0 ? '+' : ''}{number(secondary.change, 1)}%
              </span>
            )}
          </div>
          {secondary.detail && <p className="mt-1 text-[9px] font-semibold leading-tight text-slate-400">{secondary.detail}</p>}
        </div>
      )}
    </button>
  );
}

function ConversionCard({
  acessorios,
  peliculas,
  seguro,
  segurosValor,
  loading,
  onSelectMetric,
  insuranceScope,
}: {
  acessorios: number;
  peliculas: number;
  seguro: number;
  segurosValor: number;
  loading: boolean;
  onSelectMetric: (metric: MetricKey) => void;
  insuranceScope?: 'month_to_date' | 'selected_period';
}) {
  const items: Array<{
    id: string;
    key?: MetricKey;
    label: string;
    value: number;
    icon: any;
    format: 'percent' | 'money';
  }> = [
    {
      id: 'acessorios',
      key: 'conversaoAcessorios',
      label: 'Acessórios',
      value: acessorios,
      icon: ShoppingBag,
      format: 'percent',
    },
    {
      id: 'peliculas',
      key: 'conversaoPeliculas',
      label: 'Películas',
      value: peliculas,
      icon: PackageCheck,
      format: 'percent',
    },
    {
      id: 'seguro-pct',
      key: 'seguroPct',
      label: 'Seguro %',
      value: seguro,
      icon: ShieldCheck,
      format: 'percent',
    },
    {
      id: 'seguro-valor',
      label: 'R$ Seguros',
      value: segurosValor,
      icon: CircleDollarSign,
      format: 'money',
    },
  ];

  return (
    <div className="min-w-0 rounded-[18px] border border-slate-200/80 bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] sm:rounded-[22px] sm:p-4">
      <div className="mb-2.5 flex items-start justify-between gap-2 sm:mb-3 sm:gap-2.5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Conversões</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">
            Acessórios, películas e seguro
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white sm:h-9 sm:w-9">
          <BarChart3 size={18} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {items.map(({ id, key, label, value, icon: Icon, format }) => (
          <button
            key={id}
            type="button"
            onClick={() => key && onSelectMetric(key)}
            disabled={!key}
            className={`rounded-xl bg-slate-50 px-2.5 py-2.5 text-left transition ${
              key ? 'hover:bg-orange-50' : 'cursor-default'
            }`}
          >
            <div className="flex items-center gap-1.5 text-slate-400">
              <Icon size={12} />
              <span className="truncate text-[8px] font-black uppercase tracking-wide">{label}</span>
            </div>
            <p className="mt-1.5 break-words text-[12px] font-black leading-tight tracking-tight text-slate-950 sm:text-[15px]">
              {loading
                ? '—'
                : format === 'money'
                  ? money(value)
                  : `${number(value, 1)}%`}
            </p>
          </button>
        ))}
      </div>

      {insuranceScope === 'month_to_date' && (
        <p className="mt-2 text-[9px] font-semibold text-slate-400">
          Seguro permanece no acumulado do mês quando o intervalo atual é personalizado.
        </p>
      )}
    </div>
  );
}

function InsuranceRankingCard({
  stores,
  loading,
  periodLabel,
}: {
  stores: NonNullable<DashboardData['stores']>;
  loading: boolean;
  periodLabel?: string;
}) {
  const [mode, setMode] = useState<'conversion' | 'revenue'>('conversion');

  const normalizedStores = useMemo(
    () =>
      [...stores].map((store) => ({
        ...store,
        seguros: Math.max(0, Number(store.seguros || 0)),
        qtdSeguros: Math.max(0, Number(store.qtdSeguros || 0)),
        qtdAparelhosSeguro: Math.max(0, Number(store.qtdAparelhosSeguro || 0)),
        seguroPct: Math.max(0, Number(store.seguroPct || 0)),
      })),
    [stores],
  );

  const sortRanking = useCallback(
    (rankingMode: 'conversion' | 'revenue') =>
      [...normalizedStores].sort((a, b) => {
        if (rankingMode === 'revenue') {
          return b.seguros - a.seguros || b.seguroPct - a.seguroPct;
        }
        return b.seguroPct - a.seguroPct || b.seguros - a.seguros;
      }),
    [normalizedStores],
  );

  const ranking = useMemo(() => sortRanking(mode), [mode, sortRanking]);

  const totals = useMemo(() => {
    return normalizedStores.reduce(
      (acc, store) => {
        acc.qtdSeguros += store.qtdSeguros;
        acc.valor += store.seguros;
        acc.produtos += store.qtdAparelhosSeguro;
        return acc;
      },
      { qtdSeguros: 0, valor: 0, produtos: 0 },
    );
  }, [normalizedStores]);

  const totalConversion =
    totals.produtos > 0 ? (totals.qtdSeguros / totals.produtos) * 100 : 0;

  const exportInsuranceExcel = useCallback(() => {
    const workbook = XLSX.utils.book_new();

    const createSheet = (rankingMode: 'conversion' | 'revenue') => {
      const items = sortRanking(rankingMode);
      const rows: Array<Array<string | number>> = [
        ['Posição', 'Loja', 'Qtd. Seguro', 'Valor Venda Seguro', 'Qtd produtos', 'Conversão'],
        ...items.map((store, index) => [
          index + 1,
          store.loja,
          store.qtdSeguros,
          store.seguros,
          store.qtdAparelhosSeguro,
          store.seguroPct / 100,
        ]),
        ['TOTAL GERAL', '', totals.qtdSeguros, totals.valor, totals.produtos, totalConversion / 100],
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 10 },
        { wch: 30 },
        { wch: 14 },
        { wch: 20 },
        { wch: 14 },
        { wch: 12 },
      ];

      const lastRow = rows.length;
      for (let row = 2; row <= lastRow; row += 1) {
        const moneyCell = worksheet[`D${row}`];
        const percentCell = worksheet[`F${row}`];
        if (moneyCell) moneyCell.z = 'R$ #,##0.00';
        if (percentCell) percentCell.z = '0%';
      }

      return worksheet;
    };

    XLSX.utils.book_append_sheet(workbook, createSheet('conversion'), 'Conversão');
    XLSX.utils.book_append_sheet(workbook, createSheet('revenue'), 'Faturamento');

    const filePeriod = String(periodLabel || localIsoDate())
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    XLSX.writeFile(workbook, `ranking-seguros-${filePeriod || localIsoDate()}.xlsx`);
  }, [periodLabel, sortRanking, totalConversion, totals]);

  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-white p-2.5 shadow-sm sm:rounded-[22px] sm:p-3.5">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-orange-600">
            Samsung Care+
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <h2 className="text-[16px] font-black leading-tight text-slate-950 sm:text-lg">
              Ranking de seguros
            </h2>
            <button
              type="button"
              onClick={exportInsuranceExcel}
              disabled={loading || normalizedStores.length === 0}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[7px] font-black uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-orange-200 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:px-2.5 sm:text-[8px]"
              title="Gerar Excel do ranking de seguros"
            >
              <Download size={11} />
              Excel
            </button>
          </div>
          <p className="mt-0.5 text-[7px] font-bold uppercase tracking-wide text-slate-400 sm:text-[8px]">
            Meta mín. R$ 20.000,00{periodLabel ? ` • ${periodLabel}` : ''}
          </p>
        </div>
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-orange-500" />
      </div>

      <div className="mb-2 grid grid-cols-2 rounded-[10px] bg-slate-100 p-0.5">
        <button
          type="button"
          onClick={() => setMode('conversion')}
          className={`rounded-[8px] px-2 py-1.5 text-[7px] font-black uppercase tracking-wide transition sm:text-[8px] ${
            mode === 'conversion'
              ? 'bg-white text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          Conversão
        </button>
        <button
          type="button"
          onClick={() => setMode('revenue')}
          className={`rounded-[8px] px-2 py-1.5 text-[7px] font-black uppercase tracking-wide transition sm:text-[8px] ${
            mode === 'revenue'
              ? 'bg-white text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          Faturamento
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100 md:hidden">
        {loading ? (
          <div className="bg-slate-50 px-3 py-5 text-center text-[9px] font-bold text-slate-400">
            Carregando ranking...
          </div>
        ) : ranking.length ? (
          <>
            <div className="divide-y divide-slate-100">
              {ranking.map((store, index) => (
                <div key={store.loja} className="bg-white px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[6px] font-black text-slate-500">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[9px] font-black leading-tight text-slate-900" title={store.loja}>
                      {store.loja}
                    </p>
                    <span
                      className={`inline-flex min-w-[38px] shrink-0 justify-center rounded-full px-1.5 py-0.5 text-[8px] font-black ${
                        mode === 'conversion'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {number(store.seguroPct, 0)}%
                    </span>
                  </div>

                  <div className="mt-1 flex min-w-0 items-center gap-x-2.5 pl-[26px] text-[7px] font-bold leading-none text-slate-500">
                    <span className="whitespace-nowrap">
                      <strong className="text-slate-800">{number(store.qtdSeguros)}</strong> seguros
                    </span>
                    <span className="whitespace-nowrap">
                      <strong className="text-slate-800">{number(store.qtdAparelhosSeguro)}</strong> produtos
                    </span>
                    <span className="ml-auto truncate whitespace-nowrap font-black text-slate-900">
                      {money(store.seguros)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-slate-950 px-2 py-2 text-white">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[7px] font-black uppercase tracking-wide">Total geral</span>
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-black">
                  {number(totalConversion, 0)}%
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[7px] font-bold text-slate-300">
                <span><strong className="text-white">{number(totals.qtdSeguros)}</strong> seguros</span>
                <span><strong className="text-white">{number(totals.produtos)}</strong> produtos</span>
                <span className="ml-auto font-black text-white">{money(totals.valor)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-slate-50 px-3 py-5 text-center text-[9px] font-bold text-slate-400">
            Sem dados de seguros para o período.
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-slate-100 md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <thead className="bg-slate-50">
            <tr className="text-[7px] font-black uppercase tracking-[0.08em] text-slate-500 lg:text-[8px]">
              <th className="w-[34%] px-2 py-1.5">Loja</th>
              <th className="w-[12%] px-1 py-1.5 text-right">Qtd. Seguro</th>
              <th className="w-[20%] px-1 py-1.5 text-right">Valor Seguro</th>
              <th className="w-[14%] px-1 py-1.5 text-right">Qtd produtos</th>
              <th className="w-[20%] px-2 py-1.5 text-right">Conversão</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-center text-[9px] font-bold text-slate-400">
                  Carregando ranking...
                </td>
              </tr>
            ) : ranking.length ? (
              ranking.map((store, index) => (
                <tr
                  key={store.loja}
                  className="border-t border-slate-100 text-[9px] font-bold text-slate-600 hover:bg-orange-50/50 lg:text-[10px]"
                >
                  <td className="px-2 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[7px] font-black text-slate-500">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate font-black text-slate-900" title={store.loja}>
                        {store.loja}
                      </span>
                    </div>
                  </td>
                  <td className="px-1 py-2 text-right">{number(store.qtdSeguros)}</td>
                  <td className="px-1 py-2 text-right font-black text-slate-900">
                    {money(store.seguros)}
                  </td>
                  <td className="px-1 py-2 text-right">{number(store.qtdAparelhosSeguro)}</td>
                  <td className="px-2 py-2 text-right">
                    <span
                      className={`inline-flex min-w-[44px] justify-center rounded-full px-1.5 py-0.5 font-black ${
                        mode === 'conversion'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {number(store.seguroPct, 0)}%
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-center text-[9px] font-bold text-slate-400">
                  Sem dados de seguros para o período.
                </td>
              </tr>
            )}
          </tbody>
          {ranking.length > 0 && (
            <tfoot className="bg-slate-950 text-white">
              <tr className="text-[9px] font-black">
                <td className="px-2 py-1.5 uppercase">Total Geral</td>
                <td className="px-1 py-1.5 text-right">{number(totals.qtdSeguros)}</td>
                <td className="px-1 py-1.5 text-right">{money(totals.valor)}</td>
                <td className="px-1 py-1.5 text-right">{number(totals.produtos)}</td>
                <td className="px-2 py-1.5 text-right">{number(totalConversion, 0)}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function OperationalPanel({
  operations,
  kpis,
  loading,
  storeMode,
}: {
  operations?: DashboardData['operations'];
  kpis: DashboardData['kpis'];
  loading: boolean;
  storeMode: boolean;
}) {
  const categories = operations?.categorias || [];
  const regions = operations?.regioes || [];
  const maxCategory = Math.max(1, ...categories.map((item) => Number(item.faturamento || 0)));

  const regionChartData = useMemo(() => {
    return regions
      .map((item) => ({
        name: String(item.regiao || 'SEM REGIÃO'),
        value: Math.max(0, Number(item.faturamento || 0)),
      }))
      .filter((item) => item.value > 0 && item.name !== 'SEM REGIÃO')
      .sort((a, b) => b.value - a.value);
  }, [regions]);

  const regionTotal = regionChartData.reduce((sum, item) => sum + item.value, 0);
  const singleRegion = regionChartData.length === 1 ? regionChartData[0] : null;

  const mini = [
    {
      label: 'Peças vendidas',
      value: loading ? '—' : number(operations?.quantidade || kpis?.pecasMes || 0),
      icon: Package,
    },
    {
      label: 'Ticket médio',
      value: loading ? '—' : money(kpis?.ticketMedio || 0),
      icon: Gauge,
    },
    {
      label: 'Média por dia',
      value: loading ? '—' : money(operations?.mediaDiaria || 0),
      icon: Activity,
    },
    {
      label: storeMode ? 'Vendedores ativos' : 'Lojas ativas',
      value: loading
        ? '—'
        : number(storeMode ? operations?.vendedoresAtivos || 0 : operations?.lojasAtivas || 0),
      icon: storeMode ? UserRound : Store,
    },
  ];

  const cardClass =
    'min-w-0 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] sm:rounded-[28px] sm:p-5';

  return (
    <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-orange-600 sm:text-[10px] sm:tracking-[0.18em]">
              Visão operacional
            </p>
            <h2 className="mt-1 text-lg font-black leading-tight tracking-tight text-slate-950 sm:text-xl">
              Indicadores de Vendas
            </h2>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white sm:h-10 sm:w-10 sm:rounded-2xl">
            <BarChart3 size={17} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-2.5">
          {mini.map(({ label, value, icon: Icon }) => (
            <div key={label} className="min-w-0 rounded-2xl bg-slate-50 p-3 sm:p-3.5">
              <div className="flex min-w-0 items-center gap-1.5 text-slate-400">
                <Icon size={12} className="shrink-0" />
                <span className="truncate text-[7px] font-black uppercase tracking-[0.1em] sm:text-[8px] sm:tracking-[0.12em]">
                  {label}
                </span>
              </div>
              <p className="mt-2 truncate text-[13px] font-black tracking-tight text-slate-950 sm:text-[15px]">
                {value}
              </p>
            </div>
          ))}
        </div>

        {!storeMode && operations?.topLoja && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 sm:px-3.5">
            <div className="min-w-0">
              <p className="text-[7px] font-black uppercase tracking-[0.12em] text-emerald-700 sm:text-[8px] sm:tracking-[0.14em]">
                Destaque do período
              </p>
              <p className="mt-1 truncate text-[10px] font-black text-slate-900 sm:text-[11px]">
                {operations.topLoja.loja}
              </p>
            </div>
            <p className="shrink-0 text-[10px] font-black text-emerald-800 sm:text-[11px]">
              {money(operations.topLoja.faturamento)}
            </p>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400 sm:text-[10px] sm:tracking-[0.18em]">
              Categorias
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
              Faturamento por categoria
            </h2>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 sm:h-10 sm:w-10 sm:rounded-2xl">
            <ShoppingBag size={17} />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {categories.length ? (
            categories.slice(0, 6).map((item) => (
              <div key={item.categoria}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="truncate text-[10px] font-bold text-slate-600 sm:text-[11px]">
                    {formatCategory(item.categoria)}
                  </span>
                  <span className="shrink-0 text-[10px] font-black text-slate-900 sm:text-[11px]">
                    {money(item.faturamento)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-orange-500"
                    style={{ width: `${Math.max(4, (Number(item.faturamento || 0) / maxCategory) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-slate-50 p-4 text-[11px] font-bold text-slate-400 sm:text-xs">
              Sem categorias no período.
            </p>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-slate-400">
              <MapPin size={13} />
              <span className="text-[9px] font-black uppercase tracking-[0.16em] sm:text-[10px] sm:tracking-[0.18em]">
                Participação regional
              </span>
            </div>
            <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
              Faturamento por região
            </h2>
          </div>
        </div>

        <div className="mt-4">
          {!regionChartData.length ? (
            <p className="rounded-2xl bg-slate-50 p-4 text-[11px] font-bold text-slate-400 sm:text-xs">
              Sem regiões no período.
            </p>
          ) : singleRegion ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-4">
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">Região da loja</p>
                <p className="mt-1 truncate text-sm font-black text-slate-900">{singleRegion.name}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-black text-slate-950">100%</p>
                <p className="text-[9px] font-bold text-slate-400">{money(singleRegion.value)}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[130px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[130px_minmax(0,1fr)]">
              <div className="mx-auto h-[140px] w-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={regionChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={62}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {regionChartData.map((item, index) => (
                        <Cell
                          key={`${item.name}-${index}`}
                          fill={REGION_COLORS[index % REGION_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => [money(value), 'Faturamento']}
                      contentStyle={{
                        borderRadius: 14,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 12px 32px rgba(15,23,42,.12)',
                        fontSize: 11,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-1">
                {regionChartData.map((item, index) => {
                  const participation = regionTotal > 0 ? (item.value / regionTotal) * 100 : 0;

                  return (
                    <div
                      key={item.name}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: REGION_COLORS[index % REGION_COLORS.length] }}
                        />
                        <span className="truncate text-[9px] font-black text-slate-600 sm:text-[10px]">
                          {item.name}
                        </span>
                      </div>
                      <span className="shrink-0 text-[9px] font-black text-slate-950 sm:text-[10px]">
                        {number(participation, 1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home({ currentUser }: Props) {
  const initialPeriod = useMemo(() => currentPeriod(), []);
  const today = useMemo(() => localIsoDate(), []);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [storeView, setStoreView] = useState<any | null>(null);
  const [storeViewLoading, setStoreViewLoading] = useState(false);
  const [storeViewError, setStoreViewError] = useState('');
  const [liquidOnly, setLiquidOnly] = useState(false);
  const [storeClassification, setStoreClassification] = useState<Record<string, StatusLojaLiquida>>(
    () => lerClassificacaoPersonalizada(),
  );
  const [liquidSources, setLiquidSources] = useState<LiquidSources>(EMPTY_LIQUID_SOURCES);
  const [liquidLoading, setLiquidLoading] = useState(true);


  const [periodRequest, setPeriodRequest] = useState<PeriodRequest>(initialPeriod);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(Number(initialPeriod.startDate.slice(0, 4)));
  const [draftMonth, setDraftMonth] = useState(Number(initialPeriod.startDate.slice(5, 7)));
  const [draftStart, setDraftStart] = useState(initialPeriod.startDate);
  const [draftEnd, setDraftEnd] = useState(initialPeriod.endDate);

  useEffect(() => {
    const reload = () => setStoreClassification(lerClassificacaoPersonalizada());
    const onStorage = (event: StorageEvent) => {
      if (event.key === CLASSIFICACAO_LOJAS_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reload);
    };
  }, []);

  const isNetworkView = dashboard?.scope?.type === 'network';
  const hasMultiStoreScope =
    !isNetworkView && (dashboard?.scope?.stores?.length || 0) > 1;
  const isMultiStoreView = isNetworkView || hasMultiStoreScope;
  const firstName = String(currentUser?.name || 'Usuário').split(' ')[0];

  const buildPeriodQuery = useCallback(() => {
    return `startDate=${encodeURIComponent(periodRequest.startDate)}&endDate=${encodeURIComponent(
      periodRequest.endDate,
    )}`;
  }, [periodRequest.endDate, periodRequest.startDate]);

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
      const response = await fetch(
        `${API_URL}/api/home/resumo?userId=${encodeURIComponent(userId)}&${buildPeriodQuery()}`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar o painel.');
      setDashboard(data);
    } catch (error: any) {
      console.error('Erro ao carregar Home:', error);
      setDashboardError(error?.message || 'Erro ao carregar os indicadores.');
    } finally {
      setDashboardLoading(false);
    }
  }, [buildPeriodQuery, currentUser?.id]);

  // Os dados por loja do ano anterior são requisitados separadamente para
  // calcular variação líquida sobre a MESMA seleção de lojas (OK em ambos os anos).
  // Os agregados anuais já são calculados e autorizados pelo backend.
  useEffect(() => {
    const userId = String(currentUser?.id || '').trim();
    if (!userId) return;
    const controller = new AbortController();
    let alive = true;
    const yearB = Number(periodRequest.startDate.slice(0, 4));
    const yearA = yearB - 1;
    const queryPrevious = `startDate=${comparablePreviousDate(periodRequest.startDate)}&endDate=${comparablePreviousDate(periodRequest.endDate)}`;
    const selectedMonthStart = `${periodRequest.startDate.slice(0, 7)}-01`;
    const monthToDateNeeded = periodRequest.startDate !== selectedMonthStart;
    const urlHome = (query: string) => `${API_URL}/api/home/resumo?userId=${encodeURIComponent(userId)}&${query}`;

    const fetchSources = async () => {
      setLiquidLoading(true);
      try {
        const [previous, annual, monthToDate] = await Promise.allSettled([
          fetch(urlHome(queryPrevious), { signal: controller.signal, cache: 'no-store' }),
          fetch(`${API_URL}/anuais/lojas_compare?userId=${encodeURIComponent(userId)}&yearA=${yearA}&yearB=${yearB}&month=0`, {
            signal: controller.signal, cache: 'no-store',
          }),
          monthToDateNeeded
            ? fetch(urlHome(`startDate=${selectedMonthStart}&endDate=${periodRequest.endDate}`), {
                signal: controller.signal, cache: 'no-store',
              })
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        const readJson = async (result: PromiseSettledResult<Response | null>) => {
          if (result.status !== 'fulfilled' || !result.value?.ok) return null;
          try { return await result.value.json(); } catch { return null; }
        };
        const [prevData, yearData, monthData] = await Promise.all([
          readJson(previous), readJson(annual), readJson(monthToDate),
        ]);
        if (!alive) return;
        const prevValid = prevData?.success === true && Array.isArray(prevData.stores);
        const annualValid = Array.isArray(yearData?.data);
        setLiquidSources({
          previousStores: prevValid ? prevData.stores : [],
          annualRows: annualValid ? yearData.data : [],
          monthToDateStores: monthToDateNeeded && monthData?.success && Array.isArray(monthData.stores)
            ? monthData.stores : null,
          previousAvailable: prevValid,
          annualAvailable: annualValid,
          error: !prevValid || !annualValid || (monthToDateNeeded && !monthData?.success)
            ? 'Algumas bases de comparação líquida não estão disponíveis no momento.' : '',
        });
      } catch (error) {
        if (alive) setLiquidSources({ ...EMPTY_LIQUID_SOURCES, error: 'Falha ao consultar dados líquidos.' });
      } finally {
        if (alive) setLiquidLoading(false);
      }
    };
    void fetchSources();
    return () => { alive = false; controller.abort(); };
  }, [currentUser?.id, periodRequest.startDate, periodRequest.endDate]);

  const loadStoreView = useCallback(
    async (store: string) => {
      const userId = String(currentUser?.id || '').trim();
      const normalizedStore = String(store || '').trim();

      if (!userId || !normalizedStore) return;

      try {
        setStoreViewLoading(true);
        setStoreViewError('');

        const response = await fetch(
          `${API_URL}/api/home/store-detail?userId=${encodeURIComponent(
            userId,
          )}&store=${encodeURIComponent(normalizedStore)}&${buildPeriodQuery()}`,
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
    },
    [buildPeriodQuery, currentUser?.id],
  );

  const toggleLiquid = useCallback(() => {
    setLiquidOnly((previous) => {
      const next = !previous;
      if (next && storeFilter && !lojaEhLiquida(storeFilter, storeClassification)) {
        setStoreFilter(null);
        setStoreView(null);
      }
      return next;
    });
  }, [storeFilter, storeClassification]);

  const clearStoreAnalysis = useCallback(() => {
    setStoreFilter(null);
    setStoreView(null);
    setStoreViewError('');
  }, []);

  const selectStoreForAnalysis = useCallback(
    (store: string) => {
      const normalized = String(store || '').trim();
      if (!normalized) return;

      if (
        storeFilter &&
        String(storeFilter).toUpperCase() === normalized.toUpperCase()
      ) {
        clearStoreAnalysis();
        return;
      }

      setStoreFilter(normalized);
    },
    [clearStoreAnalysis, storeFilter],
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (storeFilter) {
      loadStoreView(storeFilter);
    } else {
      setStoreView(null);
      setStoreViewError('');
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

  const resetDraftToCurrent = () => {
    setDraftYear(currentYear);
    setDraftMonth(currentMonth);
    setDraftStart(initialPeriod.startDate);
    setDraftEnd(initialPeriod.endDate);
  };

  const openPeriodSelector = () => {
    const start = dashboard?.period?.startDate || periodRequest.startDate;
    const end = dashboard?.period?.endDate || periodRequest.endDate;
    setDraftYear(Number(start.slice(0, 4)));
    setDraftMonth(Number(start.slice(5, 7)));
    setDraftStart(start);
    setDraftEnd(end);
    setPeriodOpen((value) => !value);
  };

  const handleDraftMonthChange = (year: number, month: number) => {
    setDraftYear(year);
    setDraftMonth(month);

    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const isCurrent = year === currentYear && month === currentMonth;

    if (isCurrent) {
      setDraftStart(`${prefix}-01`);
      setDraftEnd(today);
      return;
    }

    const last = lastDayOfMonth(year, month);
    setDraftStart(`${prefix}-01`);
    setDraftEnd(`${prefix}-${String(last).padStart(2, '0')}`);
  };

  const applyPeriod = () => {
    const prefix = `${draftYear}-${String(draftMonth).padStart(2, '0')}`;
    const isCurrent = draftYear === currentYear && draftMonth === currentMonth;

    if (isCurrent) {
      const start = draftStart.startsWith(prefix) ? draftStart : `${prefix}-01`;
      let end = draftEnd.startsWith(prefix) ? draftEnd : today;
      if (end > today) end = today;
      setPeriodRequest({
        startDate: start <= end ? start : `${prefix}-01`,
        endDate: end,
      });
    } else {
      const last = lastDayOfMonth(draftYear, draftMonth);
      setPeriodRequest({
        startDate: `${prefix}-01`,
        endDate: `${prefix}-${String(last).padStart(2, '0')}`,
      });
    }

    setPeriodOpen(false);
  };

  const applyCurrentPeriod = () => {
    resetDraftToCurrent();
    setPeriodRequest(initialPeriod);
    setPeriodOpen(false);
  };

  const networkKpis = dashboard?.kpis || {};
  const stores = dashboard?.stores || [];
  const isStoreAnalysis = Boolean(storeFilter && storeView?.success);
  const scopedStores = isStoreAnalysis
    ? stores.filter((item) => normalizarLojaLiquida(item.loja) === normalizarLojaLiquida(storeFilter || ''))
    : stores;
  const allowedStoreNames = dashboard?.scope?.stores || stores.map((item) => item.loja);
  const allowedNormalized = new Set(allowedStoreNames.map(normalizarLojaLiquida));
  const currentLiquidStores = scopedStores.filter((store) => lojaEhLiquida(store.loja, storeClassification));
  const visibleStores = liquidOnly ? currentLiquidStores : scopedStores;

  const eligible = (name: string) => {
    const normalized = normalizarLojaLiquida(name);
    return lojaEhLiquida(normalized, storeClassification) &&
      (isNetworkView || allowedNormalized.has(normalized)) &&
      (!isStoreAnalysis || normalized === normalizarLojaLiquida(storeFilter || ''));
  };
  const sumLiquidAnnual = (year: number, monthPredicate: (month: number) => boolean) =>
    liquidSources.annualRows.reduce((sum, row) => {
      const yr = Number(row.ano);
      const month = Number(row.mes);
      return yr === year && monthPredicate(month) && eligible(String(row.loja || row.cnpj_empresa || ''))
        ? sum + validNumber(row.venda_total) : sum;
    }, 0);
  const currentYearSelected = Number(periodRequest.startDate.slice(0, 4));
  const selectedMonth = Number(periodRequest.startDate.slice(5, 7));
  const currentLiquidMonthly = sumRevenue(currentLiquidStores);
  const previousLiquidMonthly = liquidSources.previousStores.reduce((sum, store) =>
    eligible(store.loja) ? sum + validNumber(store.faturamento) : sum, 0);
  const monthGrowthLiquid = liquidSources.previousAvailable
    ? changePercent(currentLiquidMonthly, previousLiquidMonthly) : null;
  const monthToDateLiquid = liquidSources.monthToDateStores === null
    ? (periodRequest.startDate.endsWith('-01') ? currentLiquidMonthly : null)
    : liquidSources.monthToDateStores.reduce((sum, store) =>
        eligible(store.loja) ? sum + validNumber(store.faturamento) : sum, 0);
  const completedYearMonths = sumLiquidAnnual(currentYearSelected, (month) => month < selectedMonth);
  const priorYearFullLiquid = sumLiquidAnnual(currentYearSelected - 1, () => true);
  const priorYearMonths = new Set(liquidSources.annualRows.filter((row) =>
    Number(row.ano) === currentYearSelected - 1 && eligible(String(row.loja || row.cnpj_empresa || ''))
  ).map((row) => Number(row.mes)));
  const pastYearAvailable = liquidSources.annualAvailable && priorYearMonths.size === 12;
  const currentYearMonthsAvailable = selectedMonth === 1 || liquidSources.annualRows.some((row) =>
    Number(row.ano) === currentYearSelected && Number(row.mes) < selectedMonth && eligible(String(row.loja || row.cnpj_empresa || ''))
  );
  const yearLiquidReady = currentYearMonthsAvailable && monthToDateLiquid !== null && liquidSources.annualAvailable;
  const liquidYearActual = yearLiquidReady ? completedYearMonths + Number(monthToDateLiquid) : null;
  const liquidYearTrend = liquidYearActual !== null && validNumber(networkKpis.realizadoAno) > 0
    ? liquidYearActual * validNumber(networkKpis.tendenciaAno) / validNumber(networkKpis.realizadoAno)
    : null;
  const yearLiquidGrowth = pastYearAvailable && liquidYearTrend !== null
    ? changePercent(liquidYearTrend, priorYearFullLiquid) : null;

  const baseKpis = isStoreAnalysis
    ? {
        ...networkKpis,
        faturamentoMes: storeView?.kpis?.faturamento || 0,
        faturamentoAnterior: storeView?.kpis?.faturamentoAnterior || 0,
        faturamentoAnteriorMesCompleto: storeView?.kpis?.faturamentoAnteriorMesCompleto || 0,
        referenciaAnoAnterior: storeView?.kpis?.referenciaAnoAnterior,
        crescimento: storeView?.kpis?.crescimento ?? networkKpis.crescimento ?? null,
        crescimentoTendencia: storeView?.kpis?.crescimentoTendencia ?? null,
        tendenciaMes: storeView?.kpis?.tendenciaMes || 0,
        tendenciaAno: storeView?.kpis?.tendenciaAno || 0,
        realizadoAno: storeView?.kpis?.realizadoAno || 0,
        pecasMes: storeView?.kpis?.quantidade || 0,
        ticketMedio: storeView?.kpis?.ticketMedio || 0,
        conversaoAcessorios: storeView?.kpis?.conversaoAcessorios || 0,
        conversaoPeliculas: storeView?.kpis?.conversaoPeliculas || 0,
        seguroPct: storeView?.kpis?.seguroPct || 0,
        seguros: storeView?.kpis?.seguros || 0,
        vendasDia: storeView?.kpis?.vendasDia || 0,
      }
    : networkKpis;

  const liquidMonthlyPieces = currentLiquidStores.reduce((sum, store) => sum + validNumber(store.quantidade), 0);
  const liquidMonthlyInsurance = currentLiquidStores.reduce((sum, store) => sum + validNumber(store.seguros), 0);
  // Tendência líquida mensal: usa o acumulado do mês desde o dia 1,
  // inclusive quando o usuário seleciona um intervalo personalizado.
  // Em mês encerrado, tendência é igual ao realizado (sem projeção).
  const isCurrentSelectedMonth = currentYearSelected === currentYear && selectedMonth === currentMonth;
  const calendarDaysInSelectedMonth = lastDayOfMonth(currentYearSelected, selectedMonth);
  const elapsedSelectedMonth = Math.min(
    calendarDaysInSelectedMonth,
    Math.max(1, Number(periodRequest.endDate.slice(8, 10)) || 1),
  );
  const currentMonthSourceAvailable = Boolean(dashboard?.success && Array.isArray(dashboard.stores));
  const projectedLiquidBasis = monthToDateLiquid !== null && currentMonthSourceAvailable
    ? monthToDateLiquid : null;
  const liquidMonthProjection = projectedLiquidBasis === null ? null
    : isCurrentSelectedMonth
      ? projectedLiquidBasis * calendarDaysInSelectedMonth / elapsedSelectedMonth
      : projectedLiquidBasis;
  const previousFullMonthLiquid = sumLiquidAnnual(currentYearSelected - 1, (month) => month === selectedMonth);
  const previousFullMonthAvailable = liquidSources.annualAvailable && liquidSources.annualRows.some(
    (row) => Number(row.ano) === currentYearSelected - 1 && Number(row.mes) === selectedMonth &&
      eligible(String(row.loja || row.cnpj_empresa || '')),
  );
  const liquidTrendGrowth = previousFullMonthAvailable && previousFullMonthLiquid > 0 && liquidMonthProjection !== null
    ? changePercent(liquidMonthProjection, previousFullMonthLiquid) : null;

  const kpis = liquidOnly
    ? {
        ...baseKpis,
        faturamentoMes: currentLiquidMonthly,
        faturamentoAnterior: previousLiquidMonthly,
        crescimento: monthGrowthLiquid,
        tendenciaMes: liquidMonthProjection ?? 0,
        crescimentoTendencia: liquidTrendGrowth,
        tendenciaAno: liquidYearTrend ?? 0,
        realizadoAno: liquidYearActual ?? 0,
        pecasMes: liquidMonthlyPieces,
        ticketMedio: liquidMonthlyPieces > 0 ? currentLiquidMonthly / liquidMonthlyPieces : 0,
        seguros: liquidMonthlyInsurance,
        lojasAtivas: currentLiquidStores.length,
      }
    : baseKpis;

  const liquidRegions = currentLiquidStores.reduce<Record<string, number>>((result, store) => {
    const region = String(store.regiao || 'SEM REGIÃO').trim().toUpperCase();
    result[region] = (result[region] || 0) + validNumber(store.faturamento);
    return result;
  }, {});
  const operations = liquidOnly ? {
    mediaDiaria: currentLiquidMonthly / Math.max(1, dashboard?.period?.daysSelected || 1),
    quantidade: liquidMonthlyPieces,
    lojasAtivas: currentLiquidStores.length,
    vendedoresAtivos: undefined,
    topLoja: [...currentLiquidStores].sort((a, b) => b.faturamento - a.faturamento)[0] || null,
    categorias: [],
    regioes: Object.entries(liquidRegions).map(([regiao, faturamento]) => ({
      regiao, faturamento, quantidade: 0,
      participacao: currentLiquidMonthly > 0 ? faturamento / currentLiquidMonthly * 100 : 0,
    })),
    source: dashboard?.operations?.source,
    insuranceScope: dashboard?.operations?.insuranceScope,
  } : isStoreAnalysis ? storeView?.operations : dashboard?.operations;

  const trend = useMemo(
    () =>
      ((isStoreAnalysis ? storeView?.trend : dashboard?.trend) || []).map((item: any) => ({
        ...item,
        label: shortDate(item.date),
      })),
    [dashboard?.trend, isStoreAnalysis, storeView?.trend],
  );

  const viewLoading = dashboardLoading || (Boolean(storeFilter) && storeViewLoading) || (liquidOnly && liquidLoading);
  const scopeLabel = isStoreAnalysis
    ? `Análise da loja • ${storeFilter}`
    : dashboard?.scope?.label || 'Validando seu acesso';

  const effectivePeriod = isStoreAnalysis ? storeView?.period || dashboard?.period : dashboard?.period;
  const isHistorical = Boolean(effectivePeriod?.isHistorical);
  const isCustomCurrent = Boolean(effectivePeriod?.isCurrentMonth && !effectivePeriod?.isFullMonth);

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
      period: storeView?.period || dashboard.period,
      kpis,
      trend: storeView?.trend || [],
      stores: selectedStoreData ? [selectedStoreData] : [],
      operations: storeView?.operations || dashboard.operations,
      radar: [],
    };
  }, [dashboard, isStoreAnalysis, kpis, storeFilter, storeView?.operations, storeView?.period, storeView?.trend, stores]);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let year = currentYear; year >= currentYear - 3; year -= 1) years.push(year);
    return years;
  }, [currentYear]);

  const allowedStoreOptions = (dashboard?.scope?.stores || stores.map((item) => item.loja))
    .filter((store) => !liquidOnly || lojaEhLiquida(store, storeClassification));

  return (
    <div className="flex-1 overflow-y-auto bg-[#f5f7fb]" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
      <div className="mx-auto w-full max-w-[1540px] px-2 py-2.5 sm:px-4 sm:py-4 md:px-6 lg:px-8 lg:py-5">
        <section className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                <Activity size={13} /> TeleFluxo Intelligence
              </span>
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                  isMultiStoreView && !isStoreAnalysis
                    ? 'bg-slate-950 text-white'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {isMultiStoreView && !isStoreAnalysis ? <Crown size={12} /> : <ShieldCheck size={12} />}
                {scopeLabel}
              </span>
              {isStoreAnalysis && (
                <button
                  type="button"
                  onClick={clearStoreAnalysis}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-black uppercase tracking-wide text-slate-600 transition hover:border-orange-200 hover:text-orange-700"
                >
                  <X size={11} /> Todas as lojas
                </button>
              )}
            </div>
            <h1 className="text-[25px] font-black leading-none tracking-[-0.04em] text-slate-950 sm:text-[28px] md:text-[34px]">
              Olá, {firstName}. <span className="text-orange-500">👋</span>
            </h1>
            <p className="mt-1.5 text-[10px] font-semibold text-slate-400">
              {effectivePeriod?.label || 'Este mês'}
              {isStoreAnalysis ? ` • ${storeFilter}` : ''}
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2">
            <div className="relative col-span-2 sm:col-span-1">
              <button
                type="button"
                onClick={openPeriodSelector}
                className="col-span-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 shadow-sm transition hover:border-orange-200 hover:text-orange-700 sm:col-span-1 sm:w-auto sm:justify-start sm:px-4 sm:text-xs"
              >
                <CalendarDays size={15} className="text-orange-500" />
                {effectivePeriod?.label || 'Este mês'}
                <ChevronDown size={13} />
              </button>

              {periodOpen && (
                <div className="fixed left-3 right-3 top-[88px] z-[90] max-h-[calc(100vh-105px)] overflow-y-auto rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px] sm:max-h-none sm:overflow-visible sm:rounded-[24px] sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-orange-600">
                        Período global
                      </p>
                      <p className="mt-1 text-sm font-black text-slate-900">Escolha o mês da análise</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPeriodOpen(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <select
                      value={draftYear}
                      onChange={(event) => {
                        const nextYear = Number(event.target.value);
                        const nextMonth =
                          nextYear === currentYear && draftMonth > currentMonth
                            ? currentMonth
                            : draftMonth;
                        handleDraftMonthChange(nextYear, nextMonth);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-orange-400"
                    >
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draftMonth}
                      onChange={(event) =>
                        handleDraftMonthChange(draftYear, Number(event.target.value))
                      }
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-orange-400"
                    >
                      {MONTHS.map((month, index) => {
                        const value = index + 1;
                        const future = draftYear === currentYear && value > currentMonth;
                        return (
                          <option key={month} value={value} disabled={future}>
                            {month}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {draftYear === currentYear && draftMonth === currentMonth ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-3.5">
                      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">
                        Intervalo dentro do mês atual
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[9px] font-bold text-slate-500">De</label>
                          <input
                            type="date"
                            value={draftStart}
                            min={`${today.slice(0, 7)}-01`}
                            max={today}
                            onChange={(event) => setDraftStart(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-[10px] font-bold outline-none focus:border-orange-400"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[9px] font-bold text-slate-500">Até</label>
                          <input
                            type="date"
                            value={draftEnd}
                            min={`${today.slice(0, 7)}-01`}
                            max={today}
                            onChange={(event) => setDraftEnd(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-[10px] font-bold outline-none focus:border-orange-400"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl bg-blue-50 px-3.5 py-3 text-[10px] font-semibold leading-relaxed text-blue-700">
                      Meses anteriores usam automaticamente o mês fechado completo pela base anual.
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={applyCurrentPeriod}
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50"
                    >
                      Este mês
                    </button>
                    <button
                      type="button"
                      onClick={applyPeriod}
                      className="flex-1 rounded-xl bg-slate-950 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-orange-600"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {isNetworkView && (
              <select
                value={storeFilter || ''}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) clearStoreAnalysis();
                  else setStoreFilter(value);
                }}
                className="h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-600 shadow-sm outline-none transition focus:border-orange-400 sm:w-auto sm:max-w-[230px]"
              >
                <option value="">Todas as lojas</option>
                {allowedStoreOptions.map((store) => (
                  <option key={store} value={store}>
                    {store}
                  </option>
                ))}
              </select>
            )}

            {isMultiStoreView && (
              <button
                type="button"
                onClick={toggleLiquid}
                aria-pressed={liquidOnly}
                title={liquidOnly ? 'Voltar a exibir todas as lojas' : 'Considerar apenas as lojas OK no cadastro do Comparativo Anual'}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-[11px] font-black uppercase tracking-wide shadow-sm transition ${
                  liquidOnly
                    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                <ShieldCheck size={15} /> Líquido {liquidOnly ? '✓' : ''}
              </button>
            )}
            <div title={liquidOnly ? 'O relatório executivo existente utiliza a base bruta. Desative Líquido para gerá-lo.' : ''}>
              <ExecutiveReportButton
                currentUser={currentUser}
                dashboard={reportDashboard}
                disabled={viewLoading || liquidOnly}
              />
            </div>
            <button
              onClick={() => {
                loadDashboard();
                if (storeFilter) loadStoreView(storeFilter);
              }}
              disabled={viewLoading}
              className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-[10px] font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-orange-600 disabled:opacity-50 sm:px-4 sm:text-[11px]"
            >
              <RefreshCw size={14} className={viewLoading ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </section>

        {(dashboardError || storeViewError) && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {dashboardError || storeViewError}
          </div>
        )}

        {(liquidSources.error || liquidOnly) && (
          <div className={`mb-3 mt-1 rounded-xl border px-3 py-2 text-[11px] font-semibold ${
            liquidSources.error ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}>
            {liquidOnly
              ? `Filtro líquido: ${currentLiquidStores.length} lojas OK com movimento no período. Ranking e totalizadores usam apenas essas unidades. O gráfico diário é substituído pelo ranking mensal por não haver uma série diária segmentada nesta API.`
              : 'Líquido considera somente as lojas OK do cadastro de Vendas Anuais, tanto no ano atual quanto na comparação anterior.'}
            {liquidSources.error && <span className="ml-1">{liquidSources.error}</span>}
          </div>
        )}
        <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
          <KpiCard
            title="Vendas do dia"
            value={liquidOnly || viewLoading ? '—' : money(kpis.vendasDia)}
            subtitle={liquidOnly ? 'diário por loja indisponível neste filtro' : 'realizado hoje'}
            icon={ShoppingBag}
          />
          <KpiCard
            title={liquidOnly ? 'Faturamento líquido do mês' : (isCustomCurrent ? 'Faturamento do período' : 'Faturamento do mês')}
            value={viewLoading ? '—' : money(kpis.faturamentoMes)}
            subtitle={liquidOnly ? 'somente lojas OK' : (isStoreAnalysis ? storeFilter || 'Loja selecionada' : 'faturamento bruto')}
            icon={CircleDollarSign}
            secondary={{
              label: liquidOnly ? `Líquido no mesmo período de ${currentYearSelected - 1}` : 'Faturamento líquido',
              value: liquidLoading ? 'Calculando…' : liquidOnly ? (liquidSources.previousAvailable ? money(previousLiquidMonthly) : 'Sem histórico') : money(currentLiquidMonthly),
              change: !liquidLoading ? monthGrowthLiquid : null,
              detail: !liquidLoading && monthGrowthLiquid === null
                ? 'Sem base líquida do mesmo período do ano anterior'
                : liquidOnly ? 'Variação percentual apenas das lojas OK' : `Variação líquida vs. mesmo intervalo de ${currentYearSelected - 1}`,
            }}
            onClick={() => { if (!liquidOnly) setSelectedMetric('faturamentoMes'); }}
          />
          <KpiCard
            title={liquidOnly
              ? (isHistorical ? 'Fechamento líquido do mês' : 'Tendência líquida mês')
              : (isHistorical ? 'Fechamento do mês' : 'Tendência mês')}
            value={viewLoading ? '—' : liquidOnly && liquidMonthProjection === null
              ? 'Sem base suficiente' : money(kpis.tendenciaMes)}
            subtitle={
              liquidOnly
                ? isHistorical ? 'realizado somente das lojas OK' : 'projeção somente das lojas OK'
                : isHistorical
                  ? 'mês fechado selecionado'
                  : typeof kpis.crescimentoTendencia === 'number' && kpis.faturamentoAnteriorMesCompleto && kpis.referenciaAnoAnterior
                    ? `vs. ${MONTHS[Number(kpis.referenciaAnoAnterior.slice(5, 7)) - 1]}/${kpis.referenciaAnoAnterior.slice(0, 4)}: ${money(kpis.faturamentoAnteriorMesCompleto)}`
                    : 'projeção pelo ritmo do período · histórico insuficiente'
            }
            icon={BarChart3}
            change={liquidOnly ? liquidTrendGrowth : kpis.crescimentoTendencia}
            secondary={{
              label: liquidOnly
                ? `Base líquida ${MONTHS[selectedMonth - 1]}/${currentYearSelected - 1}`
                : (isHistorical ? 'Fechamento líquido do mês' : 'Tendência líquida'),
              value: liquidLoading ? 'Calculando…'
                : liquidOnly
                  ? previousFullMonthAvailable ? money(previousFullMonthLiquid) : 'Sem base anterior'
                  : liquidMonthProjection !== null ? money(liquidMonthProjection) : 'Sem base suficiente',
              change: liquidOnly ? null : liquidTrendGrowth,
              detail: liquidOnly
                ? `Comparação da tendência líquida contra o mês fechado de ${currentYearSelected - 1}`
                : isHistorical
                  ? `Realizado das lojas OK vs. o mês correspondente de ${currentYearSelected - 1}`
                  : `Projeção das lojas OK vs. o mês completo de ${currentYearSelected - 1}`,
            }}
          />
          <KpiCard
            title={liquidOnly ? 'Tendência líquida do ano' : 'Tendência ano'}
            value={viewLoading ? '—' : liquidOnly && liquidYearTrend === null ? 'Indisponível' : money(kpis.tendenciaAno)}
            subtitle={viewLoading ? 'calculando projeção' : liquidOnly
              ? `${liquidYearActual !== null ? money(liquidYearActual) : '—'} realizado líquido no ano`
              : `${money(kpis.realizadoAno)} realizado até o período`}
            icon={Activity}
            secondary={{
              label: liquidOnly ? `Líquido ${currentYearSelected - 1} (ano fechado)` : 'Tendência líquida anual',
              value: liquidLoading ? 'Calculando…' : liquidOnly
                ? pastYearAvailable ? money(priorYearFullLiquid) : 'Sem base anual'
                : liquidYearTrend !== null ? money(liquidYearTrend) : 'Sem base suficiente',
              change: !liquidLoading ? yearLiquidGrowth : null,
              detail: 'Variação da projeção líquida contra o ano anterior completo',
            }}
          />
          {liquidOnly ? (
            <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-3 sm:rounded-[22px] sm:p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Lojas líquidas</p>
              <p className="mt-2 text-[25px] font-black text-slate-900">{currentLiquidStores.length}</p>
              <p className="mt-0.5 text-[10px] font-bold text-slate-500">com movimento no período</p>
              <div className="mt-3 border-t border-emerald-200 pt-2">
                <p className="text-[9px] font-extrabold uppercase text-emerald-700">Seguros nessas lojas</p>
                <p className="text-[16px] font-black text-slate-900">{money(liquidMonthlyInsurance)}</p>
              </div>
            </div>
          ) : (
            <ConversionCard
              acessorios={Number(kpis.conversaoAcessorios || 0)}
              peliculas={Number(kpis.conversaoPeliculas || 0)}
              seguro={Number(kpis.seguroPct || 0)}
              segurosValor={Number(kpis.seguros || 0)}
              loading={viewLoading}
              onSelectMetric={setSelectedMetric}
              insuranceScope={operations?.insuranceScope}
            />
          )}
        </section>

        <section className="mt-4">
          <div className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-[0_12px_34px_rgba(15,23,42,0.045)] sm:rounded-[24px] sm:p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2.5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
                  Performance
                </p>
                <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
                  {liquidOnly ? 'Faturamento líquido por loja' : isStoreAnalysis ? `Faturamento diário • ${storeFilter}` : 'Faturamento diário'}
                </h2>
                <p className="mt-1 text-[10px] font-semibold text-slate-400">
                  {liquidOnly ? 'Valores do período apenas das lojas OK' : effectivePeriod?.label || 'Este mês'}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="hidden rounded-2xl bg-slate-50 px-4 py-2 text-right sm:block">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</p>
                  <p className="text-sm font-black text-slate-900">{money(kpis.faturamentoMes)}</p>
                </div>
                <div className="hidden items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2 sm:flex">
                  <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                    Faturamento
                  </span>
                </div>
              </div>
            </div>

            <div className={liquidOnly ? 'min-h-[245px] w-full' : 'h-[235px] w-full sm:h-[300px] lg:h-[320px]'}>
              {liquidOnly ? (
                <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 py-2 md:grid-cols-2">
                  {[...currentLiquidStores].sort((a, b) => b.faturamento - a.faturamento).map((store) => (
                    <div key={store.loja} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold">
                        <span className="truncate text-slate-800">{store.loja}</span>
                        <span className="shrink-0 tabular-nums text-slate-950">{money(store.faturamento)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${currentLiquidMonthly > 0 ? Math.min(100, store.faturamento / currentLiquidMonthly * 100) : 0}%` }} />
                      </div>
                    </div>
                  ))}
                  {!currentLiquidStores.length && <p className="p-6 text-sm font-bold text-slate-400">Nenhuma loja OK com faturamento neste período.</p>}
                </div>
              ) : trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 30, right: 10, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="telefluxoArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis
                      yAxisId="revenue"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                      tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                    />
                    <Tooltip
                      formatter={(value: any) => [money(value), 'Faturamento']}
                      labelFormatter={(label) => `Dia ${label}`}
                      contentStyle={{
                        borderRadius: 16,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 15px 40px rgba(15,23,42,.12)',
                      }}
                    />
                    <Area
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="faturamento"
                      name="Faturamento"
                      stroke="#f97316"
                      strokeWidth={3}
                      fill="url(#telefluxoArea)"
                    >
                      <LabelList
                        dataKey="faturamento"
                        content={(props: any) => {
                          const index = Number(props?.index ?? 0);
                          const value = Number(props?.value || 0);
                          const x = Number(props?.x || 0);
                          const y = Number(props?.y || 0);
                          const shouldSkip =
                            trend.length > 16 &&
                            index % 2 !== 0 &&
                            index !== trend.length - 1;

                          if (!value || shouldSkip) return null;

                          return (
                            <text
                              x={x}
                              y={y - 9}
                              textAnchor="middle"
                              fill="#9a3412"
                              fontSize={9}
                              fontWeight={900}
                            >
                              {moneyCompact(value)}
                            </text>
                          );
                        }}
                      />
                    </Area>
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm font-bold text-slate-400">
                  Sem movimento suficiente para montar o gráfico.
                </div>
              )}
            </div>
          </div>
        </section>

        {liquidOnly ? (
          <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Peças das lojas OK</p>
              <p className="mt-1 text-xl font-black text-slate-900">{number(liquidMonthlyPieces)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Ticket médio líquido</p>
              <p className="mt-1 text-xl font-black text-slate-900">{money(kpis.ticketMedio)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Média diária líquida</p>
              <p className="mt-1 text-xl font-black text-slate-900">{money(operations?.mediaDiaria)}</p>
            </div>
          </section>
        ) : (
          <OperationalPanel
            operations={operations}
            kpis={kpis}
            loading={viewLoading}
            storeMode={isStoreAnalysis || (!isMultiStoreView && dashboard?.scope?.type === 'store')}
          />
        )}

        <section
          className={`mt-3 grid grid-cols-1 items-start gap-2.5 sm:mt-4 sm:gap-4 ${
            isNetworkView ? 'xl:grid-cols-2' : 'xl:grid-cols-1'
          }`}
        >
          <div className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-sm sm:rounded-[24px] sm:p-4 md:p-4.5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  {isMultiStoreView ? (isNetworkView ? 'Rede' : 'Lojas permitidas') : 'Sua unidade'}
                </p>
                <h2 className="mt-1 text-lg font-black text-slate-950 sm:text-xl">
                  {isMultiStoreView ? 'Performance das lojas' : 'Resumo da loja'}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {storeFilter && (
                  <button
                    type="button"
                    onClick={clearStoreAnalysis}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-wide text-slate-600 hover:border-orange-200 hover:text-orange-700"
                  >
                    <X size={12} /> Todas as lojas
                  </button>
                )}
                <Store size={20} className="text-orange-500" />
              </div>
            </div>

            <div className="space-y-1.5 md:hidden">
              {visibleStores.length ? (
                visibleStores.map((store, index) => {
                  const active =
                    Boolean(storeFilter) &&
                    String(storeFilter).toUpperCase() === String(store.loja).toUpperCase();

                  return (
                    <button
                      key={store.loja}
                      type="button"
                      onClick={() => selectStoreForAnalysis(store.loja)}
                      className={`w-full rounded-[16px] border px-2.5 py-2.5 text-left transition ${
                        active
                          ? 'border-orange-200 bg-orange-50 shadow-sm'
                          : 'border-slate-100 bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black text-slate-400">
                              {isNetworkView ? String(index + 1).padStart(2, '0') : 'LOJA'}
                            </span>
                            {active && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[7px] font-black uppercase text-orange-700">
                                Em análise
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[12px] font-black text-slate-950">{store.loja}</p>
                          <p className="mt-0.5 text-[14px] font-black tracking-tight text-slate-900">
                            {money(store.faturamento)}
                          </p>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedStore(store.loja);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.stopPropagation();
                              setSelectedStore(store.loja);
                            }
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200"
                          title="Abrir detalhes da loja"
                        >
                          <ChevronRight size={15} />
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200/70 pt-2 text-[9px] font-bold text-slate-500">
                        <span>
                          <span className="text-[7px] font-black uppercase tracking-wide text-slate-400">Acess.</span>{' '}
                          <strong className="text-slate-800">{number(store.conversaoAcessorios, 1)}%</strong>
                        </span>
                        <span>
                          <span className="text-[7px] font-black uppercase tracking-wide text-slate-400">Pelíc.</span>{' '}
                          <strong className="text-slate-800">{number(store.conversaoPeliculas, 1)}%</strong>
                        </span>
                        <span>
                          <span className="text-[7px] font-black uppercase tracking-wide text-slate-400">Seguro</span>{' '}
                          <strong className="text-slate-800">{number(store.seguroPct, 1)}%</strong>
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-xs font-semibold text-slate-400">
                  Nenhum dado disponível para o período.
                </div>
              )}
            </div>

            <div className="hidden md:block">
              <table className="w-full min-w-[650px] border-separate border-spacing-y-1 text-left">
                <thead>
                  <tr className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                    <th className="px-2.5 py-1.5">{isNetworkView ? '#' : 'Escopo'}</th>
                    <th className="px-2.5 py-1.5">Loja</th>
                    <th className="px-3 py-2 text-right">Faturamento</th>
                    <th className="px-3 py-2 text-right">Acessórios</th>
                    <th className="px-3 py-2 text-right">Películas</th>
                    <th className="px-3 py-2 text-right">Seguro</th>
                    <th className="px-3 py-2 text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStores.length ? (
                    visibleStores.map((store, index) => {
                      const active =
                        Boolean(storeFilter) &&
                        String(storeFilter).toUpperCase() === String(store.loja).toUpperCase();

                      return (
                        <tr
                          key={store.loja}
                          onClick={() => selectStoreForAnalysis(store.loja)}
                          className={`cursor-pointer text-[11px] font-bold text-slate-700 transition ${
                            active
                              ? 'bg-orange-50 ring-1 ring-inset ring-orange-200'
                              : 'bg-slate-50/80 hover:bg-orange-50'
                          }`}
                        >
                          <td className="rounded-l-xl px-2.5 py-2.5 text-slate-400">
                            {isNetworkView ? (
                              String(index + 1).padStart(2, '0')
                            ) : (
                              <ShieldCheck size={15} className="text-emerald-600" />
                            )}
                          </td>
                          <td className="px-2.5 py-2.5 font-black text-slate-900">
                            <div className="flex items-center gap-2">
                              <span>{store.loja}</span>
                              {active && (
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[8px] font-black uppercase text-orange-700">
                                  Em análise
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5 text-right">{money(store.faturamento)}</td>
                          <td className="px-2.5 py-2.5 text-right">
                            {number(store.conversaoAcessorios, 1)}%
                          </td>
                          <td className="px-2.5 py-2.5 text-right">
                            {number(store.conversaoPeliculas, 1)}%
                          </td>
                          <td className="px-2.5 py-2.5 text-right">{number(store.seguroPct, 1)}%</td>
                          <td className="rounded-r-xl px-2.5 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedStore(store.loja);
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:text-orange-600"
                              title="Abrir detalhes da loja"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm font-semibold text-slate-400">
                        Nenhum dado disponível para o período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {isNetworkView && (
            <div className="space-y-3 sm:space-y-4">
              <InsuranceRankingCard
                stores={visibleStores}
                loading={viewLoading}
                periodLabel={dashboard?.period?.label}
              />
            </div>
          )}
        </section>
      </div>

      <KpiDrilldownDrawer
        open={Boolean(selectedMetric) && !liquidOnly}
        metric={selectedMetric}
        dashboard={reportDashboard}
        onClose={() => setSelectedMetric(null)}
        onOpenStore={(store) => {
          setSelectedMetric(null);
          setSelectedStore(store);
        }}
      />
      <StoreDetailDrawer
        open={Boolean(selectedStore)}
        store={selectedStore}
        currentUser={currentUser}
        startDate={periodRequest.startDate}
        endDate={periodRequest.endDate}
        onClose={() => setSelectedStore(null)}
      />
    </div>
  );
}