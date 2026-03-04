import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell, LabelList, Legend
} from 'recharts';
import {
  Calendar, Store, AlertCircle, ChevronDown, CheckSquare, Square, Filter, Layers,
  Activity, LayoutGrid, TrendingUp
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
  toNumberSafe(pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total', 'TOTAL', 'valor', 'VALOR'], 0));

const getStoreRaw = (sale: AnyRow) =>
  String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();

const getCategory = (sale: AnyRow) =>
  String(pick(sale, ['familia', 'FAMILIA', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS'))
    .trim()
    .toUpperCase();

const extractYearMonth = (raw: any): { year: string; month: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    return { year: String(y), month: m };
  }

  if (typeof raw === 'number' && raw > 1000000000) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return { year: String(y), month: m };
    }
  }

  const s = String(raw).trim();
  if (/^\d{4}$/.test(s)) return { year: s, month: '01' };

  const ss = s.replace(/\./g, '/').replace(/\s+/g, '');

  if (ss.includes('-')) {
    const parts = ss.split('-').filter(Boolean);
    const year = parts[0];
    const month = parts[1];
    if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month)) {
      return { year, month: String(month).padStart(2, '0') };
    }
  }

  if (ss.includes('/')) {
    const parts = ss.split('/').filter(Boolean);

    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }

    if (parts.length === 3 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{4}$/.test(parts[2])) {
      return { year: parts[2], month: String(parts[1]).padStart(2, '0') };
    }
  }

  const m = ss.match(/(\d{4}).*?(\d{1,2})/);
  if (m?.[1] && m?.[2]) return { year: m[1], month: String(m[2]).padStart(2, '0') };

  return null;
};

