import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarRange, FileText, Search, UploadCloud } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

const pdfWorker = new PdfJsWorker();
pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker;

const RENDER_API_URL = 'https://telefluxo-aplicacao.onrender.com';

const getApiUrl = () => {
  const envUrl = String(import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (typeof window === 'undefined') return RENDER_API_URL;
  const host = window.location.hostname;
  return ['localhost', '127.0.0.1'].includes(host) || host.startsWith('192.168.') || host.startsWith('10.')
    ? `http://${host}:3000`
    : RENDER_API_URL;
};

const API_URL = getApiUrl();

type CartaItem = {
  arquivo: string;
  modelo: string;
  inicio: string;
  termino: string;
  quantidadeCarta: number;
};

type ResultadoCarta = CartaItem & {
  vendido: number;
  aderencia: number | null;
  status: 'ACIMA' | 'DENTRO' | 'ABAIXO' | 'SEM META';
};

const normalize = (value: unknown) =>
  String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');

const toIsoDate = (value: string) => {
  const match = String(value || '').match(/(\d{2})[\/.-](\d{2})[\/.-](\d{2,4})/);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2]}-${match[1]}`;
};

const extractText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => String(item.str || '')).join(' '));
  }
  return pages.join('\n');
};

const parseCarta = async (file: File): Promise<CartaItem[]> => {
  const text = await extractText(file);
  const dateMatches = [...text.matchAll(/(\d{2}[\/.-]\d{2}[\/.-]\d{2,4})/g)].map((match) => toIsoDate(match[1]));
  const inicio = dateMatches[0] || '';
  const termino = dateMatches[1] || inicio;

  const lines = text.split(/\n| {2,}/).map((line) => line.trim()).filter(Boolean);
  const rows: CartaItem[] = [];
  const modelPattern = /\b(?:SM-[A-Z0-9]+|SM[A-Z0-9]{4,}|GALAXY\s+[A-Z0-9][A-Z0-9 +\-\/]{2,}|MOTO\s+[A-Z0-9][A-Z0-9 +\-\/]{2,})\b/i;

  lines.forEach((line) => {
    const modelMatch = line.match(modelPattern);
    if (!modelMatch) return;
    const quantityMatch = line.match(/(?:QTD|QUANTIDADE|META)\s*[:\-]?\s*(\d+)/i);
    rows.push({
      arquivo: file.name,
      modelo: modelMatch[0].trim(),
      inicio,
      termino,
      quantidadeCarta: Number(quantityMatch?.[1] || 0),
    });
  });

  if (!rows.length) {
    rows.push({ arquivo: file.name, modelo: 'MODELO NÃO IDENTIFICADO', inicio, termino, quantidadeCarta: 0 });
  }

  return rows.filter((row, index, all) =>
    all.findIndex((candidate) => normalize(candidate.modelo) === normalize(row.modelo)) === index
  );
};

export default function LeituraCartas({ currentUser }: { currentUser?: any }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ResultadoCarta[]>([]);
  const [search, setSearch] = useState('');

  const processFiles = async (files: File[]) => {
    const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) {
      setError('Envie arquivos PDF.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const cartas = (await Promise.all(pdfs.map(parseCarta))).flat();
      const validDates = cartas.flatMap((item) => [item.inicio, item.termino]).filter(Boolean).sort();
      const startDate = validDates[0] || new Date().toISOString().slice(0, 8) + '01';
      const endDate =
              validDates.length > 0
                ? validDates[validDates.length - 1]
                : new Date().toISOString().slice(0, 10);
      const userId = String(currentUser?.id || '').trim();

      const response = await fetch(
        `${API_URL}/api/comparativos/vendas-modelos?userId=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );
      const json = await response.json().catch(() => ({ sales: [] }));
      if (!response.ok) throw new Error(json?.error || 'Erro ao buscar vendas.');

      const sales = Array.isArray(json?.sales) ? json.sales : [];
      const result = cartas.map((carta) => {
        const key = normalize(carta.modelo);
        const vendido = sales.reduce((total: number, sale: any) => {
          const description = normalize(sale.DESCRICAO || sale.descricao || sale.modelo || '');
          const family = normalize(sale.FAMILIA || sale.familia || sale.referencia || '');
          return description.includes(key) || key.includes(description) || family.includes(key)
            ? total + Number(sale.QUANTIDADE ?? sale.quantidade ?? 0)
            : total;
        }, 0);
        const aderencia = carta.quantidadeCarta > 0 ? vendido / carta.quantidadeCarta : null;
        const status: ResultadoCarta['status'] =
          carta.quantidadeCarta <= 0 ? 'SEM META' :
          vendido >= carta.quantidadeCarta * 1.1 ? 'ACIMA' :
          vendido >= carta.quantidadeCarta * 0.8 ? 'DENTRO' : 'ABAIXO';
        return { ...carta, vendido, aderencia, status };
      });
      setRows(result);
    } catch (err: any) {
      setError(err?.message || 'Erro ao ler cartas.');
    } finally {
      setLoading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const filtered = useMemo(() => {
    const term = normalize(search);
    return term ? rows.filter((row) => normalize(row.modelo).includes(term) || normalize(row.arquivo).includes(term)) : rows;
  }, [rows, search]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-black uppercase text-slate-900">Leitura de Cartas</h1>
          <p className="mt-1 text-sm text-slate-500">Leitura dos modelos, vigência e meta da carta, cruzada com as vendas realizadas no mesmo período.</p>

          <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); processFiles(Array.from(event.dataTransfer.files)); }}
            onClick={() => inputRef.current?.click()}
            className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition ${dragging ? 'border-orange-500 bg-orange-50' : 'border-slate-300 bg-slate-50 hover:border-slate-500'}`}
          >
            <UploadCloud className={dragging ? 'text-orange-600' : 'text-slate-500'} size={30} />
            <strong className="mt-2 text-sm uppercase text-slate-800">{dragging ? 'Solte as cartas aqui' : 'Clique ou arraste as cartas em PDF'}</strong>
            <span className="mt-1 text-xs text-slate-500">O sistema identifica modelo, vigência e quantidade prevista.</span>
            <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(event) => processFiles(Array.from(event.target.files || []))} />
          </div>

          {loading && <div className="mt-4 text-sm font-bold text-blue-700">Lendo cartas e cruzando vendas...</div>}
          {error && <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><AlertCircle size={17} />{error}</div>}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2"><FileText size={18} className="text-orange-600" /><strong className="uppercase">Resultado da leitura</strong></div>
            <div className="relative w-full md:w-96"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar modelo ou arquivo" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none" /></div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-slate-100 text-[10px] font-black uppercase text-slate-500">
                <tr><th className="px-4 py-3">Modelo</th><th className="px-4 py-3">Arquivo</th><th className="px-4 py-3">Vigência</th><th className="px-4 py-3 text-right">Qtd. carta</th><th className="px-4 py-3 text-right">Vendido</th><th className="px-4 py-3 text-right">Aderência</th><th className="px-4 py-3">Leitura</th></tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => (
                  <tr key={`${row.arquivo}-${row.modelo}-${index}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-black text-slate-900">{row.modelo}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">{row.arquivo}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1"><CalendarRange size={14} />{row.inicio || '-'} a {row.termino || '-'}</span></td>
                    <td className="px-4 py-3 text-right font-black">{row.quantidadeCarta.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right font-black text-blue-700">{row.vendido.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right font-black">{row.aderencia === null ? '-' : `${(row.aderencia * 100).toFixed(1).replace('.', ',')}%`}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${row.status === 'ACIMA' ? 'bg-emerald-100 text-emerald-700' : row.status === 'DENTRO' ? 'bg-blue-100 text-blue-700' : row.status === 'ABAIXO' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{row.status}</span></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm font-bold text-slate-400">Nenhuma carta processada.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
