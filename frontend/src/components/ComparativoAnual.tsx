import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, LabelList, Legend
} from 'recharts';
import {
  Calendar, Store, AlertCircle, ChevronDown, CheckSquare, Square, Filter, Layers,
  Activity, TrendingUp, Package, Search, ArrowUpRight, ArrowDownRight, Minus
} from 'lucide-react';

const STORE_MAP: Record<string, string> = {
  "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING",
  "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL",
  "12309173001228": "CONJUNTO NACIONAL QUIOSQUE", "12309173000507": "GOIANIA SHOPPING",
  "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING",
  "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
  "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING",
  "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING",
  "12309173001813": "UBERABA SHOPPING", "12309173001570": "FLAMBOYANT SHOPPING",
  "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS",
  "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
  "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS",
  "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING",
  "12309173002976": "IGUATEMI FORTALEZA", "12309173001066": "CD TAGUATINGA"
};

const getStoreName = (raw: string) => {
  if (!raw) return "N/D";
  const clean = raw.replace(/\D/g, '');
  return STORE_MAP[clean] || STORE_MAP[raw] || raw;
};

const formatMoneyShort = (val: number) => {
  if (!val) return 'R$ 0';
  if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
  return `R$ ${val.toFixed(0)}`;
};

const formatMoney = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

type AnyRow = Record<string, any>;

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

const getDateValue = (sale: AnyRow) =>
  pick(sale, ['data_emissao', 'DATA_EMISSAO', 'data', 'DATA', 'date', 'DATE'], '');

const getTotal = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total_real', 'TOTAL_REAL', 'total', 'TOTAL', 'valor', 'VALOR'], 0));

const getStoreRaw = (sale: AnyRow) =>
  String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();

