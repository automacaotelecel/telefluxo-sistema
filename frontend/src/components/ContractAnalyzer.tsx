import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, BookOpenText, CheckCircle2, ChevronRight, Copy,
  FileSearch, FileText, Files, Info, Loader2, Scale, Send,
  ShieldCheck, Sparkles, Trash2, UploadCloud, UserRound, X,
} from 'lucide-react';

interface ContractAnalyzerProps {
  currentUser?: any;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'ia';
  text: string;
  error?: boolean;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_QUESTION_CHARS = 2500;

const EXAMPLE_QUESTIONS = [
  'Compare as cláusulas de rescisão e as multas dos contratos.',
  'Quais são os prazos de vigência e as condições de renovação?',
  'Identifique os valores, reajustes e obrigações de cada parte.',
  'Quais cláusulas merecem atenção da diretoria?',
];

function usuarioPodeUsarClarkJuridica(currentUser: any) {
  const role = String(currentUser?.role || '').trim().toUpperCase();
  const isAdmin = currentUser?.isAdmin === true || Number(currentUser?.isAdmin) === 1;
  return role === 'ADM' || role === 'ADMIN' || isAdmin;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Exibe apenas Markdown seguro (sem HTML nem links automáticos).
// Evita dependências novas para não afetar o restante do TeleFluxo.
function inlineMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index} className="font-extrabold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-slate-800">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(row: string) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((value) => value.trim());
}

function startsBlock(line: string) {
  const t = line.trim();
  return /^#{1,3}\s/.test(t) || /^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t) || /^>\s/.test(t) || t.startsWith('```');
}

function RichAnswer({ text }: { text: string }) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 key={i} className="mb-2 mt-5 border-b border-slate-100 pb-2 text-[15px] font-black text-slate-900 first:mt-0">
        {inlineMarkdown(heading[2])}
      </h3>);
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const tableRows: string[][] = [];
      const start = i;
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        tableRows.push(splitTableRow(lines[i]));
        i++;
      }
      nodes.push(
        <div key={start} className="my-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse text-left text-[13px] leading-relaxed">
            <thead className="bg-slate-900 text-white"><tr>{header.map((value, c) =>
              <th key={c} className="whitespace-normal border-r border-slate-700 px-3.5 py-3 text-[12px] font-extrabold last:border-0">{value}</th>
            )}</tr></thead>
            <tbody>{tableRows.map((cells, r) =>
              <tr key={r} className="border-t border-slate-200 even:bg-slate-50">
                {header.map((_, c) => <td key={c} className="min-w-[110px] border-r border-slate-100 px-3.5 py-3 align-top last:border-r-0">{inlineMarkdown(cells[c] || '—')}</td>)}
              </tr>
            )}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*•]\s/.test(line) || /^\d+[.)]\s/.test(line)) {
      const ordered = /^\d+[.)]\s/.test(line);
      const entries: Array<{ content: string; indent: number }> = [];
      const start = i;
      while (i < lines.length && (/^\s*[-*•]\s/.test(lines[i]) || /^\s*\d+[.)]\s/.test(lines[i]))) {
        const original = lines[i];
        entries.push({ content: original.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim(), indent: (original.match(/^\s*/) || [''])[0].length });
        i++;
      }
      const tagClasses = 'my-3 space-y-2 pl-5 text-[14px] leading-7 text-slate-700 marker:font-black marker:text-orange-600';
      const listItems = entries.map((entry, j) => <li key={j} style={{ marginLeft: Math.min(entry.indent, 12) * 4 }} className="pl-1.5">{inlineMarkdown(entry.content)}</li>);
      nodes.push(ordered ? <ol key={start} className={`${tagClasses} list-decimal`}>{listItems}</ol> : <ul key={start} className={`${tagClasses} list-disc`}>{listItems}</ul>);
      continue;
    }

    if (/^>\s/.test(line)) {
      const quote = line.replace(/^>\s*/, '');
      nodes.push(<blockquote key={i} className="my-3 border-l-4 border-orange-400 bg-orange-50/60 px-4 py-3 text-[14px] italic text-slate-700">{inlineMarkdown(quote)}</blockquote>);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const code: string[] = [];
      const start = i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={start} className="my-3 overflow-auto rounded-lg bg-slate-900 p-4 text-[12px] text-slate-100"><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const paragraph: string[] = [line];
    const start = i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))) {
      paragraph.push(lines[i++].trim());
    }
    nodes.push(<p key={start} className="mb-3 text-[14px] leading-[1.85] text-slate-700 last:mb-0">{inlineMarkdown(paragraph.join(' '))}</p>);
  }
  return <div className="max-w-none break-words">{nodes}</div>;
}