// ✅ ADIÇÃO: nomes de mês (pra exibir “Março”, etc.)
const MONTH_FULL: Record<number, string> = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
};

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  // ✅ COMPARATIVO: dois anos
  const [yearA, setYearA] = useState<string>('');
  const [yearB, setYearB] = useState<string>('');

  // ✅ ADIÇÃO: dados de previsão (mês atual + projeção)
  const [forecast, setForecast] = useState<any>(null);

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

  const loadData = async () => {
    setLoading(true);

    let userId = '';
    try {
      const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        userId = parsed.id || parsed.userId || parsed._id || '';
      }
    } catch (e) { console.error(e); }

    try {
      const resAnnual = await fetch(`${API_URL}/sales_anuais?userId=${userId}`);
      if (!resAnnual.ok) {
        setErrorMsg("Rota de histórico anual não encontrada no servidor.");
        setAnnualRawData([]);
        return;
      }

      const dataAnnual = await resAnnual.json();

      const list =
        (dataAnnual && Array.isArray(dataAnnual.sales) && dataAnnual.sales) ||
        (dataAnnual && Array.isArray(dataAnnual.data) && dataAnnual.data) ||
        (Array.isArray(dataAnnual) ? dataAnnual : []);

      setAnnualRawData(list);
      setErrorMsg('');

      // ✅ ADIÇÃO: buscar previsão do ano selecionado (Ano B)
      // (se a rota não existir, só ignora sem quebrar nada)
      const targetYear = Number(yearB || new Date().getFullYear());
      try {
        const resForecast = await fetch(`${API_URL}/forecast/ano?userId=${userId}&year=${targetYear}`);
        if (resForecast.ok) {
          const f = await resForecast.json();
          setForecast(f || null);
        } else {
          setForecast(null);
        }
      } catch (e) {
        setForecast(null);
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao carregar dados anuais. Verifique se o servidor está rodando.");
      setAnnualRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const yearsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const sale of annualRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (ym?.year) set.add(ym.year);
    }
    return Array.from(set).sort();
  }, [annualRawData]);

  // ✅ default: últimos 2 anos do banco
  useEffect(() => {
    if (!yearsAvailable.length) return;
    const last = yearsAvailable[yearsAvailable.length - 1];
    const prev = yearsAvailable.length >= 2 ? yearsAvailable[yearsAvailable.length - 2] : last;

    setYearA((cur) => cur || prev);
    setYearB((cur) => cur || last);
  }, [yearsAvailable]);

  // ✅ ADIÇÃO: quando trocar Ano B, recarrega previsão (sem apagar nada)
  useEffect(() => {
    // evita chamar antes de ter ano
    if (!yearB) return;
    // reaproveita o loadData pra não duplicar lógica e manter tudo consistente
    // (não apaga nada, só garante que forecast acompanhe o Ano B)
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearB]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(
      annualRawData
        .map(r => getCategory(r))
        .filter(c => c && c !== 'NAN' && c !== 'UNDEFINED')
    );
    return Array.from(cats).sort();
  }, [annualRawData]);

  const uniqueStores = useMemo(() => {
    const stores = new Set(
      annualRawData
        .map(r => getStoreName(getStoreRaw(r)))
        .filter(Boolean)
    );
    return Array.from(stores).sort();
  }, [annualRawData]);

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) setSelectedStores(selectedStores.filter(s => s !== store));
    else setSelectedStores([...selectedStores, store]);
  };

  const computed = useMemo(() => {
    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const years = [yearA, yearB].filter(Boolean);
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

    // year -> month -> total
    const totalsByYearMonth: Record<string, Record<string, number>> = {};
    for (const y of years) {
      totalsByYearMonth[y] = {};
      for (const m of monthKeys) totalsByYearMonth[y][m] = 0;
    }

    // year -> store -> total
    const storeTotalsByYear: Record<string, Record<string, number>> = {};
    for (const y of years) storeTotalsByYear[y] = {};

    // year totals
    const totalByYear: Record<string, number> = {};
    for (const y of years) totalByYear[y] = 0;

    for (const sale of annualRawData) {
      const storeName = getStoreName(getStoreRaw(sale));
      const storeNameU = storeName.toUpperCase();

      if (selectedStores.length > 0) {
        const selectedU = selectedStores.map(s => s.toUpperCase());
        if (!selectedU.includes(storeNameU)) continue;
      }

      if (categoryFilter !== 'TODAS') {
        const cat = getCategory(sale);
        if (cat !== categoryFilter) continue;
      }

      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) continue;

      if (!years.includes(ym.year)) continue;

      const total = getTotal(sale);
      if (!total) continue;

      totalsByYearMonth[ym.year][ym.month] = (totalsByYearMonth[ym.year][ym.month] || 0) + total;

      storeTotalsByYear[ym.year][storeName] = (storeTotalsByYear[ym.year][storeName] || 0) + total;
      totalByYear[ym.year] += total;
    }

    // chart: cada mês tem colunas yearA e yearB
    const chartData = monthKeys.map((m, idx) => ({
      mes: mesesNomes[idx],
      mesNum: m,
      [yearA || 'Ano A']: yearA ? (totalsByYearMonth[yearA]?.[m] || 0) : 0,
      [yearB || 'Ano B']: yearB ? (totalsByYearMonth[yearB]?.[m] || 0) : 0,
    }));

    const totalA = yearA ? (totalByYear[yearA] || 0) : 0;
    const totalB = yearB ? (totalByYear[yearB] || 0) : 0;
    const diff = totalB - totalA;
    const diffPct = totalA > 0 ? (diff / totalA) * 100 : (totalB > 0 ? 100 : 0);

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
      diff,
      diffPct,
      bestA: yearA ? bestStoreByYear(yearA) : { nome: '—', total: 0 },
      bestB: yearB ? bestStoreByYear(yearB) : { nome: '—', total: 0 },
    };
  }, [annualRawData, selectedStores, categoryFilter, yearA, yearB]);

  const noData = (computed.totalA + computed.totalB) <= 0;

  // ✅ ADIÇÃO: helpers de forecast (sem mexer em nada do resto)
  const monthLabel = forecast?.month ? (MONTH_FULL[Number(forecast.month)] || `Mês ${forecast.month}`) : 'Mês atual';
  const monthSoFar = toNumberSafe(forecast?.month_so_far);
  const monthForecast = toNumberSafe(forecast?.month_forecast);
  const yearForecast = toNumberSafe(forecast?.year_forecast);
  const ytd = toNumberSafe(forecast?.ytd);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative flex items-center gap-2">
          <AlertCircle size={20} />
          <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* HEADER */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-[#1428A0] rounded text-white"><Activity size={18} /></div>
            <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">
              Comparativo Anual ({yearA || '—'} x {yearB || '—'})
            </h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">
            Histórico completo • Comparativo entre anos • Desempenho das lojas
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
          {/* Ano A */}
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Calendar size={14} className="text-blue-600" />
            <select
              value={yearA}
              onChange={e => setYearA(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer max-w-[120px] truncate"
            >
              {yearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Ano B */}
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            {/* ✅ TROCA DO ROXO -> VERDE */}
            <Calendar size={14} className="text-emerald-600" />
            <select
              value={yearB}
              onChange={e => setYearB(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer max-w-[120px] truncate"
            >
              {yearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Categoria */}
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Layers size={14} className="text-blue-600" />
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto max-w-[150px] truncate"
            >
              <option value="TODAS">Todas Categorias</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Lojas */}
          <div className="relative" ref={storeMenuRef}>
            <button
              onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
              className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors min-w-[160px] justify-between shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Store size={14} className="text-blue-600" />
                <span className="truncate max-w-[120px] uppercase">
                  {selectedStores.length === 0 ? "Todas Lojas" :
                    selectedStores.length === 1 ? selectedStores[0] :
                      `${selectedStores.length} Lojas`}
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

          <button
            onClick={loadData}
            disabled={loading}
            className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/10 flex items-center gap-2 disabled:opacity-50"
          >
            <Filter size={14} /> {loading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {noData && !loading && !errorMsg && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-xl flex items-center gap-3 mb-6">
          <AlertCircle size={20} />
          <div className="text-sm font-bold">
            Nenhuma venda encontrada para os anos selecionados com os filtros atuais.
            {yearsAvailable.length > 0 && (
              <div className="text-[12px] font-bold mt-1">
                Anos encontrados no banco: {yearsAvailable.join(', ')}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* CARDS */}
      {/* ✅ edit: aumentei pra 5 colunas no desktop pra incluir o card de previsão sem remover nada */}
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
            {/* ✅ TROCA DO ROXO -> VERDE */}
            <Calendar size={16} className="text-emerald-600" />
          </div>
          {/* ✅ TROCA DO ROXO -> VERDE */}
          <h3 className="text-2xl font-black text-emerald-700 mt-1">{formatMoney(computed.totalB)}</h3>
          <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Melhor loja: {computed.bestB.nome}</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Diferença (B - A)</span>
            <TrendingUp size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-2xl font-black text-emerald-700 mt-1">{formatMoney(computed.diff)}</h3>
          <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
            {computed.diffPct >= 0 ? '+' : ''}{computed.diffPct.toFixed(1)}%
          </div>
        </div>

        {/* ✅ NOVO CARD: PREVISÃO */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Previsão ({yearB || '—'})
            </span>
            <TrendingUp size={16} className="text-sky-600" />
          </div>

          <div className="text-[10px] font-black text-slate-500 uppercase">
            {monthLabel}: até agora / previsão
          </div>
          <div className="text-[12px] font-black text-slate-700 mt-1">
            {formatMoney(monthSoFar)} <span className="text-slate-400">/</span> {formatMoney(monthForecast)}
          </div>

          <h3 className="text-xl font-black text-sky-700 mt-3">
            {formatMoney(yearForecast)}
          </h3>
          <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
            YTD: {formatMoney(ytd)}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Melhor Loja (Ano B)</span>
            <Store size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-lg font-black text-slate-800 mt-1 uppercase truncate" title={computed.bestB.nome}>
            {computed.bestB.nome}
          </h3>
          <div className="text-[12px] font-black text-emerald-700 mt-1">{formatMoney(computed.bestB.total)}</div>
        </div>
      </div>

      {/* GRÁFICO */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[380px] mb-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity size={16} className="text-indigo-600" />
          <h3 className="font-black text-slate-700 uppercase text-xs">
            Vendas por Mês ({yearA || '—'} x {yearB || '—'})
          </h3>
        </div>

        <div className="h-full pb-8">
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

              {/* Ano A */}
              <Bar dataKey={yearA || 'Ano A'} fill="#1428A0" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey={yearA || 'Ano A'}
                  position="top"
                  formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                  style={{ fontSize: '10px', fill: '#1428A0', fontWeight: '900' }}
                />
              </Bar>

              {/* Ano B */}
              {/* ✅ TROCA DO ROXO -> VERDE */}
              <Bar dataKey={yearB || 'Ano B'} fill="#16A34A" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey={yearB || 'Ano B'}
                  position="top"
                  formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                  style={{ fontSize: '10px', fill: '#16A34A', fontWeight: '900' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* (Opcional) você pode manter seu ranking/tabela aqui se quiser,
          mas agora precisa decidir: ranking de qual ano? A/B ou combinado.
          Se quiser, eu adapto pra mostrar duas tabs: "Ano A" e "Ano B". */}
      
    </div>
  );
}