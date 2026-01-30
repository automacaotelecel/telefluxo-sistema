import React, { useState, useEffect } from 'react';
import { X, UserPlus, Shield } from 'lucide-react';

export default function NewUserModal({ isOpen, onClose }: any) {
  const [formData, setFormData] = useState({
    name: '', email: '', password: '123', role: '', department: '', operation: 'Financeiro', isAdmin: false, managerId: ''
  });
  const [managers, setManagers] = useState<any[]>([]);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_URL}/users`).then(r => r.json()).then(data => {
        if (Array.isArray(data)) {
            setManagers(data.filter((u: any) => u.isAdmin || u.role?.toLowerCase().includes('gerente')));
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (res.ok) {
      alert("Novo membro adicionado!");
      onClose();
      window.location.reload();
    } else {
        alert("Erro ao adicionar membro.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200">
        <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <UserPlus className="text-orange-500" />
            <h2 className="font-black uppercase tracking-tighter italic">Novo Membro Equipe</h2>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-all"><X /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          <input required placeholder="Nome Completo" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
            onChange={e => setFormData({...formData, name: e.target.value})} />
          
          <input required type="email" placeholder="E-mail (Login)" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
            onChange={e => setFormData({...formData, email: e.target.value})} />

          <div className="grid grid-cols-2 gap-4">
            <input required placeholder="Cargo" className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
              onChange={e => setFormData({...formData, role: e.target.value})} />
            <input required placeholder="Departamento" className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
              onChange={e => setFormData({...formData, department: e.target.value})} />
          </div>

          {/* 🔥 NOVO: SELEÇÃO DE OPERAÇÃO NO CADASTRO */}
          <select required className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none"
            value={formData.operation} onChange={e => setFormData({...formData, operation: e.target.value})}>
            <option value="Financeiro">Financeiro</option>
            <option value="Tim">Tim</option>
            <option value="Samsung">Samsung</option>
            <option value="Automação">Automação</option>
          </select>

          <select className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none"
            onChange={e => setFormData({...formData, managerId: e.target.value})}>
            <option value="">Selecione o Gestor Direto (Opcional)</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl border border-orange-100">
            <input type="checkbox" id="adm_check" className="accent-orange-600 w-5 h-5" onChange={e => setFormData({...formData, isAdmin: e.target.checked})} />
            <label htmlFor="adm_check" className="text-[10px] font-black uppercase text-orange-800 flex items-center gap-2 cursor-pointer"><Shield size={14}/> Acesso de Administrador</label>
          </div>

          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg active:scale-95">Salvar Membro</button>
        </form>
      </div>
    </div>
  );
}