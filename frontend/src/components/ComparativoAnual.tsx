//ARQUIVO DE VENDAS ANUAIS - TUDO QUE FOI VENDIDO NESSE ANO

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckSquare,
  ChevronDown,
  Filter,
  Layers,
  Minus,
  Package,
  PieChart,
  Search,
  ShieldCheck,
  Square,
  Store,
  TrendingUp,
} from 'lucide-react';

const STORE_MAP: Record<string, string> = {
  "12309173001309": "ARAGUAIA SHOPPING",
  "12309173000418": "BOULEVARD SHOPPING",
  "12309173000175": "BRASILIA SHOPPING",
  "12309173000680": "CONJUNTO NACIONAL",
  "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
  "12309173000507": "GOIANIA SHOPPING",
  "12309173000256": "IGUATEMI SHOPPING",
  "12309173000841": "JK SHOPPING",
  "12309173000337": "PARK SHOPPING",
  "12309173000922": "PATIO BRASIL",
  "12309173000760": "TAGUATINGA SHOPPING",
  "12309173001147": "TERRAÇO SHOPPING",
  "12309173001651": "TAGUATINGA SHOPPING QQ",
  "12309173001732": "UBERLÂNDIA SHOPPING",
  "12309173001813": "UBERABA SHOPPING",
  "12309173001570": "FLAMBOYANT SHOPPING",
  "12309173002119": "BURITI SHOPPING",
  "12309173002461": "PASSEIO DAS AGUAS",
  "12309173002038": "PORTAL SHOPPING",
  "12309173002208": "SHOPPING SUL",
  "12309173001902": "BURITI RIO VERDE",
  "12309173002380": "PARK ANAPOLIS",
  "12309173002542": "SHOPPING RECIFE",
  "12309173002895": "MANAIRA SHOPPING",
  "12309173002976": "IGUATEMI FORTALEZA",
  "12309173001066": "CD TAGUATINGA",
};

const STORE_REGION_MAP: Record<string, string> = {
  'ARAGUAIA SHOPPING': 'GOIÁS',
  'BOULEVARD SHOPPING': 'DF',
  'BRASILIA SHOPPING': 'DF',
  'CONJUNTO NACIONAL': 'DF',
  'CONJUNTO NACIONAL QUIOSQUE': 'DF',
  'GOIANIA SHOPPING': 'GOIÁS',
  'IGUATEMI SHOPPING': 'DF',
  'JK SHOPPING': 'DF',
  'PARK SHOPPING': 'DF',
  'PATIO BRASIL': 'DF',
  'TAGUATINGA SHOPPING': 'DF',
  'TERRAÇO SHOPPING': 'DF',
  'TAGUATINGA SHOPPING QQ': 'DF',
  'UBERLÂNDIA SHOPPING': 'MINAS GERAIS',
  'UBERABA SHOPPING': 'MINAS GERAIS',
  'FLAMBOYANT SHOPPING': 'GOIÁS',
  'BURITI SHOPPING': 'GOIÁS',
  'PASSEIO DAS AGUAS': 'GOIÁS',
  'PORTAL SHOPPING': 'GOIÁS',
  'SHOPPING SUL': 'GOIÁS',
  'BURITI RIO VERDE': 'GOIÁS',
  'PARK ANAPOLIS': 'GOIÁS',
  'SHOPPING RECIFE': 'NORDESTE',
  'MANAIRA SHOPPING': 'NORDESTE',
  'IGUATEMI FORTALEZA': 'NORDESTE',
  'CD TAGUATINGA': 'CD',
};

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const MONTH_FULL: Record<number, string> = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro',
};

/* ============================== Paleta ==============================
   Base: laranja da empresa + grafite/slate (neutro profissional).
   Ano anterior = grafite | Ano atual = laranja | Tendência = laranja claro */
const THEME = {
  orange: '#F97316',
  orangeDark: '#C2410C',
  orangeSoft: '#FDBA74',
  slate: '#475569',
  slateDark: '#0F172A',
};

const CHART_COLORS = {
  yearA: THEME.slate,
  yearBReal: THEME.orange,
  yearBProjection: THEME.orangeSoft,
};

// Regiões: tons de laranja alternados com grafite, para manter a identidade visual.
const PIE_COLORS = ['#F97316', '#334155', '#FB923C', '#64748B', '#FDBA74', '#94A3B8', '#C2410C', '#CBD5E1'];

type AnyRow = Record<string, any>;

const formatMoney = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

const formatMoneyShort = (val: number) => {
  if (!val) return 'R$ 0';
  if (val >= 1_000_000) return `R$ ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R$ ${(val / 1_000).toFixed(0)}k`;
  return `R$ ${val.toFixed(0)}`;
};

