import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell, LabelList
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

/** =========================
 *  HELPERS (BLINDAGEM)
 *  ========================= */
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

/**
 * Extrai {year, month} de:
 * - "2026-02-01", "2026-02"
 * - "01/02/2026"
 * - "2026/02/01", "2026/02"
 * - "2026"
 * - timestamp ms (1709251200000)
 * - Date object
 */
const extractYearMonth = (raw: any): { year: string; month: string } | null => {
  if (raw === null || raw === undefined || raw === '') return null;

  // Date object
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    return { year: String(y), month: m };
  }

  // timestamp (ms)
  if (typeof raw === 'number' && raw > 1000000000) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return { year: String(y), month: m };
    }
  }

  const s = String(raw).trim();

  // "2026"
  if (/^\d{4}$/.test(s)) {
    return { year: s, month: '01' }; // mês default só pra não matar (não usamos mês aqui pra somar por mês? usamos sim. então deixe 01.)
  }

  // Normaliza separadores
  const ss = s.replace(/\./g, '/').replace(/\s+/g, '');

  // "YYYY-MM-DD" ou "YYYY-MM"
  if (ss.includes('-')) {
    const parts = ss.split('-').filter(Boolean);
    const year = parts[0];
    const month = parts[1];
    if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month)) {
      return { year, month: String(month).padStart(2, '0') };
    }
  }

  // "DD/MM/YYYY" ou "YYYY/MM/DD" ou "YYYY/MM"
  if (ss.includes('/')) {
    const parts = ss.split('/').filter(Boolean);

    // YYYY/MM(/DD)
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return { year: parts[0], month: String(parts[1]).padStart(2, '0') };
    }

    // DD/MM/YYYY
    if (parts.length === 3 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{4}$/.test(parts[2])) {
      return { year: parts[2], month: String(parts[1]).padStart(2, '0') };
    }
  }

  // tenta achar YYYY e MM em qualquer lugar
  const m = ss.match(/(\d{4}).*?(\d{1,2})/);
  if (m && m[1] && m[2]) {
    return { year: m[1], month: String(m[2]).padStart(2, '0') };
  }

  return null;
};

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);
  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://telefluxo-aplicacao.onrender.com';

  const targetYear = new Date().getFullYear().toString(); // "2026"

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

      // DEBUG útil (deixa ligado até resolver):
      console.log("ANUAIS: total registros:", list.length);
      console.log("ANUAIS: amostra 5 datas:", list.slice(0, 5).map((r: any) => getDateValue(r)));
      console.log("ANUAIS: amostra 1 linha:", list[0]);

      setAnnualRawData(list);
      setErrorMsg('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao carregar dados anuais. Verifique se o servidor está rodando.");
      setAnnualRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

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

  // anos presentes (pra mensagem ficar inteligente)
  const yearsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const sale of annualRawData) {
      const ym = extractYearMonth(getDateValue(sale));
      if (ym?.year) set.add(ym.year);
    }
    return Array.from(set).sort();
  }, [annualRawData]);

  const computed = useMemo(() => {
    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    // buckets mês -> total
    const monthlyTotals: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) monthlyTotals[String(i).padStart(2, '0')] = 0;

    // loja -> total
    const storeTotals: Record<string, number> = {};

    let totalYear = 0;

    for (const sale of annualRawData) {
      // filtros loja/categoria
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

      // ano/mês
      const ym = extractYearMonth(getDateValue(sale));
      if (!ym) continue;

      // 🔒 só ano atual
      if (ym.year !== targetYear) continue;

      const total = getTotal(sale);
      if (!total) continue;

      monthlyTotals[ym.month] = (monthlyTotals[ym.month] || 0) + total;

      storeTotals[storeName] = (storeTotals[storeName] || 0) + total;

      totalYear += total;
    }

    // chart mês
    const chartData = Object.keys(monthlyTotals).map((mesNum, idx) => ({
      mes: mesesNomes[idx],
      mesNum,
      total: monthlyTotals[mesNum] || 0
    }));

    // meses com venda
    const monthsWithData = chartData.filter(d => d.total > 0).length;
    const currentMonthIndex = new Date().getMonth() + 1; // 1..12

    // tendência anual: projeção usando YTD / mês atual
    const monthsBase = Math.max(1, Math.min(currentMonthIndex, 12));
    const tendenciaAnual = (totalYear / monthsBase) * 12;

    // ranking lojas
    const storeRanking = Object.entries(storeTotals)
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total);

    const bestStore = storeRanking[0] || { nome: '—', total: 0 };

    return {
      chartData,
      totalYear,
      tendenciaAnual: Math.max(tendenciaAnual, totalYear),
      monthsWithData,
      storeRanking,
      bestStore
    };
  }, [annualRawData, selectedStores, categoryFilter, targetYear]);

  const noDataThisYear = computed.totalYear <= 0;

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
            <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">Vendas Anuais ({targetYear})</h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">
            Meses do ano • Tendência anual • Desempenho das lojas
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
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

      {/* AVISO */}
      {noDataThisYear && !loading && !errorMsg && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-xl flex items-center gap-3 mb-6">
          <AlertCircle size={20} />
          <div className="text-sm font-bold">
            Nenhuma venda encontrada para <b>{targetYear}</b> com os filtros atuais.
            {yearsAvailable.length > 0 && (
              <div className="text-[12px] font-bold mt-1">
                Anos encontrados no banco: {yearsAvailable.join(', ')}.
                (Se o último ano não for {targetYear}, você ainda não tem {targetYear} no histórico anual.)
              </div>
            )}
          </div>
        </div>
      )}

      {/* CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total do Ano ({targetYear})</span>
            <Calendar size={16} className="text-indigo-600" />
          </div>
          <h3 className="text-3xl font-black text-indigo-900 mt-1">
            {formatMoney(computed.totalYear)}
          </h3>
          <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
            acumulado em {computed.monthsWithData}/12 meses
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tendência Anual (Projeção)</span>
            <TrendingUp size={16} className="text-purple-600" />
          </div>
          <h3 className="text-3xl font-black text-purple-700 mt-1">
            {formatMoney(computed.tendenciaAnual)}
          </h3>
          <div className="text-[10px] font-bold text-purple-600 uppercase mt-1">
            projeção por média mensal (YTD)
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Melhor Loja (Ano)</span>
            <Store size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-slate-800 mt-1 uppercase truncate" title={computed.bestStore.nome}>
            {computed.bestStore.nome}
          </h3>
          <div className="text-[12px] font-black text-emerald-700 mt-1">
            {formatMoney(computed.bestStore.total)}
          </div>
        </div>
      </div>

      {/* VENDAS POR MÊS */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[360px] mb-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity size={16} className="text-indigo-600" />
          <h3 className="font-black text-slate-700 uppercase text-xs">
            Vendas por Mês ({targetYear})
          </h3>
        </div>

        <div className="h-full pb-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={computed.chartData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fontWeight: 'bold', fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff' }}
                formatter={(val: any) => [formatMoney(Number(val) || 0), 'Faturamento']}
              />

              <Bar dataKey="total" fill="#1428A0" radius={[4, 4, 0, 0]} name={`Ano ${targetYear}`}>
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={(val: any) => (Number(val) > 0 ? formatMoneyShort(Number(val)) : '')}
                  style={{ fontSize: '10px', fill: '#1428A0', fontWeight: '900' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* DESEMPENHO DAS LOJAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[420px]">
          <div className="flex items-center gap-2 mb-4">
            <Store size={16} className="text-indigo-600" />
            <h3 className="font-black text-slate-700 uppercase text-xs">
              Ranking de Lojas ({targetYear})
            </h3>
          </div>

          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={computed.storeRanking.slice(0, 20)}
                layout="vertical"
                margin={{ top: 10, right: 60, left: 10, bottom: 10 }}
                barSize={16}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="nome"
                  type="category"
                  width={220}
                  tick={{ fontSize: 9, fontWeight: 900, fill: '#475569' }}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff' }}
                  formatter={(val: any) => [formatMoney(Number(val) || 0), 'Faturamento']}
                />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {computed.storeRanking.slice(0, 20).map((_, idx) => (
                    <Cell key={idx} fill={idx === 0 ? '#25D366' : (idx < 3 ? '#1428A0' : '#94a3b8')} />
                  ))}
                  <LabelList
                    dataKey="total"
                    position="right"
                    formatter={(val: any) => formatMoneyShort(Number(val) || 0)}
                    style={{ fontSize: '9px', fontWeight: 'bold', fill: '#475569' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <h3 className="font-bold text-slate-700 uppercase flex items-center gap-2 text-xs">
              <LayoutGrid size={16} className="text-indigo-600" /> Top Lojas
            </h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase">
              {computed.storeRanking.length} lojas
            </span>
          </div>

          <div className="p-4">
            {computed.storeRanking.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">
                Nenhuma loja com vendas no período.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <tbody className="divide-y divide-slate-50">
                  {computed.storeRanking.slice(0, 10).map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 pr-2 w-8">
                        <span className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-black ${
                          i === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="text-[11px] font-black text-slate-700 uppercase truncate max-w-[180px]" title={r.nome}>
                          {r.nome}
                        </div>
                      </td>
                      <td className="py-3 text-right text-[12px] font-black text-[#1428A0]">
                        {formatMoney(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}