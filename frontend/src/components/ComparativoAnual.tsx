import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Calendar,
  ChevronDown,
  CheckSquare,
  Square,
  Filter,
  Layers,
  Activity,
  TrendingUp,
  ShieldCheck,
  PieChart as PieChartIcon,
  BarChart3,
  RefreshCw,
  Store,
} from 'lucide-react';

type AnyRow = Record<string, any>;
type CompareRow = {
  ano: number;
  mes: number;
  loja: string;
  cnpj_empresa?: string;
  regiao?: string;
  venda_total: number;
  venda_qtd: number;
  seguro_total: number;
  seguro_qtd: number;
};

const STORE_MAP: Record<string, string> = {
  '12309173001309': 'ARAGUAIA SHOPPING',
  '12309173000418': 'BOULEVARD SHOPPING',
  '12309173000175': 'BRASILIA SHOPPING',
  '12309173000680': 'CONJUNTO NACIONAL',
  '12309173001228': 'CONJUNTO NACIONAL QUIOSQUE',
  '12309173000507': 'GOIANIA SHOPPING',
  '12309173000256': 'IGUATEMI SHOPPING',
  '12309173000841': 'JK SHOPPING',
  '12309173000337': 'PARK SHOPPING',
  '12309173000922': 'PATIO BRASIL',
  '12309173000760': 'TAGUATINGA SHOPPING',
  '12309173001147': 'TERRAÇO SHOPPING',
  '12309173001651': 'TAGUATINGA SHOPPING QQ',
  '12309173001732': 'UBERLÂNDIA SHOPPING',
  '12309173001813': 'UBERABA SHOPPING',
  '12309173001570': 'FLAMBOYANT SHOPPING',
  '12309173002119': 'BURITI SHOPPING',
  '12309173002461': 'PASSEIO DAS AGUAS',
  '12309173002038': 'PORTAL SHOPPING',
  '12309173002208': 'SHOPPING SUL',
  '12309173001902': 'BURITI RIO VERDE',
  '12309173002380': 'PARK ANAPOLIS',
  '12309173002542': 'SHOPPING RECIFE',
  '12309173002895': 'MANAIRA SHOPPING',
  '12309173002976': 'IGUATEMI FORTALEZA',
  '12309173001066': 'CD TAGUATINGA',
};

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTH_FULL: Record<number, string> = {
  1: 'Janeiro',
  2: 'Fevereiro',
  3: 'Março',
  4: 'Abril',
  5: 'Maio',
  6: 'Junho',
  7: 'Julho',
  8: 'Agosto',
  9: 'Setembro',
  10: 'Outubro',
  11: 'Novembro',
  12: 'Dezembro',
};
const PIE_COLORS = ['#1d4ed8', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];

const API_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://telefluxo-aplicacao.onrender.com';

const formatMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatMoneyShort = (val: number) => {
  if (!val) return 'R$ 0';
  if (Math.abs(val) >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
  if (Math.abs(val) >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
  return `R$ ${val.toFixed(0)}`;
};

const pick = (obj: AnyRow, keys: string[], fallback: any = undefined) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
};

const toNumberSafe = (v: any) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v)
    .trim()
    .replace(/\s/g, '')
    .replace(/[R$\u00A0]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const getStoreName = (raw: string) => {
  if (!raw) return 'N/D';
  const clean = raw.replace(/\D/g, '');
  return STORE_MAP[clean] || STORE_MAP[raw] || raw;
};

const getDateValue = (sale: AnyRow) => pick(sale, ['data_emissao', 'DATA_EMISSAO', 'data', 'DATA', 'date', 'DATE'], '');
const getTotal = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total_real', 'TOTAL_REAL', 'total', 'TOTAL', 'valor', 'VALOR'], 0));
const getStoreRaw = (sale: AnyRow) => String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();
const getCategory = (sale: AnyRow) =>
  String(pick(sale, ['familia', 'FAMILIA', 'categoria_real', 'CATEGORIA_REAL', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS'))
    .trim()
    .toUpperCase();
const getDescription = (sale: AnyRow) => String(pick(sale, ['descricao', 'DESCRICAO', 'produto', 'PRODUTO'], 'N/D')).trim().toUpperCase();
const getQuantity = (sale: AnyRow) => toNumberSafe(pick(sale, ['quantidade', 'QUANTIDADE', 'qtd', 'QTD'], 0));
const getRegion = (sale: AnyRow) => String(pick(sale, ['regiao', 'REGIAO'], 'N/D')).trim().toUpperCase() || 'N/D';

const extractYearMonth = (raw: any): { year: string; month: string; day: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return {
      year: String(raw.getFullYear()),
      month: String(raw.getMonth() + 1).padStart(2, '0'),
      day: String(raw.getDate()).padStart(2, '0'),
    };
  }

  const s = String(raw).trim().replace(/\./g, '/');

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [year, month, day] = s.split('-');
    return { year, month, day };
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [day, month, year] = s.split('/');
    return { year, month, day };
  }

  if (/^\d{4}-\d{2}$/.test(s)) {
    const [year, month] = s.split('-');
    return { year, month, day: '01' };
  }

  const m = s.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})?/);
  if (m?.[1] && m?.[2]) {
    return {
      year: m[1],
      month: String(m[2]).padStart(2, '0'),
      day: String(m[3] || '01').padStart(2, '0'),
    };
  }

  return null;
};

