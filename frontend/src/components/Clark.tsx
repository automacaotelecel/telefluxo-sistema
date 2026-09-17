import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Send,
  X,
} from "lucide-react";

type ClarkMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  dados?: any;
  perguntaOriginal?: string;
  actions?: Array<{
    type: string;
    label: string;
    payload?: any;
  }>;
};

type ClarkProps = {
  currentUser: any;
  placement?: "floating" | "header";
  onNavigateContracts?: () => void;
  onNavigateOnlinePrices?: () => void;
  onNavigate?: (view: string) => void;
  onOpenStore?: (store: string) => void;
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function respostaVisivelClark(data: any) {
  const clark = String(data?.clark || "").trim();
  if (clark && clark !== "{}" && clark !== "[]") return clark;

  const fallback = String(data?.answer || data?.message || "").trim();
  if (fallback && fallback !== "{}" && fallback !== "[]") return fallback;

  return "Não consegui montar uma resposta segura agora. Nenhum dado foi inventado.";
}

function ClarkAvatar({ small = false }: { small?: boolean }) {
  const iconSize = small ? 22 : 28;

  return (
    <div
      className={`
        relative flex shrink-0 items-center justify-center overflow-hidden
        ${small ? "h-8 w-8 rounded-[11px]" : "h-11 w-11 rounded-[14px]"}
        border border-slate-800 bg-[#07111f]
        shadow-[0_8px_22px_rgba(15,23,42,0.18)]
      `}
      aria-label="Clark IA"
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M18 7.5V10"
          stroke="#CBD5E1"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="18" cy="6.2" r="1.7" fill="#F97316" />

        <rect
          x="9.2"
          y="10.2"
          width="17.6"
          height="15.2"
          rx="5"
          stroke="#F8FAFC"
          strokeWidth="1.7"
        />

        <path
          d="M7.5 15V20.5"
          stroke="#64748B"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M28.5 15V20.5"
          stroke="#64748B"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        <circle cx="14.4" cy="17.1" r="1.65" fill="#F97316" />
        <circle cx="21.6" cy="17.1" r="1.65" fill="#F97316" />

        <path
          d="M14.3 21.3C15.5 22.1 16.7 22.5 18 22.5C19.3 22.5 20.5 22.1 21.7 21.3"
          stroke="#CBD5E1"
          strokeWidth="1.35"
          strokeLinecap="round"
        />

        <path
          d="M13.2 28H22.8"
          stroke="#334155"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M18 25.7V28"
          stroke="#334155"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>

      <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-[#07111f] bg-emerald-500" />
    </div>
  );
}

export default function Clark({
  currentUser,
  placement = "floating",
  onNavigateContracts,
  onNavigateOnlinePrices,
  onNavigate,
  onOpenStore,
}: ClarkProps) {
  const firstName = String(currentUser?.name || "Diretoria")
    .trim()
    .split(/\s+/)[0];

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ClarkMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [excelDownloadingId, setExcelDownloadingId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const addMessage = (
    role: "user" | "assistant",
    text: string,
    extras?: {
      dados?: any;
      perguntaOriginal?: string;
      actions?: Array<{ type: string; label: string; payload?: any }>;
    },
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${Math.random()}`,
        role,
        text,
        dados: extras?.dados,
        perguntaOriginal: extras?.perguntaOriginal,
        actions: extras?.actions,
        createdAt: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
  };

  async function sendQuestion(question?: string) {
    const pergunta = String(question || input).trim();
    if (!pergunta || loading) return;

    setInput("");
    addMessage("user", pergunta);
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/clark/perguntar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser?.id,
          pergunta,
          historico: messages.slice(-12).map((msg) => ({
            role: msg.role,
            text: msg.text,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao consultar a Clark.");
      }

      addMessage("assistant", respostaVisivelClark(data), {
        dados: data?.dados,
        perguntaOriginal: pergunta,
        actions: data?.actions,
      });

      const navigationAction = Array.isArray(data?.actions)
        ? data.actions.find((action: any) =>
            action?.type === "navigate" || action?.type === "open_store"
          )
        : null;

      if (navigationAction) {
        window.setTimeout(() => handleClarkAction(navigationAction), 350);
      }
    } catch (error: any) {
      addMessage(
        "assistant",
        `Não consegui processar sua pergunta agora. Motivo: ${
          error?.message || "erro desconhecido"
        }`,
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  const closeChat = () => {
    setIsOpen(false);
    setIsExpanded(false);
  };

  const handleOpenContracts = () => {
    closeChat();
    onNavigateContracts?.();
  };

  const handleOpenOnlinePrices = () => {
    closeChat();
    onNavigateOnlinePrices?.();
  };

  const handleClarkAction = (action: { type: string; label: string; payload?: any }) => {
    if (action.type === "navigate" && action.payload?.view) {
      closeChat();
      onNavigate?.(String(action.payload.view));
      return;
    }

    if (action.type === "open_store" && action.payload?.store) {
      closeChat();
      if (onOpenStore) {
        onOpenStore(String(action.payload.store));
      } else {
        onNavigate?.("home");
      }
    }
  };

  const baixarExcelRelatorio = async (msg: ClarkMessage) => {
    if (!msg.dados || excelDownloadingId) return;

    try {
      setExcelDownloadingId(msg.id);

      const response = await fetch(`${API_URL}/api/clark/relatorio/excel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: currentUser?.id,
          pergunta: msg.perguntaOriginal || "",
          dados: msg.dados,
        }),
      });

      if (!response.ok) {
        let erro = "Erro ao gerar Excel.";
        try {
          const json = await response.json();
          erro = json?.details || json?.error || erro;
        } catch (_) {}
        throw new Error(erro);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clark-exportacao-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      addMessage(
        "assistant",
        `Não consegui gerar o Excel agora. Motivo: ${
          error?.message || "erro desconhecido"
        }`,
      );
    } finally {
      setExcelDownloadingId(null);
    }
  };

  const panelClass = isExpanded
    ? "fixed inset-3 md:inset-7 z-[9999] bg-white rounded-[26px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
    : "fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[9999] w-[calc(100vw-32px)] md:w-[430px] h-[620px] max-h-[calc(100vh-32px)] bg-white rounded-[26px] shadow-2xl border border-slate-200 overflow-hidden flex flex-col";

  const messageMaxClass = isExpanded ? "max-w-[820px]" : "max-w-[82%]";

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={
            placement === "header"
              ? "relative z-[60] group"
              : "fixed bottom-6 right-6 z-[9999] group"
          }
          title="Abrir Clark"
        >
          <div className="relative">
            <div
              className={
                placement === "header"
                  ? "relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-lg transition-all group-hover:-translate-y-0.5 group-hover:shadow-xl"
                  : "relative flex h-14 w-14 items-center justify-center rounded-[18px] border border-slate-200 bg-white shadow-xl transition-all group-hover:-translate-y-0.5 group-hover:shadow-2xl"
              }
            >
              <ClarkAvatar small />
            </div>
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </div>
        </button>
      )}

      {isOpen && (
        <div className={panelClass}>
          <header className="border-b border-slate-200 bg-white px-4 py-3.5 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ClarkAvatar />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-black tracking-tight text-slate-950">
                      Clark
                    </h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
                    Assistente de IA • TeleFluxo
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                  title={isExpanded ? "Reduzir" : "Expandir"}
                >
                  {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>

                <button
                  onClick={closeChat}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {(onNavigateOnlinePrices || onNavigateContracts) && (
              <div
                className={`mt-3 grid gap-2 ${
                  onNavigateOnlinePrices && onNavigateContracts
                    ? "grid-cols-2"
                    : "grid-cols-1"
                }`}
              >
                {onNavigateOnlinePrices && (
                  <button
                    onClick={handleOpenOnlinePrices}
                    className="group flex h-10 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 text-[11px] font-bold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100"
                    title="Abrir Preços Online"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-orange-600 shadow-sm ring-1 ring-orange-100 transition group-hover:scale-105">
                      <FileSpreadsheet size={13} />
                    </span>
                    <span>Preços Online</span>
                  </button>
                )}

                {onNavigateContracts && (
                  <button
                    onClick={handleOpenContracts}
                    className="group flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                    title="Abrir Contratos"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition group-hover:scale-105">
                      <FileText size={13} />
                    </span>
                    <span>Contratos</span>
                  </button>
                )}
              </div>
            )}
          </header>

          <div
            className={`flex-1 overflow-y-auto bg-[#f8fafc] ${
              isExpanded ? "px-7 py-7" : "px-4 py-5"
            }`}
          >
            {messages.length === 0 && (
              <div className={`${isExpanded ? "mx-auto max-w-[820px]" : ""}`}>
                <div className="flex items-start gap-3">
                  <ClarkAvatar small />
                  <div>
                    <p className="text-[15px] font-bold leading-relaxed text-slate-900">
                      Bom dia, {firstName}. Como posso te ajudar hoje?
                    </p>
                    <p className="mt-1 text-[12px] font-medium leading-relaxed text-slate-500">
                      Pergunte naturalmente sobre vendas, estoque, lojas, vendedores, produtos ou relatórios. Também posso abrir telas do TeleFluxo para você.
                    </p>
                  </div>
                </div>

              </div>
            )}

            <div className={`${isExpanded ? "mx-auto max-w-[920px]" : ""} space-y-4`}>
              {messages.map((msg) => {
                const isUser = msg.role === "user";

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && <ClarkAvatar small />}

                    <div
                      className={`${messageMaxClass} rounded-[18px] px-4 py-3 text-sm ${
                        isUser
                          ? "bg-slate-950 text-white"
                          : "border border-slate-200 bg-white text-slate-800 shadow-sm"
                      }`}
                    >
                      <div className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed">
                        {msg.text}
                      </div>

                      {!isUser &&
                        msg.actions?.some((action) => action.type === "download_excel") && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {msg.actions
                              .filter((action) => action.type === "download_excel")
                              .map((action, index) => (
                                <button
                                  key={`${msg.id}-${action.type}-${index}`}
                                  onClick={() => baixarExcelRelatorio(msg)}
                                  disabled={excelDownloadingId === msg.id}
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                                >
                                  {excelDownloadingId === msg.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Download size={13} />
                                  )}
                                  {excelDownloadingId === msg.id
                                    ? "Gerando..."
                                    : action.label || "Baixar Excel"}
                                </button>
                              ))}
                          </div>
                        )}

                      {!isUser &&
                        msg.actions?.some((action) => action.type === "navigate" || action.type === "open_store") && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {msg.actions
                              .filter((action) => action.type === "navigate" || action.type === "open_store")
                              .map((action, index) => (
                                <button
                                  key={`${msg.id}-${action.type}-${index}`}
                                  onClick={() => handleClarkAction(action)}
                                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-bold text-white transition hover:bg-orange-600"
                                >
                                  {action.label || "Abrir"}
                                </button>
                              ))}
                          </div>
                        )}

                      <div
                        className={`mt-2 text-[8px] font-semibold ${
                          isUser ? "text-slate-400" : "text-slate-300"
                        }`}
                      >
                        {msg.createdAt}
                      </div>
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex gap-2.5">
                  <ClarkAvatar small />
                  <div className="flex items-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500 shadow-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Analisando...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <footer className="border-t border-slate-200 bg-white p-3 md:px-4 md:py-3.5">
            <div className="flex items-center gap-2 rounded-[18px] border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-100">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendQuestion();
                }}
                placeholder="Pergunte à Clark..."
                disabled={loading}
                className="min-h-10 flex-1 bg-transparent px-2 py-2 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />

              <button
                onClick={() => sendQuestion()}
                disabled={loading || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-slate-950 text-white transition hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {loading ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Send size={17} />
                )}
              </button>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}
