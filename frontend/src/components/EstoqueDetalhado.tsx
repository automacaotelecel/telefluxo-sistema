import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Layers, MapPin, Download, Package, Calendar, 
  TrendingUp, AlertCircle, Clock, ShieldCheck, RefreshCw, Filter, Store, ChevronLeft, ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Mapas de regiões e lojas
const STORE_REGIONS: Record<string, string> = {
  "ARAGUAIA SHOPPING": "GOIÁS", "BOULEVARD SHOPPING": "DF", "BRASILIA SHOPPING": "DF",
  "CONJUNTO NACIONAL": "DF", "CONJUNTO NACIONAL QUIOSQUE": "DF", "GOIANIA SHOPPING": "GOIÁS",
  "IGUATEMI SHOPPING": "DF", "JK SHOPPING": "DF", "PARK SHOPPING": "DF",
  "PATIO BRASIL": "DF", "TAGUATINGA SHOPPING": "DF", "TERRAÇO SHOPPING": "DF",
  "TAGUATINGA SHOPPING QQ": "DF", "UBERLÂNDIA SHOPPING": "MINAS GERAIS",
  "UBERABA SHOPPING": "MINAS GERAIS", "FLAMBOYANT SHOPPING": "GOIÁS",
  "BURITI SHOPPING": "GOIÁS", "PASSEIO DAS AGUAS": "GOIÁS", "PORTAL SHOPPING": "GOIÁS",
  "SHOPPING SUL": "GOIÁS", "BURITI RIO VERDE": "GOIÁS", "PARK ANAPOLIS": "GOIÁS",
  "SHOPPING RECIFE": "NORDESTE", "MANAIRA SHOPPING": "NORDESTE", "IGUATEMI FORTALEZA": "NORDESTE",
  "CD TAGUATINGA": "CD"
};

