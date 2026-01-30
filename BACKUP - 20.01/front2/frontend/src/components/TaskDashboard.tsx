import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MessageSquare, Share, XCircle, CheckCircle, Paperclip, X, Download, Trash2, Lock, Activity } from 'lucide-react';

export default function TaskDashboard({ task, currentUser, onBack }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState('');
  const [comment, setComment] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = 'http://172.34.0.47:3000';

  const isFinished = task.status === 'done';
  const isDoing = task.status === 'doing';

  const loadData = () => {
    fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=all`)
      .then(r => r.json())
      .then(data => {
         const current = data.find((t: any) => t.id === task.id);
         if(current) setHistory(current.history || []);
      });
    fetch(`${API_URL}/users`).then(r => r.json()).then(setUsers);
  };

  useEffect(() => { loadData(); }, [task.id]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleAction = async (type: string, newStatus: string) => {
    const payload = { 
        currentUser: currentUser.name, 
        comment: comment, 
        actionType: type,
        user: (type === 'pass' || type === 'return') ? targetUser : undefined,
        status: newStatus
    };

    const res = await fetch(`${API_URL}/tasks/${task.id}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });

    if(res.ok) {
        setComment(''); setTargetUser(''); setActiveAction(null); 
        if (type === 'finish') onBack();
        else loadData();
    }
  };

  return (
    <div className="flex h-full bg-slate-50 w-full absolute inset-0 z-50 animate-in fade-in">
      <div className="flex-1 flex flex-col border-r border-slate-200">
        <div className="bg-white border-b px-6 py-4 flex items-center gap-4 h-16 shadow-sm">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft size={20} /></button>
          <div className="flex-1">
            <h1 className="font-black text-slate-800 uppercase italic tracking-tighter">{task.title}</h1>
            <div className="flex gap-3 mt-1 items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Prazo: {formatDate(task.deadline)}</span>
                {isFinished ? (
                    <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase flex items-center gap-1"><CheckCircle size={10}/> Concluída</span>
                ) : isDoing ? (
                    <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-black uppercase flex items-center gap-1"><Activity size={10}/> Em Tratativa</span>
                ) : (
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase flex items-center gap-1">Pendente</span>
                )}
            </div>
          </div>
        </div>
        
        <div className="flex-1 p-8 overflow-y-auto flex flex-col gap-4 bg-slate-100/30">
          {history.map((h, i) => (
            <div key={i} className={`flex ${h.user === currentUser.name ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] p-4 rounded-2xl shadow-sm border ${h.user === currentUser.name ? 'bg-slate-900 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200'}`}>
                <span className="text-[9px] font-black text-orange-500 uppercase block mb-1">{h.user}</span>
                <p className="text-sm">{h.text}</p>
                {h.type === 'file' && <a href={h.fileUrl} target="_blank" className="mt-2 flex items-center gap-2 text-[10px] font-bold text-blue-400"><Download size={12}/> Baixar</a>}
                <span className="text-[8px] block text-right mt-2 opacity-50 font-bold uppercase">{h.date}</span>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="w-96 bg-white p-8 shadow-2xl flex flex-col z-10 border-l border-slate-100">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Ações da Demanda</h2>
        
        {!isFinished ? (
            <div className="flex flex-col gap-4 mb-8">
                {!isDoing && (
                    <button onClick={() => handleAction('start_progress', 'doing')} className="w-full p-4 bg-purple-600 text-white rounded-2xl flex items-center justify-center gap-3 font-black text-[10px] uppercase shadow-lg hover:bg-purple-700 transition-all">
                        <Activity size={18}/> Iniciar Tratativa
                    </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setActiveAction('comment')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-slate-50 font-black text-[10px] uppercase transition-all"><MessageSquare size={18}/> Comentar</button>
                    <button onClick={() => setActiveAction('pass')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-slate-50 font-black text-[10px] uppercase transition-all"><Share size={18}/> Repassar</button>
                    <button onClick={() => setActiveAction('return')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-slate-50 font-black text-[10px] uppercase transition-all"><XCircle size={18}/> Devolver</button>
                    <button onClick={() => setActiveAction('finish')} className="p-4 border border-green-100 bg-green-50 text-green-700 rounded-2xl flex flex-col items-center gap-2 hover:bg-green-100 font-black text-[10px] uppercase transition-all"><CheckCircle size={18}/> Finalizar</button>
                </div>
            </div>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30 border-2 border-dashed rounded-3xl mb-8"><Lock size={40}/><p className="font-black text-[10px] mt-4 uppercase">Fluxo Encerrado</p></div>
        )}

        {activeAction && (
          <div className="flex-1 flex flex-col gap-4 animate-in slide-in-from-right">
             <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-orange-600 tracking-widest">{activeAction}</span><button onClick={() => setActiveAction(null)}><X size={16}/></button></div>
             <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Descreva a ação..." className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none shadow-inner" />
             <button onClick={() => handleAction(activeAction, activeAction === 'finish' ? 'done' : 'pending')} className="py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-orange-600">Confirmar</button>
          </div>
        )}
      </div>
    </div>
  );
}