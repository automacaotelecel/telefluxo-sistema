import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar, Cell, LabelList
} from 'recharts';
import { 
  DollarSign, TrendingUp, Trophy, LayoutGrid, Users, Calendar, Store, 
  AlertCircle, ChevronDown, CheckSquare, Square, Filter, Footprints, MousePointerClick, ArrowRightLeft, Layers
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
    "12309173001066": "CD TAGUATINGA"
};

const getStoreName = (raw: string) => {
    if (!raw) return "N/D";
    const clean = raw.replace(/\D/g, ''); 
    return STORE_MAP[clean] || STORE_MAP[raw] || raw;
};

const formatMoneyShort = (val: number) => {
    if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
    return `R$ ${val.toFixed(0)}`;
}

export default function SalesDashboard() {
  const [rawData, setRawData] = useState<any[]>([]);
  const [flowRawData, setFlowRawData] = useState<any[]>([]);
  const [stockRawData, setStockRawData] = useState<any[]>([]);
  const [kpiData, setKpiData] = useState<any[]>([]); 
  
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]); 
  const [ranking, setRanking] = useState<any[]>([]);
  const [productRanking, setProductRanking] = useState<any[]>([]); 
  
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);
  
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const [startDate, setStartDate] = useState(firstDay.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  // NOVO: Estado para a Categoria
  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  const [activeTab, setActiveTab] = useState('visao_geral');

  const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://telefluxo-aplicacao.onrender.com';
  
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  const formatPercent = (val: number) => `${((val || 0) * 100).toFixed(1)}%`;

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) {
        setIsStoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    let userId = '';
    try {
        const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
        if (rawUser) {
            const parsed = JSON.parse(rawUser);
            userId = parsed.id || parsed.userId || parsed._id || '';
        }
    } catch (e) { console.error(e); }

    if (!userId) { setErrorMsg("Usuário não identificado."); setLoading(false); return; }

    try {
        const resSales = await fetch(`${API_URL}/sales?userId=${userId}`);
        if (resSales.ok) {
            const data = await resSales.json();
            setRawData(data.sales || (Array.isArray(data) ? data : []));
        }

        try {
            const resFlow = await fetch(`${API_URL}/api/bestflow`);
            if (resFlow.ok) {
                const dataFlow = await resFlow.json();
                setFlowRawData(Array.isArray(dataFlow) ? dataFlow : []);
            }
        } catch (e) { console.warn("Erro fluxo", e); }

        try {
            const resStock = await fetch(`${API_URL}/stock`);
            if (resStock.ok) {
                const dataStock = await resStock.json();
                setStockRawData(Array.isArray(dataStock) ? dataStock : []);
            }
        } catch(e) { console.warn("Erro estoque", e); }

        try {
            const resKpi = await fetch(`${API_URL}/api/kpi-vendedores`);
            if (resKpi.ok) {
                const dataKpi = await resKpi.json();
                setKpiData(Array.isArray(dataKpi) ? dataKpi : []);
            }
        } catch (e) { console.warn("Erro KPI", e); }

        setErrorMsg(''); 
    } catch (err: any) { 
        console.error(err);
        setErrorMsg("Erro ao carregar dados. Verifique sua conexão.");
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadAllData(); }, []); 

  // --- MATEMÁTICA DE TENDÊNCIA CORRIGIDA ---
  // Calcula quantos dias se passaram e quantos dias tem no mês para fazer a projeção correta
  const { diasPassados, diasNoMes } = useMemo(() => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      // Ajuste de fuso horário para não dar erro de dia
      start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
      end.setMinutes(end.getMinutes() + end.getTimezoneOffset());
      
      const passados = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const noMes = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
      
      return { diasPassados: passados, diasNoMes: noMes };
  }, [startDate, endDate]);

  // Lista dinâmica de Categorias do BD (Corrigido para ler FAMILIA)
  const uniqueCategories = useMemo(() => {
      const cats = new Set(
          rawData.map(r => {
              // Procura por familia (maiúsculo ou minúsculo) antes de tentar categoria ou grupo
              const val = r.FAMILIA || r.familia || r.categoria || r.grupo || 'OUTROS';
              return String(val).trim().toUpperCase();
          }).filter(f => f !== 'NAN' && f !== 'UNDEFINED' && f !== '')
      );
      return Array.from(cats).sort();
  }, [rawData]);

  const filteredData = useMemo(() => {
      return rawData.filter(sale => {
          const dataVenda = sale.data_emissao || "";
          let dataISO = dataVenda;
          if (dataVenda.includes('/')) {
              const parts = dataVenda.split('/');
              if (parts.length === 3) dataISO = `${parts[2]}-${parts[1]}-${parts[0]}`;
          } else if (dataVenda.includes('-')) {
              dataISO = dataVenda.substring(0, 10);
          }

          if (dataISO < startDate || dataISO > endDate) return false;

          if (selectedStores.length > 0) {
              const rawLoja = sale.cnpj_empresa || sale.loja || "";
              const nomeLoja = getStoreName(rawLoja);
              if (!selectedStores.includes(nomeLoja)) return false;
          }

          // NOVO: Filtro de Categoria (Corrigido para ler FAMILIA)
          if (categoryFilter !== 'TODAS') {
              const rawCat = sale.FAMILIA || sale.familia || sale.categoria || sale.grupo || 'OUTROS';
              const cat = String(rawCat).trim().toUpperCase();
              if (cat !== categoryFilter) return false;
          }

          return true;
      });
  }, [rawData, startDate, endDate, selectedStores, categoryFilter]);

  const groupedFlowData = useMemo(() => {
      const filtered = flowRawData.filter(item => {
          const dataItem = item.data || "";
          let dataISO = dataItem.substring(0, 10); 
          
          if (dataISO < startDate || dataISO > endDate) return false;

          if (selectedStores.length > 0) {
              const nomeLoja = getStoreName(item.loja || "");
              if (!selectedStores.some(s => s.toUpperCase() === nomeLoja.toUpperCase())) return false;
          }
          return true;
      });

      const groups: Record<string, any> = {};
      filtered.forEach(item => {
          const nomeLoja = getStoreName(item.loja);
          if (!groups[nomeLoja]) {
              groups[nomeLoja] = { loja: nomeLoja, entradas: 0, qtd: 0, valor: 0 };
          }
          groups[nomeLoja].entradas += Number(item.entradas || 0);
          groups[nomeLoja].qtd += Number(item.qtd_vendida || 0);
          groups[nomeLoja].valor += Number(item.valor_vendido || 0);
      });

      return Object.values(groups).map((g: any) => ({
          ...g,
          conversao: g.entradas > 0 ? g.qtd / g.entradas : 0
      })).sort((a: any, b: any) => b.conversao - a.conversao); 

  }, [flowRawData, startDate, endDate, selectedStores]);

  useEffect(() => {
      const total = filteredData.reduce((acc, curr) => acc + Number(curr.total_liquido || 0), 0);
      const pecas = filteredData.reduce((acc, curr) => acc + Number(curr.quantidade || 1), 0);
      const ticket = pecas > 0 ? total / pecas : 0;
      setSummary({ total_vendas: total, total_pecas: pecas, ticket_medio: ticket });

      const mapChart = new Map();
      filteredData.forEach(sale => {
          let label = "N/D";
          const dataVenda = sale.data_emissao || "";
          if (dataVenda.includes('/')) {
              const parts = dataVenda.split('/');
              label = `${parts[0]}/${parts[1]}`;
          } else if (dataVenda.includes('-')) {
              const parts = dataVenda.substring(0, 10).split('-');
              label = `${parts[2]}/${parts[1]}`;
          }
          if (!mapChart.has(label)) mapChart.set(label, { dia: label, valor: 0 });
          mapChart.get(label).valor += Number(sale.total_liquido || 0);
      });
      const sortedChart = Array.from(mapChart.values()).sort((a: any, b: any) => {
          const [d1, m1] = a.dia.split('/').map(Number);
          const [d2, m2] = b.dia.split('/').map(Number);
          return m1 - m2 || d1 - d2;
      });
      setChartData(sortedChart);

      const mapRanking = new Map();
      filteredData.forEach(sale => {
          const nome = sale.nome_vendedor || sale.vendedor || "N/D";
          const rawLoja = sale.cnpj_empresa || sale.loja || "";
          const nomeLoja = getStoreName(rawLoja);
          if (!mapRanking.has(nome)) mapRanking.set(nome, { nome, loja: nomeLoja, total: 0, qtd: 0 });
          const item = mapRanking.get(nome);
          item.total += Number(sale.total_liquido || 0);
          item.qtd += Number(sale.quantidade || 1);
      });

      const sortedRanking = Array.from(mapRanking.values())
        .map((v: any) => {
            const kpi = kpiData.find(k => 
                (k.vendedor || "").trim().toUpperCase() === v.nome.trim().toUpperCase()
            );

            const totalVendedor = v.total || 0;
            const anterior = Number(kpi?.fat_anterior || 0);
            
            // NOVO CÁLCULO DE TENDÊNCIA INDIVIDUAL
            const tendenciaMatematica = (totalVendedor / diasPassados) * diasNoMes;

            return {
                ...v,
                tendencia: Math.max(tendenciaMatematica, totalVendedor), // Garante que nunca seja menor que o atual
                seguros: Number(kpi?.seguros || 0),
                pct_seguro: Number(kpi?.pct_seguro || 0),
                fat_anterior: anterior,
                crescimento: anterior > 0 ? (totalVendedor - anterior) / anterior : 0,
                pa: kpi?.pa || (v.qtd / 50).toFixed(2), 
                ticket: v.qtd > 0 ? totalVendedor / v.qtd : 0,
            };
        })
        .sort((a: any, b: any) => b.total - a.total);
      setRanking(sortedRanking);
        
      const mapProd = new Map();
      filteredData.forEach(sale => {
          const desc = sale.descricao || sale.produto || "N/D";
          if (!mapProd.has(desc)) mapProd.set(desc, { desc, qtd: 0, total: 0, estoqueAtual: 0 });
          const p = mapProd.get(desc);
          p.qtd += Number(sale.quantidade || 0);
          p.total += Number(sale.total_liquido || 0);
      });
      const sortedProd = Array.from(mapProd.values()).map((p: any) => {
          const stockItem = stockRawData.find((s:any) => s.description === p.desc);
          return { ...p, estoqueAtual: stockItem ? Number(stockItem.quantity) : 0 };
      }).sort((a:any, b:any) => b.qtd - a.qtd);
      setProductRanking(sortedProd);

  }, [filteredData, stockRawData, kpiData, diasPassados, diasNoMes]); 

  const uniqueStores = useMemo(() => {
      const stores = new Set(rawData.map(r => getStoreName(r.cnpj_empresa || r.loja)).filter(Boolean));
      return Array.from(stores).sort();
  }, [rawData]);

  const storeRanking = useMemo(() => {
      const stores: any = {};
      filteredData.forEach(item => {
          const rawLoja = item.cnpj_empresa || item.loja || 'OUTROS';
          const lojaNome = getStoreName(rawLoja);
          if (!stores[lojaNome]) stores[lojaNome] = 0;
          stores[lojaNome] += Number(item.total_liquido || 0);
      });
      return Object.keys(stores)
          .map(key => ({ nome: key, total: stores[key] }))
          .sort((a, b) => b.total - a.total);
  }, [filteredData]);

  // NOVO CÁLCULO GERAL DE TENDÊNCIA
  const totalTendencia = useMemo(() => {
      if (diasPassados === 0) return summary.total_vendas;
      const projecao = (summary.total_vendas / diasPassados) * diasNoMes;
      return Math.max(projecao, summary.total_vendas);
  }, [summary.total_vendas, diasPassados, diasNoMes]);

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) {
      setSelectedStores(selectedStores.filter(s => s !== store));
    } else {
      setSelectedStores([...selectedStores, store]);
    }
  };

  const handleStoreClick = (data: any) => {
      if (data && data.nome) toggleStore(data.nome);
  };

  // Progresso do mês
  const perfPercent = totalTendencia > 0 ? (summary.total_vendas / totalTendencia) * 100 : 0;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative flex items-center gap-2">
            <AlertCircle size={20} />
            <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* HEADER DE FILTROS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-[#1428A0] rounded text-white"><LayoutGrid size={18} /></div>
                <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">controle de vendas</h1>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">Samsung
            </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
            
            {/* NOVO: FILTRO DE CATEGORIA */}
            <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
                <Layers size={14} className="text-blue-600"/>
                <select 
                    value={categoryFilter} 
                    onChange={e => setCategoryFilter(e.target.value)} 
                    className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto"
                >
                    <option value="TODAS">Todas as Categorias</option>
                    {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <div className="relative" ref={storeMenuRef}>
                <button 
                    onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
                    className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors min-w-[200px] justify-between shadow-sm"
                >
                    <div className="flex items-center gap-2">
                        <Store size={14} className="text-blue-600"/>
                        <span className="truncate max-w-[140px] uppercase">
                            {selectedStores.length === 0 ? "Todas as Lojas" : 
                             selectedStores.length === 1 ? selectedStores[0] : 
                             `${selectedStores.length} Lojas`}
                        </span>
                    </div>
                    <ChevronDown size={14} className="text-slate-400"/>
                </button>

                {isStoreMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 p-2 max-h-80 overflow-y-auto">
                        <div onClick={() => setSelectedStores([])} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1">
                            {selectedStores.length === 0 ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                            <span className="text-xs font-bold text-slate-700 uppercase">Todas as Lojas</span>
                        </div>
                        {uniqueStores.map((store: string) => (
                            <div key={store} onClick={() => toggleStore(store)} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer">
                                {selectedStores.includes(store) ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                                <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                <div className="flex items-center px-2 border-r border-slate-100">
                    <Calendar size={14} className="text-slate-400 mr-2"/>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-24"/>
                </div>
                <div className="flex items-center px-2">
                    <span className="text-slate-300 font-bold mr-2 text-[10px]">ATÉ</span>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-24"/>
                </div>
            </div>

            <button onClick={loadAllData} disabled={loading} className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/10 flex items-center gap-2 disabled:opacity-50">
                <Filter size={14}/> {loading ? 'CARREGANDO...' : 'ATUALIZAR DADOS'}
            </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveTab('visao_geral')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'visao_geral' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Visão Mensal</button>
          <button onClick={() => setActiveTab('vendedores')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'vendedores' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Vendedores</button>
          <button onClick={() => setActiveTab('fluxo')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-2 ${activeTab === 'fluxo' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
             <Footprints size={14}/> Fluxo / Bestflow (Beta)
          </button>
      </div>

      {activeTab === 'visao_geral' && (
        <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#1428A0]">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Faturamento (Filtrado)</span><DollarSign size={16} className="text-[#1428A0]"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(summary.total_vendas)}</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Projeção Fim do Mês</span><TrendingUp size={16} className="text-purple-500"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(totalTendencia)}</div>
                    <div className="text-[9px] text-purple-600 font-bold mt-1">{perfPercent.toFixed(1)}% do mês percorrido</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-slate-800">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Peças</span><Users size={16} className="text-slate-800"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{summary.total_pecas}</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Ticket Médio</span><Trophy size={16} className="text-green-500"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(summary.ticket_medio)}</div>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 h-64">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={14} className="text-slate-400"/>
                    <h3 className="font-black text-slate-700 uppercase text-xs">Evolução Diária</h3>
                </div>
                <div className="h-full pb-6">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="colorVendas" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#1428A0" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#1428A0" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                            <XAxis dataKey="dia" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip contentStyle={{backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff'}} itemStyle={{color: '#fff', fontSize: '12px'}} formatter={(val: number) => [formatMoney(val), 'Vendas']} />
                            <Area type="monotone" dataKey="valor" stroke="#1428A0" fillOpacity={1} fill="url(#colorVendas)">
                                <LabelList dataKey="valor" position="top" offset={10} formatter={(val: number) => formatMoneyShort(val)} style={{ fontSize: '10px', fill: '#1428A0', fontWeight: 'bold' }} />
                            </Area>
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 h-[500px]">
                <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex flex-col h-full overflow-hidden">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
                        <Store size={14} className="text-slate-400"/>
                        <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Lojas (Filtrado)</h3>
                    </div>
                    <div className="flex-1 min-h-0 text-[10px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={storeRanking} margin={{ top: 5, right: 80, left: 10, bottom: 5 }} barSize={15}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9"/>
                                <XAxis type="number" hide />
                                <YAxis dataKey="nome" type="category" width={210} tick={{fontSize: 8, fontWeight: 800, fill: '#475569'}} interval={0} />                                     
                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '12px'}} formatter={(val: number) => [formatMoney(val), 'Faturamento']} />
                                <Bar dataKey="total" radius={[0, 4, 4, 0]} onClick={handleStoreClick} style={{ cursor: 'pointer' }}>
                                    {storeRanking.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={selectedStores.includes(entry.nome) ? '#25D366' : (index < 3 ? '#1428A0' : '#94a3b8')} />
                                     ))}
                                    <LabelList dataKey="total" position="right" formatter={(val: number) => formatMoneyShort(val)} style={{ fontSize: '9px', fontWeight: 'bold', fill: '#475569' }} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-2">
                            <Users size={14} className="text-slate-500"/>
                            <h3 className="font-black text-slate-700 uppercase text-xs">
                                {selectedStores.length === 0 ? 'Top Vendedores' : `Equipe: ${selectedStores.join(', ')}`}
                            </h3>
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-4">
                        <table className="w-full text-left border-collapse">
                            <tbody>
                                {ranking.slice(0, 50).map((v, i) => (
                                    <tr key={i} className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors">
                                        <td className="p-2 w-6"><span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-bold ${i<3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{i+1}</span></td>
                                        <td className="p-2">
                                            <div className="text-[10px] font-bold text-slate-700 uppercase truncate w-32" title={v.nome}>{v.nome}</div>
                                            <div className="text-[8px] text-slate-400 uppercase">{v.loja}</div>
                                        </td>
                                        <td className="p-2 text-right text-[10px] font-black text-[#1428A0]">{formatMoney(v.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
      )}

      {activeTab === 'vendedores' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2"><Users size={14} className="text-slate-500"/><h3 className="font-black text-slate-700 uppercase text-xs">Ranking Detalhado</h3></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">{ranking.length} RESULTADOS</span>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white shadow-sm z-10">
                        <tr className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                            <th className="p-3 text-center">#</th>
                            <th className="p-3">Vendedor</th>
                            <th className="p-3">Loja</th>
                            <th className="p-3 text-right text-[#1428A0]">Faturamento</th>
                            <th className="p-3 text-right text-purple-600">Projeção Fim do Mês</th>
                            <th className="p-3 text-right">Mês Anterior.</th>
                            <th className="p-3 text-right">Cresc.</th>
                            <th className="p-3 text-right text-emerald-600">Seguros (R$)</th>
                            <th className="p-3 text-right text-purple-600">% Seg</th>
                        </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-slate-700">
                        {ranking.map((v, i) => (
                            <tr key={i} className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors">
                                <td className="p-3 text-center"><span className={`w-5 h-5 flex items-center justify-center rounded text-[9px] ${i<3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{i+1}</span></td>
                                <td className="p-3 uppercase">{v.nome}</td>
                                <td className="p-3 text-slate-400 text-[10px] uppercase">{v.loja}</td>
                                <td className="p-3 text-right font-black text-slate-800">{formatMoney(v.total)}</td>
                                <td className="p-3 text-right text-purple-600">{formatMoney(v.tendencia)}</td>
                                <td className="p-3 text-right text-slate-400">{formatMoney(v.fat_anterior)}</td>
                                <td className={`p-3 text-right ${v.crescimento >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPercent(v.crescimento)}</td>
                                <td className="p-3 text-right text-emerald-600">{formatMoney(v.seguros)}</td>
                                <td className="p-3 text-right font-black text-purple-600">{formatPercent(v.pct_seguro)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}

      {activeTab === 'fluxo' && (
        <div className="space-y-6 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tráfego Total (Filtrado)</p>
                            <h3 className="text-3xl font-black text-slate-800 mt-1">
                                {groupedFlowData.reduce((acc, i) => acc + (Number(i.entradas) || 0), 0).toLocaleString('pt-BR')}
                            </h3>
                        </div>
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={20}/></div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conversão Média</p>
                            <h3 className="text-3xl font-black text-emerald-600 mt-1">
                                {(groupedFlowData.length > 0 
                                    ? (groupedFlowData.reduce((acc, i) => acc + (Number(i.conversao) || 0), 0) / groupedFlowData.length) * 100 
                                    : 0
                                ).toFixed(2)}%
                            </h3>
                        </div>
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><MousePointerClick size={20}/></div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Efetividade (Vendas)</p>
                            <h3 className="text-3xl font-black text-indigo-600 mt-1">
                                {groupedFlowData.reduce((acc, i) => acc + (Number(i.qtd) || 0), 0)} <span className="text-sm text-slate-400 font-bold">peças</span>
                            </h3>
                        </div>
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><ArrowRightLeft size={20}/></div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 uppercase flex items-center gap-2"><Footprints size={18} className="text-indigo-600"/> Detalhamento Consolidado por Loja</h3>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                                <th className="p-4">Loja</th>
                                <th className="p-4 text-center">Entradas Totais</th>
                                <th className="p-4 text-center">Vendas Totais (Qtd)</th>
                                <th className="p-4 text-right">Faturamento Total</th>
                                <th className="p-4 w-48">Taxa de Conversão</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm text-slate-600 divide-y divide-slate-50">
                            {groupedFlowData.map((item: any, idx: number) => {
                                const conversao = Number(item.conversao) || 0;
                                const barColor = conversao < 0.05 ? 'bg-red-500' : conversao < 0.10 ? 'bg-amber-400' : 'bg-emerald-500';
                                return (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4 font-bold text-indigo-900">{item.loja}</td>
                                        <td className="p-4 text-center font-bold">{item.entradas}</td>
                                        <td className="p-4 text-center">{item.qtd}</td>
                                        <td className="p-4 text-right font-mono text-slate-800">
                                            R$ {Number(item.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold w-12 text-right">{(conversao * 100).toFixed(1)}%</span>
                                                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(conversao * 100 * 3, 100)}%` }}></div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {groupedFlowData.length === 0 && (
                    <div className="p-10 text-center text-slate-400 font-bold text-sm">
                        Nenhum dado de fluxo encontrado para o período/loja selecionado.
                    </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
}