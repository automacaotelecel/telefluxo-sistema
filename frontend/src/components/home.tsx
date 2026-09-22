import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Download,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Crown,
  Gauge,
  MapPin,
  Megaphone,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
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
    })}M`;
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

      {/* Mobile: uma linha principal + resumo inferior. Evita cinco colunas comprimidas. */}
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

      {/* Tablet/desktop */}
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
              O que está acontecendo na operação
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

  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newNotice, setNewNotice] = useState({
    title: '',
    content: '',
    priority: 'Normal',
    category: 'Aviso',
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [storeView, setStoreView] = useState<any | null>(null);
  const [storeViewLoading, setStoreViewLoading] = useState(false);
  const [storeViewError, setStoreViewError] = useState('');

  const [periodRequest, setPeriodRequest] = useState<PeriodRequest>(initialPeriod);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(Number(initialPeriod.startDate.slice(0, 4)));
  const [draftMonth, setDraftMonth] = useState(Number(initialPeriod.startDate.slice(5, 7)));
  const [draftStart, setDraftStart] = useState(initialPeriod.startDate);
  const [draftEnd, setDraftEnd] = useState(initialPeriod.endDate);

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
    fetchAnnouncements();
  }, [fetchAnnouncements]);

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
  const visibleStores = isNetworkView ? stores : stores.slice(0, 1);
  const isStoreAnalysis = Boolean(storeFilter && storeView?.success);

  const kpis = isStoreAnalysis
    ? {
        ...networkKpis,
        faturamentoMes: storeView?.kpis?.faturamento || 0,
        faturamentoAnterior: storeView?.kpis?.faturamentoAnterior || 0,
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

  const operations = isStoreAnalysis ? storeView?.operations : dashboard?.operations;

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

  const allowedStoreOptions = dashboard?.scope?.stores || stores.map((item) => item.loja);

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
                  isNetworkView && !isStoreAnalysis
                    ? 'bg-slate-950 text-white'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {isNetworkView && !isStoreAnalysis ? <Crown size={12} /> : <ShieldCheck size={12} />}
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

            <ExecutiveReportButton
              currentUser={currentUser}
              dashboard={reportDashboard}
              disabled={viewLoading}
            />
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
            {isAdminOrManager && (
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl bg-orange-600 px-3 text-[10px] font-black uppercase tracking-wide text-white shadow-lg transition hover:bg-orange-700 sm:px-4 sm:text-[11px]"
              >
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

        <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
          <KpiCard
            title="Vendas do dia"
            value={viewLoading ? '—' : money(kpis.vendasDia)}
            subtitle="realizado hoje"
            icon={ShoppingBag}
          />
          <KpiCard
            title={isCustomCurrent ? 'Faturamento do período' : 'Faturamento do mês'}
            value={viewLoading ? '—' : money(kpis.faturamentoMes)}
            subtitle={
              isStoreAnalysis
                ? storeFilter || 'Loja selecionada'
                : isHistorical
                  ? effectivePeriod?.label || 'mês selecionado'
                  : 'realizado até agora'
            }
            icon={CircleDollarSign}
            change={kpis.crescimento}
            onClick={() => setSelectedMetric('faturamentoMes')}
          />
          <KpiCard
            title={isHistorical ? 'Fechamento do mês' : 'Tendência mês'}
            value={viewLoading ? '—' : money(kpis.tendenciaMes)}
            subtitle={isHistorical ? 'mês fechado selecionado' : 'projeção pelo ritmo do período'}
            icon={BarChart3}
            change={kpis.crescimentoTendencia}
          />
          <KpiCard
            title="Tendência ano"
            value={viewLoading ? '—' : money(kpis.tendenciaAno)}
            subtitle={
              viewLoading ? 'calculando projeção' : `${money(kpis.realizadoAno)} realizado até o período`
            }
            icon={Activity}
          />
          <ConversionCard
            acessorios={Number(kpis.conversaoAcessorios || 0)}
            peliculas={Number(kpis.conversaoPeliculas || 0)}
            seguro={Number(kpis.seguroPct || 0)}
            segurosValor={Number(kpis.seguros || 0)}
            loading={viewLoading}
            onSelectMetric={setSelectedMetric}
            insuranceScope={operations?.insuranceScope}
          />
        </section>

        <section className="mt-4">
          <div className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-[0_12px_34px_rgba(15,23,42,0.045)] sm:rounded-[24px] sm:p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2.5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
                  Performance
                </p>
                <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
                  {isStoreAnalysis ? `Faturamento diário • ${storeFilter}` : 'Faturamento diário'}
                </h2>
                <p className="mt-1 text-[10px] font-semibold text-slate-400">
                  {effectivePeriod?.label || 'Este mês'}
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

            <div className="h-[235px] w-full sm:h-[300px] lg:h-[320px]">
              {trend.length ? (
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

        <OperationalPanel
          operations={operations}
          kpis={kpis}
          loading={viewLoading}
          storeMode={isStoreAnalysis || dashboard?.scope?.type === 'store'}
        />

        <section className="mt-3 grid grid-cols-1 items-start gap-2.5 sm:mt-4 sm:gap-4 xl:grid-cols-2">
          <div className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-sm sm:rounded-[24px] sm:p-4 md:p-4.5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  {isNetworkView ? 'Rede' : 'Sua unidade'}
                </p>
                <h2 className="mt-1 text-lg font-black text-slate-950 sm:text-xl">
                  {isNetworkView ? 'Performance das lojas' : 'Resumo da loja'}
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

          <div className="space-y-3 sm:space-y-4">
            {isNetworkView && (
              <InsuranceRankingCard
                stores={stores}
                loading={dashboardLoading}
                periodLabel={dashboard?.period?.label}
              />
            )}

            <div className="rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-sm sm:rounded-[24px] sm:p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    Informativos
                  </p>
                  <h2 className="mt-1 text-lg font-black text-slate-950">Mural oficial</h2>
                </div>
                <Megaphone size={19} className="text-orange-500" />
              </div>
              <div className="space-y-3">
                {notices.slice(0, 2).map((ann) => (
                  <div key={ann.id} className="relative rounded-2xl bg-slate-50 p-4">
                    {isAdminOrManager && (
                      <button
                        onClick={() => handleDelete(ann.id)}
                        className="absolute right-3 top-3 text-slate-300 hover:text-rose-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <span
                      className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${
                        ann.priority === 'Urgente'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-white text-slate-500'
                      }`}
                    >
                      {ann.priority}
                    </span>
                    <p className="mt-3 pr-6 text-sm font-black text-slate-900">{ann.title}</p>
                    <p className="mt-1 line-clamp-3 text-xs font-medium leading-relaxed text-slate-500">
                      {ann.content}
                    </p>
                  </div>
                ))}
                {!notices.length && (
                  <p className="rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-400">
                    Sem novos informativos.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="rounded-[24px] bg-orange-600 p-5 text-white">
                <Bell size={17} />
                <p className="mt-4 text-[9px] font-black uppercase tracking-[0.18em] text-orange-100">
                  Frase do dia
                </p>
                <p className="mt-2 text-sm font-black leading-relaxed">
                  {dailyTip ? dailyTip.content : 'Organização é a base de tudo. Bom trabalho!'}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                <CalendarDays size={17} className="text-slate-900" />
                <p className="mt-4 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
                  Agenda grupo
                </p>
                <p className="mt-2 text-sm font-black text-slate-900">
                  {groupAgenda.length ? `${groupAgenda.length} compromisso(s)` : 'Sem reuniões hoje'}
                </p>
                {groupAgenda[0] && (
                  <p className="mt-1 text-xs font-semibold text-slate-400">{groupAgenda[0].title}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <KpiDrilldownDrawer
        open={Boolean(selectedMetric)}
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

      {showModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[30px] bg-white p-7 shadow-2xl md:p-9">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
                  Comunicação interna
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Novo conteúdo</h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <select
                className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500"
                value={newNotice.category}
                onChange={(event) => setNewNotice({ ...newNotice, category: event.target.value })}
              >
                <option value="Aviso">Mural central</option>
                <option value="Dica">Frase do dia</option>
                <option value="Agenda">Agenda grupo</option>
              </select>
              <input
                placeholder="Título / assunto"
                className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500"
                value={newNotice.title}
                onChange={(event) => setNewNotice({ ...newNotice, title: event.target.value })}
              />
              <textarea
                placeholder="Conteúdo ou mensagem..."
                rows={4}
                className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none focus:border-orange-500"
                value={newNotice.content}
                onChange={(event) => setNewNotice({ ...newNotice, content: event.target.value })}
              />
              {newNotice.category === 'Aviso' && (
                <select
                  className="w-full rounded-2xl border border-slate-200 p-4 text-sm font-bold outline-none"
                  value={newNotice.priority}
                  onChange={(event) => setNewNotice({ ...newNotice, priority: event.target.value })}
                >
                  <option value="Normal">Prioridade normal</option>
                  <option value="Urgente">Prioridade urgente</option>
                </select>
              )}
            </div>
            <button
              onClick={handleCreate}
              className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-4 text-xs font-black uppercase tracking-wide text-white shadow-lg hover:bg-orange-700"
            >
              Publicar <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
