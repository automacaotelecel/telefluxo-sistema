import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2, CheckSquare, Square, Briefcase } from 'lucide-react';

export default function Agenda({ currentUser }: any) {
  const getToday = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [personalEvents, setPersonalEvents] = useState<any[]>([]);
  const [systemTasks, setSystemTasks] = useState<any[]>([]); 
  const [newEventText, setNewEventText] = useState('');
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'; 

  useEffect(() => {
    fetch(`${API_URL}/agenda?userId=${currentUser.id}&date=${selectedDate}`).then(r => r.json()).then(setPersonalEvents);

    fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=mine`)
      .then(r => r.json())
      .then(data => {
        const tasksForToday = data.filter((t: any) => t.deadline === selectedDate);
        setSystemTasks(tasksForToday);
      });
  }, [selectedDate, currentUser]);

  const addEvent = async () => {
    if (!newEventText.trim()) return;
    const res = await fetch(`${API_URL}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, title: newEventText, date: selectedDate })
    });
    if (res.ok) {
        const saved = await res.json();
        setPersonalEvents([...personalEvents, saved]);
        setNewEventText('');
    }
  };

  const deleteEvent = async (id: string) => {
    const res = await fetch(`${API_URL}/agenda/${id}`, { method: 'DELETE' });
    if (res.ok) setPersonalEvents(personalEvents.filter(e => e.id !== id));
  };

  // --- NOVA FUNÇÃO: MARCAR COMO CONCLUÍDO ---
  const toggleEvent = async (id: string, currentStatus: boolean) => {
    // 1. Atualiza visualmente na hora (para ser rápido)
    const updatedEvents = personalEvents.map(e => 
        e.id === id ? { ...e, completed: !currentStatus } : e
    );
    setPersonalEvents(updatedEvents);

    // 2. Avisa o servidor
    await fetch(`${API_URL}/agenda/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !currentStatus })
    });
  };

  const changeDay = (days: number) => {
    const parts = selectedDate.split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() + days);
    setSelectedDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  };

  const parts = selectedDate.split('-');
  const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const displayDate = dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="p-8 h-full bg-slate-50 flex flex-col items-center overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col min-h-[550px]">
        <div className="bg-slate-900 p-8 flex items-center justify-between text-white border-b-4 border-orange-600">
            <button onClick={() => changeDay(-1)} className="p-2 hover:bg-slate-700 rounded-full"><ChevronLeft /></button>
            <div className="text-center">
                <h2 className="text-2xl font-black capitalize">{displayDate}</h2>
                <span className="text-[10px] text-orange-400 uppercase font-black tracking-widest">Grupo Telecel • Agenda</span>
            </div>
            <button onClick={() => changeDay(1)} className="p-2 hover:bg-slate-700 rounded-full"><ChevronRight /></button>
        </div>

        <div className="flex-1 p-8">
            {systemTasks.length > 0 && (
                <div className="mb-8 animate-in slide-in-from-top duration-500">
                    <h3 className="text-[10px] font-black text-blue-600 uppercase mb-4 flex items-center gap-2 border-b-2 border-blue-50 pb-2">
                        <Briefcase size={14}/> Compromissos Telecel (Hoje)
                    </h3>
                    {systemTasks.map(task => (
                        <div key={task.id} className="flex items-center gap-3 mb-2 p-4 bg-blue-50/50 rounded-2xl border border-blue-100 border-l-4 border-l-blue-500">
                            <span className="flex-1 text-sm font-bold text-slate-700">{task.title}</span>
                            <span className="text-[10px] px-2 py-1 rounded bg-blue-100 text-blue-700 font-black">PENDENTE</span>
                        </div>
                    ))}
                </div>
            )}

            <h3 className="text-[10px] font-black text-slate-400 uppercase mb-4 border-b-2 border-slate-50 pb-2">Minhas Notas</h3>
            {personalEvents.map(event => (
                <div key={event.id} className={`flex items-center gap-3 mb-3 group p-3 rounded-xl transition-all ${event.completed ? 'bg-green-50/50' : 'hover:bg-slate-50'}`}>
                    
                    {/* BOTÃO DE CHECK: Se completado fica Verde, se não fica Cinza */}
                    <button onClick={() => toggleEvent(event.id, event.completed)}>
                        {event.completed ? (
                            <CheckSquare size={20} className="text-green-500" />
                        ) : (
                            <Square size={20} className="text-slate-300 group-hover:text-orange-400 transition" />
                        )}
                    </button>

                    <span className={`flex-1 text-base font-medium transition-all ${event.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                        {event.title}
                    </span>
                    
                    <button onClick={() => deleteEvent(event.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"><Trash2 size={18} /></button>
                </div>
            ))}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-2">
            <input type="text" className="flex-1 p-3 rounded-xl border border-slate-200 focus:border-orange-500 outline-none text-sm" placeholder="Nova nota..." value={newEventText} onChange={e => setNewEventText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEvent()} />
            <button onClick={addEvent} className="bg-orange-600 text-white px-6 rounded-xl font-black uppercase text-xs tracking-widest shadow-lg shadow-orange-600/20">Add</button>
        </div>
      </div>
    </div>
  );
}