export default function ContractAnalyzer({ currentUser }: ContractAnalyzerProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const hasFiles = files.length > 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatHistory, isLoading]);

  const addFiles = (incoming: File[]) => {
    if (isLoading || !incoming.length) return;
    setError('');
    const next = [...files];
    for (const item of incoming) {
      if (!/\.pdf$/i.test(item.name) || (item.type && item.type !== 'application/pdf')) {
        setError(`"${item.name}" não é um PDF válido.`);
        continue;
      }
      if (item.size > MAX_FILE_BYTES) {
        setError(`"${item.name}" excede o limite de 10 MB por contrato.`);
        continue;
      }
      if (next.some((file) => file.name.toLowerCase() === item.name.toLowerCase())) {
        setError(`Já existe um contrato chamado "${item.name}". Renomeie o arquivo para diferenciá-lo.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        setError(`Limite de ${MAX_FILES} contratos por análise atingido.`);
        break;
      }
      if (next.reduce((sum, file) => sum + file.size, 0) + item.size > MAX_TOTAL_BYTES) {
        setError('O conjunto de PDFs não pode ultrapassar 30 MB.');
        break;
      }
      next.push(item);
    }
    if (next.length !== files.length) {
      setFiles(next);
      // Evita continuar uma conversa cujas fontes foram substituídas.
      setChatHistory([]);
    }
  };

  const removeFile = (index: number) => {
    if (isLoading) return;
    setFiles((existing) => existing.filter((_, i) => i !== index));
    setChatHistory([]);
    setError('');
  };

  const clearFiles = () => {
    if (isLoading) return;
    setFiles([]);
    setChatHistory([]);
    setQuestion('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files || []));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasFiles || isLoading || !question.trim()) return;
    const currentQuestion = question.trim();
    if (currentQuestion.length > MAX_QUESTION_CHARS) {
      setError(`A pergunta pode ter no máximo ${MAX_QUESTION_CHARS} caracteres.`);
      return;
    }
    const userMessage: ChatMessage = { id: `${Date.now()}-u`, role: 'user', text: currentQuestion };
    const currentHistory = [...chatHistory, userMessage];
    setChatHistory(currentHistory);
    setQuestion('');
    setError('');
    setIsLoading(true);

    try {
      const formData = new FormData();
      for (const file of files) formData.append('pdfs', file, file.name);
      formData.append('question', currentQuestion);
      formData.append('userId', String(currentUser?.id || ''));
      const historyPayload = chatHistory
        .filter((message) => !message.error)
        .slice(-6)
        .map((message) => ({
          role: message.role === 'ia' ? 'assistant' : 'user',
          text: message.text.slice(0, 1800),
        }));
      formData.append('history', JSON.stringify(historyPayload));

      const response = await fetch(`${API_URL}/api/contracts/analyze`, { method: 'POST', body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Não foi possível analisar os documentos (HTTP ${response.status}).`);
      }
      const answer = String(data.answer || '').trim();
      if (!answer) throw new Error('A IA não retornou uma resposta válida.');
      setChatHistory([...currentHistory, { id: `${Date.now()}-a`, role: 'ia', text: answer }]);
    } catch (caught: any) {
      const message = String(caught?.message || 'Falha inesperada ao analisar os documentos.');
      setChatHistory([...currentHistory, {
        id: `${Date.now()}-error`, role: 'ia', text: message, error: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const copyAnswer = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
    } catch {
      setError('Não foi possível copiar o texto automaticamente.');
    }
  };

  if (!usuarioPodeUsarClarkJuridica(currentUser)) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-8">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-4 text-orange-600" size={36} />
          <h2 className="text-lg font-black text-slate-800">Acesso restrito</h2>
          <p className="mt-2 text-sm text-slate-500">A Clark Jurídica está disponível somente para usuários autorizados.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f5f7fb] lg:flex-row">
      {/* Painel dos documentos */}
      <aside className="flex max-h-[46vh] w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-[350px] lg:border-b-0 lg:border-r xl:w-[390px]">
        <div className="border-b border-slate-100 px-5 py-5 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-orange-400 shadow-sm"><Scale size={22} /></div>
            <div>
              <h2 className="text-[19px] font-black tracking-tight text-slate-900">Clark Jurídica</h2>
              <p className="text-[12px] font-medium text-slate-500">Leitura e comparação de contratos</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 lg:p-6">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-extrabold text-slate-800">Documentos da análise</h3>
              <p className="text-[12px] text-slate-500">Até {MAX_FILES} PDFs por consulta</p>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-[12px] font-extrabold text-orange-700">{files.length}/{MAX_FILES}</span>
          </div>

          <div
            onDragEnter={(event) => { event.preventDefault(); if (!isLoading) setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); if (!isLoading) setDragActive(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
            onDrop={handleDrop}
            onClick={(event) => { if (event.target !== fileInputRef.current && !isLoading && files.length < MAX_FILES) fileInputRef.current?.click(); }}
            role="button"
            tabIndex={isLoading || files.length >= MAX_FILES ? -1 : 0}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !isLoading) { event.preventDefault(); fileInputRef.current?.click(); } }}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-400 ${dragActive ? 'border-orange-500 bg-orange-50' : 'border-slate-300 bg-slate-50/80 hover:border-orange-400 hover:bg-orange-50/40'} ${isLoading || files.length >= MAX_FILES ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple
              disabled={isLoading || files.length >= MAX_FILES}
              className="hidden"
              onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }}
            />
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-orange-600 shadow-sm"><UploadCloud size={25} /></div>
            <span className="text-[13px] font-extrabold text-slate-800">{files.length ? 'Adicionar mais contratos' : 'Selecionar contratos em PDF'}</span>
            <span className="mt-1 text-[12px] leading-5 text-slate-500">Clique ou arraste vários arquivos aqui</span>
            <span className="mt-2 text-[11px] text-slate-400">Até 10 MB por PDF · 30 MB no total</span>
          </div>

          {error && (
            <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] font-medium text-rose-800">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} title="Fechar aviso"><X size={15} /></button>
            </div>
          )}

          {hasFiles && (
            <section className="space-y-2" aria-label="Contratos selecionados">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-slate-600">{files.length} {files.length === 1 ? 'arquivo selecionado' : 'arquivos selecionados'} · {formatSize(totalBytes)}</span>
                <button type="button" onClick={clearFiles} disabled={isLoading} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-rose-600 disabled:opacity-50"><Trash2 size={12} /> Limpar</button>
              </div>
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_6px_rgba(15,23,42,.03)]">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><FileText size={19} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-extrabold text-slate-800" title={file.name}><span className="mr-1.5 text-orange-600">{index + 1}.</span>{file.name}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><CheckCircle2 size={12} className="text-emerald-600" /> {formatSize(file.size)} · Selecionado</div>
                  </div>
                  <button type="button" disabled={isLoading} onClick={() => removeFile(index)} title={`Remover ${file.name}`} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><X size={17} /></button>
                </div>
              ))}
            </section>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-[12px] font-extrabold text-slate-700">Processamento temporário</p>
                <p className="mt-1 text-[11px] leading-[1.65] text-slate-500">Os PDFs são enviados para análise pela IA e processados em memória no backend; esta tela não os salva no banco. PDFs digitalizados sem texto selecionável precisam de OCR.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden border-t border-slate-100 bg-white px-5 py-4 lg:block">
          <div className="flex items-center gap-2 text-[11px] text-slate-500"><Info size={14} /> A análise documental não substitui revisão jurídica.</div>
        </div>
      </aside>

      {/* Conversa */}
      <main className="flex min-h-[470px] min-w-0 flex-1 flex-col">
        <header className="flex min-h-[74px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><BookOpenText size={20} /></div>
            <div>
              <h3 className="text-[15px] font-black text-slate-900">Análise documental</h3>
              <p className="text-[12px] text-slate-500">Respostas fundamentadas nos arquivos selecionados</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ${hasFiles ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            <span className={`h-2 w-2 rounded-full ${hasFiles ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {hasFiles ? `${files.length} ${files.length === 1 ? 'contrato selecionado' : 'contratos selecionados'}` : 'Aguardando PDFs'}
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-7 sm:px-6 lg:px-8" aria-label="Conversa com a Clark Jurídica">
          {chatHistory.length === 0 && (
            <div className="mx-auto flex h-full max-w-[650px] flex-col items-center justify-center py-8 text-center">
              <div className="relative mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-3xl border border-orange-100 bg-white text-orange-500 shadow-sm">
                <FileSearch size={34} /><Sparkles size={18} className="absolute -right-2 -top-2 text-orange-500" />
              </div>
              <h2 className="text-[23px] font-black tracking-tight text-slate-900">Análises mais claras, decisões melhores.</h2>
              <p className="mt-3 max-w-[500px] text-[14px] leading-7 text-slate-500">{hasFiles
                ? 'Documentos selecionados. Faça uma pergunta sobre um contrato ou compare cláusulas entre todos eles.'
                : 'Adicione um ou mais contratos em PDF para identificar cláusulas, comparar condições e consultar prazos, multas e responsabilidades.'}</p>
              <div className="mt-7 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button key={example} type="button" disabled={!hasFiles || isLoading}
                    onClick={() => { setQuestion(example); textareaRef.current?.focus(); }}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left text-[12px] font-semibold leading-[1.65] text-slate-700 shadow-sm transition-all hover:border-orange-300 hover:bg-orange-50/30 disabled:cursor-not-allowed disabled:opacity-50">
                    <span>{example}</span><ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-orange-600" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatHistory.map((message) => message.role === 'user' ? (
            <div key={message.id} className="mx-auto flex max-w-[940px] justify-end gap-3">
              <div className="max-w-[83%] rounded-2xl rounded-tr-sm bg-orange-600 px-5 py-3.5 text-[14px] font-medium leading-7 text-white shadow-sm whitespace-pre-wrap">{message.text}</div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700"><UserRound size={18} /></div>
            </div>
          ) : (
            <article key={message.id} className={`mx-auto max-w-[940px] rounded-2xl border bg-white shadow-[0_3px_18px_rgba(15,23,42,.04)] ${message.error ? 'border-rose-200' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${message.error ? 'bg-rose-50 text-rose-600' : 'bg-slate-900 text-orange-400'}`}>{message.error ? <AlertCircle size={17} /> : <Scale size={17} />}</div>
                  <div><span className="block text-[13px] font-black text-slate-800">Clark Jurídica</span><span className="block text-[11px] text-slate-400">{message.error ? 'Falha na análise' : 'Análise dos documentos'}</span></div>
                </div>
                {!message.error && <button type="button" onClick={() => copyAnswer(message)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"><Copy size={13} /> {copiedId === message.id ? 'Copiado' : 'Copiar'}</button>}
              </div>
              <div className="px-5 py-5 sm:px-7 sm:py-6">{message.error
                ? <div className="text-[13px] leading-7 text-rose-700">{message.text}</div>
                : <RichAnswer text={message.text} />}
              </div>
            </article>
          ))}

          {isLoading && (
            <div className="mx-auto flex max-w-[940px] items-center gap-3 rounded-2xl border border-orange-100 bg-white px-5 py-5 shadow-sm">
              <Loader2 size={19} className="animate-spin text-orange-600" />
              <div><span className="block text-[13px] font-extrabold text-slate-800">Cruzando informações dos documentos...</span><span className="text-[12px] text-slate-500">Lendo {files.length} {files.length === 1 ? 'contrato' : 'contratos'} e verificando as cláusulas.</span></div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
          <form onSubmit={handleSubmit} className="relative mx-auto max-w-[940px]">
            <textarea
              ref={textareaRef}
              value={question} onChange={(event) => setQuestion(event.target.value)} rows={2}
              maxLength={MAX_QUESTION_CHARS}
              disabled={!hasFiles || isLoading}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              placeholder={hasFiles ? 'Pergunte sobre cláusulas ou compare os contratos selecionados...' : 'Primeiro, adicione um ou mais contratos PDF.'}
              className="block w-full resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4 pr-[62px] text-[14px] leading-6 text-slate-800 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button type="submit" disabled={!hasFiles || !question.trim() || isLoading}
              className="absolute bottom-3.5 right-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
              title="Enviar pergunta"><Send size={18} /></button>
          </form>
          <div className="mx-auto mt-2 flex max-w-[940px] flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Files size={12} /> {hasFiles ? `${files.length} PDFs na análise` : 'Nenhum documento selecionado'} · Enter envia, Shift + Enter quebra linha</span>
            <span>{question.length}/{MAX_QUESTION_CHARS}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
