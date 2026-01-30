import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MessageSquare, Share, XCircle, CheckCircle, Paperclip, X, Download, Trash2, Lock, Activity, User } from 'lucide-react';

export default function TaskDashboard({ task, currentUser, onBack }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState('');
  const [comment, setComment] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const [localStatus, setLocalStatus] = useState(task.status);
  const isFinished = localStatus === 'done';
  const isDoing = localStatus === 'doing';

  const loadData = () => {
    fetch(`${API_URL}/tasks/${task.id}`)
      .then(r => r.json())
      .then(data => {
         if(data) {
            setHistory(data.history || []);
            setLocalStatus(data.status); 
         }
      })
      .catch(err => console.error("Erro histórico:", err));

    fetch(`${API_URL}/users`).then(r => r.json()).then(setUsers);
  };

  useEffect(() => { loadData(); }, [task.id]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleDelete = async () => {
      if (!confirm("⚠️ ATENÇÃO: Você está prestes a excluir esta demanda permanentemente. O histórico será perdido. Deseja continuar?")) return;
      
      try {
          const res = await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
          if (res.ok) {
              alert("Demanda excluída do sistema.");
              onBack();
          } else {
              alert("Erro ao excluir.");
          }
      } catch (e) { alert("Erro de conexão."); }
  };

  const handleAction = async (type: string, newStatus: string) => {
    if (type === 'pass' && !targetUser) return alert("Por favor, selecione para quem você vai repassar a demanda.");

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
        if (type === 'finish') {
            loadData(); 
        } else {
            loadData();
            if (type === 'pass') onBack();
        }
    }
  };

  const handleFileUpload = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('currentUser', currentUser.name);
      await fetch(`${API_URL}/tasks/${task.id}/upload`, { method: 'POST', body: formData });
      loadData();
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
                <p className="text-sm whitespace-pre-wrap">{h.text}</p>
                {h.type === 'file' && <a href={h.fileUrl} target="_blank" className="mt-2 flex items-center gap-2 text-[10px] font-bold text-blue-400 hover:underline bg-slate-50/10 p-2 rounded-lg w-fit"><Download size={12}/> Baixar Anexo: {h.fileName}</a>}
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
                    <button onClick={() => handleAction('start_progress', 'doing')} className="w-full p-4 bg-purple-600 text-white rounded-2xl flex items-center justify-center gap-3 font-black text-[10px] uppercase shadow-lg hover:bg-purple-700 transition-all active:scale-95">
                        <Activity size={18}/> Iniciar Tratativa
                    </button>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setActiveAction('comment')} className={`p-4 border rounded-2xl flex flex-col items-center gap-2 font-black text-[10px] uppercase transition-all ${activeAction === 'comment' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'hover:bg-slate-50'}`}><MessageSquare size={18}/> Comentar</button>
                    <button onClick={() => setActiveAction('pass')} className={`p-4 border rounded-2xl flex flex-col items-center gap-2 font-black text-[10px] uppercase transition-all ${activeAction === 'pass' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'hover:bg-slate-50'}`}><Share size={18}/> Repassar</button>
                    <button onClick={() => setActiveAction('return')} className={`p-4 border rounded-2xl flex flex-col items-center gap-2 font-black text-[10px] uppercase transition-all ${activeAction === 'return' ? 'bg-red-50 border-red-200 text-red-700' : 'hover:bg-slate-50'}`}><XCircle size={18}/> Devolver</button>
                    <button onClick={() => setActiveAction('finish')} className={`p-4 border rounded-2xl flex flex-col items-center gap-2 font-black text-[10px] uppercase transition-all ${activeAction === 'finish' ? 'bg-green-50 border-green-200 text-green-700' : 'hover:bg-green-50 text-green-600'}`}><CheckCircle size={18}/> Finalizar</button>
                </div>
            </div>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30 border-2 border-dashed rounded-3xl mb-8"><Lock size={40}/><p className="font-black text-[10px] mt-4 uppercase">Fluxo Encerrado</p></div>
        )}

        {/* 🔥 BOTÃO DE EXCLUSÃO (SÓ PARA ADMIN) */}
        {currentUser.isAdmin && (
            <button onClick={handleDelete} className="w-full mb-8 p-3 bg-red-50 text-red-600 border border-red-100 rounded-2xl flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest">
                <Trash2 size={16} /> Excluir Demanda
            </button>
        )}

        {activeAction && (
          <div className="flex-1 flex flex-col gap-4 animate-in slide-in-from-right border-t border-slate-100 pt-6">
             <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-orange-600 tracking-widest flex items-center gap-2">
                    {activeAction === 'pass' ? "Repassar Para..." : activeAction === 'return' ? "Devolver Para..." : "Detalhes da Ação"}
                </span>
                <button onClick={() => { setActiveAction(null); setTargetUser(''); }} className="hover:bg-slate-100 p-1 rounded-full"><X size={16}/></button>
             </div>
             
             {(activeAction === 'pass' || activeAction === 'return') && (
                 <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 px-3 py-2 text-slate-400">
                        <User size={14} />
                        <span className="text-[10px] font-bold uppercase">Selecione o Destino</span>
                     </div>
                     <select value={targetUser} onChange={e => setTargetUser(e.target.value)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-500 mb-2">
                        <option value="">Quem assume essa demanda?</option>
                        {users.map(u => u.name !== currentUser.name && <option key={u.id} value={u.name}>{u.name} - {u.role}</option>)}
                     </select>
                 </div>
             )}

             <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Escreva uma observação..." className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none shadow-inner resize-none focus:bg-white focus:border-orange-500 transition-all" />
             
             <div className="flex gap-2">
                 <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                 <button onClick={() => fileInputRef.current?.click()} className="p-4 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-colors" title="Anexar Arquivo"><Paperclip size={20}/></button>
                 <button onClick={() => handleAction(activeAction, activeAction === 'finish' ? 'done' : 'pending')} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-orange-600 transition-all shadow-lg active:scale-95">Confirmar</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}