const CNPJ_MAP: Record<string, string> = {
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

const normalizeStr = (str: string) => String(str || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const getStoreNameFromCNPJ = (raw: string) => {
  if (!raw) return "";
  const clean = raw.replace(/\D/g, '');
  return CNPJ_MAP[clean] || CNPJ_MAP[raw] || raw.toUpperCase();
};

// CAÇADOR UNIVERSAL DE DATAS E QUANTIDADES (Blinda contra diferenças de banco)
const getDateValue = (sale: any) => sale.data_emissao || sale.DATA_EMISSAO || sale.data || sale.DATA || sale.date || sale.DATE || '';
const getQtyValue = (sale: any) => Number(sale.quantidade || sale.QUATIDADE || sale.qtd || sale.QTD || 1);

const parseDateValue = (val: any) => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  const s = String(val).trim();
  if (!s) return null;
  if (s.includes('T')) return new Date(s);
  if (s.includes('/')) {
    const p = s.split(' ')[0].split('/');
    if (p.length === 3) {
        if (p[2].length === 4) return new Date(`${p[2]}-${p[1]}-${p[0]}T12:00:00`);
        if (p[0].length === 4) return new Date(`${p[0]}-${p[1]}-${p[2]}T12:00:00`);
    }
  }
  if (s.includes('-')) return new Date(`${s.substring(0, 10)}T12:00:00`);
  return null;
};

export default function EstoqueDetalhado() {
  const [loading, setLoading] = useState(false);
  const [stockData, setStockData] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  
  // Filtros Globais
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState('TODOS');

  // Estado para a "Segunda Navegação" (Drill-down loja a loja)
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  const API_URL = isLocal ? `http://${window.location.hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const loadData = async () => {
    setLoading(true);
    try {
      let userId = '';
      try {
        const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          userId = parsed.id || parsed.userId || parsed._id || '';
        }
      } catch (e) {}

      // 1. Puxa Estoque Físico
      const resStock = await fetch(`${API_URL}/stock`);
      const jsonStock = await resStock.json();
      const rawStock = Array.isArray(jsonStock) ? jsonStock : [];

      // 2. Puxa Bancos de Venda (Tempo Real e Histórico SQLite)
      const [resSales, resSalesAnual] = await Promise.all([
        fetch(`${API_URL}/sales?userId=${userId}`),
        fetch(`${API_URL}/sales_anuais?userId=${userId}`)
      ]);

      let vendasMesRaw = resSales.ok ? await resSales.json() : [];
      let vendasAnualRaw = resSalesAnual.ok ? await resSalesAnual.json() : [];
      
      let vendasMes = vendasMesRaw.sales || (Array.isArray(vendasMesRaw) ? vendasMesRaw : []);
      let vendasAnual = vendasAnualRaw.sales || (Array.isArray(vendasAnualRaw) ? vendasAnualRaw : []);

      // 3. SEPARAÇÃO BLINDADA DOS BANCOS (Garante que nunca vão se duplicar)
      
      // Do Banco Mensal (Tempo Real): Pegar apenas o mês atual
      const liveFiltered = vendasMes.filter((sale: any) => {
          const d = parseDateValue(getDateValue(sale));
          return d && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      });

      // Do Banco Anual (SQLite): Pegar apenas o que aconteceu ANTES do mês atual
      const annualFiltered = vendasAnual.filter((sale: any) => {
          const d = parseDateValue(getDateValue(sale));
          return d && (d.getFullYear() < currentYear || (d.getFullYear() === currentYear && d.getMonth() < currentMonth));
      });

      setStockData(rawStock);
      setSalesData([...annualFiltered, ...liveFiltered]);

    } catch (error) {
      console.error("Erro ao carregar Visão Detalhada:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Datas de Referência para os Cálculos
  const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
  const date60DaysAgo = new Date(today.getTime() - (60 * 24 * 60 * 60 * 1000));
  const date90DaysAgo = new Date(today.getTime() - (90 * 24 * 60 * 60 * 1000));

  // =========================================================================
  // LÓGICA DA TELA 1: VISÃO GERAL DE PRODUTOS
  // =========================================================================
  const detailedViewData = useMemo(() => {
    if (!stockData.length) return [];
    const productMap = new Map();

    stockData.forEach(item => {
      const storeName = item.storeName || 'OUTROS';
      const region = STORE_REGIONS[storeName] || 'OUTROS';
      
      if (regionFilter !== 'TODAS' && region !== regionFilter) return;
      if (storeFilter !== 'TODAS' && storeName !== storeFilter) return;
      if (categoryFilter !== 'TODAS' && (item.category || 'GERAL') !== categoryFilter) return;
      if (search && !item.description?.toLowerCase().includes(search.toLowerCase())) return;

      const key = item.description;
      if (!productMap.has(key)) {
        productMap.set(key, { modelo: item.description, categoria: item.category || 'GERAL', estoque: 0, vendasMes: 0, vendas60: 0, vendas90: 0 });
      }
      productMap.get(key).estoque += (Number(item.quantity) || 0);
    });

    salesData.forEach(sale => {
      const storeName = getStoreNameFromCNPJ(sale.cnpj_empresa || sale.loja);
      const region = STORE_REGIONS[storeName] || 'OUTROS';
      const desc = normalizeStr(sale.descricao || sale.produto);
      const category = sale.familia || sale.categoria_real || sale.categoria || 'GERAL';

      if (regionFilter !== 'TODAS' && region !== regionFilter) return;
      if (storeFilter !== 'TODAS' && storeName !== storeFilter) return;
      if (categoryFilter !== 'TODAS' && category !== categoryFilter) return;
      if (search && !desc.toLowerCase().includes(search.toLowerCase())) return;

      let p = Array.from(productMap.values()).find(x => normalizeStr(x.modelo) === desc);
      if (!p) {
          productMap.set(desc, { modelo: sale.descricao || sale.produto, categoria: category, estoque: 0, vendasMes: 0, vendas60: 0, vendas90: 0 });
          p = productMap.get(desc);
      }

      const saleDate = parseDateValue(getDateValue(sale));
      if (!saleDate) return;
      const qty = getQtyValue(sale);

      // Distribuição inteligente nos "baldes" de tempo
      if (saleDate >= startOfCurrentMonth) p.vendasMes += qty;
      if (saleDate >= date60DaysAgo) p.vendas60 += qty;
      if (saleDate >= date90DaysAgo) p.vendas90 += qty;
    });

    let result = Array.from(productMap.values()).map(p => {
        const giroDiario = p.vendas90 / 90; 
        let coberturaDias = Infinity;
        if (giroDiario > 0) coberturaDias = p.estoque / giroDiario;
        return { ...p, giroDiario, coberturaDias };
    });

    if (statusFilter !== 'TODOS') {
        result = result.filter(item => {
            if (statusFilter === 'FALTAR') return item.coberturaDias <= 30 && item.coberturaDias !== Infinity;
            if (statusFilter === 'EXCESSO') return item.coberturaDias > 120 && item.coberturaDias !== Infinity;
            if (statusFilter === 'SEM_GIRO') return item.coberturaDias === Infinity;
            return true;
        });
    }

    return result.sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90);
  }, [stockData, salesData, regionFilter, storeFilter, categoryFilter, search, statusFilter]);

  const uniqueCategories = useMemo(() => Array.from(new Set(stockData.map(i => i.category || 'GERAL'))).sort(), [stockData]);
  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);
  const uniqueStores = useMemo(() => {
      let stores = stockData.map(i => i.storeName);
      if (regionFilter !== 'TODAS') stores = stores.filter(s => STORE_REGIONS[s] === regionFilter);
      return Array.from(new Set(stores.filter(Boolean))).sort();
  }, [stockData, regionFilter]);


  // =========================================================================
  // LÓGICA DA TELA 2: DRILL-DOWN (SEGUNDA NAVEGAÇÃO LOJA A LOJA)
  // =========================================================================
  const productStoreDetails = useMemo(() => {
    if (!selectedProduct) return [];
    const storeMap = new Map();

    stockData.forEach(item => {
        if (item.description !== selectedProduct) return;
        const storeName = item.storeName || 'OUTROS';
        if (!storeMap.has(storeName)) {
            storeMap.set(storeName, { loja: storeName, regiao: STORE_REGIONS[storeName] || 'OUTROS', estoque: 0, vendasMes: 0, vendas60: 0, vendas90: 0 });
        }
        storeMap.get(storeName).estoque += (Number(item.quantity) || 0);
    });

    salesData.forEach(sale => {
        const desc = normalizeStr(sale.descricao || sale.produto);
        if (desc !== normalizeStr(selectedProduct)) return;

        const storeName = getStoreNameFromCNPJ(sale.cnpj_empresa || sale.loja);
        if (!storeMap.has(storeName)) {
            storeMap.set(storeName, { loja: storeName, regiao: STORE_REGIONS[storeName] || 'OUTROS', estoque: 0, vendasMes: 0, vendas60: 0, vendas90: 0 });
        }

        const p = storeMap.get(storeName);
        const saleDate = parseDateValue(getDateValue(sale));
        if (!saleDate) return;
        const qty = getQtyValue(sale);

        if (saleDate >= startOfCurrentMonth) p.vendasMes += qty;
        if (saleDate >= date60DaysAgo) p.vendas60 += qty;
        if (saleDate >= date90DaysAgo) p.vendas90 += qty;
    });

    return Array.from(storeMap.values()).map(p => {
        const giroDiario = p.vendas90 / 90;
        let coberturaDias = Infinity;
        if (giroDiario > 0) coberturaDias = p.estoque / giroDiario;
        return { ...p, giroDiario, coberturaDias };
    }).sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90);
  }, [selectedProduct, stockData, salesData]);


  const exportToExcel = () => {
    const dataToExport = detailedViewData.map(item => ({
      "Produto": item.modelo,
      "Categoria": item.categoria,
      "Estoque Atual": item.estoque,
      "Vendas (Mês Atual)": item.vendasMes,
      "Vendas (60 Dias)": item.vendas60,
      "Vendas (90 Dias)": item.vendas90,
      "Giro Diário (Média)": item.giroDiario > 0 ? item.giroDiario.toFixed(2) : '0',
      "Previsão de Cobertura (Dias)": item.coberturaDias === Infinity ? 'Sem Giro' : Math.round(item.coberturaDias)
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Visao_Detalhada");
    XLSX.writeFile(wb, "Estoque_Visao_Detalhada.xlsx");
  };

  const renderStatus = (coberturaDias: number) => {
      const dias = Math.round(coberturaDias);
      if (coberturaDias === Infinity) return <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded-md text-[10px] font-black border border-slate-200">Sem Giro</span>;
      if (dias <= 15) return <span className="bg-red-100 text-red-700 px-2 py-1 rounded-md text-[10px] font-black border border-red-200 animate-pulse">{dias} dias (Crítico)</span>;
      if (dias <= 30) return <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-md text-[10px] font-black border border-amber-200">{dias} dias (Atenção)</span>;
      if (dias > 120) return <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-md text-[10px] font-black border border-purple-200">{dias} dias (Excesso)</span>;
      return <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md text-[10px] font-black border border-emerald-200">{dias} dias</span>;
  };

  // =========================================================================
  // RENDERIZAÇÃO: SEGUNDA NAVEGAÇÃO (DRILL-DOWN)
  // =========================================================================
  if (selectedProduct) {
      return (
        <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen animate-in fade-in slide-in-from-right-8 duration-300">
            <div className="max-w-[1600px] mx-auto space-y-6">
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedProduct(null)} className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
                            <ChevronLeft size={24} />
                        </button>
                        <div>
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1 mb-1">
                                <Store size={12}/> Análise Loja a Loja
                            </p>
                            <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                                {selectedProduct}
                            </h1>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <div className="overflow-x-auto max-h-[650px] scrollbar-thin">
                        <table className="w-full text-left border-collapse min-w-[1000px]">
                            <thead className="sticky top-0 bg-slate-50 shadow-sm z-10 border-b border-slate-200">
                                <tr>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase">Loja / Região</th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200">Vendas <br/><span className="text-indigo-500">Mês Atual</span></th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-100">Vendas <br/><span className="text-sky-500">Últimos 60D</span></th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-100">Vendas <br/><span className="text-blue-500">Últimos 90D</span></th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-slate-100/50">Estoque <br/><span className="text-slate-800">Físico Atual</span></th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-indigo-50/50">Giro Médio <br/><span className="text-indigo-600">Peças/Dia</span></th>
                                    <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-indigo-50/50">Cobertura <br/><span className="text-indigo-600">Previsão</span></th>
                                </tr>
                            </thead>
                            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
                                {productStoreDetails.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <p className="font-black text-xs uppercase text-slate-800">{item.loja}</p>
                                            <span className="inline-block text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase mt-1">{item.regiao}</span>
                                        </td>
                                        <td className="p-4 text-center border-l border-slate-100 font-black text-indigo-600">{item.vendasMes}</td>
                                        <td className="p-4 text-center border-l border-slate-50 font-black text-sky-600">{item.vendas60}</td>
                                        <td className="p-4 text-center border-l border-slate-50 font-black text-blue-600">{item.vendas90}</td>
                                        <td className="p-4 text-center border-l border-slate-100 bg-slate-50/50">
                                            <span className={`px-3 py-1 rounded-lg font-black text-sm ${item.estoque === 0 ? 'text-red-500' : 'text-slate-800'}`}>{item.estoque}</span>
                                        </td>
                                        <td className="p-4 text-center border-l border-slate-100 bg-indigo-50/10 font-mono text-xs font-bold text-slate-600">
                                            {item.giroDiario > 0 ? `${item.giroDiario.toFixed(2)} un/dia` : '-'}
                                        </td>
                                        <td className="p-4 text-center border-l border-slate-100 bg-indigo-50/10">
                                            {renderStatus(item.coberturaDias)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
      );
  }

  // =========================================================================
  // RENDERIZAÇÃO: TELA PRINCIPAL (VISÃO GERAL DE MODELOS)
  // =========================================================================
  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen animate-in fade-in duration-500">
      <div className="max-w-[1600px] mx-auto space-y-6">

        <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-600 rounded-xl shadow-md text-white">
                <Package size={24} />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                  Visão Detalhada de Estoque
                </h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 mt-1">
                  <TrendingUp size={12}/> Análise de Cobertura Baseada em Histórico de Vendas
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={loadData} disabled={loading} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-2">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
              </button>
              <button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2">
                <Download size={14} /> Exportar
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 mt-2 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="BUSCAR MODELO..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold uppercase rounded-xl outline-none focus:border-indigo-500 transition-all shadow-sm" />
            </div>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 shadow-sm">
              <MapPin size={14} className="text-indigo-500 mr-2" />
              <select value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setStoreFilter('TODAS'); }} className="w-full bg-transparent border-none py-2 text-xs font-bold text-slate-600 uppercase focus:outline-none cursor-pointer truncate">
                <option value="TODAS">Região: TODAS</option>
                {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 shadow-sm">
              <Store size={14} className="text-indigo-500 mr-2" />
              <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="w-full bg-transparent border-none py-2 text-xs font-bold text-slate-600 uppercase focus:outline-none cursor-pointer truncate">
                <option value="TODAS">Loja: TODAS</option>
                {uniqueStores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 shadow-sm">
              <Layers size={14} className="text-indigo-500 mr-2" />
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full bg-transparent border-none py-2 text-xs font-bold text-slate-600 uppercase focus:outline-none cursor-pointer truncate">
                <option value="TODAS">Categoria: TODAS</option>
                {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="flex items-center bg-indigo-50 border border-indigo-200 rounded-xl px-3 shadow-sm">
              <AlertCircle size={14} className="text-indigo-600 mr-2" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-transparent border-none py-2 text-[10px] font-black text-indigo-700 uppercase focus:outline-none cursor-pointer truncate">
                <option value="TODOS">Status: TODOS</option>
                <option value="FALTAR">VAI FALTAR (≤ 30 dias)</option>
                <option value="EXCESSO">EXCESSO (&gt; 120 dias)</option>
                <option value="SEM_GIRO">SEM GIRO / ENCALHADO</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="overflow-x-auto max-h-[650px] scrollbar-thin">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead className="sticky top-0 bg-slate-50 shadow-sm z-10 border-b border-slate-200">
                <tr>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase">Produto / Categoria</th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200">Vendas <br/><span className="text-indigo-500">Mês Atual</span></th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-100">Vendas <br/><span className="text-sky-500">Últimos 60D</span></th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-100">Vendas <br/><span className="text-blue-500">Últimos 90D</span></th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-slate-100/50">Estoque <br/><span className="text-slate-800">Físico Atual</span></th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-indigo-50/50">Giro Médio <br/><span className="text-indigo-600">Peças/Dia</span></th>
                  <th className="p-4 text-[10px] font-black text-slate-500 uppercase text-center border-l border-slate-200 bg-indigo-50/50">Previsão <br/><span className="text-indigo-600">Automática</span></th>
                </tr>
              </thead>
              <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
                {detailedViewData.map((item, idx) => (
                    <tr 
                        key={idx} 
                        onClick={() => setSelectedProduct(item.modelo)}
                        className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                    >
                      <td className="p-4 relative">
                        <p className="font-black text-xs uppercase text-slate-800 line-clamp-2 max-w-[280px]" title={item.modelo}>
                          {item.modelo}
                        </p>
                        <span className="inline-block text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase mt-1">
                          {item.categoria}
                        </span>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[9px] font-black text-indigo-500 uppercase flex items-center gap-1 bg-indigo-100 px-2 py-1 rounded-lg">
                                Ver Lojas <ArrowRight size={12}/>
                            </span>
                        </div>
                      </td>
                      <td className="p-4 text-center border-l border-slate-100 font-black text-indigo-600">{item.vendasMes}</td>
                      <td className="p-4 text-center border-l border-slate-50 font-black text-sky-600">{item.vendas60}</td>
                      <td className="p-4 text-center border-l border-slate-50 font-black text-blue-600">{item.vendas90}</td>
                      <td className="p-4 text-center border-l border-slate-100 bg-slate-50/50">
                        <span className={`px-3 py-1 rounded-lg font-black text-sm ${item.estoque === 0 ? 'text-red-500' : 'text-slate-800'}`}>{item.estoque}</span>
                      </td>
                      <td className="p-4 text-center border-l border-slate-100 bg-indigo-50/10 font-mono text-xs font-bold text-slate-600">
                        {item.giroDiario > 0 ? `${item.giroDiario.toFixed(2)} un/dia` : '-'}
                      </td>
                      <td className="p-4 text-center border-l border-slate-100 bg-indigo-50/10">
                        {renderStatus(item.coberturaDias)}
                      </td>
                    </tr>
                ))}
                
                {detailedViewData.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400 text-xs uppercase font-bold tracking-widest bg-slate-50/50">
                      Nenhum produto encontrado com os filtros atuais.
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