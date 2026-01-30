import React, { useState, useEffect } from 'react';
import { X, UserCog, Shield } from 'lucide-react';

export default function EditUserModal({ isOpen, onClose, userToEdit }: any) {
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', role: '', department: '', operation: '', isAdmin: false, managerId: ''
  });
  const [managers, setManagers] = useState<any[]>([]);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  useEffect(() => {
    if (isOpen && userToEdit) {
      setFormData({
          name: userToEdit.name,
          email: userToEdit.email,
          password: '',
          role: userToEdit.role,
          department: userToEdit.department,
          operation: userToEdit.operation || 'Financeiro', // Valor padrão caso esteja vazio
          isAdmin: userToEdit.isAdmin,
          managerId: userToEdit.managerId || ''
      });
      
      fetch(`${API_URL}/users`).then(r => r.json()).then(data => {
        setManagers(data.filter((u: any) => u.isAdmin || u.role.toLowerCase().includes('gerente')));
      });
    }
  }, [isOpen, userToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/users/${userToEdit.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (res.ok) {
      alert("Dados atualizados com sucesso!");
      onClose();
      window.location.reload();
    } else {
        alert("Erro ao atualizar.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200">
        <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <UserCog className="text-orange-500" />
            <h2 className="font-black uppercase tracking-tighter italic">Editar Membro</h2>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-all"><X /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Nome</label>
            <input required value={formData.name} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
              onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">E-mail</label>
            <input required type="email" value={formData.email} className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
              onChange={e => setFormData({...formData, email: e.target.value})} />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Cargo</label>
                <input required value={formData.role} className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none w-full" 
                  onChange={e => setFormData({...formData, role: e.target.value})} />
             </div>
             <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Setor</label>
                <input required value={formData.department} className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none w-full" 
                  onChange={e => setFormData({...formData, department: e.target.value})} />
             </div>
          </div>

          {/* 🔥 NOVO CAMPO: OPERAÇÃO NO EDITAR */}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Operação / Operacional</label>
            <select 
              required 
              value={formData.operation} 
              className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none focus:border-orange-500"
              onChange={e => setFormData({...formData, operation: e.target.value})}
            >
              <option value="Outros">Selecione...</option>
              <option value="Geral">Geral</option>
              <option value="Financeiro">Financeiro</option>
              <option value="Tim">Tim</option>
              <option value="Samsung">Samsung</option>
              <option value="Automação">Automação</option>
            </select>
          </div>

          <div>
             <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Nova Senha (Opcional)</label>
             <input type="password" placeholder="Deixe vazio para manter a atual" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
               onChange={e => setFormData({...formData, password: e.target.value})} />
          </div>

          <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl border border-orange-100">
            <input type="checkbox" id="adm_edit" className="accent-orange-600 w-5 h-5" checked={formData.isAdmin} onChange={e => setFormData({...formData, isAdmin: e.target.checked})} />
            <label htmlFor="adm_edit" className="text-[10px] font-black uppercase text-orange-800 flex items-center gap-2 cursor-pointer"><Shield size={14}/> Acesso de Administrador</label>
          </div>

          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg active:scale-95">Salvar Alterações</button>
        </form>
      </div>
    </div>
  );
}