import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Users, CheckCircle, Clock } from 'lucide-react';

export default function ManagerDashboard({ currentUser }: any) {
  const [stats, setStats] = useState<any[]>([]);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  useEffect(() => {
    fetch(`${API_URL}/manager-stats?managerName=${currentUser.name}`)
      .then(r => r.json())
      .then(setStats);
  }, [currentUser]);

  return (
    <div className="h-full overflow-y-auto p-8 bg-slate-50">
      <div className="mb-8">
          <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800">Produtividade da Equipe</h2>
          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Acompanhamento de desempenho de tarefas</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
             <div className="flex items-center gap-4 mb-2">
                 <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><Users size={24}/></div>
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Equipe</span>
             </div>
             <div className="text-3xl font-black text-slate-800">{stats.length} Membros</div>
          </div>
      </div>

      <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm mb-8">
         <h3 className="font-black text-slate-800 uppercase text-sm mb-6">Eficiência por Membro (Concluídas vs Total)</h3>
         <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 900, fill: '#64748b'}} width={100} />
                    <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                    <Bar dataKey="efficiency" name="Eficiência %" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={20} />
                </BarChart>
            </ResponsiveContainer>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((member) => (
            <div key={member.name} className="bg-white p-6 rounded-[24px] border border-slate-100 shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-center">
                    <span className="font-black text-slate-700 uppercase text-sm">{member.name}</span>
                    <span className={`px-2 py-1 rounded text-[10px] font-black ${member.efficiency >= 80 ? 'bg-green-100 text-green-700' : member.efficiency >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{member.efficiency}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full ${member.efficiency >= 80 ? 'bg-green-500' : member.efficiency >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{width: `${member.efficiency}%`}}></div>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                    <span className="flex items-center gap-1"><CheckCircle size={12}/> {member.done} Feitas</span>
                    <span className="flex items-center gap-1"><Clock size={12}/> {member.total} Total</span>
                </div>
            </div>
        ))}
      </div>
    </div>
  );
}