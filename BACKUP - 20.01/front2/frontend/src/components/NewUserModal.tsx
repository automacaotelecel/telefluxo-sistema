import React, { useState, useEffect } from 'react';
import { X, User, Shield, Briefcase } from 'lucide-react';

export default function NewUserModal({ isOpen, onClose, onSuccess }: any) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Colaborador');
  const [isAdmin, setIsAdmin] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [allUsers, setAllUsers] = useState<any[]>([]);

  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_URL}/users`).then(r => r.json()).then(setAllUsers);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit() {
    const payload = { name, email, password, role, department: "Geral", isAdmin, managerId: managerId || null };
    const res = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert("Usuário criado com sucesso!");
      onClose();
      window.location.reload();
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-8 space-y-4">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Novo Colaborador</h2>
            <button onClick={onClose}><X /></button>
        </div>

        <div>
            <label className="text-xs font-bold uppercase text-slate-400">Nome</label>
            <input className="w-full p-2 border rounded mt-1" onChange={e => setName(e.target.value)} />
        </div>
        <div>
            <label className="text-xs font-bold uppercase text-slate-400">Email</label>
            <input className="w-full p-2 border rounded mt-1" onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
            <label className="text-xs font-bold uppercase text-slate-400">Senha</label>
            <input type="password" className="w-full p-2 border rounded mt-1" onChange={e => setPassword(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
            <div>
                <label className="text-xs font-bold uppercase text-slate-400">Cargo</label>
                <input className="w-full p-2 border rounded mt-1" onChange={e => setRole(e.target.value)} />
            </div>
            <div>
                <label className="text-xs font-bold uppercase text-orange-600">Gestor Direto</label>
                <select className="w-full p-2 border border-orange-200 bg-orange-50 rounded mt-1" onChange={e => setManagerId(e.target.value)}>
                    <option value="">Sem Gestor (Topo)</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
            </div>
        </div>

        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
            <input type="checkbox" onChange={e => setIsAdmin(e.target.checked)} />
            <label className="text-sm font-bold">Acesso Administrador Master</label>
        </div>

        <button onClick={handleSubmit} className="w-full p-3 bg-orange-600 text-white font-bold rounded-lg hover:bg-orange-700">Cadastrar</button>
      </div>
    </div>
  );
}