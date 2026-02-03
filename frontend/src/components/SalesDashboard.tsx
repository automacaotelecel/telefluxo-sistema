import React, { useEffect, useState, useMemo } from 'react';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar, Cell 
} from 'recharts';
import { 
  DollarSign, TrendingUp, Trophy, 
  LayoutGrid, Users, Calendar, Store, Smartphone, X, AlertCircle 
} from 'lucide-react';

export default function SalesDashboard() {
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]); // Usado no AreaChart agora
  const [ranking, setRanking] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // --- ESTADOS DE FILTRO ---
  const [selectedStore, setSelectedStore] = useState('todas');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]); 
  const [filterCategory, setFilterCategory] = useState('todas');
  const [activeTab, setActiveTab] = useState('visao_geral');

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';
  
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  const formatPercent = (val: number) => `${((val || 0) * 100).toFixed(1)}%`;

  useEffect(() => {
    // 1. BLINDAGEM DO USER ID
    let userId = '';
    try {
        const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
        if (rawUser) {
            const parsed = JSON.parse(rawUser);
            userId = parsed.id || parsed.userId || parsed._id || '';
        }
    } catch (e) {
        console.error("Erro ao ler usuário:", e);
    }

    if (!userId) {
        setErrorMsg("Usuário não identificado. Faça login novamente.");
        return;
    }

    // 2. FUNÇÃO FETCH CORRIGIDA E IMPLEMENTADA
    const fetchData = async (endpoint: string, setter: (data: any) => void) => {
        try {
            // Adiciona o userId na URL
            const url = `${API_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}userId=${userId}`;
            
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Erro API: ${res.status}`);
            
            const data = await res.json();
            setter(data);
        } catch (err: any) {
            console.error(`Erro ao buscar ${endpoint}:`, err);
            // Não vamos travar a tela por um erro de gráfico, apenas logar
        }
    };

    // 3. CHAMADAS
    fetchData('/bi/summary', setSummary);
    
    fetchData('/bi/chart', (data: any[]) => {
       if(Array.isArray(data)) setChartData(data);
    });
    
    fetchData('/bi/ranking', (data: any[]) => {
       if(Array.isArray(data)) setRanking(data);
    });

  }, []);

  // --- LÓGICA DE FILTROS ---

  const uniqueStores = useMemo(() => {
      const stores = new Set(ranking.map(r => r.loja).filter(Boolean));
      return Array.from(stores).sort();
  }, [ranking]);

  const storeRanking = useMemo(() => {
      const stores: any = {};
      ranking.forEach(item => {
          const lojaNome = item.loja || 'OUTROS';
          if (!stores[lojaNome]) stores[lojaNome] = 0;
          stores[lojaNome] += (item.total || 0);
      });
      return Object.keys(stores)
          .map(key => ({ nome: key, total: stores[key] }))
          .sort((a, b) => b.total - a.total);
  }, [ranking]);

  const filteredSellers = useMemo(() => {
      if (selectedStore === 'todas') return ranking;
      return ranking.filter(r => r.loja === selectedStore);
  }, [ranking, selectedStore]);

  const filteredSummary = useMemo(() => {
      if (selectedStore === 'todas') return summary;
      const total = filteredSellers.reduce((acc, curr) => acc + (curr.total || 0), 0);
      const pecas = filteredSellers.reduce((acc, curr) => acc + (curr.qtd || 0), 0);
      const ticket = pecas > 0 ? total / pecas : 0;
      return { total_vendas: total, total_pecas: pecas, ticket_medio: ticket };
  }, [summary, filteredSellers, selectedStore]);

  const calculateProjection = () => {
      const today = new Date();
      const currentDay = today.getDate();
      const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const totalAtual = filteredSummary.total_vendas || 0;
      if (currentDay === 0) return 0;
      return (totalAtual / currentDay) * lastDayOfMonth;
  };
  const projectionValue = calculateProjection();
  const performancePercent = projectionValue > 0 ? (filteredSummary.total_vendas / projectionValue) * 100 : 0;

  const handleStoreClick = (data: any) => {
      if (data && data.nome) {
          setSelectedStore(prev => prev === data.nome ? 'todas' : data.nome);
      }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      
      {/* ALERTA DE ERRO (SE HOUVER) */}
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
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">Samsung • BI Automático • v2.4</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
            {/* FILTRO DE LOJA */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${selectedStore !== 'todas' ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'}`}>
                <Store size={14} className={selectedStore !== 'todas' ? "text-blue-600" : "text-slate-400"}/>
                <select 
                    className="bg-transparent text-xs font-bold text-slate-700 outline-none uppercase w-48 cursor-pointer" 
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                >
                    <option value="todas">Todas as Lojas</option>
                    {uniqueStores.map(store => (
                        <option key={store} value={store}>{store}</option>
                    ))}
                </select>
                {selectedStore !== 'todas' && (
                    <button onClick={() => setSelectedStore('todas')} className="text-blue-600 hover:bg-blue-100 rounded-full p-1"><X size={12} /></button>
                )}
            </div>

            {/* FILTRO DE CATEGORIA */}
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                <Smartphone size={14} className="text-slate-400"/>
                <select 
                    className="bg-transparent text-xs font-bold text-slate-600 outline-none uppercase cursor-pointer"
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                >
                    <option value="todas">Todas as Categorias</option>
                    <option value="smartphone">Smartphones</option>
                    <option value="wearable">Wearables</option>
                    <option value="tablet">Tablets</option>
                </select>
            </div>

            {/* FILTRO DE DATA */}
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                <Calendar size={14} className="text-slate-400"/>
                <input 
                    type="date"
                    className="bg-transparent text-xs font-bold text-slate-600 outline-none uppercase cursor-pointer"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                />
            </div>

            <button onClick={() => window.location.reload()} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors ml-auto xl:ml-0">
                ATUALIZAR
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
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Faturamento</span><DollarSign size={16} className="text-[#1428A0]"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(filteredSummary.total_vendas)}</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Tendência</span><TrendingUp size={16} className="text-purple-500"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(projectionValue)}</div>
                    <div className="text-[9px] text-purple-600 font-bold mt-1">{performancePercent.toFixed(0)}% da Projeção</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-slate-800">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Peças</span><Users size={16} className="text-slate-800"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{filteredSummary.total_pecas}</div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
                    <div className="flex justify-between items-start mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">Ticket Médio</span><Trophy size={16} className="text-green-500"/></div>
                    <div className="text-2xl font-black text-slate-800 tracking-tight">{formatMoney(filteredSummary.ticket_medio)}</div>
                </div>
            </div>

            {/* GRÁFICO DE TENDÊNCIA (Adicionado para corrigir o erro de variável não usada) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6 h-64">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={14} className="text-slate-400"/>
                    <h3 className="font-black text-slate-700 uppercase text-xs">Evolução Diária (Últimos 7 dias)</h3>
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
                        <h3 className="font-black text-slate-700 uppercase text-xs">Ranking de Lojas (Clique na barra para filtrar)</h3>
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
                                            fill={entry.nome === selectedStore ? '#25D366' : (index < 3 ? '#1428A0' : '#94a3b8')} 
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
                                {selectedStore === 'todas' ? 'Top Vendedores' : `Equipe: ${selectedStore}`}
                            </h3>
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-4">
                        <table className="w-full text-left border-collapse">
                            <tbody>
                                {filteredSellers.map((v, i) => (
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
                <span className="text-[10px] font-bold text-slate-400 uppercase">{filteredSellers.length} RESULTADOS</span>
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
                        {filteredSellers.map((v, i) => (
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