import React, { useState, useEffect } from 'react';
import { Megaphone, Bell, Calendar, Plus, Trash2, X } from 'lucide-react';

export default function Home({ currentUser }: any) {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newNotice, setNewNotice] = useState({ title: '', content: '', priority: 'Normal', category: 'Aviso' });
  
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // 🔥 SOLUÇÃO DEFINITIVA DO BOTÃO: Checagem robusta (1 ou true ou texto)
  const isAdminOrManager = 
    currentUser?.isAdmin === true || 
    Number(currentUser?.isAdmin) === 1 || 
    currentUser?.role?.toLowerCase().includes('gerente') || 
    currentUser?.role?.toLowerCase().includes('gestor') ||
    currentUser?.role?.toLowerCase().includes('adm');

  const fetchAnnouncements = () => {
    fetch(`${API_URL}/announcements`)
      .then(r => r.json())
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => setAnnouncements([]));
  };

  useEffect(() => { fetchAnnouncements(); }, []);

  const handleCreate = async () => {
    if (!newNotice.title || !newNotice.content) return alert("Preencha título e conteúdo!");
    
    await fetch(`${API_URL}/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newNotice, author: currentUser.name })
    });
    
    setShowModal(false);
    setNewNotice({ title: '', content: '', priority: 'Normal', category: 'Aviso' });
    fetchAnnouncements();
  };

  const handleDelete = async (id: string) => {
    if(!confirm("Deseja remover este informativo?")) return;
    await fetch(`${API_URL}/announcements/${id}`, { method: 'DELETE' });
    fetchAnnouncements();
  };

  // Filtramos os dados por categoria para preencher os espaços
  const notices = announcements.filter(a => a.category === 'Aviso');
  const dailyTip = announcements.find(a => a.category === 'Dica');
  const groupAgenda = announcements.filter(a => a.category === 'Agenda');

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto">
        
        {/* CABEÇALHO */}
        <div className="flex justify-between items-end mb-10">
          <div>
            <h1 className="text-3xl font-black text-slate-800 uppercase tracking-tighter italic">
              Olá, {currentUser.name.split(' ')[0]}! 👋
            </h1>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em]">Painel de Controle Grupo Telecel</p>
          </div>
          
          {isAdminOrManager && (
            <button 
              onClick={() => setShowModal(true)}
              className="bg-orange-600 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase flex gap-2 hover:bg-orange-700 shadow-lg transition-all active:scale-95"
            >
              <Plus size={16} /> Gerenciar Mural
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* MURAL CENTRAL (AVISOS) */}
          <div className="md:col-span-2 space-y-6">
            <h3 className="flex items-center gap-2 font-black uppercase text-[10px] text-slate-400 tracking-widest">
              <Megaphone size={14} className="text-orange-500" /> Informativos Oficiais
            </h3>
            
            {notices.map((ann) => (
              <div key={ann.id} className="p-8 rounded-[40px] border border-slate-100 shadow-sm bg-white relative group">
                {isAdminOrManager && (
                  <button onClick={() => handleDelete(ann.id)} className="absolute top-6 right-6 text-slate-300 hover:text-red-500 transition-colors">
                    <Trash2 size={16} />
                  </button>
                )}
                <div className="flex items-center gap-3 mb-4">
                   <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${ann.priority === 'Urgente' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {ann.priority}
                   </span>
                </div>
                <h4 className="text-xl font-black text-slate-800 mb-3 uppercase italic">{ann.title}</h4>
                <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">{ann.content}</p>
              </div>
            ))}
          </div>

          {/* LATERAL (DICA E AGENDA) */}
          <div className="space-y-6">
             
             {/* FRASE / DICA DO DIA */}
             <div className="bg-slate-900 rounded-[40px] p-8 text-white shadow-xl relative group">
                {isAdminOrManager && dailyTip && (
                  <button onClick={() => handleDelete(dailyTip.id)} className="absolute top-4 right-4 text-slate-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                )}
                <h4 className="font-black uppercase text-[10px] tracking-widest mb-6 text-orange-500 flex items-center gap-2">
                  <Bell size={14}/> Frase do Dia
                </h4>
                <p className="text-lg font-black italic tracking-tighter">
                  {dailyTip ? `"${dailyTip.content}"` : "Organização é a base de tudo. Bom trabalho!"}
                </p>
             </div>

             {/* AGENDA DO GRUPO */}
             <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm">
                <h4 className="font-black uppercase text-[10px] tracking-widest mb-6 text-slate-400 flex items-center gap-2">
                  <Calendar size={14}/> Agenda Grupo
                </h4>
                <div className="space-y-4">
                   {groupAgenda.map(item => (
                     <div key={item.id} className="flex justify-between items-start group">
                        <div className="flex gap-3">
                          <div className="w-2 h-2 rounded-full bg-orange-500 mt-1"></div>
                          <p className="text-xs font-black text-slate-700 uppercase">{item.title}</p>
                        </div>
                        {isAdminOrManager && (
                          <button onClick={() => handleDelete(item.id)} className="text-slate-300 hover:text-red-500">
                            <Trash2 size={12} />
                          </button>
                        )}
                     </div>
                   ))}
                   {groupAgenda.length === 0 && <p className="text-[10px] font-bold text-slate-300 uppercase">Sem reuniões hoje.</p>}
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* MODAL DE GERENCIAMENTO */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl p-10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-800">Novo Conteúdo</h2>
              <button onClick={() => setShowModal(false)}><X/></button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Onde publicar?</label>
                <select 
                  className="w-full p-4 rounded-2xl border border-slate-200 font-bold outline-none mt-1"
                  value={newNotice.category}
                  onChange={e => setNewNotice({...newNotice, category: e.target.value})}
                >
                  <option value="Aviso">Mural Central (Informativos)</option>
                  <option value="Dica">Frase do Dia (Card Preto)</option>
                  <option value="Agenda">Agenda Grupo (Lista Lateral)</option>
                </select>
              </div>

              <input 
                placeholder="Título / Assunto" 
                className="w-full p-4 rounded-2xl border border-slate-200 font-bold outline-none focus:border-orange-500"
                value={newNotice.title}
                onChange={e => setNewNotice({...newNotice, title: e.target.value})}
              />
              
              <textarea 
                placeholder="Conteúdo ou Mensagem..." 
                rows={4}
                className="w-full p-4 rounded-2xl border border-slate-200 font-bold outline-none focus:border-orange-500"
                value={newNotice.content}
                onChange={e => setNewNotice({...newNotice, content: e.target.value})}
              />

              {newNotice.category === 'Aviso' && (
                <select 
                  className="w-full p-4 rounded-2xl border border-slate-200 font-bold outline-none"
                  value={newNotice.priority}
                  onChange={e => setNewNotice({...newNotice, priority: e.target.value})}
                >
                  <option value="Normal">Prioridade Normal</option>
                  <option value="Urgente">Prioridade Urgente</option>
                </select>
              )}
            </div>

            <button onClick={handleCreate} className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg hover:bg-orange-700 mt-8 transition-all">
              Confirmar e Publicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}