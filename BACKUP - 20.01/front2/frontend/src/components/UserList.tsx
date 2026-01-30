import React, { useState, useEffect } from 'react';
import { Mail, Shield } from 'lucide-react';

export default function UserList() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const API_URL = 'http://172.34.0.47:3000';

  useEffect(() => {
    fetch(`${API_URL}/users`)
      .then(res => res.json())
      .then(data => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-20 text-center font-black text-slate-300 uppercase animate-pulse">Carregando Equipe...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {users.map(user => (
        <div key={user.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center font-black shadow-inner group-hover:bg-orange-600 group-hover:text-white transition-all text-xl">
              {user.name.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <h3 className="font-black text-slate-800 uppercase text-sm truncate tracking-tight">{user.name}</h3>
              <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase mt-1">
                <Shield size={10} /> {user.role || 'Colaborador'}
              </div>
            </div>
          </div>
          
          <div className="mt-6 flex items-center gap-2 text-[10px] font-bold text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <Mail size={12} className="text-orange-500" /> {user.email || 'Sem email'}
          </div>

          {/* Se ele for gestor, mostra quem ele gerencia (Opcional, baseado no seu pedido) */}
          {user.staff && user.staff.length > 0 && (
             <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[9px] font-black text-slate-300 uppercase mb-2">Equipe:</p>
                <div className="flex flex-wrap gap-1">
                    {user.staff.map((s:any) => (
                        <span key={s.id} className="text-[9px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-bold uppercase">{s.name}</span>
                    ))}
                </div>
             </div>
          )}
        </div>
      ))}
    </div>
  );
}