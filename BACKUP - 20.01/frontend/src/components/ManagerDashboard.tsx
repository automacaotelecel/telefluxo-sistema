import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, User, CheckCircle } from 'lucide-react';

export default function ManagerDashboard({ currentUser }: any) {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    fetch(`${API_URL}/manager-stats?managerName=${currentUser.name}`)
      .then(r => r.json())
      .then(data => {
          if(Array.isArray(data)) setStats(data);
          setLoading(false);
      }).catch(() => setLoading(false));
  }, [currentUser]);

  if (loading) return <div className="p-10 text-center font-bold text-slate-400 animate-pulse">Gerando relatórios da equipe...</div>;

  const totalTasks = stats?.reduce((acc, curr) => acc + curr.total, 0) || 0;
  const totalDone = stats?.reduce((acc, curr) => acc + curr.done, 0) || 0;

  return (
    <div className="flex-1 bg-slate-50 p-8 overflow-y-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="text-orange-600" /> Desempenho da Equipe</h2>
        <p className="text-slate-500">Métricas de produtividade para gestão de subordinados.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs font-bold text-slate-400 uppercase">Demandas Atribuídas</p>
            <h3 className="text-4xl font-bold text-slate-800 mt-2">{totalTasks}</h3>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs font-bold text-slate-400 uppercase">Total Concluído</p>
            <h3 className="text-4xl font-bold text-green-600 mt-2">{totalDone}</h3>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <p className="text-xs font-bold text-slate-400 uppercase">Eficiência Geral</p>
            <h3 className="text-4xl font-bold text-orange-600 mt-2">{totalTasks > 0 ? Math.round((totalDone/totalTasks)*100) : 0}%</h3>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Ranking de Produtividade</h3>
          <div className="space-y-6">
            {stats?.map((emp) => (
                <div key={emp.name}>
                    <div className="flex justify-between mb-2 text-sm font-bold">
                        <span>{emp.name}</span>
                        <span className="text-slate-500">{emp.done} de {emp.total} tarefas</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-orange-500 h-3 transition-all duration-700" style={{ width: `${emp.efficiency}%` }}></div>
                    </div>
                </div>
            ))}
            {stats.length === 0 && <p className="text-center text-slate-400 italic py-10">Nenhum funcionário vinculado sob sua gestão.</p>}
          </div>
      </div>
    </div>
  );
}