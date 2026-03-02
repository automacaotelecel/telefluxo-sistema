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
 *  HELPERS (BLINDAGEM DE CAMPOS)
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

  // aceita "1.234,56" / "1234,56" / "1234.56" / "R$ 1.234,56"
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

const getDateStr = (sale: AnyRow) =>
  String(pick(sale, ['data_emissao', 'DATA_EMISSAO', 'data', 'DATA'], '')).trim();

const getTotal = (sale: AnyRow) =>
  toNumberSafe(pick(sale, ['total_liquido', 'TOTAL_LIQUIDO', 'total', 'TOTAL', 'valor', 'VALOR'], 0));

const getStoreRaw = (sale: AnyRow) =>
  String(pick(sale, ['cnpj_empresa', 'CNPJ_EMPRESA', 'cnpjEmp', 'CNPJ', 'loja', 'LOJA'], '')).trim();

const getCategory = (sale: AnyRow) =>
  String(pick(sale, ['familia', 'FAMILIA', 'categoria', 'CATEGORIA', 'grupo', 'GRUPO'], 'OUTROS'))
    .trim()
    .toUpperCase();

/** Extrai {ano, mes} bem blindado */
const extractYearMonth = (rawDate: string) => {
  const d = String(rawDate || "").trim();
  let ano = "";
  let mes = "";

  // "2024-02-01" / "2024-02"
  if (d.includes('-')) {
    const partes = d.split('-');
    ano = partes[0] || "";
    mes = partes[1] || "";
  }
  // "01/02/2024"
  else if (d.includes('/')) {
    const partes = d.split('/');
    if (partes.length === 3) {
      ano = partes[2] || "";
      mes = partes[1] || "";
    }
  }
  return { ano, mes };
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

  const currentYear = new Date().getFullYear().toString();
  const currentMonthIndex = new Date().getMonth(); // 0-11

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

      console.log("Recebido do Back-end (amostra):", list[0]);

      console.log("TOTAL REGISTROS:", list.length);
      console.log("AMOSTRA DATAS:", list.slice(0, 10).map((r:any) => r.data_emissao || r.DATA_EMISSAO || r.data || r.DATA));

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

  /** =========================
   *  DADOS DO ANO ATUAL
   *  ========================= */
  const yearData = useMemo(() => {
    // meses fixos
    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthly: Record<string, { mes: string; mesNum: string; total: number }> = {};
    mesesNomes.forEach((m, i) => {
      const mesNum = String(i + 1).padStart(2, '0');
      monthly[mesNum] = { mes: m, mesNum, total: 0 };
    });

    // ranking de lojas
    const storeAgg: Record<string, number> = {};

    let totalAno = 0;

    annualRawData.forEach((sale) => {
      // filtros
      if (selectedStores.length > 0) {
        const storeName = getStoreName(getStoreRaw(sale));
        if (!selectedStores.includes(storeName)) return;
      }
      if (categoryFilter !== 'TODAS') {
        const cat = getCategory(sale);
        if (cat !== categoryFilter) return;
      }

      const { ano, mes } = extractYearMonth(getDateStr(sale));
      if (!ano || !mes) return;

      // só ano atual
      if (ano !== currentYear) return;

      const total = getTotal(sale);
      if (total === 0) return;

      // soma mensal
      if (monthly[mes]) monthly[mes].total += total;

      // soma anual
      totalAno += total;

      // soma por loja
      const lojaNome = getStoreName(getStoreRaw(sale));
      if (!storeAgg[lojaNome]) storeAgg[lojaNome] = 0;
      storeAgg[lojaNome] += total;
    });

    const chartMensal = Object.values(monthly).sort((a, b) => Number(a.mesNum) - Number(b.mesNum));

    const rankingLojas = Object.keys(storeAgg)
      .map(nome => ({ nome, total: storeAgg[nome] }))
      .sort((a, b) => b.total - a.total);

    // tendência anual (projeção simples com base no YTD)
    const mesesPassados = Math.max(1, currentMonthIndex + 1); // evita /0
    const projecao = (totalAno / mesesPassados) * 12;
    const tendenciaAnual = Math.max(projecao, totalAno);

    return {
      chartMensal,
      rankingLojas,
      totalAno,
      tendenciaAnual,
      mesesPassados
    };
  }, [annualRawData, selectedStores, categoryFilter, currentYear, currentMonthIndex]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">

      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative flex items-center gap-2">
          <AlertCircle size={20} />
          <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* HEADER E FILTROS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-[#1428A0] rounded text-white"><Activity size={18} /></div>
            <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">
              Vendas Anuais ({currentYear})
            </h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">
            Meses do ano • Tendência anual • Desempenho das lojas
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
          {/* Categoria */}
          <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
            <Layers size={14} className="text-blue-600" />
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto max-w-[150px] truncate"
            >
              <option value="TODAS">Todas Categorias</option>
              {uniqueCategories.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
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

      {/* AVISO - SEM DADOS DO ANO */}
      {yearData.totalAno === 0 && !loading && !errorMsg && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-xl flex items-center gap-3 mb-6">
          <AlertCircle size={20} />
          <span className="text-sm font-bold">
            Nenhuma venda encontrada para {currentYear} com os filtros atuais.
            (Se você carregou histórico antigo, ele não entra aqui — esta tela mostra apenas o ano atual.)
          </span>
        </div>
      )}

      {/* CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Total do Ano ({currentYear})
            </span>
            <Calendar size={16} className="text-indigo-600" />
          </div>
          <h3 className="text-3xl font-black text-indigo-900 mt-1">
            {formatMoney(yearData.totalAno)}
          </h3>
          <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase">
            acumulado em {yearData.mesesPassados}/12 meses
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Tendência Anual (Projeção)
            </span>
            <TrendingUp size={16} className="text-purple-600" />
          </div>
          <h3 className="text-3xl font-black text-purple-700 mt-1">
            {formatMoney(yearData.tendenciaAnual)}
          </h3>
          <div className="text-[10px] text-purple-600 font-bold mt-1 uppercase">
            projeção por média mensal (YTD)
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Melhor Loja (Ano)
            </span>
            <Store size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-emerald-700 mt-1 uppercase truncate">
            {yearData.rankingLojas[0]?.nome || '—'}
          </h3>
          <div className="text-[12px] font-black text-slate-800 mt-1">
            {formatMoney(yearData.rankingLojas[0]?.total || 0)}
          </div>
        </div>
      </div>

      {/* GRÁFICO MENSAL */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[360px] mb-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity size={16} className="text-indigo-600" />
          <h3 className="font-black text-slate-700 uppercase text-xs">
            Vendas por mês ({currentYear})
          </h3>
        </div>

        <div className="h-full pb-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={yearData.chartMensal} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fontWeight: 'bold', fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff' }}
                formatter={(val: any) => [formatMoney(Number(val) || 0), 'Faturamento']}
              />
              <Bar dataKey="total" fill="#1428A0" radius={[6, 6, 0, 0]}>
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
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm h-[420px] overflow-hidden">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
            <Store size={14} className="text-slate-400" />
            <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Lojas ({currentYear})</h3>
          </div>

          <div className="h-full pb-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={yearData.rankingLojas.slice(0, 25)}
                margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
                barSize={16}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="nome" type="category" width={210} tick={{ fontSize: 9, fontWeight: 800, fill: '#475569' }} interval={0} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '12px' }}
                  formatter={(val: any) => [formatMoney(Number(val) || 0), 'Faturamento']}
                />
                <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                  {yearData.rankingLojas.slice(0, 25).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index < 3 ? '#1428A0' : '#94a3b8'} />
                  ))}
                  <LabelList
                    dataKey="total"
                    position="right"
                    formatter={(val: any) => formatMoneyShort(Number(val) || 0)}
                    style={{ fontSize: '10px', fontWeight: 'bold', fill: '#475569' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <div className="flex items-center gap-2">
              <LayoutGrid size={14} className="text-slate-500" />
              <h3 className="font-black text-slate-700 uppercase text-xs">Top Lojas</h3>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase">
              {yearData.rankingLojas.length} lojas
            </span>
          </div>

          <div className="overflow-y-auto flex-1 p-4">
            <table className="w-full text-left border-collapse">
              <tbody>
                {yearData.rankingLojas.slice(0, 50).map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors">
                    <td className="p-2 w-6">
                      <span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="text-[10px] font-bold text-slate-700 uppercase truncate w-40" title={l.nome}>{l.nome}</div>
                      <div className="text-[8px] text-slate-400 uppercase">ano {currentYear}</div>
                    </td>
                    <td className="p-2 text-right text-[10px] font-black text-[#1428A0]">
                      {formatMoney(l.total)}
                    </td>
                  </tr>
                ))}
                {yearData.rankingLojas.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-slate-400 font-bold text-sm" colSpan={3}>
                      Nenhuma loja com vendas no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}