const buildDate = (year: string, month: string, day: string) => new Date(`${year}-${month}-${day}T00:00:00`);

const StatCard = ({
  title,
  value,
  subtitle,
  icon,
  accent = 'border-slate-200',
  valueClass = 'text-slate-900',
}: {
  title: string;
  value: string;
  subtitle: string;
  icon?: React.ReactNode;
  accent?: string;
  valueClass?: string;
}) => (
  <div className={`bg-white rounded-[1.6rem] border ${accent} p-5 shadow-sm min-h-[126px]`}>
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</div>
      {icon ? <div className="text-slate-400">{icon}</div> : null}
    </div>
    <div className={`text-[2rem] leading-none font-black ${valueClass}`}>{value}</div>
    <div className="mt-4 text-[11px] font-bold text-slate-500 uppercase tracking-wide">{subtitle}</div>
  </div>
);

const StoreSelector = ({
  stores,
  selectedStores,
  setSelectedStores,
}: {
  stores: string[];
  selectedStores: string[];
  setSelectedStores: React.Dispatch<React.SetStateAction<string[]>>;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleStore = (store: string) => {
    setSelectedStores((current) =>
      current.includes(store) ? current.filter((item) => item !== store) : [...current, store],
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-12 min-w-[180px] px-4 rounded-2xl border border-slate-200 bg-white flex items-center justify-between gap-3 text-sm font-bold text-slate-700"
      >
        <span className="flex items-center gap-2 truncate">
          <Store size={16} />
          {selectedStores.length ? `${selectedStores.length} lojas` : 'Todas lojas'}
        </span>
        <ChevronDown size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-30 w-[320px] bg-white border border-slate-200 rounded-2xl shadow-2xl p-3">
          <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-slate-100">
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Lojas</span>
            <button
              onClick={() => setSelectedStores([])}
              className="text-[11px] font-black uppercase tracking-widest text-blue-600"
            >
              Limpar
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto pr-1 space-y-1">
            {stores.map((store) => {
              const checked = selectedStores.includes(store);
              return (
                <button
                  key={store}
                  onClick={() => toggleStore(store)}
                  className="w-full px-2 py-2 rounded-xl flex items-center gap-3 text-left hover:bg-slate-50"
                >
                  {checked ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-slate-400" />}
                  <span className="text-sm font-semibold text-slate-700">{store}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<AnyRow[]>([]);
  const [monthlyRawData, setMonthlyRawData] = useState<AnyRow[]>([]);
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [yearA, setYearA] = useState('');
  const [yearB, setYearB] = useState('');
  const [monthFilter, setMonthFilter] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState<'geral' | 'produtos'>('geral');
  const [searchProduct, setSearchProduct] = useState('');

  const getUserId = () => {
    try {
      const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
      if (!rawUser) return '';
      const parsed = JSON.parse(rawUser);
      return String(parsed.id || parsed.userId || parsed._id || '');
    } catch {
      return '';
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const userId = getUserId();
      const [resAnnual, resMonthly] = await Promise.all([
        fetch(`${API_URL}/sales_anuais?userId=${userId}`),
        fetch(`${API_URL}/sales?userId=${userId}`),
      ]);

      if (!resAnnual.ok) throw new Error('Rota de histórico anual não encontrada no servidor.');
      if (!resMonthly.ok) throw new Error('Rota de vendas mensais não encontrada no servidor.');

      const dataAnnual = await resAnnual.json();
      const dataMonthly = await resMonthly.json();

      const annualList =
        (dataAnnual && Array.isArray(dataAnnual.sales) && dataAnnual.sales) ||
        (dataAnnual && Array.isArray(dataAnnual.data) && dataAnnual.data) ||
        (Array.isArray(dataAnnual) ? dataAnnual : []);

      const monthlyList =
        (dataMonthly && Array.isArray(dataMonthly.sales) && dataMonthly.sales) ||
        (dataMonthly && Array.isArray(dataMonthly.data) && dataMonthly.data) ||
        (Array.isArray(dataMonthly) ? dataMonthly : []);

      setAnnualRawData(annualList);
      setMonthlyRawData(monthlyList);
      setErrorMsg('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Erro ao carregar dados anuais.');
      setAnnualRawData([]);
      setMonthlyRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const yearsAvailable = useMemo(() => {
    const set = new Set<string>();
    [...annualRawData, ...monthlyRawData].forEach((sale) => {
      const ym = extractYearMonth(getDateValue(sale));
      if (ym?.year) set.add(ym.year);
    });
    return Array.from(set).sort();
  }, [annualRawData, monthlyRawData]);

  useEffect(() => {
    if (!yearsAvailable.length) return;
    const last = yearsAvailable[yearsAvailable.length - 1];
    const prev = yearsAvailable.length >= 2 ? yearsAvailable[yearsAvailable.length - 2] : last;
    setYearA((cur) => cur || prev);
    setYearB((cur) => cur || last);
  }, [yearsAvailable]);

  useEffect(() => {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-01-01`;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    setStartDate((cur) => cur || firstDay);
    setEndDate((cur) => cur || today);
  }, []);

  useEffect(() => {
    const userId = getUserId();
    if (!userId || !yearA || !yearB) return;
    fetch(`${API_URL}/anuais/lojas_compare?userId=${userId}&yearA=${yearA}&yearB=${yearB}&month=${monthFilter}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Não consegui carregar seguros anuais.'))))
      .then((json) => setCompareRows(Array.isArray(json?.data) ? json.data : []))
      .catch((err: any) => {
        console.error(err);
        setCompareRows([]);
      });
  }, [yearA, yearB, monthFilter]);

  const mergedRawData = useMemo(() => {
    const today = new Date();
    const currentYear = String(today.getFullYear());
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');

    const annualWithoutCurrentMonth = annualRawData.filter((row) => {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym) return false;
      return !(ym.year === currentYear && ym.month === currentMonth);
    });

    const monthlyCurrentMonth = monthlyRawData.filter((row) => {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym) return false;
      return ym.year === currentYear && ym.month === currentMonth;
    });

    return [...annualWithoutCurrentMonth, ...monthlyCurrentMonth];
  }, [annualRawData, monthlyRawData]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    mergedRawData.forEach((sale) => {
      const cat = getCategory(sale);
      if (cat && cat !== 'NAN' && cat !== 'UNDEFINED') categories.add(cat);
    });
    return Array.from(categories).sort();
  }, [mergedRawData]);

  const uniqueStores = useMemo(() => {
    const stores = new Set<string>();
    mergedRawData.forEach((sale) => stores.add(getStoreName(getStoreRaw(sale))));
    return Array.from(stores).sort();
  }, [mergedRawData]);

  const filteredRawData = useMemo(() => {
    const monthNum = Number(monthFilter || 0);
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59`) : null;

    return mergedRawData.filter((sale) => {
      const storeName = getStoreName(getStoreRaw(sale));
      const category = getCategory(sale);
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) return false;
      const date = buildDate(ym.year, ym.month, ym.day);

      if (selectedStores.length > 0 && !selectedStores.includes(storeName)) return false;
      if (categoryFilter !== 'TODAS' && category !== categoryFilter) return false;
      if (monthNum >= 1 && Number(ym.month) !== monthNum) return false;
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    });
  }, [mergedRawData, selectedStores, categoryFilter, monthFilter, startDate, endDate]);

  const compareRowsFiltered = useMemo(() => {
    return compareRows.filter((row) => {
      if (selectedStores.length > 0 && !selectedStores.includes(String(row.loja || '').toUpperCase())) return false;
      if (Number(monthFilter || 0) >= 1 && Number(row.mes || 0) !== Number(monthFilter)) return false;
      return true;
    });
  }, [compareRows, selectedStores, monthFilter]);

  const computed = useMemo(() => {
    const totalsByYearMonth: Record<string, Record<string, number>> = {};
    const totalsByYearCategory: Record<string, Record<string, number>> = {};
    const totalsByYearRegion: Record<string, Record<string, number>> = {};
    const totalsByYearStore: Record<string, Record<string, number>> = {};
    const totalByYear: Record<string, number> = {};
    const totalQtyByYear: Record<string, number> = {};

    const years = [yearA, yearB].filter(Boolean);
    years.forEach((year) => {
      totalsByYearMonth[year] = {};
      totalsByYearCategory[year] = {};
      totalsByYearRegion[year] = {};
      totalsByYearStore[year] = {};
      totalByYear[year] = 0;
      totalQtyByYear[year] = 0;
      for (let m = 1; m <= 12; m++) totalsByYearMonth[year][String(m).padStart(2, '0')] = 0;
    });

    filteredRawData.forEach((sale) => {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym || !years.includes(ym.year)) return;
      const total = getTotal(sale);
      const qty = getQuantity(sale);
      const category = getCategory(sale);
      const region = getRegion(sale);
      const storeName = getStoreName(getStoreRaw(sale));

      totalsByYearMonth[ym.year][ym.month] = (totalsByYearMonth[ym.year][ym.month] || 0) + total;
      totalsByYearCategory[ym.year][category] = (totalsByYearCategory[ym.year][category] || 0) + total;
      totalsByYearRegion[ym.year][region] = (totalsByYearRegion[ym.year][region] || 0) + total;
      totalsByYearStore[ym.year][storeName] = (totalsByYearStore[ym.year][storeName] || 0) + total;
      totalByYear[ym.year] = (totalByYear[ym.year] || 0) + total;
      totalQtyByYear[ym.year] = (totalQtyByYear[ym.year] || 0) + qty;
    });

    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const daysInCurrentMonth = new Date(now.getFullYear(), currentMonth, 0).getDate();
    const daysPassedInYear = Math.max(1, Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + 1);
    const daysInYear = new Date(now.getFullYear(), 11, 31).getDate() === 31 ? (new Date(now.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365) : 365;

    const cutoffMonth = endDate ? Number((endDate.split('-')[1] || currentMonth).replace(/^0/, '') || currentMonth) : currentMonth;
    const totalA = yearA ? totalByYear[yearA] || 0 : 0;
    const totalAUntilCutoff = yearA
      ? Object.entries(totalsByYearMonth[yearA] || {})
          .filter(([month]) => Number(month) <= cutoffMonth)
          .reduce((acc, [, value]) => acc + value, 0)
      : 0;
    const totalB = yearB ? totalByYear[yearB] || 0 : 0;

    const currentMonthKey = String(currentMonth).padStart(2, '0');
    const currentMonthRealB = yearB ? totalsByYearMonth[yearB]?.[currentMonthKey] || 0 : 0;

    let yearForecast = totalB;
    let monthForecast = currentMonthRealB;
    let monthRemainingForecast = 0;

    if (yearB === currentYear) {
      monthForecast = currentDay > 0 ? (currentMonthRealB / currentDay) * daysInCurrentMonth : currentMonthRealB;
      monthRemainingForecast = Math.max(0, monthForecast - currentMonthRealB);
      yearForecast = daysPassedInYear > 0 ? (totalB / daysPassedInYear) * daysInYear : totalB;
    }

    const growthPct = totalA > 0 ? ((yearForecast - totalA) / totalA) * 100 : 0;

    const chartData = MONTH_LABELS.map((label, index) => {
      const month = String(index + 1).padStart(2, '0');
      const realA = yearA ? totalsByYearMonth[yearA]?.[month] || 0 : 0;
      const realB = yearB ? totalsByYearMonth[yearB]?.[month] || 0 : 0;
      const isCurrentMonth = yearB === currentYear && month === currentMonthKey;
      const remaining = isCurrentMonth ? monthRemainingForecast : 0;

      return {
        mes: label,
        [`${yearA} Real`]: realA,
        [`${yearB} Real`]: realB,
        [`${yearB} Tendência restante`]: remaining,
      };
    });

    const getBestStore = (year: string) => {
      const entries = Object.entries(totalsByYearStore[year] || {}).sort((a, b) => b[1] - a[1]);
      return entries[0] ? { nome: entries[0][0], total: entries[0][1] } : { nome: '—', total: 0 };
    };

    const segurosYearB = compareRowsFiltered
      .filter((row) => String(row.ano) === yearB)
      .reduce(
        (acc, row) => {
          acc.total += toNumberSafe(row.seguro_total);
          acc.qtd += toNumberSafe(row.seguro_qtd);
          return acc;
        },
        { total: 0, qtd: 0 },
      );

    const categoryMiniData = Object.entries(totalsByYearCategory[yearB] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    const regionPieData = Object.entries(totalsByYearRegion[yearB] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    const groupedProducts = Object.values(
      filteredRawData.reduce((acc: Record<string, any>, sale) => {
        const ym = extractYearMonth(getDateValue(sale));
        if (!ym || String(ym.year) !== yearB) return acc;

        const description = getDescription(sale);
        const category = getCategory(sale);
        const total = getTotal(sale);
        const qty = getQuantity(sale);
        const key = `${description}__${category}`;
        if (!acc[key]) acc[key] = { descricao: description, categoria: category, faturamento: 0, quantidade: 0 };
        acc[key].faturamento += total;
        acc[key].quantidade += qty;
        return acc;
      }, {}),
    )
      .sort((a: any, b: any) => b.faturamento - a.faturamento)
      .filter((row: any) => {
        const term = searchProduct.trim().toUpperCase();
        if (!term) return true;
        return String(row.descricao).includes(term) || String(row.categoria).includes(term);
      });

    return {
      chartData,
      totalA,
      totalAUntilCutoff,
      totalB,
      bestB: yearB ? getBestStore(yearB) : { nome: '—', total: 0 },
      yearForecast,
      growthPct,
      segurosYearB,
      categoryMiniData,
      regionPieData,
      groupedProducts,
    };
  }, [filteredRawData, compareRowsFiltered, yearA, yearB, endDate, monthFilter, searchProduct]);

  const monthLabel = monthFilter !== '0' ? MONTH_FULL[Number(monthFilter)] || 'Mês' : 'Ano completo';

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
      <div className="bg-white rounded-[2rem] border border-slate-200 p-5 md:p-6 shadow-sm mb-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-700 text-white flex items-center justify-center shadow-lg">
                <Activity size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-indigo-700">Vendas anuais</h1>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                  Histórico completo • comparativo entre anos • produtos
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="h-12 px-4 rounded-2xl border border-slate-200 bg-white flex items-center gap-3">
              <Calendar size={16} className="text-slate-400" />
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="outline-none text-sm font-bold text-slate-700 bg-transparent" />
            </div>
            <div className="h-12 px-4 rounded-2xl border border-slate-200 bg-white flex items-center gap-3">
              <Calendar size={16} className="text-slate-400" />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="outline-none text-sm font-bold text-slate-700 bg-transparent" />
            </div>
            <select value={yearA} onChange={(e) => setYearA(e.target.value)} className="h-12 px-4 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
              {yearsAvailable.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select value={yearB} onChange={(e) => setYearB(e.target.value)} className="h-12 px-4 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
              {yearsAvailable.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-12 px-4 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
              <option value="0">Todos os meses</option>
              {Object.entries(MONTH_FULL).map(([num, label]) => (
                <option key={num} value={num}>{label}</option>
              ))}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-12 px-4 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 min-w-[170px]">
              <option value="TODAS">Todas categorias</option>
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <StoreSelector stores={uniqueStores} selectedStores={selectedStores} setSelectedStores={setSelectedStores} />
            <button onClick={loadData} className="h-12 px-5 rounded-2xl bg-blue-700 text-white text-sm font-black flex items-center gap-2 shadow-lg hover:bg-blue-800">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          {errorMsg}
        </div>
      ) : null}

      <div className="flex gap-3 mb-4">
        <button onClick={() => setActiveTab('geral')} className={`px-5 h-11 rounded-2xl text-sm font-black uppercase tracking-tight shadow-sm ${activeTab === 'geral' ? 'bg-blue-700 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          Visão geral
        </button>
        <button onClick={() => setActiveTab('produtos')} className={`px-5 h-11 rounded-2xl text-sm font-black uppercase tracking-tight shadow-sm ${activeTab === 'produtos' ? 'bg-white border border-slate-900 text-slate-900' : 'bg-white border border-slate-200 text-slate-600'}`}>
          Comparativo de produtos
        </button>
      </div>

      {activeTab === 'geral' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
            <StatCard
              title={`Card 1 · ${yearA}`}
              value={formatMoney(computed.totalA)}
              subtitle={`${yearA} até ${monthLabel}: ${formatMoney(computed.totalAUntilCutoff)}`}
              icon={<Calendar size={18} />}
              accent="border-slate-200"
              valueClass="text-indigo-700"
            />
            <StatCard
              title={`Card 2 · ${yearB}`}
              value={formatMoney(computed.totalB)}
              subtitle={`Melhor loja: ${computed.bestB.nome} • ${formatMoney(computed.bestB.total)}`}
              icon={<Store size={18} />}
              accent="border-slate-200"
              valueClass="text-sky-600"
            />
            <StatCard
              title={`Card 3 · Tendência ${yearB}`}
              value={formatMoney(computed.yearForecast)}
              subtitle={`Crescimento: ${computed.growthPct.toFixed(2)}%`}
              icon={<TrendingUp size={18} />}
              accent="border-slate-200"
              valueClass="text-emerald-600"
            />
            <StatCard
              title="Card 4 · Seguros"
              value={formatMoney(computed.segurosYearB.total)}
              subtitle={`Qtd. seguros: ${computed.segurosYearB.qtd.toLocaleString('pt-BR')}`}
              icon={<ShieldCheck size={18} />}
              accent="border-slate-200"
              valueClass="text-fuchsia-600"
            />
            <div className="bg-white rounded-[1.6rem] border border-slate-200 p-5 shadow-sm min-h-[126px]">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Card 5 · Categorias</div>
                <BarChart3 size={18} className="text-slate-400" />
              </div>
              <div className="h-[86px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={computed.categoryMiniData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#2563eb" />
                    <XAxis dataKey="name" hide />
                    <Tooltip formatter={(v: any) => formatMoney(Number(v || 0))} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">Top categorias de {yearB}</div>
            </div>
            <div className="bg-white rounded-[1.6rem] border border-slate-200 p-5 shadow-sm min-h-[126px]">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Card 6 · Regiões</div>
                <PieChartIcon size={18} className="text-slate-400" />
              </div>
              <div className="h-[86px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={computed.regionPieData} dataKey="value" nameKey="name" innerRadius={20} outerRadius={34} paddingAngle={2}>
                      {computed.regionPieData.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatMoney(Number(v || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">Distribuição de {yearB}</div>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-200 p-5 shadow-sm mb-4">
            <div className="flex items-center gap-2 mb-5">
              <Activity size={16} className="text-blue-700" />
              <h2 className="text-lg font-black uppercase tracking-tight">Vendas por mês ({yearA} x {yearB})</h2>
            </div>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={computed.chartData} margin={{ top: 12, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatMoneyShort} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} axisLine={false} tickLine={false} width={76} />
                  <Tooltip
                    cursor={{ fill: 'rgba(37,99,235,0.06)' }}
                    formatter={(value: any, name: any) => [formatMoney(Number(value || 0)), String(name)]}
                    labelFormatter={(label) => `Mês: ${label}`}
                    contentStyle={{ borderRadius: 16, borderColor: '#cbd5e1' }}
                  />
                  <Legend />
                  <Bar dataKey={`${yearA} Real`} name={`${yearA} Real`} fill="#1d4ed8" radius={[10, 10, 0, 0]} />
                  <Bar dataKey={`${yearB} Real`} name={`${yearB} Real (até agora)`} fill="#7dd3fc" radius={[10, 10, 0, 0]} />
                  <Bar dataKey={`${yearB} Tendência restante`} name={`${yearB} Tendência restante`} stackId="trend" fill="#0f766e" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-200 p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight">Comparativo de produtos</h2>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Baseada no ano {yearB} com os filtros aplicados</p>
            </div>
            <div className="h-12 px-4 rounded-2xl border border-slate-200 bg-white flex items-center gap-3 min-w-[280px]">
              <Filter size={16} className="text-slate-400" />
              <input
                value={searchProduct}
                onChange={(e) => setSearchProduct(e.target.value)}
                placeholder="Buscar por produto ou categoria"
                className="w-full bg-transparent outline-none text-sm font-semibold text-slate-700"
              />
            </div>
          </div>

          <div className="overflow-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Descrição</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Categoria</th>
                  <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Qtd.</th>
                  <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {computed.groupedProducts.map((row: any, idx: number) => (
                  <tr key={`${row.descricao}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="px-4 py-3 font-black text-slate-900">{row.descricao}</td>
                    <td className="px-4 py-3 font-semibold text-slate-600">{row.categoria}</td>
                    <td className="px-4 py-3 text-right font-black text-slate-700">{row.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right font-black text-blue-700">{formatMoney(row.faturamento)}</td>
                  </tr>
                ))}
                {!computed.groupedProducts.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                      Nenhum produto encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
