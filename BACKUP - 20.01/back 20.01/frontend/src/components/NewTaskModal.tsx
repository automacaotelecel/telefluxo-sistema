import React, { useState, useEffect, useRef } from 'react';
import { X, Send, AlertCircle, Paperclip } from 'lucide-react';

export default function NewTaskModal({ isOpen, onClose, currentUser, onTaskCreated }: any) {
  const [formData, setFormData] = useState({
    title: '', responsible: '', priority: 'Média', deadline: '', creatorName: currentUser.name, description: ''
  });
  const [file, setFile] = useState<File | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    fetch(`${API_URL}/users`).then(r => r.json()).then(setUsers);
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Usamos FormData para enviar texto e arquivo juntos
    const data = new FormData();
    data.append('title', formData.title);
    data.append('responsible', formData.responsible);
    data.append('priority', formData.priority);
    data.append('deadline', formData.deadline);
    data.append('creatorName', formData.creatorName);
    data.append('description', formData.description); // Enviando o comentário
    
    if (file) {
        data.append('file', file);
    }

    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      body: data 
    });

    if (res.ok) {
      onTaskCreated();
    } else {
      alert("Erro ao criar demanda.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200">
        
        {/* Cabeçalho Laranja que você gostou */}
        <div className="bg-orange-600 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <AlertCircle />
            <h2 className="font-black uppercase tracking-tighter italic">Nova Demanda Técnica</h2>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-all"><X /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          
          {/* Título */}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Título da Demanda</label>
            <input required placeholder="Ex: Ajuste de Preço Samsung S24" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none mt-1 focus:border-orange-500" 
              onChange={e => setFormData({...formData, title: e.target.value})} />
          </div>

          {/* Responsável e Prioridade */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Responsável</label>
              <select required className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none mt-1"
                onChange={e => setFormData({...formData, responsible: e.target.value})}>
                <option value="">Selecione...</option>
                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Prioridade</label>
              <select className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none mt-1"
                onChange={e => setFormData({...formData, priority: e.target.value})}>
                <option value="Baixa">Baixa</option>
                <option value="Média">Média</option>
                <option value="Alta">Alta</option>
              </select>
            </div>
          </div>

          {/* Prazo */}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Prazo de Entrega</label>
            <input required type="date" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none mt-1" 
              onChange={e => setFormData({...formData, deadline: e.target.value})} />
          </div>

          {/* NOVO CAMPO: Detalhes/Comentários */}
          <div>
             <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Detalhes e Observações</label>
             <textarea 
                placeholder="Descreva o que precisa ser feito com detalhes..." 
                className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none mt-1 resize-none h-24 focus:border-orange-500"
                onChange={e => setFormData({...formData, description: e.target.value})}
             />
          </div>

          {/* NOVO CAMPO: Anexo */}
          <div>
            <div 
                onClick={() => fileInputRef.current?.click()}
                className={`w-full p-4 border-2 border-dashed rounded-2xl cursor-pointer flex items-center justify-center gap-3 transition-all ${file ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-400'}`}
            >
                <input type="file" ref={fileInputRef} className="hidden" onChange={(e: any) => setFile(e.target.files[0])} />
                <Paperclip size={18} />
                <span className="text-xs font-bold uppercase">{file ? file.name : "Anexar Documento (Opcional)"}</span>
            </div>
          </div>

          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg flex items-center justify-center gap-3">
            <Send size={18} /> Lançar no Fluxo
          </button>
        </form>
      </div>
    </div>
  );
}