const pick = (obj: AnyRow, keys: string[], fallback: any = undefined) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
};

// Cálculo de vendas anuais
const toNumberSafe = (v: any) => {
  if (v === null || v === undefined) return 0;

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }

  let s = String(v)
    .trim()
    .replace(/\s/g, '')
    .replace(/[R$\u00A0]/g, '');

  // Formato brasileiro: 1.234,56 ou 10,50
  if (s.includes(',')) {
    s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  } else {
    // Se houver mais de um ponto, tratamos como separador de milhar.
    if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
  }

  // Mantém somente números, ponto decimal e sinal negativo.
  s = s.replace(/[^0-9.-]/g, '');

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const getStoreName = (raw: string) => {
  if (!raw) return 'N/D';
  const clean = raw.replace(/\D/g, '');
  return STORE_MAP[clean] || STORE_MAP[raw] || raw;
};

const getDateValue = (sale: AnyRow) =>
  pick(sale, ['data_emissao', 'DATA_EMISSAO', 'data', 'DATA', 'date', 'DATE'], '');

const getTotal = (sale: AnyRow) =>
  toNumberSafe(
    pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total_real', 'TOTAL_REAL', 'total', 'TOTAL', 'valor', 'VALOR'], 0)
  );

const getStoreRaw = (sale: AnyRow) =>
  String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();

const getCategory = (sale: AnyRow) =>
  String(
    pick(sale, ['familia', 'FAMILIA', 'categoria_real', 'CATEGORIA_REAL', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS')
  )
    .trim()
    .toUpperCase();

const getRegion = (sale: AnyRow) => {
  const rawRegion = String(pick(sale, ['regiao', 'REGIAO'], '')).trim().toUpperCase();
  if (rawRegion && rawRegion !== 'N/D' && rawRegion !== 'NAN' && rawRegion !== 'UNDEFINED') return rawRegion;
  const store = getStoreName(getStoreRaw(sale)).toUpperCase();
  return STORE_REGION_MAP[store] || 'SEM REGIÃO';
};

const getDescription = (sale: AnyRow) =>
  String(pick(sale, ['descricao', 'DESCRICAO', 'produto', 'PRODUTO'], 'N/D')).trim().toUpperCase();

const getQuantity = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['quantidade', 'QUANTIDADE', 'qtd', 'QTD'], 0));

const extractYearMonth = (raw: any): { year: string; month: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return {
      year: String(raw.getFullYear()),
      month: String(raw.getMonth() + 1).padStart(2, '0'),
    };
  }

  const s = String(raw).trim();

  if (/^\d{4}$/.test(s)) return { year: s, month: '01' };

  const normalized = s.replace(/\./g, '/').replace(/\s+/g, '');

  if (normalized.includes('-')) {
    const parts = normalized.split('-').filter(Boolean);
    if (/^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
    if (
      parts.length === 3 &&
      /^\d{4}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      /^\d{1,2}$/.test(parts[2])
    ) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
  }

  if (normalized.includes('/')) {
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }
    if (
      parts.length === 3 &&
      /^\d{1,2}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      /^\d{4}$/.test(parts[2])
    ) {
      return { year: parts[2], month: String(parts[1]).padStart(2, '0') };
    }
  }

  const m = normalized.match(/(\d{4}).*?(\d{1,2})/);
  if (m?.[1] && m?.[2]) return { year: m[1], month: String(m[2]).padStart(2, '0') };

  return null;
};

const parseDateLoose = (raw: any): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(`${s}-01T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const isWithinDateRange = (raw: any, startDate: string, endDate: string) => {
  const value = parseDateLoose(raw);
  if (!value) return false;

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);
    if (value < start) return false;
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59`);
    if (value > end) return false;
  }

  return true;
};

const SmallMetricCard = ({
  title,
  icon,
  value,
  subtitle,
  valueClass = 'text-slate-900',
  children,
}: {
  title: string;
  icon: React.ReactNode;
  value?: string;
  subtitle?: string;
  valueClass?: string;
  children?: React.ReactNode;
}) => (
  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm min-h-[150px] flex flex-col">
    <div className="flex justify-between items-start mb-3">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{title}</span>
      <div className="p-1.5 rounded-lg bg-orange-50 text-orange-600">{icon}</div>
    </div>
    {children ? (
      <div className="w-full flex-1">{children}</div>
    ) : (
      <>
        <h3 className={`text-2xl font-black tracking-tight ${valueClass}`}>{value}</h3>
        {subtitle && (
          <div className="text-[10px] font-bold text-slate-500 uppercase mt-3 whitespace-pre-line leading-relaxed">
            {subtitle}
          </div>
        )}
      </>
    )}
  </div>
);

