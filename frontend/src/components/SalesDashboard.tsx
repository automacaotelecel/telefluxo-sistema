import React, { useEffect, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { 
  DollarSign, ShoppingBag, TrendingUp, Trophy, AlertCircle, 
  MapPin, Calendar, LayoutGrid, Users, Package, RefreshCw 
} from 'lucide-react';

export default function SalesDashboard() {
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [activeTab, setActiveTab] = useState('visao_geral'); // Controle das abas

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';

  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  useEffect(() => {
    const savedUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
    let userId = '';
    try { if (savedUser) userId = JSON.parse(savedUser).id || ''; } catch (e) {}

    const fetchData = async (endpoint: string, setter: Function, nome: string) => {
        try {
            const res = await fetch(`${API_URL}${endpoint}?userId=${userId}`);
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const data = await res.json();
            setter(data);
        } catch (err: any) {
            console.error(`❌ Erro em ${nome}:`, err);
            setErrorMsg(prev => `${prev} | ${nome}: ${err.message}`);
        }
    };

    fetchData('/bi/summary', setSummary, 'Cards');
    fetchData('/bi/chart', setChartData, 'Gráfico');
    fetchData('/bi/ranking', setRanking, 'Ranking');
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 bg-[#F3F4F6] font-sans">
      
      {/* 🔴 ALERTA DE ERRO (Só aparece se der ruim) */}
      {errorMsg && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg flex items-center gap-3 animate-pulse">
            <AlertCircle size={24} />
            <span className="text-xs font-bold">{errorMsg}</span>
        </div>
      )}

      {/* --- HEADER ESTILO "PERFORMANCE COMERCIAL" --- */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
            <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-blue-600 rounded-lg text-white">
                    <LayoutGrid size={20} />
                </div>
                <h1 className="text-xl font-black text-slate-800 tracking-tight">PERFORMANCE COMERCIAL</h1>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-12">
                SAMSUNG • BI AUTOMÁTICO
            </p>
        </div>

        {/* Botões de Abas (Estilo Print 2) */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
                onClick={() => setActiveTab('visao_geral')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'visao_geral' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
                <TrendingUp size={14} /> Visão Geral
            </button>
            <button 
                onClick={() => setActiveTab('vendedores')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'vendedores' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
                <Users size={14} /> Vendedores
            </button>
            <button 
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase text-slate-300 cursor-not-allowed"
            >
                <Package size={14} /> Estoque
            </button>
        </div>

        <button onClick={() => window.location.reload()} className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors">
            <RefreshCw size={14} /> ATUALIZAR
        </button>
      </div>

      {/* --- FILTROS (Visual Apenas) --- */}
      <div className="flex flex-wrap gap-4 mb-8 items-center">
        <span className="bg-blue-600 text-white px-4 py-1 rounded-full text-[10px] font-black uppercase">Todos</span>
        <span className="bg-white border border-slate-200 text-slate-400 px-4 py-1 rounded-full text-[10px] font-black uppercase">Outros</span>
        <div className="flex-1 border-b border-slate-200 border-dashed mx-4"></div>
        <div className="flex gap-2">
            <div className="bg-white border border-slate-200 px-3 py-1 rounded-lg flex items-center gap-2 text-xs text-slate-500 font-bold">
                <MapPin size={12}/> Todas as Lojas
            </div>
            <div className="bg-white border border-slate-200 px-3 py-1 rounded-lg flex items-center gap-2 text-xs text-slate-500 font-bold">
                <Calendar size={12}/> Este Mês
            </div>
        </div>
      </div>

      {/* --- CARDS KPI (Estilo Print 2) --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        
        {/* CARD 1: REALIZADO */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 bg-green-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Realizado</span>
                    <div className="p-2 bg-green-100 text-green-600 rounded-lg"><DollarSign size={16}/></div>
                </div>
                <div className="text-3xl font-black text-slate-800 tracking-tight">{formatMoney(summary.total_vendas)}</div>
                <div className="mt-2 text-xs font-bold text-green-600 flex items-center gap-1">
                    <TrendingUp size={12}/> +100% <span className="text-slate-300 font-normal">vs meta</span>
                </div>
            </div>
        </div>

        {/* CARD 2: TICKET MÉDIO (Usando slot de Projeção) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ticket Médio</span>
                    <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><TrendingUp size={16}/></div>
                </div>
                <div className="text-3xl font-black text-slate-800 tracking-tight">{formatMoney(summary.ticket_medio)}</div>
                <div className="mt-2 text-xs font-bold text-purple-600">
                    Média por venda
                </div>
            </div>
        </div>

        {/* CARD 3: VOLUME */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Volume (Peças)</span>
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><ShoppingBag size={16}/></div>
                </div>
                <div className="text-3xl font-black text-slate-800 tracking-tight">{summary.total_pecas}</div>
                <div className="mt-2 text-xs font-bold text-blue-600">
                    Itens vendidos
                </div>
            </div>
        </div>
      </div>

      {/* --- CONTEÚDO PRINCIPAL (GRÁFICO E RANKING) --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LADO ESQUERDO: GRÁFICO (Ocupando o lugar de "Ranking Lojas" temporariamente) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><BarChart size={18}/></div>
                <h3 className="font-black text-slate-800 uppercase text-sm">Evolução de Vendas</h3>
            </div>
            <div className="h-80">
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
                        <Tooltip 
                            contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                            formatter={(value: number) => [formatMoney(value), 'Venda']}
                        />
                        <Area type="monotone" dataKey="valor" stroke="#4F46E5" strokeWidth={3} fillOpacity={1} fill="url(#colorValor)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>

        {/* LADO DIREITO: TOP VENDEDORES (Igual ao Print 3) */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
                <div className="p-2 bg-amber-50 text-amber-500 rounded-lg"><Trophy size={18}/></div>
                <h3 className="font-black text-slate-800 uppercase text-sm">Top Vendedores</h3>
            </div>
            
            <div className="space-y-4">
                {ranking.length === 0 ? <p className="text-xs text-slate-400 italic">Nenhum dado encontrado.</p> : 
                 ranking.map((v, i) => (
                    <div key={i} className="group flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100 cursor-default">
                        <div className="flex items-center gap-3">
                            <div className={`
                                w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shadow-sm
                                ${i === 0 ? 'bg-amber-100 text-amber-600' : 
                                  i === 1 ? 'bg-slate-200 text-slate-600' : 
                                  i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-400'}
                            `}>
                                {i + 1}º
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 uppercase truncate w-28 group-hover:text-blue-600 transition-colors" title={v.nome}>
                                    {v.nome}
                                </span>
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Vendedor</span>
                            </div>
                        </div>
                        <span className="text-xs font-black text-slate-800">{formatMoney(v.total)}</span>
                    </div>
                ))}
            </div>
            
            <button className="w-full mt-6 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors uppercase tracking-wide">
                Ver Ranking Completo
            </button>
        </div>

      </div>
    </div>
  );
}