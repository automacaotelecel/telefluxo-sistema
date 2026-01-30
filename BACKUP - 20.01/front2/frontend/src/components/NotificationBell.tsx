import React, { useState, useEffect } from 'react';
import { Bell, Check, BellOff } from 'lucide-react';

export default function NotificationBell({ currentUser }: any) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const API_URL = 'http://172.34.0.47:3000';

  const fetchNotes = () => {
    if (!currentUser?.id) return;
    fetch(`${API_URL}/notifications?userId=${currentUser.id}`)
      .then(r => r.json())
      .then(data => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchNotes();
    const interval = setInterval(fetchNotes, 20000); 
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  const markAsRead = async (id: string) => {
    await fetch(`${API_URL}/notifications/${id}`, { method: 'PUT' });
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)} className="relative p-2 text-slate-400 hover:text-orange-600 transition-all">
        <Bell size={22} />
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
            {notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center text-xs font-black uppercase tracking-widest font-sans">
              <span>Notificações</span>
              <span className="bg-orange-600 px-2 py-0.5 rounded-full">{notifications.length}</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-slate-400 italic text-sm flex flex-col items-center gap-2">
                  <BellOff size={24} className="opacity-20" /> Sem novidades
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className="p-4 border-b border-slate-50 hover:bg-orange-50/30 flex gap-3 items-start group">
                    <div className="flex-1 font-sans text-sm font-semibold text-slate-700 leading-snug">
                      {n.text || n.content || "Atualização no sistema"}
                    </div>
                    <button onClick={() => markAsRead(n.id)} className="opacity-0 group-hover:opacity-100 p-1.5 bg-green-50 text-green-600 rounded-lg">
                      <Check size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}