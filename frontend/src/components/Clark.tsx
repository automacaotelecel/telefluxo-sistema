import { useMemo, useRef, useState } from 'react';
import {
  Send,
  Loader2,
  User,
  Sparkles,
  TrendingUp,
  Building2,
  Users,
  CalendarDays,
  X,
  MessageCircle,
  Crown,
  Minimize2,
  Maximize2,
  Package,
} from 'lucide-react';

type ClarkMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

type ClarkProps = {
  currentUser: any;
};

const API_URL =
  import.meta.env.VITE_API_URL ||
  'http://localhost:3000';

function ClarkAvatar({ small = false }: { small?: boolean }) {
  const sizeClass = small ? 'w-9 h-9' : 'w-14 h-14';

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-800 to-orange-700 text-white shadow-lg border border-white/10 ${sizeClass}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(255,255,255,0.28),transparent_34%)]" />
      <div className="absolute -right-2 -bottom-2 w-10 h-10 rounded-full bg-orange-500/60 blur-md" />

      <div className="absolute left-1/2 top-[8%] -translate-x-1/2 w-[70%] h-[70%] rounded-t-full bg-gradient-to-b from-yellow-200 via-yellow-300 to-amber-500 shadow-md" />
      <div className="absolute left-[18%] top-[30%] w-[20%] h-[52%] rounded-full bg-amber-400/95 rotate-[-8deg]" />
      <div className="absolute right-[18%] top-[30%] w-[20%] h-[52%] rounded-full bg-amber-400/95 rotate-[8deg]" />

      <div className="absolute left-1/2 top-[25%] -translate-x-1/2 w-[42%] h-[42%] rounded-full bg-amber-100 border border-amber-200" />

      <div className="absolute left-[32%] top-[17%] w-[28%] h-[22%] rounded-br-full rounded-tl-full bg-yellow-300 rotate-[-18deg]" />
      <div className="absolute right-[30%] top-[18%] w-[26%] h-[20%] rounded-bl-full rounded-tr-full bg-yellow-300 rotate-[16deg]" />

      <div className="absolute left-[40%] top-[43%] w-1 h-1 rounded-full bg-slate-700" />
      <div className="absolute right-[40%] top-[43%] w-1 h-1 rounded-full bg-slate-700" />

      <div className="absolute left-1/2 bottom-[9%] -translate-x-1/2 w-[58%] h-[30%] rounded-t-2xl bg-slate-700 border-t border-slate-500" />

      <div className="absolute left-1/2 bottom-[10%] -translate-x-1/2 w-4 h-4 rounded-md bg-orange-500/90 flex items-center justify-center">
        <Sparkles size={small ? 8 : 10} className="text-white" />
      </div>
    </div>
  );
}

