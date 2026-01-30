import React, { useState, useEffect } from 'react';
import { Search, Clock, ChevronRight, LayoutGrid, ListTodo, CheckSquare, Plus } from 'lucide-react';

export default function TaskList({ onOpenTask, viewMode, currentUser }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=${viewMode}`)
      .then(r => r.json())
      .then(data => {
        setTasks(Array.isArray(data) ? data : []);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [viewMode, currentUser.name]);

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status !== 'done').length,
    done: tasks.filter(t => t.status === 'done').length
  };

  const filteredTasks = tasks.filter(t => 
    t.title.toLowerCase().includes(searchTerm.toLowerCase()) || t.user.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col p-8 overflow-hidden bg-slate-50">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
            {viewMode === 'all' ? 'Painel Geral' : 'Meu Fluxo'}
          </h2>
          <p className="text-slate-500 text-sm font-medium italic font-serif">Grupo Telecel</p>
        </div>
        <div className="flex gap-3">
          <input type="text" placeholder="Buscar..." className="p-2.5 bg-white border rounded-xl text-sm outline-none w-64" onChange={e => setSearchTerm(e.target.value)} />
          <button onClick={() => window.dispatchEvent(new CustomEvent('openNewTaskModal'))} className="bg-orange-600 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg">
            <Plus size={18} /> Nova Demanda
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border flex items-center gap-4 shadow-sm">
          <LayoutGrid className="text-blue-500" />
          <div><p className="text-[10px] font-black text-slate-400 uppercase">Total</p><p className="text-2xl font-black text-slate-800">{stats.total}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border flex items-center gap-4 shadow-sm">
          <ListTodo className="text-orange-500" />
          <div><p className="text-[10px] font-black text-slate-400 uppercase">Pendentes</p><p className="text-2xl font-black text-slate-800">{stats.pending}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border flex items-center gap-4 shadow-sm">
          <CheckSquare className="text-green-500" />
          <div><p className="text-[10px] font-black text-slate-400 uppercase">Concluídas</p><p className="text-2xl font-black text-slate-800">{stats.done}</p></div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {filteredTasks.map((task) => (
          <div key={task.id} onClick={() => onOpenTask(task)} className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-orange-500 transition-all cursor-pointer flex items-center gap-5">
            <div className={`w-1.5 h-12 rounded-full ${task.priority === 'Alta' ? 'bg-red-500' : 'bg-orange-400'}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-slate-300 uppercase">{task.id}</span>
                {task.user !== currentUser.name && <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold uppercase">Acompanhando</span>}
              </div>
              <h3 className="font-bold text-slate-800 group-hover:text-orange-600 text-lg">{task.title}</h3>
              <div className="flex gap-6 mt-2 text-[10px] font-bold uppercase text-slate-400">
                <span>Responsável: <span className="text-slate-800">{task.user}</span></span>
                <span>Prazo: <span className="text-slate-800">{task.deadline}</span></span>
              </div>
            </div>
            <ChevronRight className="text-slate-200 group-hover:text-orange-500 transition-all" />
          </div>
        ))}
      </div>
    </div>
  );
}