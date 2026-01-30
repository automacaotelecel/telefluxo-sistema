import React, { useState, useEffect, useRef } from 'react';
import { X, User, Paperclip, FileText } from 'lucide-react';

export default function NewTaskModal({ isOpen, onClose, currentUser, onTaskCreated }: any) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('Média');
  const [deadline, setDeadline] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedResponsible, setSelectedResponsible] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_URL}/users`)
        .then(res => res.json())
        .then(data => setUsers(Array.isArray(data) ? data : []))
        .catch(err => console.error(err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit() {
    if (!title || !selectedResponsible) {
        return alert("Preencha o Título e escolha um Responsável!");
    }

    try {
      // 1. Cria a Tarefa
      const response = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            title: title, 
            priority: priority, 
            deadline: deadline || "Sem prazo", 
            creatorName: currentUser.name, 
            responsible: selectedResponsible 
        }),
      });

      if (response.ok) {
        const savedTask = await response.json();
        
        // 2. Se tiver arquivo, faz o upload
        if (selectedFile && savedTask.id) {
          const formData = new FormData();
          formData.append('file', selectedFile);
          formData.append('currentUser', currentUser.name);
          await fetch(`${API_URL}/tasks/${savedTask.id}/upload`, { method: 'POST', body: formData });
        }

        alert("Fluxo iniciado com sucesso!");
        onTaskCreated(); 
      } else {
        alert("Erro no servidor ao criar tarefa.");
      }
    } catch (error) {
      alert("Erro de conexão com o servidor.");
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase italic">Novo Fluxo <span className="text-orange-600">Telecel</span></h2>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-orange-600 transition"><X size={28} /></button>
        </div>

        <div className="p-8 space-y-6">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que precisa ser feito?" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-orange-500" />
          
          <div className="grid grid-cols-2 gap-6">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none">
              <option value="Baixa">Baixa</option><option value="Média">Média</option><option value="Alta">Alta</option>
            </select>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none text-slate-600" />
          </div>

          <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-inner">
            <div className="flex items-center gap-2 mb-4 text-orange-500"><User size={16} /><span className="text-[10px] font-black uppercase tracking-widest">Responsável pela execução</span></div>
            <div className="flex items-center gap-3">
              <div className="bg-slate-800 px-4 py-2 rounded-xl text-[10px] font-black text-slate-400 uppercase border border-slate-700">De: {currentUser.name}</div>
              <span className="text-orange-600 font-black">→</span>
              <div className="relative">
                <button onClick={() => setIsSelecting(!isSelecting)} className="bg-slate-800 px-4 py-2 rounded-xl text-[10px] font-black text-white uppercase border border-dashed border-orange-500 hover:bg-slate-700 transition">
                  {selectedResponsible || "Selecionar Responsável"}
                </button>
                {isSelecting && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden max-h-48 overflow-y-auto">
                    {users.map(u => (u.name !== currentUser.name && <button key={u.id} onClick={() => { setSelectedResponsible(u.name); setIsSelecting(false); }} className="w-full text-left px-4 py-3 text-xs font-black text-slate-700 hover:bg-orange-50 transition uppercase">{u.name}</button>))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 border border-slate-300 transition text-[10px] font-black uppercase">
              <Paperclip size={14} /> {selectedFile ? selectedFile.name : "Anexar Arquivo (Opcional)"}
            </button>
          </div>
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-4">
          <button onClick={onClose} className="px-8 py-4 text-slate-400 font-black uppercase text-[10px]">Cancelar</button>
          <button onClick={handleSubmit} className="px-8 py-4 bg-orange-600 text-white font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-orange-700 shadow-xl shadow-orange-600/20 active:scale-95 transition-all">Iniciar Fluxo →</button>
        </div>
      </div>
    </div>
  );
}