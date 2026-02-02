import React, { useEffect, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { 
  DollarSign, ShoppingBag, TrendingUp, Trophy, AlertCircle, 
  MapPin, Calendar, LayoutGrid, Users, Package, RefreshCw, Store, 
  BarChart3 // ✅ ÍCONE CORRETO
} from 'lucide-react';

export default function SalesDashboard() {
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);
  const [storeRanking, setStoreRanking] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [activeTab, setActiveTab] = useState('visao_geral');

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';
  
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  const formatPercent = (val: number) => `${((val || 0) * 100).toFixed(1)}%`;

  useEffect(() => {
    const savedUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
    let userId = '';
    try { if (savedUser) userId = JSON.parse(savedUser).id || ''; } catch (e) {}

    const fetchData = async (endpoint: string, setter: Function) => {
        try {
            const res = await fetch(`${API_URL}${endpoint}?userId=${userId}`);
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const data = await res.json();
            setter(data);
        } catch (err: any) {
            console.error(`❌ Erro ${endpoint}:`, err);
            // Não mostra erro na tela se for apenas cache vazio
        }
    };

    fetchData('/bi/summary', setSummary);
    
    // Dados para o Gráfico
    fetchData('/bi/chart', (data: any[]) => {
       if(Array.isArray(data)) setChartData(data);
    });
    
    // Dados para o Ranking
    fetchData('/bi/ranking', (data: any[]) => {
        if(!Array.isArray(data)) return;
        setRanking(data);
        
        // Agrupa por Loja para criar o Ranking de Lojas
        const stores: any = {};
        data.forEach(item => {
            const lojaNome = item.loja || 'OUTROS';
            if (!stores[lojaNome]) stores[lojaNome] = 0;
            stores[lojaNome] += (item.total || 0);
        });
        const storeList = Object.keys(stores)
            .map(key => ({ nome: key, total: stores[key] }))
            .sort((a, b) => b.total - a.total);
        setStoreRanking(storeList);
    });

  }, []);

  // --- ATUALIZAÇÃO MANUAL (Chama o Python) ---
  const handleRefresh = async () => {
      try {
          await fetch(`${API_URL}/sales/refresh`, { method: 'POST' });
          alert("Atualização solicitada! Aguarde 10 segundos e recarregue a página.");
      } catch (e) { alert("Erro ao solicitar atualização."); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 bg-[#F3F4F6] font-sans">
      
      {/* --- HEADER --- */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
            <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-blue-600 rounded-lg text-white"><LayoutGrid size={20} /></div>
                <h1 className="text-xl font-black text-slate-800 tracking-tight">PERFORMANCE COMERCIAL v2.0</h1>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-12">SAMSUNG • BI AUTOMÁTICO</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('visao_geral')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'visao_geral' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <TrendingUp size={14} /> Visão Geral
            </button>
            <button onClick={() => setActiveTab('vendedores')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'vendedores' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <Users size={14} /> Vendedores
            </button>
        </div>

        <button onClick={handleRefresh} className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors">
            <RefreshCw size={14} /> ATUALIZAR DADOS
        </button>
      </div>

      {/* --- CONTEÚDO DA ABA: VISÃO GERAL --- */}
      {activeTab === 'visao_geral' && (
        <>
            {/* CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Realizado</span><div className="p-2 bg-green-100 text-green-600 rounded-lg"><DollarSign size={16}/></div></div>
                    <div className="text-3xl font-black text-slate-800 tracking-tight">{formatMoney(summary.total_vendas)}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Peças</span><div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><ShoppingBag size={16}/></div></div>
                    <div className="text-3xl font-black text-slate-800 tracking-tight">{summary.total_pecas}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ticket Médio</span><div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><BarChart3 size={16}/></div></div>
                    <div className="text-3xl font-black text-slate-800 tracking-tight">{formatMoney(summary.ticket_medio)}</div>
                </div>
            </div>

            {/* SPLIT: RANKING LOJAS (ESQUERDA) vs RANKING VENDEDORES (DIREITA) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Ranking Lojas */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 h-96 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4 sticky top-0 bg-white z-10">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Store size={18}/></div>
                        <h3 className="font-black text-slate-800 uppercase text-sm">Ranking de Lojas</h3>
                    </div>
                    <div className="space-y-3">
                        {storeRanking.length === 0 ? <p className="text-xs text-slate-400">Carregando...</p> : storeRanking.map((loja, i) => (
                            <div key={i} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <span className="w-6 h-6 flex items-center justify-center bg-slate-100 text-slate-600 text-[10px] font-black rounded">{i+1}</span>
                                    <span className="text-xs font-bold text-slate-700 uppercase">{loja.nome}</span>
                                </div>
                                <span className="text-xs font-black text-slate-800">{formatMoney(loja.total)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Ranking Vendedores (Top 10 Resumido) */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 h-96 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4 sticky top-0 bg-white z-10">
                        <div className="p-2 bg-amber-50 text-amber-500 rounded-lg"><Trophy size={18}/></div>
                        <h3 className="font-black text-slate-800 uppercase text-sm">Top Vendedores</h3>
                    </div>
                    <div className="space-y-3">
                        {ranking.slice(0, 20).map((v, i) => (
                            <div key={i} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black ${i < 3 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{i+1}</div>
                                    <span className="text-xs font-bold text-slate-700 uppercase truncate w-40" title={v.nome}>{v.nome}</span>
                                </div>
                                <span className="text-xs font-black text-slate-800">{formatMoney(v.total)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* GRÁFICO (NO FINAL) */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6" style={{ minHeight: '300px' }}>
                <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><BarChart3 size={18}/></div>
                    <h3 className="font-black text-slate-800 uppercase text-sm">Evolução de Vendas</h3>
                </div>
                <div className="h-64 w-full">
                    {chartData && chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorValor" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="dia" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} tickFormatter={(val) => `R$${val/1000}k`} />
                                <Tooltip formatter={(value: number) => [formatMoney(value), 'Venda']} />
                                <Area type="monotone" dataKey="valor" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorValor)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex h-full items-center justify-center text-slate-400 text-xs italic">
                            Gráfico aguardando dados...
                        </div>
                    )}
                </div>
            </div>
        </>
      )}

      {/* --- CONTEÚDO DA ABA: VENDEDORES (TABELA DETALHADA) --- */}
      {activeTab === 'vendedores' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={18}/></div>
                    <h3 className="font-black text-slate-800 uppercase text-sm">Ranking Detalhado</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">{ranking.length} COLABORADORES</span>
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                            <th className="p-4">#</th>
                            <th className="p-4">Vendedor</th>
                            <th className="p-4">Região</th>
                            <th className="p-4 text-right text-blue-600">Fat. Atual</th>
                            <th className="p-4 text-right">Fat. Anterior</th>
                            <th className="p-4 text-right">Cresc.</th>
                            <th className="p-4 text-right">PA</th>
                            <th className="p-4 text-right">Ticket</th>
                            <th className="p-4 text-right">Qtd</th>
                            <th className="p-4 text-right text-purple-600">% Seg</th>
                        </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-slate-700">
                        {ranking.map((v, i) => (
                            <tr key={i} className="border-b border-slate-50 hover:bg-blue-50/50 transition-colors group">
                                <td className="p-4">
                                    <span className={`w-6 h-6 flex items-center justify-center rounded text-[10px] ${i<3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{i+1}</span>
                                </td>
                                <td className="p-4 uppercase group-hover:text-blue-600 transition-colors">{v.nome}</td>
                                <td className="p-4 text-slate-400">{v.regiao || '-'}</td>
                                <td className="p-4 text-right font-black text-slate-800">{formatMoney(v.total)}</td>
                                <td className="p-4 text-right text-slate-500">{formatMoney(v.fat_anterior)}</td>
                                <td className={`p-4 text-right ${v.crescimento >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {formatPercent(v.crescimento)}
                                </td>
                                <td className="p-4 text-right text-slate-600">{Number(v.pa || 0).toFixed(2)}</td>
                                <td className="p-4 text-right text-slate-600">{formatMoney(v.ticket)}</td>
                                <td className="p-4 text-right text-slate-800">{v.qtd}</td>
                                <td className="p-4 text-right font-black text-purple-600">{formatPercent(v.pct_seguro)}</td>
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