import { useEffect, useMemo, useRef, useState } from "react";
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
  Download,
  Brain,
  Trash2,
  FileSpreadsheet,
  FileText, // Importado para o ícone de contratos
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
  }>;
};

type ClarkProps = {
  currentUser: any;
  placement?: "floating" | "header";
  onNavigateContracts?: () => void; // Navega para o leitor de contratos
  onNavigateOnlinePrices?: () => void; // Navega para o agente Preços Online
};

type ClarkMemoryState = {
  userId: string;
  lastProduct: string | null;
  lastStore: string | null;
  lastPeriodStart: string | null;
  lastPeriodEnd: string | null;
  lastPeriodLabel: string | null;
  lastIntent: string | null;
  lastTool: string | null;
  lastQuestion: string | null;
  lastAnswerSummary: string | null;
  interactionCount: number;
  updatedAt: string | null;
};

type QuickAction =
  | "buscar_produto"
  | "vendas_periodo"
  | "vendas_por_loja"
  | "seguros_vendedores"
  | "relatorio_executivo"
  | "analise_produto"
  | "modo_diretoria";

type QuickSuggestion = {
  label: string;
  icon: any;
  prompt?: string;
  action?: QuickAction;
  assistantMessage?: string;
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
  const sizeClass = small ? "w-9 h-9" : "w-14 h-14";

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

export default function Clark({ currentUser, placement = "floating", onNavigateContracts, onNavigateOnlinePrices }: ClarkProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [messages, setMessages] = useState<ClarkMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: 'Olá, eu sou a Clark. Posso te ajudar com perguntas sobre vendas, lojas, vendedores, categorias e estoque. Comece perguntando: "Quanto vendemos hoje?"',
      createdAt: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<QuickAction | null>(null);
  const [excelDownloadingId, setExcelDownloadingId] = useState<string | null>(null);
  const [memory, setMemory] = useState<ClarkMemoryState | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregarMemoriaClark = async () => {
    const userId = String(currentUser?.id || "").trim();
    if (!userId) return;

    try {
      setMemoryLoading(true);
      const response = await fetch(
        `${API_URL}/api/clark/memory?userId=${encodeURIComponent(userId)}`,
      );

      const data = await response.json();

      if (response.ok) {
        setMemory(data?.memory || null);
      }
    } catch (error) {
      console.warn("Não foi possível carregar a memória da Clark:", error);
    } finally {
      setMemoryLoading(false);
    }
  };

  const limparMemoriaClark = async () => {
    const userId = String(currentUser?.id || "").trim();
    if (!userId || loading) return;

    try {
      setMemoryLoading(true);
      const response = await fetch(
        `${API_URL}/api/clark/memory?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Erro ao limpar memória.");
      }

      setMemory(null);
      addMessage(
        "assistant",
        "Memória de contexto limpa. A partir de agora, não vou usar o produto, loja ou período anterior para completar perguntas curtas.",
      );
    } catch (error: any) {
      addMessage(
        "assistant",
        `Não consegui limpar a memória agora. Motivo: ${
          error?.message || "erro desconhecido"
        }`,
      );
    } finally {
      setMemoryLoading(false);
    }
  };

  const gerarRelatorioExecutivoRapido = async () => {
    if (loading) return;
    await sendQuestion(
      "Modo diretoria: gere um relatório executivo da operação este mês, com vendas, estoque, seguros, alertas, riscos e ações recomendadas. Ao final, disponibilize Excel.",
    );
  };

  useEffect(() => {
    if (isOpen) {
      carregarMemoriaClark();
    }
  }, [isOpen, currentUser?.id]);

  const suggestions = useMemo<QuickSuggestion[]>(
    () => [
      {
        label: "Buscar produto",
        action: "buscar_produto",
        assistantMessage:
          "Qual produto você deseja buscar? Pode escrever do seu jeito. Exemplo: Galaxy A56 128GB Preto.",
        icon: Package,
      },
      {
        label: "Analisar produto",
        action: "analise_produto",
        assistantMessage:
          "Qual produto você deseja analisar? Exemplo: Galaxy A56. Eu vou cruzar estoque, vendas, giro, excesso, ruptura e redistribuição.",
        icon: Sparkles,
      },
      {
        label: "Modo diretoria",
        action: "modo_diretoria",
        assistantMessage:
          "Qual período você deseja analisar no modo diretoria? Exemplo: este mês ou 01/05/2026 até 10/05/2026.",
        icon: Crown,
      },
      {
        label: "Vendas período",
        action: "vendas_periodo",
        assistantMessage:
          "Qual período você deseja consultar? Exemplo: 25/03/2026 até 04/04/2026.",
        icon: CalendarDays,
      },
      {
        label: "Vendas por loja",
        action: "vendas_por_loja",
        assistantMessage:
          "Qual período você deseja consultar para listar as vendas por loja? Exemplo: 25/03/2026 até 04/04/2026.",
        icon: Building2,
      },
      {
        label: "Seguros vendedores",
        action: "seguros_vendedores",
        assistantMessage:
          "Qual período você deseja consultar para ranking de seguros por vendedor? Exemplo: este mês ou 25/03/2026 até 04/04/2026.",
        icon: Users,
      },
      {
        label: "Top smartphones",
        prompt:
          "Liste os 5 maiores modelos da categoria SMARTPHONES em estoque e quais lojas estão.",
        icon: Package,
      },
      {
        label: "Relatório executivo",
        action: "relatorio_executivo",
        assistantMessage:
          "Qual período você deseja usar no relatório executivo de vendas, estoque e seguros? Exemplo: 25/03/2026 até 04/04/2026.",
        icon: TrendingUp,
      },
    ],
    [],
  );

  const addMessage = (
  role: "user" | "assistant",
  text: string,
  extras?: {
        dados?: any;
        perguntaOriginal?: string;
        actions?: Array<{ type: string; label: string }>;
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

  const montarPerguntaDaAcaoRapida = (
    action: QuickAction,
    respostaUsuario: string,
  ) => {
    const texto = respostaUsuario.trim();

    switch (action) {
      case "buscar_produto":
        return `Me liste as lojas que têm "${texto}" em estoque na categoria SMARTPHONES.`;

      case "vendas_periodo":
        return `Vendas de ${texto}. Traga um resumo executivo com total vendido, peças vendidas e ticket médio.`;

      case "vendas_por_loja":
        return `Vendas de ${texto} e me liste as lojas e o valor de cada uma.`;

      case "seguros_vendedores":
        return `Me liste o top 5 vendedores com maior venda de seguros no período ${texto}.`;

      case "relatorio_executivo":
        return `Me faça um relatório executivo de vendas, estoque e seguros de ${texto}. Ao final, disponibilize a opção de baixar em Excel.`;

      case "analise_produto":
        return `Analise comercialmente o produto ${texto}. Cruze estoque atual, vendas do período, giro, cobertura, risco de ruptura, excesso e sugestões de redistribuição.`;

      case "modo_diretoria":
        return `Modo diretoria: me dê um resumo executivo da operação no período ${texto}, com vendas, estoque, pontos de atenção e ações recomendadas.`;

      default:
        return texto;
    }
  };

  const handleQuickSuggestion = (item: QuickSuggestion) => {
    if (loading) return;

    if (item.action) {
      setPendingAction(item.action);
      addMessage(
        "assistant",
        item.assistantMessage || "Me diga o que você deseja consultar.",
      );
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    if (item.prompt) {
      sendQuestion(item.prompt);
    }
  };

  async function sendQuestion(question?: string) {
    const perguntaDigitada = String(question || input).trim();

    if (!perguntaDigitada || loading) return;

    const acaoPendente = pendingAction;
    const pergunta = acaoPendente
      ? montarPerguntaDaAcaoRapida(acaoPendente, perguntaDigitada)
      : perguntaDigitada;

    setInput("");
    setPendingAction(null);
    addMessage("user", perguntaDigitada);
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
          historico: messages
            .filter((msg) => msg.id !== "welcome")
            .slice(-12)
            .map((msg) => ({
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

      const memoryAfter = data?.dados?.brain?.memoryAfter;
      if (memoryAfter) {
        setMemory(memoryAfter);
      } else {
        carregarMemoriaClark();
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
    closeChat(); // Fecha o modal da Clark atual
    if (onNavigateContracts) {
      onNavigateContracts(); // Navega para a tela de contratos
    }
  };

  const handleOpenOnlinePrices = () => {
    closeChat();
    if (onNavigateOnlinePrices) {
      onNavigateOnlinePrices();
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
    ? "fixed inset-3 md:inset-8 z-[9999] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
    : "fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[9999] w-[calc(100vw-32px)] md:w-[430px] h-[620px] max-h-[calc(100vh-32px)] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col";

  const messageMaxClass = isExpanded ? "max-w-[900px]" : "max-w-[78%]";

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            carregarMemoriaClark();
            setTimeout(() => inputRef.current?.focus(), 150);
          }}
          className={
            placement === "header"
              ? "relative z-[60] group"
              : "fixed bottom-6 right-6 z-[9999] group"
          }
          title="Abrir Clark IA"
        >
          <div className="relative">
            <div
              className={
                placement === "header"
                  ? "absolute inset-0 rounded-full bg-orange-500 blur-md opacity-30 group-hover:opacity-60 transition-opacity"
                  : "absolute inset-0 rounded-full bg-orange-500 blur-xl opacity-50 group-hover:opacity-80 transition-opacity"
              }
            />

            <div
              className={
                placement === "header"
                  ? "relative w-11 h-11 rounded-2xl bg-slate-950 text-white shadow border border-orange-400/30 flex items-center justify-center hover:scale-105 transition-transform"
                  : "relative w-16 h-16 rounded-full bg-slate-950 text-white shadow-2xl border border-orange-400/30 flex items-center justify-center hover:scale-105 transition-transform"
              }
            >
              <ClarkAvatar small />
            </div>

            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-orange-600 text-white flex items-center justify-center border-2 border-white shadow-lg">
              <MessageCircle size={11} />
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
              
              {onNavigateOnlinePrices && (
                <button
                  onClick={handleOpenOnlinePrices}
                  className="hidden md:flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-800 hover:bg-orange-600 text-[10px] font-black tracking-widest uppercase transition-colors"
                  title="Abrir agente Preços Online"
                >
                  <FileSpreadsheet size={13} />
                  Preços Online
                </button>
              )}

              {onNavigateContracts && (
                <button
                  onClick={handleOpenContracts}
                  className="hidden md:flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-800 hover:bg-emerald-600 text-[10px] font-black tracking-widest uppercase transition-colors"
                  title="Abrir Leitor de Contratos"
                >
                  <FileText size={13} />
                  Ler Contratos
                </button>
              )}

              <button
                onClick={() => setIsExpanded((prev) => !prev)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-orange-600 flex items-center justify-center transition-colors"
                title={isExpanded ? "Reduzir chat" : "Expandir chat"}
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
                  {currentUser?.name || "Usuário"}
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 bg-white border-b border-slate-200">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <Brain size={15} />
                  </div>

                  <div className="min-w-0">
                    <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">
                      Memória executiva
                    </p>
                    <p className="text-xs font-black text-slate-800 truncate">
                      {memory?.lastProduct || memory?.lastStore || memory?.lastPeriodLabel
                        ? [memory?.lastProduct, memory?.lastStore, memory?.lastPeriodLabel]
                            .filter(Boolean)
                            .join(" • ")
                        : memoryLoading
                          ? "Carregando contexto..."
                          : "Sem contexto salvo ainda"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={gerarRelatorioExecutivoRapido}
                    disabled={loading}
                    className="hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white text-[10px] font-black uppercase transition-colors"
                    title="Gerar relatório executivo este mês"
                  >
                    <FileSpreadsheet size={13} />
                    Relatório
                  </button>

                  <button
                    onClick={limparMemoriaClark}
                    disabled={loading || memoryLoading || !memory}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 hover:text-red-600 border border-slate-200 transition-colors"
                    title="Limpar memória da Clark"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {memory?.lastAnswerSummary && (
                <p className="text-[10px] leading-relaxed text-slate-500 font-semibold line-clamp-2">
                  Última resposta: {memory.lastAnswerSummary}
                </p>
              )}
            </div>
          </div>

          <div className="px-4 py-3 bg-white border-b border-slate-200">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.label}
                    onClick={() => handleQuickSuggestion(item)}
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

          <div
            className={`flex-1 overflow-y-auto bg-slate-50 ${isExpanded ? "px-8 py-6" : "p-4"} space-y-4`}
          >
            {messages.map((msg) => {
              const isUser = msg.role === "user";

              return (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isUser && <ClarkAvatar small />}

                  <div
                    className={`${messageMaxClass} rounded-2xl px-4 py-3 text-sm shadow-sm border ${
                      isUser
                        ? "bg-orange-600 text-white border-orange-600"
                        : "bg-white text-slate-800 border-slate-200"
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed font-medium">
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
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase transition-colors"
                              >
                                {excelDownloadingId === msg.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Download size={14} />
                                )}
                                {excelDownloadingId === msg.id
                                  ? "Gerando Excel..."
                                  : action.label || "Baixar Excel"}
                              </button>
                            ))}
                        </div>
                      )}

                    <div
                      className={`mt-2 text-[9px] font-black uppercase tracking-widest ${
                        isUser ? "text-orange-100" : "text-slate-400"
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
                  if (e.key === "Enter") sendQuestion();
                }}
                placeholder={
                  pendingAction
                    ? "Responda à pergunta da Clark..."
                    : "Pergunte à Clark..."
                }
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
              Clark usa dados reais, respeita permissões e lembra o último contexto para perguntas curtas.
            </p>
          </div>
        </div>
      )}
    </>
  );
}