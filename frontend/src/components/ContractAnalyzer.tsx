import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Send, Bot, User, Loader2, FileCheck, X, AlertCircle } from 'lucide-react';


interface ContractAnalyzerProps {
  currentUser?: any;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'ia';
  text: string;
}

export default function ContractAnalyzer({ currentUser }: ContractAnalyzerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Faz o scroll automático para a última mensagem do chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isLoading]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
        setChatHistory([]); // Limpa o chat ao trocar de contrato
      } else {
        alert('Por favor, envie apenas arquivos PDF.');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setFile(selectedFile);
        setChatHistory([]);
      } else {
        alert('Por favor, envie apenas arquivos PDF.');
      }
    }
  };

  const clearFile = () => {
    setFile(null);
    setChatHistory([]);
    setQuestion('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      alert('Por favor, envie um contrato em PDF primeiro.');
      return;
    }

    if (!question.trim()) return;

    const currentQuestion = question.trim();
    setQuestion('');
    
    // Adiciona a pergunta do usuário no chat
    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { id: Date.now().toString(), role: 'user', text: currentQuestion }
    ];
    setChatHistory(newHistory);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('question', currentQuestion);

      // Chamada para a rota que criamos no backend
      const response = await fetch(`http://localhost:3000/api/contracts/analyze`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao analisar o contrato.');
      }

      setChatHistory([
        ...newHistory,
        { id: (Date.now() + 1).toString(), role: 'ia', text: data.answer }
      ]);

    } catch (error: any) {
      console.error(error);
      setChatHistory([
        ...newHistory,
        { 
          id: (Date.now() + 1).toString(), 
          role: 'ia', 
          text: `⚠️ Desculpe, ocorreu um erro: ${error.message}` 
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-slate-50 overflow-hidden">
      
      {/* LADO ESQUERDO: UPLOAD DO ARQUIVO */}
      <div className="w-full md:w-[380px] lg:w-[420px] bg-white border-r border-slate-200 flex flex-col shrink-0 p-6 shadow-sm z-10">
        <div className="mb-6">
          <h2 className="text-xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
            <FileText className="text-orange-600" size={24} />
            Clark Jurídica
          </h2>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            Análise Inteligente de Contratos
          </p>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          {!file ? (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 group
                ${dragActive ? 'border-orange-500 bg-orange-50' : 'border-slate-300 hover:border-orange-400 hover:bg-slate-50'}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${dragActive ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500 group-hover:bg-orange-100 group-hover:text-orange-500'}`}>
                <UploadCloud size={32} />
              </div>
              <p className="text-sm font-bold text-slate-700 mb-2">
                Arraste seu contrato PDF aqui
              </p>
              <p className="text-xs text-slate-400 font-medium">
                Ou clique para procurar no computador
              </p>
              
              <div className="mt-6 flex items-start gap-2 bg-blue-50 text-blue-800 p-3 rounded-xl text-left border border-blue-100">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed font-semibold">
                  O documento é processado 100% em memória RAM segura e descartado imediatamente após a leitura. Nenhum dado é treinado ou armazenado no banco.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 flex flex-col items-center text-center relative shadow-sm">
              <button
                onClick={clearFile}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-full text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors shadow-sm"
                title="Remover arquivo"
              >
                <X size={16} />
              </button>

              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 ring-8 ring-emerald-50">
                <FileCheck size={40} />
              </div>
              <p className="text-xs font-black uppercase tracking-widest text-emerald-600 mb-1">
                Arquivo Carregado
              </p>
              <p className="text-sm font-bold text-slate-800 truncate w-full max-w-[280px]">
                {file.name}
              </p>
              <p className="text-xs text-slate-400 font-medium mt-1">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>

              <div className="w-full h-px bg-slate-200 my-6"></div>

              <p className="text-xs text-slate-500 font-medium">
                A IA já leu este documento. Você pode começar a fazer perguntas no chat ao lado.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* LADO DIREITO: CHAT */}
      <div className="flex-1 flex flex-col bg-slate-50 h-full relative">
        {/* Header do Chat */}
        <div className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center px-6 shrink-0 z-10">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-3"></div>
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight">
            Consultoria Ativa
          </h3>
        </div>

        {/* Área de Mensagens */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
          
          {chatHistory.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <Bot size={48} className="mb-4 text-slate-300 opacity-50" />
              <p className="text-lg font-bold text-slate-600 mb-2">Pronta para analisar.</p>
              <p className="text-sm max-w-md leading-relaxed">
                Faça o upload do contrato ao lado e me pergunte sobre cláusulas de rescisão, índices de reajuste, responsabilidades ou prazos.
              </p>
            </div>
          )}

          {chatHistory.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 max-w-[85%] ${
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-900 text-white'
                }`}
              >
                {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
              </div>

              <div
                className={`p-4 rounded-2xl shadow-sm text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-orange-600 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none whitespace-pre-wrap'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4 max-w-[85%]">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot size={20} />
              </div>
              <div className="p-4 rounded-2xl bg-white border border-slate-200 text-slate-500 rounded-tl-none flex items-center gap-3 shadow-sm">
                <Loader2 size={16} className="animate-spin text-orange-500" />
                <span className="text-xs font-bold uppercase tracking-widest">Analisando documento...</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input de Mensagem */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-3 max-w-4xl mx-auto relative"
          >
            <textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={file ? "Qual a multa por rescisão antecipada?" : "Faça o upload do PDF primeiro..."}
              disabled={!file || isLoading}
              className="flex-1 resize-none rounded-2xl border border-slate-300 p-4 pr-16 bg-slate-50 focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed custom-scrollbar"
            />
            <button
              type="submit"
              disabled={!file || !question.trim() || isLoading}
              className="absolute right-3 bottom-3 w-10 h-10 bg-orange-600 text-white rounded-xl flex items-center justify-center hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:hover:bg-orange-600 shadow-md active:scale-95"
            >
              <Send size={18} className="ml-1" />
            </button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[10px] text-slate-400 font-medium">
              Pressione <strong>Enter</strong> para enviar ou <strong>Shift + Enter</strong> para quebrar linha.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}