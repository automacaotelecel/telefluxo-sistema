import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MessageSquare, Share, XCircle, CheckCircle, Send, Paperclip, X, Download, Trash2, Lock } from 'lucide-react';

export default function TaskDashboard({ task, currentUser, onBack }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState('');
  const [comment, setComment] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = 'http://172.34.0.47:3000';

  // Verifica se está finalizada
  const isFinished = task.status === 'done';

  const loadData = () => {
    // Carrega viewMode=all para garantir que traz o histórico mesmo se estiver finalizada
    fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=completed`) 
      .then(r => r.json())
      .then(data => {
         // Tenta achar em completed, se não achar, tenta em all
         let currentTask = data.find((t: any) => t.id === task.id);
         if(currentTask) {
             setHistory(currentTask.history || []);
         } else {
             fetch(`${API_URL}/tasks?user=${currentUser.name}&viewMode=all`)
                .then(r => r.json())
                .then(d => {
                    currentTask = d.find((t: any) => t.id === task.id);
                    if(currentTask) setHistory(currentTask.history || []);
                });
         }
      });
    fetch(`${API_URL}/users`).then(r => r.json()).then(setUsers);
  };

  useEffect(() => { loadData(); }, [task.id]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const handleSubmit = async () => {
    if (!comment && activeAction !== 'finish') return alert("Escreva um comentário!");
    
    const payload = { 
        currentUser: currentUser.name, 
        comment: comment, 
        actionType: activeAction,
        user: (activeAction === 'pass' || activeAction === 'return') ? targetUser : undefined,
        status: activeAction === 'finish' ? 'done' : 'pending'
    };

    const res = await fetch(`${API_URL}/tasks/${task.id}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });

    if(res.ok) {
        setComment(''); setTargetUser(''); setActiveAction(null); 
        if (activeAction === 'finish') {
            alert("Demanda finalizada com sucesso!");
            onBack();
        } else {
            loadData();
        }
    } else {
        alert("Erro: Não foi possível atualizar a tarefa.");
    }
  };

  const handleDelete = async () => {
    if (confirm("⚠️ TEM CERTEZA? Essa ação é permanente.")) {
        try {
            const res = await fetch(`${API_URL}/tasks/${task.id}`, { method: 'DELETE' });
            if (res.ok) {
                alert("Apagado!");
                onBack();
            } else {
                alert("Erro ao apagar.");
            }
        } catch (e) { alert("Erro de conexão."); }
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
            {isFinished && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase tracking-widest flex items-center gap-1 w-fit mt-1"><CheckCircle size={10}/> Concluída</span>}
          </div>
        </div>
        
        <div className="flex-1 p-8 overflow-y-auto flex flex-col gap-4 bg-slate-100/30">
          {history.map((h, i) => (
            <div key={i} className={`flex ${h.user === currentUser.name ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] p-4 rounded-2xl shadow-sm border ${h.user === currentUser.name ? 'bg-slate-900 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200'}`}>
                {h.user !== currentUser.name && <span className="text-[9px] font-black text-orange-500 uppercase block mb-1">{h.user}</span>}
                <p className="text-sm">{h.text}</p>
                {h.type === 'file' && <a href={h.fileUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-[10px] font-bold text-blue-400 hover:underline"><Download size={12}/> Baixar</a>}
                <span className="text-[8px] block text-right mt-2 opacity-50 font-bold uppercase">{h.date}</span>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="w-96 bg-white p-8 shadow-2xl flex flex-col z-10 border-l border-slate-100">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Ações da Demanda</h2>
        
        {isFinished ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-50 border-2 border-dashed border-slate-200 rounded-3xl p-8 mb-8">
                <Lock size={40} className="text-slate-300 mb-4" />
                <p className="text-center text-xs font-black uppercase text-slate-400">Fluxo Encerrado</p>
                <p className="text-center text-[10px] text-slate-300 mt-2">Nenhuma movimentação permitida.</p>
            </div>
        ) : (
            <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => setActiveAction('comment')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-orange-50 font-black text-[10px] uppercase transition-all"><MessageSquare size={20}/> Comentar</button>
            <button onClick={() => setActiveAction('pass')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-orange-50 font-black text-[10px] uppercase transition-all"><Share size={20}/> Repassar</button>
            <button onClick={() => setActiveAction('return')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-orange-50 font-black text-[10px] uppercase transition-all"><XCircle size={20}/> Devolver</button>
            <button onClick={() => setActiveAction('finish')} className="p-4 border rounded-2xl flex flex-col items-center gap-2 hover:bg-green-50 text-green-600 font-black text-[10px] uppercase transition-all"><CheckCircle size={20}/> Finalizar</button>
            </div>
        )}

        {currentUser.isAdmin && (
            <button onClick={handleDelete} className="w-full mb-8 p-3 bg-red-50 text-red-600 border border-red-100 rounded-2xl flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest"><Trash2 size={16} /> Excluir (ADM)</button>
        )}

        {activeAction && !isFinished && (
          <div className="flex-1 flex flex-col gap-4 animate-in slide-in-from-right">
            <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-orange-600 tracking-widest">Escrever {activeAction}</span><button onClick={() => setActiveAction(null)}><X size={16}/></button></div>
            {activeAction === 'pass' && (
              <select value={targetUser} onChange={e => setTargetUser(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
                <option value="">Selecione quem recebe...</option>
                {users.map(u => u.name !== currentUser.name && <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            )}
            <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Detalhes..." className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none resize-none shadow-inner" />
            <div className="flex gap-2">
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} className="p-4 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200"><Paperclip size={20}/></button>
                <button onClick={handleSubmit} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-orange-600 shadow-lg active:scale-95">Confirmar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}