// Item da legenda personalizada do gráfico
const LegendItem = ({ color, label }: { color: string; label: string }) => (
  <span className="flex items-center gap-2 text-xs font-bold text-slate-600">
    <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ backgroundColor: color }} />
    {label}
  </span>
);

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [monthlyRawData, setMonthlyRawData] = useState<any[]>([]);
  const [annualStoreCompareRows, setAnnualStoreCompareRows] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [monthFilter, setMonthFilter] = useState<string>('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [yearA, setYearA] = useState<string>('');
  const [yearB, setYearB] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'geral' | 'produtos'>('geral');
  const [searchProduct, setSearchProduct] = useState('');

  const API_URL = useMemo(() => {
    const envUrl = String(
      import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_BACKEND_URL ||
      ''
    ).trim();

    if (envUrl) return envUrl.replace(/\/$/, '');

    const hostname = window.location.hostname;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.endsWith('.local');

    return isLocal ? `http://${hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';
  }, []);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) setIsStoreMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getUserId = () => {
    let userId = '';
    try {
      const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        userId = parsed.id || parsed.userId || parsed._id || '';
      }
    } catch (e) {
      console.error(e);
    }
    return userId;
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

  const yearsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const sale of mergedRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (ym?.year) set.add(ym.year);
    }
    return Array.from(set).sort();
  }, [mergedRawData]);

  useEffect(() => {
    if (!yearsAvailable.length) return;
    const latest = yearsAvailable[yearsAvailable.length - 1];
    const previous = yearsAvailable.length >= 2 ? yearsAvailable[yearsAvailable.length - 2] : latest;
    setYearA((cur) => cur || previous);
    setYearB((cur) => cur || latest);
  }, [yearsAvailable]);

  useEffect(() => {
    const loadAnnualStoreCompare = async () => {
      if (!yearA || !yearB) return;
      try {
        const userId = getUserId();
        const month = Number(monthFilter || '0');
        const res = await fetch(
          `${API_URL}/anuais/lojas_compare?userId=${encodeURIComponent(userId)}&yearA=${encodeURIComponent(yearA)}&yearB=${encodeURIComponent(yearB)}&month=${month}`
        );
        if (!res.ok) throw new Error('Rota de comparação anual por lojas não encontrada.');
        const json = await res.json();
        const rows = (json && Array.isArray(json.data) && json.data) || (Array.isArray(json) ? json : []);
        setAnnualStoreCompareRows(rows);
      } catch (e: any) {
        console.error(e);
        setAnnualStoreCompareRows([]);
      }
    };
    loadAnnualStoreCompare();
  }, [API_URL, yearA, yearB, monthFilter]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(
      mergedRawData.map((r) => getCategory(r)).filter((c) => c && c !== 'NAN' && c !== 'UNDEFINED')
    );
    return Array.from(cats).sort();
  }, [mergedRawData]);

  const uniqueStores = useMemo(() => {
    const stores = new Set(mergedRawData.map((r) => getStoreName(getStoreRaw(r))).filter(Boolean));
    return Array.from(stores).sort();
  }, [mergedRawData]);

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) setSelectedStores(selectedStores.filter((s) => s !== store));
    else setSelectedStores([...selectedStores, store]);
  };

  const clearDates = () => {
    setStartDate('');
    setEndDate('');
  };

  const filteredRawData = useMemo(() => {
    return mergedRawData.filter((sale) => {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) return false;

      const storeName = getStoreName(getStoreRaw(sale)).toUpperCase();

      if (selectedStores.length > 0 && !selectedStores.map((s) => s.toUpperCase()).includes(storeName)) {
        return false;
      }

      if (categoryFilter !== 'TODAS' && getCategory(sale) !== categoryFilter) {
        return false;
      }

      if (monthFilter !== '0' && ym.month !== String(monthFilter).padStart(2, '0')) {
        return false;
      }

      if ((startDate || endDate) && !isWithinDateRange(getDateValue(sale), startDate, endDate)) {
        return false;
      }

      return true;
    });
  }, [mergedRawData, selectedStores, categoryFilter, monthFilter, startDate, endDate]);

  const filteredAnnualStoreCompare = useMemo(() => {
    return annualStoreCompareRows.filter((row) => {
      const storeName = getStoreName(String(row.loja || row.LOJA || row.cnpj_empresa || row.CNPJ_EMPRESA || ''));
      if (selectedStores.length > 0 && !selectedStores.map((s) => s.toUpperCase()).includes(storeName.toUpperCase())) {
        return false;
      }
      return true;
    });
  }, [annualStoreCompareRows, selectedStores]);

  const computed = useMemo(() => {
    const today = new Date();
    const currentYear = String(today.getFullYear());
    const currentMonth = today.getMonth() + 1;
    const currentDay = Math.max(1, today.getDate());
    const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const daysPassedInYear = Math.max(
      1,
      Math.floor((today.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );
    const daysInYear = today.getFullYear() % 4 === 0 ? 366 : 365;

    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const years = [yearA, yearB].filter(Boolean);

    const totalsByYearMonth: Record<string, Record<string, number>> = {};
    const storeTotalsByYear: Record<string, Record<string, number>> = {};
    const totalByYear: Record<string, number> = {};

    for (const year of years) {
      totalsByYearMonth[year] = {};
      storeTotalsByYear[year] = {};
      totalByYear[year] = 0;
      for (const month of monthKeys) totalsByYearMonth[year][month] = 0;
    }

    for (const sale of filteredRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym || !years.includes(ym.year)) continue;

      const total = getTotal(sale);
      if (!total) continue;

      const storeName = getStoreName(getStoreRaw(sale));

      totalsByYearMonth[ym.year][ym.month] = (totalsByYearMonth[ym.year][ym.month] || 0) + total;
      storeTotalsByYear[ym.year][storeName] = (storeTotalsByYear[ym.year][storeName] || 0) + total;
      totalByYear[ym.year] += total;
    }

    let currentMonthRealYearB = 0;

    const chartData = monthKeys.map((month, idx) => {
      const totalYearA = yearA ? totalsByYearMonth[yearA]?.[month] || 0 : 0;
      const totalYearB = yearB ? totalsByYearMonth[yearB]?.[month] || 0 : 0;

      const row: AnyRow = {
        mes: MONTH_LABELS[idx],
        mesNumero: month,
        [yearA]: totalYearA,
        [`${yearB}_real`]: totalYearB,
        [`${yearB}_proj`]: 0,
        // Campos auxiliares só para os rótulos: evita sobreposição no mês com tendência.
        [`${yearB}_realLabel`]: totalYearB,
        [`${yearB}_projLabel`]: 0,
      };

      if (yearB === currentYear && Number(month) === currentMonth) {
        currentMonthRealYearB = totalYearB;
        const projectedMonth = currentDay > 0 ? (totalYearB / currentDay) * daysInCurrentMonth : totalYearB;
        const remaining = Math.max(0, projectedMonth - totalYearB);
        row[`${yearB}_proj`] = remaining;
        if (remaining > 0) {
          row[`${yearB}_realLabel`] = 0;
          row[`${yearB}_projLabel`] = totalYearB + remaining;
        }
      }

      return row;
    });

    const totalA = yearA ? totalByYear[yearA] || 0 : 0;
    const totalB = yearB ? totalByYear[yearB] || 0 : 0;

    const cutoffMonth = monthFilter !== '0' ? Number(monthFilter) : currentMonth;

    const totalAUntilCurrentMonth = yearA
      ? monthKeys
          .filter((m) => Number(m) <= cutoffMonth)
          .reduce((sum, m) => sum + (totalsByYearMonth[yearA]?.[m] || 0), 0)
      : 0;

    const hasExplicitDateFilter = Boolean(startDate || endDate);
    const hasSingleMonthFilter = monthFilter !== '0';

    let localYearForecast = totalB;
    let trendLabel = 'Ano fechado';

    if (yearB === currentYear && !hasExplicitDateFilter) {
      if (hasSingleMonthFilter && Number(monthFilter) === currentMonth) {
        localYearForecast = totalB - currentMonthRealYearB + (currentDay > 0 ? (currentMonthRealYearB / currentDay) * daysInCurrentMonth : currentMonthRealYearB);
        trendLabel = 'Projeção do mês atual no recorte';
      } else if (!hasSingleMonthFilter) {
        localYearForecast = daysPassedInYear > 0 ? (totalB / daysPassedInYear) * daysInYear : totalB;
        trendLabel = 'Projeção anual pelo ritmo atual';
      } else {
        localYearForecast = totalB;
        trendLabel = 'Filtro de mês fechado';
      }
    } else if (hasExplicitDateFilter) {
      trendLabel = 'Filtro de datas aplicado';
    }

    const bestStoreByYear = (year: string) => {
      const entries = Object.entries(storeTotalsByYear[year] || {})
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);
      return entries[0] || { nome: '—', total: 0 };
    };

    const bestB = yearB ? bestStoreByYear(yearB) : { nome: '—', total: 0 };
    const growthVsYearA = totalA > 0 ? ((localYearForecast - totalA) / totalA) * 100 : 0;

    return {
      chartData,
      totalA,
      totalAUntilCurrentMonth,
      totalB,
      bestB,
      localMonthSoFar: currentMonthRealYearB,
      localMonthForecast:
        yearB === currentYear && currentDay > 0
          ? Math.max(currentMonthRealYearB, (currentMonthRealYearB / currentDay) * daysInCurrentMonth)
          : currentMonthRealYearB,
      localYearForecast: Math.max(localYearForecast, totalB),
      trendLabel,
      growthVsYearA,
      cutoffLabel:
        monthFilter !== '0'
          ? `Até ${MONTH_FULL[Number(monthFilter)]}`
          : yearB === currentYear
            ? 'Até mês atual'
            : 'Ano completo',
    };
  }, [filteredRawData, yearA, yearB, monthFilter, startDate, endDate]);

  const segurosComputed = useMemo(() => {
    const byYear: Record<string, { total: number; qtd: number }> = {
      [yearA]: { total: 0, qtd: 0 },
      [yearB]: { total: 0, qtd: 0 },
    };

    for (const row of filteredAnnualStoreCompare) {
      const year = String(row.ano || row.ANO || '');
      if (year !== yearA && year !== yearB) continue;

      byYear[year] = {
        total: (byYear[year]?.total || 0) + toNumberSafe(row.seguro_total || row.SEGURO_TOTAL || 0),
        qtd: (byYear[year]?.qtd || 0) + toNumberSafe(row.seguro_qtd || row.SEGURO_QTD || 0),
      };
    }

    const hasInsurance = Object.values(byYear).some((item) => item.total !== 0 || item.qtd !== 0);

    if (!hasInsurance) {
      for (const row of filteredRawData) {
        const ym = extractYearMonth(getDateValue(row));
        if (!ym || (ym.year !== yearA && ym.year !== yearB)) continue;

        const text = `${getCategory(row)} ${getDescription(row)}`;
        const looksLikeInsurance = /SEGURO|PROTECAO|PROTEÇÃO|GARANTIA/.test(text);
        if (!looksLikeInsurance) continue;

        byYear[ym.year].total += getTotal(row);
        byYear[ym.year].qtd += getQuantity(row) || 1;
      }
    }

    return {
      yearA: byYear[yearA] || { total: 0, qtd: 0 },
      yearB: byYear[yearB] || { total: 0, qtd: 0 },
    };
  }, [filteredAnnualStoreCompare, filteredRawData, yearA, yearB]);

  const categoryMiniData = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of filteredRawData) {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym || ym.year !== yearB) continue;
      const category = getCategory(row) || 'OUTROS';
      map.set(category, (map.get(category) || 0) + getTotal(row));
    }

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredRawData, yearB]);

  const regionPieData = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of filteredRawData) {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym || ym.year !== yearB) continue;
      const region = getRegion(row) || 'SEM REGIÃO';
      map.set(region, (map.get(region) || 0) + getTotal(row));
    }

    const sorted = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Mostra as 6 maiores regiões e agrupa o restante em "OUTRAS".
    if (sorted.length <= 7) return sorted;
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6).reduce((sum, r) => sum + r.value, 0);
    return [...top, { name: 'OUTRAS', value: rest }];
  }, [filteredRawData, yearB]);

  const regionTotal = useMemo(() => regionPieData.reduce((sum, r) => sum + r.value, 0), [regionPieData]);
  const categoryMax = useMemo(() => Math.max(1, ...categoryMiniData.map((c) => c.value)), [categoryMiniData]);

  const productComparison = useMemo(() => {
    const prodMap = new Map<string, { desc: string; totalA: number; qtdA: number; totalB: number; qtdB: number }>();

    for (const sale of filteredRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) continue;

      const isYearA = ym.year === yearA;
      const isYearB = ym.year === yearB;
      if (!isYearA && !isYearB) continue;

      const desc = getDescription(sale);
      const total = getTotal(sale);
      const qtd = getQuantity(sale);

      if (!prodMap.has(desc)) {
        prodMap.set(desc, { desc, totalA: 0, qtdA: 0, totalB: 0, qtdB: 0 });
      }

      const current = prodMap.get(desc)!;

      if (isYearA) {
        current.totalA += total;
        current.qtdA += qtd;
      }
      if (isYearB) {
        current.totalB += total;
        current.qtdB += qtd;
      }
    }

    return Array.from(prodMap.values())
      .map((p) => {
        let crescimentoPct = 0;
        if (p.totalA > 0) crescimentoPct = ((p.totalB - p.totalA) / p.totalA) * 100;
        else if (p.totalB > 0) crescimentoPct = 100;
        return { ...p, crescimentoPct };
      })
      .sort((a, b) => b.totalB - a.totalB);
  }, [filteredRawData, yearA, yearB]);

  const searchedProducts = useMemo(() => {
    if (!searchProduct) return productComparison;
    const term = searchProduct.toLowerCase();
    return productComparison.filter((p) => p.desc.toLowerCase().includes(term));
  }, [productComparison, searchProduct]);

  const topProductA = useMemo(() => {
    return [...productComparison].sort((a, b) => b.totalA - a.totalA)[0] || null;
  }, [productComparison]);

  const topProductB = useMemo(() => {
    return [...productComparison].sort((a, b) => b.totalB - a.totalB)[0] || null;
  }, [productComparison]);

  const maxGrowthProduct = useMemo(() => {
    const valid = productComparison.filter((p) => p.totalA > 10000);
    return valid.sort((a, b) => b.crescimentoPct - a.crescimentoPct)[0] || null;
  }, [productComparison]);

  const noData = computed.totalA + computed.totalB + segurosComputed.yearB.total <= 0;

  // Nomes usados no tooltip do gráfico
  const chartLegendNameMap: Record<string, string> = useMemo(() => ({
    [yearA]: `${yearA}`,
    [`${yearB}_real`]: `${yearB}`,
    [`${yearB}_proj`]: `${yearB} Tendência`,
  }), [yearA, yearB]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-slate-50 font-sans text-slate-800">
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <AlertCircle size={20} />
          <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* Cabeçalho + filtros */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-orange-500 rounded-lg text-white"><Activity size={18} /></div>
            <h1 className="text-lg font-black uppercase tracking-tight text-slate-900">
              Comparativo Anual ({yearA || '—'} x {yearB || '—'})
            </h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">
            Histórico completo • Comparativo entre anos • Produtos
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm focus-within:border-orange-400">
            <Calendar size={14} className="text-orange-500" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 outline-none"
            />
          </div>

          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm focus-within:border-orange-400">
            <Calendar size={14} className="text-orange-500" />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 outline-none"
            />
          </div>

          {(startDate || endDate) && (
            <button
              onClick={clearDates}
              className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 shadow-sm"
            >
              Limpar datas
            </button>
          )}

          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Calendar size={14} className="text-orange-500" />
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer"
            >
              <option value="0">Todos os meses</option>
              {Object.entries(MONTH_FULL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Layers size={14} className="text-orange-500" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto max-w-[180px] truncate"
            >
              <option value="TODAS">Todas categorias</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="relative" ref={storeMenuRef}>
            <button
              onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
              className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors min-w-[170px] justify-between shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Store size={14} className="text-orange-500" />
                <span className="truncate max-w-[120px] uppercase">
                  {selectedStores.length === 0 ? 'Todas as lojas' : selectedStores.length === 1 ? selectedStores[0] : `${selectedStores.length} lojas`}
                </span>
              </div>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {isStoreMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 p-2 max-h-80 overflow-y-auto">
                <div
                  onClick={() => setSelectedStores([])}
                  className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1"
                >
                  {selectedStores.length === 0 ? <CheckSquare size={16} className="text-orange-500" /> : <Square size={16} className="text-slate-300" />}
                  <span className="text-xs font-bold text-slate-700 uppercase">Todas as lojas</span>
                </div>

                {uniqueStores.map((store) => (
                  <div
                    key={store}
                    onClick={() => toggleStore(store)}
                    className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    {selectedStores.includes(store)
                      ? <CheckSquare size={16} className="text-orange-500" />
                      : <Square size={16} className="text-slate-300" />
                    }
                    <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-orange-900/10 flex items-center gap-2 disabled:opacity-50"
          >
            <Filter size={14} /> {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('geral')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeTab === 'geral' ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
        >
          <Activity size={16} /> Visão Geral
        </button>

        <button
          onClick={() => setActiveTab('produtos')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeTab === 'produtos' ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
        >
          <Package size={16} /> Comparativo de Produtos
        </button>
      </div>

      {noData && !loading && !errorMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 p-4 rounded-xl flex items-center gap-3 mb-6">
          <AlertCircle size={20} />
          <div className="text-sm font-bold">Nenhum dado encontrado com os filtros atuais.</div>
        </div>
      )}

      {activeTab === 'geral' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <SmallMetricCard
              title={`Faturamento ${yearB}`}
              icon={<Store size={16} />}
              value={formatMoney(computed.totalB)}
              valueClass="text-orange-600"
              subtitle={`Melhor loja: ${computed.bestB.nome}\n${formatMoney(computed.bestB.total)}`}
            />

            <SmallMetricCard
              title={`Faturamento ${yearA}`}
              icon={<Calendar size={16} />}
              value={formatMoney(computed.totalA)}
              valueClass="text-slate-700"
              subtitle={`${computed.cutoffLabel}: ${formatMoney(computed.totalAUntilCurrentMonth)}`}
            />

            <SmallMetricCard
              title={`Tendência ${yearB}`}
              icon={<TrendingUp size={16} />}
              value={formatMoney(computed.localYearForecast)}
              valueClass="text-orange-700"
              subtitle={`${computed.trendLabel}
Total real ${yearB}: ${formatMoney(computed.totalB)}
Crescimento: ${computed.growthVsYearA >= 0 ? '+' : ''}${computed.growthVsYearA.toFixed(2)}%`}
            />

            <SmallMetricCard
              title="Seguros"
              icon={<ShieldCheck size={16} />}
              value={formatMoney(segurosComputed.yearB.total)}
              valueClass="text-slate-900"
              subtitle={`Qtd. seguros: ${Math.round(segurosComputed.yearB.qtd).toLocaleString('pt-BR')}`}
            />

            {/* Categorias: barras horizontais em laranja */}
            <SmallMetricCard
              title="Categorias"
              icon={<BarChart3 size={16} />}
            >
              {categoryMiniData.length ? (
                <div className="space-y-2.5">
                  {categoryMiniData.map((item) => (
                    <div key={item.name}>
                      <div className="flex justify-between gap-2 text-[10px] font-black uppercase">
                        <span className="truncate text-slate-600">{item.name}</span>
                        <span className="text-slate-800 shrink-0">{formatMoneyShort(item.value)}</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-orange-50 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, (item.value / categoryMax) * 100)}%`,
                            background: `linear-gradient(90deg, ${THEME.orange}, #FB923C)`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] font-bold text-slate-400 uppercase">Sem categoria no filtro</div>
              )}
            </SmallMetricCard>

            {/* Regiões */}
            <SmallMetricCard
              title="Regiões"
              icon={<PieChart size={16} />}
            >
              {regionPieData.length ? (
                <div className="flex items-center gap-4">
                  <div className="h-[116px] w-[116px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={regionPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={34}
                          outerRadius={54}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {regionPieData.map((entry, index) => (
                            <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any, _name: any, props: any) => [formatMoney(Number(value) || 0), props?.payload?.name || 'Região']} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    {regionPieData.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between gap-2 text-[10px] font-black uppercase text-slate-500">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="text-slate-800 shrink-0">
                          {formatMoneyShort(item.value)}
                          <span className="ml-1.5 text-slate-400 font-bold">
                            {regionTotal > 0 ? `${((item.value / regionTotal) * 100).toFixed(0)}%` : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] font-bold text-slate-400 uppercase">Sem região no filtro</div>
              )}
            </SmallMetricCard>
          </div>

          {/* Gráfico mensal: 2025 (grafite) -> 2026 (laranja) -> 2026 tendência (laranja claro) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-orange-50 text-orange-600"><Activity size={16} /></div>
                <h3 className="font-black text-slate-700 uppercase text-xs">Vendas por Mês ({yearA} x {yearB})</h3>
              </div>

              {/* Legenda própria: ordem fixa (ano anterior, ano atual, tendência) */}
              <div className="flex flex-wrap items-center gap-5">
                <LegendItem color={CHART_COLORS.yearA} label={`${yearA}`} />
                <LegendItem color={CHART_COLORS.yearBReal} label={`${yearB}`} />
                <LegendItem color={CHART_COLORS.yearBProjection} label={`${yearB} Tendência`} />
              </div>
            </div>

            <div className="h-[320px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={computed.chartData}
                  margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
                  barGap={3}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="mes"
                    tick={{ fontSize: 12, fontWeight: 'bold', fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={(value) => formatMoneyShort(Number(value))} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: '#FFF7ED' }}
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '10px', border: 'none', color: '#fff' }}
                    labelStyle={{ color: '#FDBA74', fontWeight: 800 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(val: any, name: any) => [formatMoney(Number(val) || 0), chartLegendNameMap[name] || name]}
                  />

                  {/* 1ª barra: ano anterior (stackId próprio garante a posição à esquerda) */}
                  <Bar
                    dataKey={yearA}
                    name={chartLegendNameMap[yearA]}
                    stackId="anoA"
                    fill={CHART_COLORS.yearA}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={yearA}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={CHART_COLORS.yearA}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>

                  {/* 2ª barra: ano atual (real + tendência empilhados) */}
                  <Bar
                    dataKey={`${yearB}_real`}
                    name={chartLegendNameMap[`${yearB}_real`]}
                    stackId="anoB"
                    fill={CHART_COLORS.yearBReal}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={`${yearB}_realLabel`}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={THEME.orangeDark}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>

                  <Bar
                    dataKey={`${yearB}_proj`}
                    name={chartLegendNameMap[`${yearB}_proj`]}
                    stackId="anoB"
                    fill={CHART_COLORS.yearBProjection}
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey={`${yearB}_projLabel`}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      fill={THEME.orangeDark}
                      fontSize={10}
                      fontWeight={900}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {activeTab === 'produtos' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-orange-100 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-xl"><Package size={24} /></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais vendido ({yearB})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductB?.desc}>{topProductB?.desc || 'N/D'}</h3>
                <p className="text-xs text-orange-600 font-bold mt-0.5">{topProductB ? formatMoney(topProductB.totalB) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl"><Package size={24} /></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais vendido ({yearA})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductA?.desc}>{topProductA?.desc || 'N/D'}</h3>
                <p className="text-xs text-slate-600 font-bold mt-0.5">{topProductA ? formatMoney(topProductA.totalA) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp size={60} /></div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl z-10"><ArrowUpRight size={24} /></div>
              <div className="z-10 overflow-hidden">
                <p className="text-[10px] font-black text-emerald-600/70 uppercase tracking-widest truncate">Destaque de crescimento</p>
                <h3 className="text-sm font-black text-emerald-900 mt-1 truncate" title={maxGrowthProduct?.desc}>{maxGrowthProduct?.desc || 'N/D'}</h3>
                <p className="text-xs text-emerald-600 font-bold mt-0.5">
                  {maxGrowthProduct ? `${maxGrowthProduct.crescimentoPct > 0 ? '+' : ''}${maxGrowthProduct.crescimentoPct.toFixed(1)}% vs ano anterior` : '-'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center bg-slate-50 gap-4">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-orange-500" />
                <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Produtos</h3>
              </div>

              <div className="relative w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar modelo..."
                  value={searchProduct}
                  onChange={(e) => setSearchProduct(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-orange-400 transition-colors uppercase shadow-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="sticky top-0 bg-slate-50 shadow-sm z-10 border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">#</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Produto</th>
                    <th className="p-3 text-center border-l border-slate-200 bg-orange-50/60 text-orange-700 text-[10px] font-black uppercase" colSpan={2}>
                      {yearB}
                    </th>
                    <th className="p-3 text-center border-l border-slate-200 bg-slate-100/70 text-slate-700 text-[10px] font-black uppercase" colSpan={2}>
                      {yearA}
                    </th>
                    <th className="p-3 text-right border-l border-slate-200 text-[9px] font-black text-slate-400 uppercase">
                      Crescimento
                    </th>
                  </tr>
                  <tr className="text-[9px] font-black text-slate-400 uppercase tracking-wider bg-white">
                    <th></th>
                    <th></th>
                    <th className="p-2 text-center border-l border-slate-100">Qtd</th>
                    <th className="p-2 text-right border-r border-slate-100">Valor (R$)</th>
                    <th className="p-2 text-center">Qtd</th>
                    <th className="p-2 text-right border-r border-slate-100">Valor (R$)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="text-xs font-bold text-slate-700 divide-y divide-slate-50">
                  {searchedProducts.map((p, i) => {
                    const isPositive = p.crescimentoPct > 0;
                    const isNegative = p.crescimentoPct < 0;
                    const isNeutral = p.crescimentoPct === 0;

                    return (
                      <tr key={`${p.desc}-${i}`} className="hover:bg-orange-50/30 transition-colors group">
                        <td className="p-3 text-center">
                          <span className={`w-5 h-5 flex items-center justify-center rounded mx-auto text-[9px] ${i < 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="p-3 uppercase text-[10px] max-w-[200px] truncate" title={p.desc}>{p.desc}</td>
                        <td className="p-3 text-center border-l border-slate-50 text-slate-600 bg-orange-50/20 group-hover:bg-orange-50/50 transition-colors">{p.qtdB}</td>
                        <td className="p-3 text-right font-mono text-orange-700 font-black bg-orange-50/20 group-hover:bg-orange-50/50 transition-colors">{formatMoney(p.totalB)}</td>
                        <td className="p-3 text-center border-l border-slate-50 text-slate-500 bg-slate-50/50 group-hover:bg-slate-100/60 transition-colors">{p.qtdA}</td>
                        <td className="p-3 text-right font-mono text-slate-700 bg-slate-50/50 group-hover:bg-slate-100/60 transition-colors">{formatMoney(p.totalA)}</td>
                        <td className="p-3 text-right border-l border-slate-50">
                          <div className="flex justify-end">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black ${
                              isPositive ? 'bg-emerald-100 text-emerald-700' :
                              isNegative ? 'bg-red-100 text-red-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {isPositive && <ArrowUpRight size={12} />}
                              {isNegative && <ArrowDownRight size={12} />}
                              {isNeutral && <Minus size={12} />}
                              {isFinite(p.crescimentoPct) ? `${p.crescimentoPct > 0 ? '+' : ''}${p.crescimentoPct.toFixed(1)}%` : 'NOVO'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {searchedProducts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400 text-sm font-bold">
                        Nenhum produto encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}