import React, { useState } from 'react';
import { Lock, Mail, ArrowRight } from 'lucide-react';

interface LoginProps {
  onLogin: (userData: any) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Endereço do seu servidor local
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); 

    try {
      const res = await fetch(`${API_URL}/login`, { 
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const user = await res.json();
        onLogin(user); 
      } else {
        // Mensagem profissional e segura
        setError("E-mail ou senha incorretos.");
      }
    } catch (err) {
      // Se cair aqui, o servidor está desligado ou o IP mudou
      setError("Erro de conexão. Verifique se o servidor está ativo.");
    }
  }

  return (
    <div className="h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-300">
        
        {/* Header com Identidade Telecel */}
        <div className="bg-orange-600 p-8 text-center">
          <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-lg mx-auto mb-4 text-orange-600 text-xl font-bold">T</div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-tight">TeleFluxo</h1>
          <p className="text-orange-100 text-xs font-bold uppercase tracking-widest mt-1">Grupo Telecel</p>
        </div>

        <div className="p-8 pt-10">
          <form onSubmit={handleLogin} className="space-y-6">
            
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Email Corporativo</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-slate-400" size={20} />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none transition"
                  placeholder="seu@telecel.com.br"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-slate-400" size={20} />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none transition"
                  placeholder="••••••"
                />
              </div>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium text-center border border-red-100">
                    {error}
                </div>
            )}

            <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition flex items-center justify-center gap-2 shadow-lg transform active:scale-95">
              Entrar no Sistema <ArrowRight size={18} />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              SISTEMA INTERNO • GRUPO TELECEL
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}