const getCategory = (sale: AnyRow) =>
  String(pick(sale, ['familia', 'FAMILIA', 'categoria_real', 'CATEGORIA_REAL', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS'))
    .trim()
    .toUpperCase();

const getDescription = (sale: AnyRow) =>
  String(pick(sale, ['descricao', 'DESCRICAO', 'produto', 'PRODUTO'], 'N/D')).trim().toUpperCase();

const getQuantity = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['quantidade', 'QUANTIDADE', 'qtd', 'QTD'], 0));

const extractYearMonth = (raw: any): { year: string; month: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return {
      year: String(raw.getFullYear()),
      month: String(raw.getMonth() + 1).padStart(2, '0')
    };
  }

  if (typeof raw === 'number' && raw > 1000000000) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return {
        year: String(d.getFullYear()),
        month: String(d.getMonth() + 1).padStart(2, '0')
      };
    }
  }

  const s = String(raw).trim();
  if (/^\d{4}$/.test(s)) return { year: s, month: '01' };

  const ss = s.replace(/\./g, '/').replace(/\s+/g, '');

  if (ss.includes('-')) {
    const parts = ss.split('-').filter(Boolean);

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

  if (ss.includes('/')) {
    const parts = ss.split('/').filter(Boolean);

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

  const m = ss.match(/(\d{4}).*?(\d{1,2})/);
  if (m?.[1] && m?.[2]) return { year: m[1], month: String(m[2]).padStart(2, '0') };

  return null;
};

const MONTH_FULL: Record<number, string> = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
};

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [monthlyRawData, setMonthlyRawData] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  const [yearA, setYearA] = useState<string>('');
  const [yearB, setYearB] = useState<string>('');

  // NOVOS ESTADOS PARA A TELA DE PRODUTOS
  const [activeTab, setActiveTab] = useState<'geral' | 'produtos'>('geral');
  const [searchProduct, setSearchProduct] = useState('');

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://telefluxo-aplicacao.onrender.com';

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) setIsStoreMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
        fetch(`${API_URL}/sales?userId=${userId}`)
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
      setErrorMsg(err?.message || "Erro ao carregar dados anuais.");
      setAnnualRawData([]);
      setMonthlyRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ==========================================================
  // NOVO: MERGE ENTRE BASE ANUAL + BASE MENSAL
  // Regra:
  // - mantém da base anual tudo, exceto mês atual do ano atual
  // - adiciona da base mensal apenas mês atual do ano atual
  // ==========================================================
  const mergedRawData = useMemo(() => {
    const today = new Date();
    const currentYear = String(today.getFullYear());
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');

    const annualWithoutCurrentMonth = annualRawData.filter((row) => {
      const ym = extractYearMonth(getDateValue(row));
      if (!ym) return false;

      if (ym.year === currentYear && ym.month === currentMonth) {
        return false;
      }

      return true;
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
    const last = yearsAvailable[yearsAvailable.length - 1];
    const prev = yearsAvailable.length >= 2 ? yearsAvailable[yearsAvailable.length - 2] : last;
    setYearA((cur) => cur || prev);
    setYearB((cur) => cur || last);
  }, [yearsAvailable]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(
      mergedRawData
        .map(r => getCategory(r))
        .filter(c => c && c !== 'NAN' && c !== 'UNDEFINED')
    );
    return Array.from(cats).sort();
  }, [mergedRawData]);

  const uniqueStores = useMemo(() => {
    const stores = new Set(
      mergedRawData
        .map(r => getStoreName(getStoreRaw(r)))
        .filter(Boolean)
    );
    return Array.from(stores).sort();
  }, [mergedRawData]);

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) setSelectedStores(selectedStores.filter(s => s !== store));
    else setSelectedStores([...selectedStores, store]);
  };

  // Pré-filtra os dados brutos para reutilizar na Visão Geral e Produtos
  const filteredRawData = useMemo(() => {
    return mergedRawData.filter(sale => {
      const storeName = getStoreName(getStoreRaw(sale)).toUpperCase();

      if (selectedStores.length > 0 && !selectedStores.map(s => s.toUpperCase()).includes(storeName)) {
        return false;
      }

      if (categoryFilter !== 'TODAS' && getCategory(sale) !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [mergedRawData, selectedStores, categoryFilter]);

  // CÁLCULOS VISÃO GERAL
  const computed = useMemo(() => {
    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const today = new Date();
    const currentYearStr = today.getFullYear().toString();
    const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
    const currentDay = Math.max(1, today.getDate());
    const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const daysPassedInYear = Math.max(1, Math.floor((today.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const daysInYear = (today.getFullYear() % 4 === 0) ? 366 : 365;

    const years = [yearA, yearB].filter(Boolean);
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

    const totalsByYearMonth: Record<string, Record<string, number>> = {};
    for (const y of years) {
      totalsByYearMonth[y] = {};
      for (const m of monthKeys) totalsByYearMonth[y][m] = 0;
    }

    const storeTotalsByYear: Record<string, Record<string, number>> = {};
    for (const y of years) storeTotalsByYear[y] = {};

    const totalByYear: Record<string, number> = {};
    for (const y of years) totalByYear[y] = 0;

    for (const sale of filteredRawData) {
      const storeName = getStoreName(getStoreRaw(sale));
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym || !years.includes(ym.year)) continue;

      const total = getTotal(sale);
      if (!total) continue;

      totalsByYearMonth[ym.year][ym.month] = (totalsByYearMonth[ym.year][ym.month] || 0) + total;
      storeTotalsByYear[ym.year][storeName] = (storeTotalsByYear[ym.year][storeName] || 0) + total;
      totalByYear[ym.year] += total;
    }

    let currentMonthRealB = 0;

    const chartData = monthKeys.map((m, idx) => {
      const realA = yearA ? (totalsByYearMonth[yearA]?.[m] || 0) : 0;
      const realB = yearB ? (totalsByYearMonth[yearB]?.[m] || 0) : 0;

      if (yearB === currentYearStr && m === currentMonthStr) currentMonthRealB = realB;

      const row: any = {
        mes: mesesNomes[idx],
        mesNum: m,
        [yearA || 'Ano A']: realA,
        [yearB || 'Ano B']: realB,
        [`${yearB || 'Ano B'}_real`]: realB,
        [`${yearB || 'Ano B'}_proj`]: 0,
      };

      if (yearB === currentYearStr && m === currentMonthStr) {
        const projecaoTotalMes = currentDay > 0 ? (realB / currentDay) * daysInCurrentMonth : realB;
        const faltaVender = Math.max(0, projecaoTotalMes - realB);
        row[`${yearB}_real`] = realB;
        row[`${yearB}_proj`] = faltaVender;
        row[yearB] = realB + faltaVender;
      }

      return row;
    });

    const totalA = yearA ? (totalByYear[yearA] || 0) : 0;
    const totalB = yearB ? (totalByYear[yearB] || 0) : 0;

    let projecaoMensal = 0;
    let projecaoAnual = totalB;

    if (yearB === currentYearStr) {
      projecaoMensal = currentDay > 0 ? (currentMonthRealB / currentDay) * daysInCurrentMonth : currentMonthRealB;
      projecaoAnual = daysPassedInYear > 0 ? (totalB / daysPassedInYear) * daysInYear : totalB;
    } else {
      projecaoMensal = currentMonthRealB;
    }

    const bestStoreByYear = (y: string) => {
      const entries = Object.entries(storeTotalsByYear[y] || {})
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);
      return entries[0] || { nome: '—', total: 0 };
    };

    return {
      chartData,
      totalA,
      totalB,
      bestA: yearA ? bestStoreByYear(yearA) : { nome: '—', total: 0 },
      bestB: yearB ? bestStoreByYear(yearB) : { nome: '—', total: 0 },
      localMonthSoFar: currentMonthRealB,
      localMonthForecast: Math.max(projecaoMensal, currentMonthRealB),
      localYearForecast: Math.max(projecaoAnual, totalB),
      monthLabel: yearB === currentYearStr ? MONTH_FULL[today.getMonth() + 1] : 'Mês selecionado',
    };
  }, [filteredRawData, yearA, yearB]);

  // CÁLCULOS TELA DE PRODUTOS
  const productComparison = useMemo(() => {
    const prodMap = new Map();

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

      const p = prodMap.get(desc);
      if (isYearA) {
        p.totalA += total;
        p.qtdA += qtd;
      }
      if (isYearB) {
        p.totalB += total;
        p.qtdB += qtd;
      }
    }

    const arr = Array.from(prodMap.values()).map((p: any) => {
      let crescimentoPct = 0;
      if (p.totalA > 0) crescimentoPct = ((p.totalB - p.totalA) / p.totalA) * 100;
      else if (p.totalB > 0) crescimentoPct = 100;

      return { ...p, crescimentoPct };
    });

    return arr.sort((a: any, b: any) => b.totalB - a.totalB);
  }, [filteredRawData, yearA, yearB]);

  const searchedProducts = useMemo(() => {
    if (!searchProduct) return productComparison;
    const term = searchProduct.toLowerCase();
    return productComparison.filter((p: any) => p.desc.toLowerCase().includes(term));
  }, [productComparison, searchProduct]);

  const topProductA = useMemo(
    () => [...productComparison].sort((a: any, b: any) => b.totalA - a.totalA)[0] || null,
    [productComparison]
  );

  const topProductB = useMemo(
    () => [...productComparison].sort((a: any, b: any) => b.totalB - a.totalB)[0] || null,
    [productComparison]
  );

  const maxGrowthProduct = useMemo(() => {
    const valid = productComparison.filter((p: any) => p.totalA > 10000);
    return valid.sort((a: any, b: any) => b.crescimentoPct - a.crescimentoPct)[0] || null;
  }, [productComparison]);

  const noData = (computed.totalA + computed.totalB) <= 0;
  const trendDiff = computed.localYearForecast - computed.totalA;
  const trendDiffPct = computed.totalA > 0 ? (trendDiff / computed.totalA) * 100 : 0;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative flex items-center gap-2">
          <AlertCircle size={20} />
          <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-[#1428A0] rounded text-white"><Activity size={18} /></div>
            <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">
              Comparativo Anual ({yearA || '—'} x {yearB || '—'})
            </h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">
            Histórico completo • Comparativo entre anos • Produtos
          </p>
        </div>

        {/* FILTROS GLOBAIS */}
        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Calendar size={14} className="text-blue-600" />
            <select value={yearA} onChange={e => setYearA(e.target.value)} className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer max-w-[120px]">
              {yearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <span className="text-xs font-black text-slate-400">X</span>
            <select value={yearB} onChange={e => setYearB(e.target.value)} className="bg-transparent text-xs font-bold text-sky-600 uppercase outline-none cursor-pointer max-w-[120px] ml-1">
              {yearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Layers size={14} className="text-blue-600" />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto max-w-[150px] truncate">
              <option value="TODAS">Todas Categorias</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="relative" ref={storeMenuRef}>
            <button onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)} className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors min-w-[160px] justify-between shadow-sm">
              <div className="flex items-center gap-2">
                <Store size={14} className="text-blue-600" />
                <span className="truncate max-w-[120px] uppercase">
                  {selectedStores.length === 0 ? "Todas Lojas" : selectedStores.length === 1 ? selectedStores[0] : `${selectedStores.length} Lojas`}
                </span>
              </div>
              <ChevronDown size={14} className="text-slate-400" />
            </button>
            {isStoreMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 p-2 max-h-80 overflow-y-auto">
                <div onClick={() => setSelectedStores([])} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1">
                  {selectedStores.length === 0 ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-slate-300" />}
                  <span className="text-xs font-bold text-slate-700 uppercase">Todas as Lojas</span>
                </div>
                {uniqueStores.map((store: string) => (
                  <div key={store} onClick={() => toggleStore(store)} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer">
                    {selectedStores.includes(store) ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-slate-300" />}
                    <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={loadData} disabled={loading} className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/10 flex items-center gap-2 disabled:opacity-50">
            <Filter size={14} /> {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* CONTROLE DE ABAS (TABS) */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('geral')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeTab === 'geral' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
        >
          <Activity size={16}/> Visão Geral
        </button>
        <button
          onClick={() => setActiveTab('produtos')}
          className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeTab === 'produtos' ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
        >
          <Package size={16}/> Comparativo de Produtos
        </button>
      </div>

      {noData && !loading && !errorMsg && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-xl flex items-center gap-3 mb-6">
          <AlertCircle size={20} />
          <div className="text-sm font-bold">Nenhuma venda encontrada para os anos selecionados com os filtros atuais.</div>
        </div>
      )}

      {/* ==========================================================
          ABA 1: VISÃO GERAL
      ========================================================== */}
      {activeTab === 'geral' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total ({yearA || '—'})</span>
                <Calendar size={16} className="text-indigo-600" />
              </div>
              <h3 className="text-2xl font-black text-indigo-900 mt-1">{formatMoney(computed.totalA)}</h3>
              <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Melhor loja: {computed.bestA.nome}</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total ({yearB || '—'})</span>
                <Calendar size={16} className="text-sky-600" />
              </div>
              <h3 className="text-2xl font-black text-sky-700 mt-1">{formatMoney(computed.totalB)}</h3>
              <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Melhor loja: {computed.bestB.nome}</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tendência Final x Ano Ant.</span>
                <TrendingUp size={16} className={trendDiff >= 0 ? 'text-teal-600' : 'text-red-600'} />
              </div>
              <h3 className={`text-2xl font-black mt-1 ${trendDiff >= 0 ? 'text-teal-700' : 'text-red-700'}`}>
                {formatMoney(trendDiff)}
              </h3>
              <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                {trendDiff >= 0 ? '+' : ''}{trendDiffPct.toFixed(1)}% de crescimento proj.
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Previsão ({yearB || '—'})
                </span>
                <TrendingUp size={16} className="text-sky-600" />
              </div>

              <div className="text-[10px] font-black text-slate-500 uppercase">
                {computed.monthLabel}: real / proj.
              </div>
              <div className="text-[12px] font-black text-slate-700 mt-1">
                {formatMoney(computed.localMonthSoFar)} <span className="text-slate-400">/</span> {formatMoney(computed.localMonthForecast)}
              </div>

              <h3 className="text-xl font-black text-sky-700 mt-3">
                {formatMoney(computed.localYearForecast)}
              </h3>
              <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                YTD Real: {formatMoney(computed.totalB)}
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Melhor Loja ({yearB})</span>
                <Store size={16} className="text-sky-600" />
              </div>
              <h3 className="text-lg font-black text-slate-800 mt-1 uppercase truncate" title={computed.bestB.nome}>
                {computed.bestB.nome}
              </h3>
              <div className="text-[12px] font-black text-sky-700 mt-1">{formatMoney(computed.bestB.total)}</div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[380px] mb-6">
            <div className="flex items-center gap-2 mb-6">
              <Activity size={16} className="text-indigo-600" />
              <h3 className="font-black text-slate-700 uppercase text-xs">Vendas por Mês ({yearA || '—'} x {yearB || '—'})</h3>
            </div>
            <div className="h-[300px] min-h-[300px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={computed.chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fontWeight: 'bold', fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff' }}
                    formatter={(val: any) => [formatMoney(Number(val) || 0), 'Faturamento']}
                  />
                  <Legend />
                  <Bar dataKey={yearA || 'Ano A'} name={`${yearA || 'Ano A'} Real`} fill="#1428A0" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey={yearA || 'Ano A'}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      style={{ fontSize: '10px', fill: '#1428A0', fontWeight: '900' }}
                    />
                  </Bar>
                  <Bar dataKey={`${yearB || 'Ano B'}_real`} name={`${yearB || 'Ano B'} Real (Até Agora)`} stackId="yearB" fill="#7DD3FC" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={`${yearB || 'Ano B'}_proj`} name={`${yearB || 'Ano B'} Tendência Restante`} stackId="yearB" fill="#0284C7" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey={yearB || 'Ano B'}
                      position="top"
                      formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                      style={{ fontSize: '10px', fill: '#0369A1', fontWeight: '900' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ==========================================================
          ABA 2: COMPARATIVO DE PRODUTOS
      ========================================================== */}
      {activeTab === 'produtos' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Package size={24}/></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais Vendido ({yearA})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductA?.desc}>{topProductA?.desc || 'N/D'}</h3>
                <p className="text-xs text-indigo-600 font-bold mt-0.5">{topProductA ? formatMoney(topProductA.totalA) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-sky-50 text-sky-600 rounded-xl"><Package size={24}/></div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">Mais Vendido ({yearB})</p>
                <h3 className="text-sm font-black text-slate-800 mt-1 truncate" title={topProductB?.desc}>{topProductB?.desc || 'N/D'}</h3>
                <p className="text-xs text-sky-600 font-bold mt-0.5">{topProductB ? formatMoney(topProductB.totalB) : 'R$ 0'}</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp size={60}/></div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl z-10"><ArrowUpRight size={24}/></div>
              <div className="z-10 overflow-hidden">
                <p className="text-[10px] font-black text-emerald-600/70 uppercase tracking-widest truncate">Destaque de Crescimento</p>
                <h3 className="text-sm font-black text-emerald-900 mt-1 truncate" title={maxGrowthProduct?.desc}>{maxGrowthProduct?.desc || 'N/D'}</h3>
                <p className="text-xs text-emerald-600 font-bold mt-0.5">
                  {maxGrowthProduct ? `+${maxGrowthProduct.crescimentoPct.toFixed(1)}% vs Ano Anterior` : '-'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center bg-slate-50 gap-4">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-slate-500"/>
                <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Produtos</h3>
              </div>

              <div className="relative w-full sm:w-72">
                <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar modelo..."
                  value={searchProduct}
                  onChange={(e) => setSearchProduct(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-emerald-500 transition-colors uppercase shadow-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="sticky top-0 bg-slate-50 shadow-sm z-10 border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-center text-[9px] font-black text-slate-400 uppercase">#</th>
                    <th className="p-3 text-[9px] font-black text-slate-400 uppercase">Produto</th>

                    <th className="p-3 text-center border-l border-slate-200 bg-indigo-50/30 text-indigo-800 text-[10px] font-black uppercase" colSpan={2}>
                      {yearA || 'Ano A'}
                    </th>

                    <th className="p-3 text-center border-l border-slate-200 bg-sky-50/30 text-sky-800 text-[10px] font-black uppercase" colSpan={2}>
                      {yearB || 'Ano B'}
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
                  {searchedProducts.map((p: any, i: number) => {
                    const isPositive = p.crescimentoPct > 0;
                    const isNegative = p.crescimentoPct < 0;
                    const isNeutral = p.crescimentoPct === 0;

                    return (
                      <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="p-3 text-center">
                          <span className={`w-5 h-5 flex items-center justify-center rounded mx-auto text-[9px] ${i<3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                            {i+1}
                          </span>
                        </td>
                        <td className="p-3 uppercase text-[10px] max-w-[200px] truncate" title={p.desc}>
                          {p.desc}
                        </td>

                        <td className="p-3 text-center border-l border-slate-50 text-slate-500 bg-indigo-50/10 group-hover:bg-indigo-50/30 transition-colors">{p.qtdA}</td>
                        <td className="p-3 text-right font-mono text-indigo-700 bg-indigo-50/10 group-hover:bg-indigo-50/30 transition-colors">{formatMoney(p.totalA)}</td>

                        <td className="p-3 text-center border-l border-slate-50 bg-sky-50/10 group-hover:bg-sky-50/30 transition-colors">{p.qtdB}</td>
                        <td className="p-3 text-right font-mono text-sky-700 font-black bg-sky-50/10 group-hover:bg-sky-50/30 transition-colors">{formatMoney(p.totalB)}</td>

                        <td className="p-3 text-right border-l border-slate-50">
                          <div className="flex justify-end">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black
                              ${isPositive ? 'bg-emerald-100 text-emerald-700' :
                                isNegative ? 'bg-red-100 text-red-700' :
                                'bg-slate-100 text-slate-500'}`}
                            >
                              {isPositive && <ArrowUpRight size={12}/>}
                              {isNegative && <ArrowDownRight size={12}/>}
                              {isNeutral && <Minus size={12}/>}
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