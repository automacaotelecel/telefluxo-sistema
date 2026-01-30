import React, { useState, useEffect, useRef } from 'react';
import { Send, Hash } from 'lucide-react';

export default function DeptBulletin({ department, currentUser }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const fetchMessages = () => {
    fetch(`${API_URL}/dept-messages/${department}`)
      .then(r => r.json())
      .then(data => setMessages(Array.isArray(data) ? data : []));
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000); // Atualiza a cada 5 segundos
    return () => clearInterval(interval);
  }, [department]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim()) return;
    await fetch(`${API_URL}/dept-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newMessage, author: currentUser.name, department })
    });
    setNewMessage('');
    fetchMessages();
  };

  return (
    <div className="flex-1 flex flex-col bg-white h-full">
      <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
        <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-orange-500">
          <Hash size={20} />
        </div>
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter italic">Informativo {department}</h2>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comunicação direta do setor</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-fixed">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.author === currentUser.name ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[70%] p-4 rounded-[24px] shadow-sm ${msg.author === currentUser.name ? 'bg-orange-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-800 rounded-tl-none'}`}>
              <p className="text-[10px] font-black uppercase mb-1 opacity-60">{msg.author}</p>
              <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
              <p className="text-[9px] mt-2 opacity-50 font-bold">{new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <div className="p-6 border-t border-slate-100 bg-white">
        <div className="flex gap-3 bg-slate-50 p-2 rounded-[24px] border border-slate-200">
          <input 
            className="flex-1 bg-transparent p-3 outline-none font-bold text-sm"
            placeholder={`Escrever para o time ${department}...`}
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
          />
          <button onClick={handleSend} className="bg-slate-900 text-white p-3 rounded-2xl hover:bg-orange-600 transition-all">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}