export default function Clark({ currentUser }: ClarkProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [messages, setMessages] = useState<ClarkMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'Olá, eu sou a Clark. Posso te ajudar com perguntas sobre vendas, lojas, vendedores, categorias e estoque. Comece perguntando: "Quanto vendemos hoje?"',
      createdAt: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
  ]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(
  () => [
    {
      label: 'Vendas hoje',
      prompt: 'Quanto vendemos hoje?',
      icon: CalendarDays,
    },
    {
      label: 'Vendas período',
      prompt: 'Quanto vendemos no período de 01/03/2026 até 09/04/2026?',
      icon: TrendingUp,
    },
    {
      label: 'Ranking lojas',
      prompt: 'Qual loja mais vendeu no mês?',
      icon: Building2,
    },
    {
      label: 'Seguros vendedores',
      prompt: 'Me liste o top 5 vendedores com maior venda de seguros no mês.',
      icon: Users,
    },
    {
      label: 'Top smartphones',
      prompt: 'Liste os 5 maiores modelos da categoria SMARTPHONES em estoque e quais lojas estão.',
      icon: Package,
    },
    {
      label: 'Buscar produto',
      prompt: 'Me liste as lojas que têm "Galaxy A56 128GB Preto" em estoque na categoria SMARTPHONES.',
      icon: Package,
    },
  ],
  []
);

  const addMessage = (role: 'user' | 'assistant', text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${Math.random()}`,
        role,
        text,
        createdAt: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
    ]);
  };

  const sendQuestion = async (question?: string) => {
    const pergunta = String(question || input).trim();

    if (!pergunta || loading) return;

    setInput('');
    addMessage('user', pergunta);
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/clark/perguntar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUser?.id,
          pergunta,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Erro ao consultar a Clark.');
      }

      addMessage('assistant', data?.clark || 'Não consegui responder agora.');
    } catch (error: any) {
      addMessage(
        'assistant',
        `Não consegui processar sua pergunta agora. Motivo: ${
          error?.message || 'erro desconhecido'
        }`
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const closeChat = () => {
    setIsOpen(false);
    setIsExpanded(false);
  };

  const panelClass = isExpanded
    ? 'fixed inset-3 md:inset-8 z-[9999] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col'
    : 'fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[9999] w-[calc(100vw-32px)] md:w-[430px] h-[620px] max-h-[calc(100vh-32px)] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col';

  const messageMaxClass = isExpanded ? 'max-w-[900px]' : 'max-w-[78%]';

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 150);
          }}
          className="fixed bottom-6 right-6 z-[9999] group"
          title="Abrir Clark IA"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-orange-500 blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />

            <div className="relative w-16 h-16 rounded-full bg-slate-950 text-white shadow-2xl border border-orange-400/30 flex items-center justify-center hover:scale-105 transition-transform">
              <ClarkAvatar small />
            </div>

            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-orange-600 text-white flex items-center justify-center border-2 border-white shadow-lg">
              <MessageCircle size={13} />
            </div>
          </div>
        </button>
      )}

      {isOpen && (
        <div className={panelClass}>
          <div className="bg-slate-950 text-white px-4 py-4 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <ClarkAvatar />

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-black uppercase text-sm tracking-tight">
                    Clark IA
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 text-[9px] font-black uppercase">
                    Beta
                  </span>
                </div>

                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                  Assistente do TeleFluxo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded((prev) => !prev)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-orange-600 flex items-center justify-center transition-colors"
                title={isExpanded ? 'Reduzir chat' : 'Expandir chat'}
              >
                {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              <button
                onClick={closeChat}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-red-600 flex items-center justify-center transition-colors"
                title="Fechar"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 bg-white border-b border-slate-200">
            <div className="flex items-center gap-2 bg-slate-100 rounded-2xl px-3 py-2">
              <div className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center shrink-0">
                <Crown size={15} />
              </div>

              <div className="min-w-0">
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">
                  Usuário conectado
                </p>
                <p className="text-xs font-black text-slate-800 truncate">
                  {currentUser?.name || 'Usuário'}
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-white border-b border-slate-200">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.label}
                    onClick={() => sendQuestion(item.prompt)}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100 hover:bg-orange-100 text-slate-700 hover:text-orange-700 border border-slate-200 hover:border-orange-200 transition-all text-[10px] font-black uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon size={13} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto bg-slate-50 ${isExpanded ? 'px-8 py-6' : 'p-4'} space-y-4`}>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';

              return (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {!isUser && <ClarkAvatar small />}

                  <div
                    className={`${messageMaxClass} rounded-2xl px-4 py-3 text-sm shadow-sm border ${
                      isUser
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-white text-slate-800 border-slate-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed font-medium">
                      {msg.text}
                    </div>

                    <div
                      className={`mt-2 text-[9px] font-black uppercase tracking-widest ${
                        isUser ? 'text-orange-100' : 'text-slate-400'
                      }`}
                    >
                      {msg.createdAt}
                    </div>
                  </div>

                  {isUser && (
                    <div className="w-9 h-9 rounded-2xl bg-orange-600 text-white flex items-center justify-center shrink-0 shadow">
                      <User size={16} />
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2 justify-start">
                <ClarkAvatar small />

                <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-500 flex items-center gap-2 shadow-sm font-bold">
                  <Loader2 size={16} className="animate-spin" />
                  Clark está analisando...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-3 bg-white">
            <div className="flex items-center gap-2 bg-slate-100 rounded-2xl border border-slate-200 px-3 py-2">
              <div className="hidden md:flex w-9 h-9 rounded-xl bg-orange-600 text-white items-center justify-center shrink-0">
                <Sparkles size={16} />
              </div>

              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendQuestion();
                }}
                placeholder="Pergunte à Clark..."
                disabled={loading}
                className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-700 placeholder:text-slate-400 px-1 py-2"
              />

              <button
                onClick={() => sendQuestion()}
                disabled={loading || !input.trim()}
                className="w-10 h-10 rounded-xl bg-slate-900 hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all active:scale-95"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>

            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2 text-center">
              Clark responde usando os dados permitidos para seu usuário.
            </p>
          </div>
        </div>
      )}
    </>
  );
}