import React, { useState, useEffect } from 'react';
import { Mail, Briefcase, User, Shield, Trash2, Pencil } from 'lucide-react';
import EditUserModal from './EditUserModal'; // Certifique-se que este arquivo existe!

export default function UserList() {
  const [users, setUsers] = useState<any[]>([]);
  const [userToEdit, setUserToEdit] = useState<any>(null);
  const API_URL = 'http://172.34.0.47:3000';

  const currentUser = JSON.parse(localStorage.getItem('telefluxo_user') || '{}');
  const isAdmin = currentUser?.isAdmin;

  useEffect(() => {
    fetch(`${API_URL}/users`).then(r => r.json()).then(setUsers);
  }, []);

  const handleDelete = async (id: string) => {
      if(!confirm("Tem certeza que deseja remover este membro da equipe?")) return;
      await fetch(`${API_URL}/users/${id}`, { method: 'DELETE' });
      setUsers(users.filter(u => u.id !== id));
  };

  return (
    <div className="space-y-4">
      {users.map((u) => (
        <div key={u.id} className="bg-white p-6 rounded-[24px] border border-slate-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${u.isAdmin ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                {u.name.charAt(0)}
            </div>
            <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    {u.name}
                    {/* CORREÇÃO AQUI: Title vai no span, não no ícone */}
                    {u.isAdmin && (
                        <span title="Administrador">
                            <Shield size={12} className="text-orange-500" />
                        </span>
                    )}
                </h3>
                <div className="flex gap-4 mt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Briefcase size={10}/> {u.role}</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Mail size={10}/> {u.email}</span>
                </div>
            </div>
          </div>
          
          <div className="text-right">
             <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest block mb-2">{u.department}</span>
             
             {/* BOTÕES DE AÇÃO (SÓ PARA ADMIN) */}
             {isAdmin && (
                 <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                     <button onClick={() => setUserToEdit(u)} className="p-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200" title="Editar">
                        <Pencil size={14} />
                     </button>
                     <button onClick={() => handleDelete(u.id)} className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100" title="Remover">
                        <Trash2 size={14} />
                     </button>
                 </div>
             )}
          </div>
        </div>
      ))}
      
      {/* RENDERIZAÇÃO DO MODAL DE EDIÇÃO */}
      {userToEdit && (
        <EditUserModal 
            isOpen={!!userToEdit} 
            userToEdit={userToEdit} 
            onClose={() => setUserToEdit(null)} 
        />
      )}
    </div>
  );
}