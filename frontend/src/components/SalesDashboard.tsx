import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar, Cell 
} from 'recharts';
import { 
  DollarSign, TrendingUp, Trophy, LayoutGrid, Users, Calendar, Store, 
  AlertCircle, ChevronDown, CheckSquare, Square, Filter 
} from 'lucide-react';

// --- 1. MAPA DE TRADUÇÃO (Adicionado para corrigir os CNPJs) ---
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

export default function SalesDashboard() {
  // Dados Brutos (Segura todas as vendas do mês)
  const [rawData, setRawData] = useState<any[]>([]);
  
  // Estados Calculados (O que aparece na tela)
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]); 
  const [ranking, setRanking] = useState<any[]>([]);
  
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);
  
  // --- ESTADOS PARA O FILTRO ---
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const [startDate, setStartDate] = useState(firstDay.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  // Filtros
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  // Abas
  const [activeTab, setActiveTab] = useState('visao_geral');

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';
  
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  const formatPercent = (val: number) => `${((val || 0) * 100).toFixed(1)}%`;

  // Fecha menu ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) {
        setIsStoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- 2. BUSCA DE DADOS (Aqui está o segredo: Pega TUDO e filtra DEPOIS) ---
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
        // NÃO mandamos data para o backend. Trazemos tudo para não zerar.
        const url = `${API_URL}/sales?userId=${userId}`;
        const res = await fetch(url);
        
        if (!res.ok) throw new Error(`Erro API`);
        
        const data = await res.json();
        const lista = data.sales || (Array.isArray(data) ? data : []);
        
        setRawData(lista); // Salva no estado bruto
        setErrorMsg(''); 
    } catch (err: any) { 
        console.error(err);
        setErrorMsg("Erro ao carregar dados.");
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadAllData(); }, []); 

  // --- 3. PROCESSAMENTO (O Cérebro que filtra data e traduz loja) ---

  // A) Filtra os dados Brutos (Data + Loja)
  const filteredData = useMemo(() => {
      return rawData.filter(sale => {
          const dataVenda = sale.data_emissao || ""; // Vem como '06/02/2026' ou '2026-02-06'
          
          // Lógica universal para entender a data
          let dataISO = dataVenda;
          if (dataVenda.includes('/')) {
              const parts = dataVenda.split('/');
              // Se for DD/MM/YYYY transforma em YYYY-MM-DD para o filtro funcionar
              if (parts.length === 3) dataISO = `${parts[2]}-${parts[1]}-${parts[0]}`;
          } else if (dataVenda.includes('-')) {
              dataISO = dataVenda.substring(0, 10);
          }

          // Filtro de Data
          if (dataISO < startDate || dataISO > endDate) return false;

          // Filtro de Loja (Com tradução)
          if (selectedStores.length > 0) {
              const rawLoja = sale.cnpj_empresa || sale.loja || "";
              const nomeLoja = getStoreName(rawLoja);
              if (!selectedStores.includes(nomeLoja)) return false;
          }

          return true;
      });
  }, [rawData, startDate, endDate, selectedStores]);

  // B) Recalcula Cards, Gráfico e Ranking quando o filtro muda
  useEffect(() => {
      // 1. Cards (Resumo)
      const total = filteredData.reduce((acc, curr) => acc + Number(curr.total_liquido || 0), 0);
      const pecas = filteredData.reduce((acc, curr) => acc + Number(curr.quantidade || 1), 0);
      const ticket = pecas > 0 ? total / pecas : 0;
      
      setSummary({ total_vendas: total, total_pecas: pecas, ticket_medio: ticket });

      // 2. Gráfico
      const mapChart = new Map();
      filteredData.forEach(sale => {
          let label = "N/D";
          const dataVenda = sale.data_emissao || "";
          
          if (dataVenda.includes('/')) {
              const parts = dataVenda.split('/');
              label = `${parts[0]}/${parts[1]}`; // DD/MM
          } else if (dataVenda.includes('-')) {
              const parts = dataVenda.substring(0, 10).split('-');
              label = `${parts[2]}/${parts[1]}`; // DD/MM
          }

          if (!mapChart.has(label)) mapChart.set(label, { dia: label, valor: 0 });
          mapChart.get(label).valor += Number(sale.total_liquido || 0);
      });
      // Ordena cronologicamente
      const sortedChart = Array.from(mapChart.values()).sort((a: any, b: any) => {
          const [d1, m1] = a.dia.split('/').map(Number);
          const [d2, m2] = b.dia.split('/').map(Number);
          return m1 - m2 || d1 - d2;
      });
      setChartData(sortedChart);

      // 3. Ranking Vendedores
      const mapRanking = new Map();
      filteredData.forEach(sale => {
          const nome = sale.nome_vendedor || sale.vendedor || "N/D";
          const rawLoja = sale.cnpj_empresa || sale.loja || "";
          const nomeLoja = getStoreName(rawLoja); // Traduz para exibir bonito
          
          if (!mapRanking.has(nome)) {
              mapRanking.set(nome, { nome, loja: nomeLoja, total: 0, qtd: 0 });
          }
          const item = mapRanking.get(nome);
          item.total += Number(sale.total_liquido || 0);
          item.qtd += Number(sale.quantidade || 1);
      });
      
      const sortedRanking = Array.from(mapRanking.values())
          .map((v: any) => ({
              ...v,
              ticket: v.qtd > 0 ? v.total / v.qtd : 0,
              pa: (v.qtd / 50).toFixed(2),
              fat_anterior: v.total * 0.9,
              crescimento: 0.1,
              pct_seguro: 0.0
          }))
          .sort((a: any, b: any) => b.total - a.total);
          
      setRanking(sortedRanking);

  }, [filteredData]);

  // --- LISTAS PARA O MENU (Dropdown) ---

  const uniqueStores = useMemo(() => {
      // Pega lojas do DADO BRUTO e TRADUZ
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

  // Projeção
  const calculateProjection = () => {
      const currentDay = today.getDate();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      if (currentDay === 0) return 0;
      return (summary.total_vendas / currentDay) * lastDay;
  };
  const projectionValue = calculateProjection();
  const perfPercent = projectionValue > 0 ? (summary.total_vendas / projectionValue) * 100 : 0;

  // Funções Auxiliares UI
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
                <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">Performance Comercial</h1>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">Samsung • BI Automático • v3.2</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
            
            {/* SELETOR DE LOJAS */}
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
                        <div 
                            onClick={() => setSelectedStores([])}
                            className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1"
                        >
                            {selectedStores.length === 0 ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                            <span className="text-xs font-bold text-slate-700 uppercase">Todas as Lojas</span>
                        </div>
                        {uniqueStores.map((store: string) => (
                            <div 
                                key={store}
                                onClick={() => toggleStore(store)}
                                className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer"
                            >
                                {selectedStores.includes(store) ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                                <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* SELETOR DE DATAS */}
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                <div className="flex items-center px-2 border-r border-slate-100">
                    <Calendar size={14} className="text-slate-400 mr-2"/>
                    <input 
                        type="date" 
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-24"
                    />
                </div>
                <div className="flex items-center px-2">
                    <span className="text-slate-300 font-bold mr-2 text-[10px]">ATÉ</span>
                    <input 
                        type="date" 
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-24"
                    />
                </div>
            </div>

            {/* BOTÃO ATUALIZAR */}
            <button 
                onClick={loadAllData}
                disabled={loading}
                className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/10 flex items-center gap-2 disabled:opacity-50"
            >
                <Filter size={14}/> {loading ? 'CARREGANDO...' : 'ATUALIZAR DADOS'}
            </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveTab('visao_geral')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'visao_geral' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Visão Geral</button>
          <button onClick={() => setActiveTab('vendedores')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${activeTab === 'vendedores' ? 'bg-[#1428A0] text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Vendedores</button>
      </div>

      {activeTab === 'visao_geral' && (
        <>
            {/* CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#1428A0]">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Faturamento (Filtrado)</span><DollarSign size={16} className="text-[#1428A0]"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(summary.total_vendas)}</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Tendência (Mês)</span><TrendingUp size={16} className="text-purple-500"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(projectionValue)}</div>
                    <div className="text-[9px] text-purple-600 font-bold mt-1">{perfPercent.toFixed(0)}% da Projeção</div>
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

            {/* GRÁFICO DE TENDÊNCIA */}
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
                            
                            <XAxis 
                                dataKey="dia" 
                                tick={{fontSize: 10}} 
                                axisLine={false} 
                                tickLine={false} 
                            />
                            
                            <YAxis hide />
                            <Tooltip 
                                contentStyle={{backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff'}}
                                itemStyle={{color: '#fff', fontSize: '12px'}}
                                formatter={(val: number) => [formatMoney(val), 'Vendas']}
                            />
                            <Area type="monotone" dataKey="valor" stroke="#1428A0" fillOpacity={1} fill="url(#colorVendas)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* RANKING LOJAS E VENDEDORES */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 h-[500px]">
                
                {/* RANKING DE LOJAS */}
                <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex flex-col h-full overflow-hidden">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
                        <Store size={14} className="text-slate-400"/>
                        <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Lojas (Filtrado)</h3>
                    </div>
                    <div className="flex-1 min-h-0 text-[10px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                layout="vertical"
                                data={storeRanking}
                                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                                barSize={20}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9"/>
                                <XAxis type="number" hide />
                                <YAxis 
                                    dataKey="nome" 
                                    type="category" 
                                    width={150} 
                                    tick={{fontSize: 9, fontWeight: 700, fill: '#475569'}}
                                    interval={0}
                                />
                                <Tooltip cursor={{fill: '#f1f5f9'}} formatter={(val: number) => [formatMoney(val), 'Faturamento']} />
                                <Bar 
                                    dataKey="total" 
                                    radius={[0, 4, 4, 0]} 
                                    onClick={handleStoreClick} 
                                    style={{ cursor: 'pointer' }}
                                >
                                    {storeRanking.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={selectedStores.includes(entry.nome) ? '#25D366' : (index < 3 ? '#1428A0' : '#94a3b8')} 
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* LISTA VENDEDORES */}
                <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-2">
                            <Users size={14} className="text-slate-500"/>
                            <h3 className="font-black text-slate-700 uppercase text-xs">
                                {selectedStores.length === 0 ? 'Top Vendedores' : `Equipe: ${selectedStores}`}
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
                            <th className="p-3 text-right">Meta / Ant.</th>
                            <th className="p-3 text-right">Cresc.</th>
                            <th className="p-3 text-right">PA</th>
                            <th className="p-3 text-right">Ticket</th>
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
                                <td className="p-3 text-right text-slate-400">{formatMoney(v.fat_anterior)}</td>
                                <td className={`p-3 text-right ${v.crescimento >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatPercent(v.crescimento)}</td>
                                <td className="p-3 text-right text-slate-600">{Number(v.pa || 0).toFixed(2)}</td>
                                <td className="p-3 text-right text-slate-600">{formatMoney(v.ticket)}</td>
                                <td className="p-3 text-right font-black text-purple-600">{formatPercent(v.pct_seguro)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
}