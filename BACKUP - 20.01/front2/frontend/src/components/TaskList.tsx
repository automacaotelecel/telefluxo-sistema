import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle2, AlertCircle, PlayCircle, Plus } from 'lucide-react';

export default function TaskList({ onOpenTask, viewMode, currentUser }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=${viewMode}`)
      .then(r => r.json())
      .then(setTasks);
  }, [viewMode, currentUser]);

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    doing: tasks.filter(t => t.status === 'doing').length,
    done: tasks.filter(t => t.status === 'done').length
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      {/* CABEÇALHO COM CONTADORES */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</p>
            <div className="text-3xl font-black text-slate-800">{stats.total}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm border-l-4 border-l-amber-500">
            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-1"><AlertCircle size={12}/> Pendentes</p>
            <div className="text-3xl font-black text-slate-800">{stats.pending}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm border-l-4 border-l-purple-500">
            <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest flex items-center gap-1"><PlayCircle size={12}/> Em Tratativa</p>
            <div className="text-3xl font-black text-slate-800">{stats.doing}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm border-l-4 border-l-green-500">
            <p className="text-[10px] font-black text-green-500 uppercase tracking-widest flex items-center gap-1"><CheckCircle2 size={12}/> Concluídos</p>
            <div className="text-3xl font-black text-slate-800">{stats.done}</div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-black uppercase italic tracking-tighter">Fluxo de Demandas</h2>
          <button onClick={() => window.dispatchEvent(new CustomEvent('openNewTaskModal'))} className="bg-orange-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex gap-2 hover:bg-orange-700 shadow-lg transition-all active:scale-95">
            <Plus size={16}/> Nova Demanda
          </button>
      </div>

      {/* LISTA DE CARDS */}
      <div className="space-y-4">
        {tasks.map((task) => (
          <div key={task.id} onClick={() => onOpenTask(task)} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center gap-6 group">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${task.status === 'doing' ? 'bg-purple-50 text-purple-600' : task.status === 'done' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                {task.status === 'doing' ? <PlayCircle /> : task.status === 'done' ? <CheckCircle2 /> : <Clock />}
            </div>
            
            <div className="flex-1">
                <h3 className="font-black text-slate-800 uppercase text-sm group-hover:text-orange-600 transition-colors">{task.title}</h3>
                <div className="flex gap-4 mt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Responsável: <span className="text-slate-600">{task.user}</span></span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Prazo: <span className="text-orange-600">{formatDate(task.deadline)}</span></span>
                </div>
            </div>

            <div className="text-right">
                <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${task.priority === 'Alta' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                    Prioridade {task.priority}
                </span>
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
            <div className="py-20 text-center text-slate-300 font-black uppercase tracking-widest italic opacity-50">Nenhuma demanda encontrada neste setor.</div>
        )}
      </div>
    </div>
  );
}