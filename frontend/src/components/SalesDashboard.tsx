import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
// ✅ ADICIONADO: AlertCircle para mostrar erro na tela se houver
import { DollarSign, ShoppingBag, TrendingUp, Trophy, AlertCircle } from 'lucide-react';

export default function SalesDashboard() {
  // Estados para guardar os dados que vêm do servidor
  const [summary, setSummary] = useState<any>({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);
  
  // ✅ ADICIONADO: Estado para capturar erros e mostrar na tela
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 🔴 IMPORTANTE: Forçando o endereço do seu servidor no Render
  const API_URL = 'https://telefluxo-aplicacao.onrender.com';

  useEffect(() => {
    // Tenta pegar o usuário logado para enviar o ID
    const savedUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
    let userId = '';
    
    if (savedUser) {
        try {
            const parsed = JSON.parse(savedUser);
            userId = parsed.id || '';
        } catch (e) {}
    }

    console.log(`📡 CONECTANDO EM: ${API_URL}`);
    console.log(`👤 Usuário ID: ${userId || 'Não identificado'}`);

    // ✅ MELHORIA: Função auxiliar para buscar dados e capturar erros
    const fetchData = async (endpoint: string, setter: Function, nome: string) => {
        try {
            const res = await fetch(`${API_URL}${endpoint}?userId=${userId}`);
            
            if (!res.ok) {
                throw new Error(`Erro ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            console.log(`📦 ${nome} RECEBIDO:`, data);
            setter(data);
        } catch (err: any) {
            console.error(`❌ Erro em ${nome}:`, err);
            // Atualiza a mensagem de erro na tela
            setErrorMsg(prev => `${prev} | Falha ${nome}: ${err.message}`);
        }
    };

    // 1. Busca os Cards
    fetchData('/bi/summary', setSummary, 'CARDS');

    // 2. Busca o Gráfico
    fetchData('/bi/chart', setChartData, 'GRÁFICO');

    // 3. Busca o Ranking
    fetchData('/bi/ranking', setRanking, 'RANKING');

  }, []);

  // Formata dinheiro (R$)
  const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  return (
    <div className="h-full overflow-y-auto p-8 bg-slate-50">
      
      {/* ✅ ADICIONADO: ÁREA DE DIAGNÓSTICO (SÓ APARECE SE TIVER ERRO) */}
      {errorMsg && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle size={24} />
            <div>
                <strong className="block text-sm font-bold">Ocorreu um erro de conexão:</strong>
                <p className="text-xs">{errorMsg}</p>
                <p className="text-[10px] mt-1 text-red-500">Se o erro for "Failed to fetch", é bloqueio de CORS ou o servidor Render está dormindo.</p>
            </div>
        </div>
      )}

      <div className="mb-8">
          <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800">BI de Vendas (Samsung)</h2>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Painel Comercial - Conectado ao Render</p>
      </div>

      {/* CARDS SUPERIORES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><DollarSign size={24}/></div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Faturamento</span>
            </div>
            <div className="text-3xl font-black text-slate-800">{formatMoney(summary.total_vendas)}</div>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl"><ShoppingBag size={24}/></div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Peças</span>
            </div>
            <div className="text-3xl font-black text-slate-800">{summary.total_pecas}</div>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-green-50 text-green-600 rounded-2xl"><TrendingUp size={24}/></div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ticket Médio</span>
            </div>
            <div className="text-3xl font-black text-slate-800">{formatMoney(summary.ticket_medio)}</div>
          </div>
      </div>

      {/* GRÁFICO E RANKING */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* GRÁFICO */}
          <div className="lg:col-span-2 bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
              <h3 className="font-black text-slate-800 uppercase text-sm mb-6">Vendas Diárias</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="dia" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 900, fill: '#94a3b8'}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} tickFormatter={(val) => `R$${val/1000}k`} />
                        <Tooltip contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                        <Bar dataKey="valor" fill="#ea580c" radius={[6, 6, 0, 0]} barSize={40} />
                    </BarChart>
                </ResponsiveContainer>
              </div>
          </div>

          {/* RANKING */}
          <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
              <h3 className="font-black text-slate-800 uppercase text-sm mb-6 flex items-center gap-2">
                <Trophy size={16} className="text-amber-500"/> Ranking Top 5
              </h3>
              <div className="space-y-4">
                {ranking.length === 0 ? <p className="text-xs text-gray-400">Sem dados de ranking ainda...</p> : 
                 ranking.map((v, i) => (
                    <div key={i} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-2xl transition-colors">
                        <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${i === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</div>
                            <span className="text-xs font-bold text-slate-700 uppercase truncate w-24" title={v.nome}>{v.nome}</span>
                        </div>
                        <span className="text-xs font-black text-slate-800">{formatMoney(v.total)}</span>
                    </div>
                ))}
              </div>
          </div>
      </div>
    </div>
  );
}