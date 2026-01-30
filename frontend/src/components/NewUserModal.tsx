import React, { useState, useEffect } from 'react';
import { X, UserPlus, Shield, Store, Lock } from 'lucide-react';

export default function NewUserModal({ isOpen, onClose }: any) {
  // Estado do formulário
  const [formData, setFormData] = useState({
    name: '', 
    email: '', 
    password: '', // Agora começa vazio para obrigar digitação
    role: 'LOJA', 
    department: '', 
    operation: 'Geral', 
    isAdmin: false, 
    managerId: '',
    allowedStores: [] as string[]
  });
  
  const [managers, setManagers] = useState<any[]>([]);
  const [availableStores, setAvailableStores] = useState<string[]>([]); // Estado para as lojas vindas do banco
  
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  useEffect(() => {
    if (isOpen) {
      // 1. Busca Gestores
      fetch(`${API_URL}/users`).then(r => r.json()).then(data => {
        if (Array.isArray(data)) {
            setManagers(data.filter((u: any) => u.isAdmin || u.role?.toLowerCase().includes('gerente')));
        }
      });

      // 2. Busca Lojas do Banco de Dados (Silo Samsung)
      fetch(`${API_URL}/external-stores`)
        .then(r => r.json())
        .then(data => {
            if (Array.isArray(data)) {
                setAvailableStores(data);
            }
        })
        .catch(err => console.error("Erro ao carregar lojas:", err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStoreToggle = (store: string) => {
    setFormData(prev => {
        const current = prev.allowedStores;
        if (current.includes(store)) {
            return { ...prev, allowedStores: current.filter(s => s !== store) };
        } else {
            return { ...prev, allowedStores: [...current, store] };
        }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validação básica de senha
    if (!formData.password || formData.password.length < 3) {
        alert("A senha precisa ter pelo menos 3 caracteres.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
    
        if (res.ok) {
            alert("Novo membro adicionado com sucesso!");
            onClose();
            window.location.reload();
        } else {
            const err = await res.json();
            alert("Erro ao adicionar membro: " + (err.error || "Erro desconhecido"));
        }
    } catch (error) {
        alert("Erro de conexão com o servidor.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <div className="bg-slate-900 p-6 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <UserPlus className="text-orange-500" />
            <h2 className="font-black uppercase tracking-tighter italic">Novo Acesso</h2>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-all"><X /></button>
        </div>

        {/* FORMULÁRIO */}
        <form onSubmit={handleSubmit} className="p-8 space-y-4 overflow-y-auto custom-scrollbar">
          
          <input required placeholder="Nome Completo" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-colors" 
            onChange={e => setFormData({...formData, name: e.target.value})} />
          
          {/* E-MAIL E SENHA */}
          <div className="grid grid-cols-1 gap-4">
            <input required type="email" placeholder="E-mail (Login)" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-colors" 
                onChange={e => setFormData({...formData, email: e.target.value})} />
            
            <div className="relative">
                <input required type="password" placeholder="Senha de Acesso" className="w-full p-4 pl-12 bg-slate-50 border rounded-2xl font-bold text-sm outline-none focus:border-orange-500 transition-colors" 
                    onChange={e => setFormData({...formData, password: e.target.value})} />
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* SELETOR DE CARGO (HIERARQUIA) */}
            <select required className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none uppercase"
                value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                <option value="LOJA">Operação de Loja</option>
                <option value="ADM">Administrativo</option>
                <option value="DIRETOR">Diretoria</option>
                <option value="CEO">CEO</option>
            </select>

            <input required placeholder="Departamento" className="p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none" 
              onChange={e => setFormData({...formData, department: e.target.value})} />
          </div>

          <select required className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none"
            value={formData.operation} onChange={e => setFormData({...formData, operation: e.target.value})}>
            <option value="Geral">Operação: Geral / Gestão</option>
            <option value="Financeiro">Operação: Financeiro</option>
            <option value="Tim">Operação: Tim</option>
            <option value="Samsung">Operação: Samsung</option>
            <option value="Automação">Operação: Automação</option>
          </select>

          {/* === ÁREA DE SELEÇÃO DE LOJAS (Carregada do Banco de Dados) === */}
          {formData.role === 'LOJA' && (
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                  <div className="flex items-center gap-2 mb-2 text-blue-800 font-bold text-xs uppercase tracking-widest">
                      <Store size={14}/> Lojas Disponíveis ({availableStores.length})
                  </div>
                  
                  {availableStores.length === 0 ? (
                      <p className="text-xs text-blue-400 p-2 italic">Nenhuma loja encontrada no banco de dados.</p>
                  ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                          {availableStores.map(store => (
                              <label key={store} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-blue-100 cursor-pointer hover:bg-blue-50 transition-colors">
                                  <input 
                                    type="checkbox" 
                                    className="accent-blue-600 w-4 h-4"
                                    checked={formData.allowedStores.includes(store)}
                                    onChange={() => handleStoreToggle(store)}
                                  />
                                  <span className="text-[10px] font-bold text-slate-600 truncate" title={store}>{store}</span>
                              </label>
                          ))}
                      </div>
                  )}
              </div>
          )}

          <select className="w-full p-4 bg-slate-50 border rounded-2xl font-bold text-sm outline-none"
            onChange={e => setFormData({...formData, managerId: e.target.value})}>
            <option value="">Selecione o Gestor Direto (Opcional)</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl border border-orange-100">
            <input type="checkbox" id="adm_check" className="accent-orange-600 w-5 h-5" onChange={e => setFormData({...formData, isAdmin: e.target.checked})} />
            <label htmlFor="adm_check" className="text-[10px] font-black uppercase text-orange-800 flex items-center gap-2 cursor-pointer"><Shield size={14}/> Acesso de Administrador (Super User)</label>
          </div>

          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg active:scale-95">
            Salvar Acesso
          </button>
        </form>
      </div>
    </div>
  );
}