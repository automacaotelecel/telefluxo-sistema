import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Clock,
  Download,
  RefreshCw,
  Search,
  Star,
  Store,
  Trophy,
} from 'lucide-react';

type AvaliacaoLoja = {
  loja: string;
  sistema: string;
  notaMedia: string;
  avaliacoesDia: string;
  avaliacoesMes: string;
};

const SHEET_ID = '1t4eM7Zy3P7ADAqJpm7-K95lbnysMlnQ9CSMZOXX9mDY';
const SHEET_GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

function normalizeHeader(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentLine = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentLine += char + nextChar;
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      currentLine += char;
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (currentLine.trim()) rows.push(parseCsvLine(currentLine));
      currentLine = '';
      if (char === '\r' && nextChar === '\n') index += 1;
      continue;
    }

    currentLine += char;
  }

  if (currentLine.trim()) rows.push(parseCsvLine(currentLine));
  return rows;
}

function onlyNumber(value: string | number) {
  if (typeof value === 'number') return value;
  const strValue = String(value || '');

  if (/^-?\d+\.\d+$/.test(strValue)) {
    return Number(strValue);
  }

  const normalized = strValue
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatNota(value: string | number) {
  if (!value && value !== 0) return '-';

  const number = onlyNumber(value);
  if (!number && number !== 0) return String(value);

  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: string | number) {
  if (!value && value !== 0) return '0';

  const number = onlyNumber(value);
  if (!Number.isFinite(number)) return String(value);

  return Math.round(number).toLocaleString('pt-BR');
}

function findColumnIndex(headers: string[], possibleNames: string[]) {
  const normalizedPossibleNames = possibleNames.map(normalizeHeader);

  return headers.findIndex((header) => {
    const normalizedHeader = normalizeHeader(header);
    return normalizedPossibleNames.some((name) => normalizedHeader === name || normalizedHeader.includes(name));
  });
}

function mapRows(rows: string[][]): AvaliacaoLoja[] {
  if (rows.length < 2) return [];

  const headers = rows[0];

  const lojaIndex = findColumnIndex(headers, ['LOJA']);
  const sistemaIndex = findColumnIndex(headers, ['SISTEMA']);
  const notaIndex = findColumnIndex(headers, ['NOTA MEDIA', 'NOTA MÉDIA']);
  const diaIndex = findColumnIndex(headers, ['AVALIACOES NO DIA', 'AVALIAÇÕES NO DIA']);
  const mesIndex = findColumnIndex(headers, ['AVALIACOES NO MES', 'AVALIAÇÕES NO MÊS']);

  return rows
    .slice(1)
    .map((row) => ({
      loja: row[lojaIndex] || '',
      sistema: row[sistemaIndex] || '',
      notaMedia: row[notaIndex] || '',
      avaliacoesDia: row[diaIndex] || '',
      avaliacoesMes: row[mesIndex] || '',
    }))
    .filter((item) => {
      // Ignora linhas vazias ou cabeçalhos indesejados da planilha
      const lojaUpper = item.loja.toUpperCase();
      return (
        item.loja && 
        lojaUpper !== 'LOJA SISTEMA' && 
        lojaUpper !== 'LOJA A PROCURAR' && 
        lojaUpper !== '--00'
      );
    });
}

function getNotaBadgeClass(nota: string | number) {
  const value = onlyNumber(nota);

  if (value >= 4.7) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value >= 4.3) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (value >= 4) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export default function AvaliacoesLojas() {
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoLoja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const carregarAvaliacoes = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${SHEET_CSV_URL}&cacheBust=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Não foi possível acessar a planilha do Google Sheets.');
      }

      const csvText = await response.text();

      if (!csvText || csvText.toLowerCase().includes('<html')) {
        throw new Error('A planilha não retornou dados válidos. Verifique se ela está compartilhada como pública/visualização.');
      }

      const parsedRows = parseCsv(csvText);
      const mappedRows = mapRows(parsedRows);

      setAvaliacoes(mappedRows);
      setLastUpdate(new Date());
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar avaliações das lojas.');
      setAvaliacoes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarAvaliacoes();
  }, []);

  const filteredAvaliacoes = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return avaliacoes;

    return avaliacoes.filter((item) => {
      return [item.loja, item.sistema, item.notaMedia, item.avaliacoesDia, item.avaliacoesMes]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [avaliacoes, search]);

  const resumo = useMemo(() => {
    const totalLojas = avaliacoes.length;
    const totalDia = avaliacoes.reduce((acc, item) => acc + onlyNumber(item.avaliacoesDia), 0);
    const totalMes = avaliacoes.reduce((acc, item) => acc + onlyNumber(item.avaliacoesMes), 0);
    const notasValidas = avaliacoes.map((item) => onlyNumber(item.notaMedia)).filter((nota) => nota > 0);
    const mediaGeral = notasValidas.length
      ? notasValidas.reduce((acc, nota) => acc + nota, 0) / notasValidas.length
      : 0;

    return {
      totalLojas,
      totalDia,
      totalMes,
      mediaGeral,
    };
  }, [avaliacoes]);

  // Função para exportar os dados exibidos para Excel (.csv)
  const exportarParaExcel = () => {
    if (!filteredAvaliacoes.length) return;

    const cabecalho = ['Loja', 'Sistema', 'Nota Media', 'Avaliacoes no Dia', 'Avaliacoes no Mes'];
    
    const linhas = filteredAvaliacoes.map(item => [
      `"${item.loja}"`,
      `"${item.sistema}"`,
      `"${formatNota(item.notaMedia)}"`,
      `"${formatInteger(item.avaliacoesDia)}"`,
      `"${formatInteger(item.avaliacoesMes)}"`
    ]);

    // O \uFEFF força o Excel a entender a codificação UTF-8 (mantendo acentos)
    // O ponto e vírgula (;) é usado para separar colunas no Excel em português
    const csvContent = '\uFEFF' + [
      cabecalho.join(';'),
      ...linhas.map(row => row.join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Relatorio_Avaliacoes_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black text-orange-600 uppercase tracking-[0.22em] mb-2">
              <Star size={15} fill="currentColor" />
              Painel Diretoria
            </div>

            <h1 className="text-2xl md:text-4xl font-black text-slate-900 uppercase tracking-tight italic">
              Avaliações das Lojas
            </h1>

            <p className="text-slate-500 text-xs md:text-sm font-bold mt-1">
              Consulta automática da planilha Google Sheets com loja, sistema, nota média e volume de avaliações.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar loja ou sistema..."
                className="w-full sm:w-72 pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-bold outline-none focus:ring-4 focus:ring-orange-100 focus:border-orange-400 transition-all"
              />
            </div>

            <button
              onClick={exportarParaExcel}
              disabled={loading || filteredAvaliacoes.length === 0}
              className="px-5 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg transition-all active:scale-95"
            >
              <Download size={16} />
              Exportar
            </button>

            <button
              onClick={carregarAvaliacoes}
              disabled={loading}
              className="px-5 py-3 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg transition-all active:scale-95"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Card Lojas Monitoradas */}
          <div className="bg-white rounded-[24px] border border-slate-100 border-b-[4px] border-b-slate-200 hover:border-b-orange-500 shadow-sm hover:shadow-md transition-all p-6 group cursor-default">
            <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Store size={22} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lojas Monitoradas</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{resumo.totalLojas}</p>
          </div>

          {/* Card Nota Média Geral */}
          <div className="bg-white rounded-[24px] border border-slate-100 border-b-[4px] border-b-slate-200 hover:border-b-amber-500 shadow-sm hover:shadow-md transition-all p-6 group cursor-default">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Trophy size={22} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nota Média Geral</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{resumo.mediaGeral ? formatNota(resumo.mediaGeral) : '-'}</p>
          </div>

          {/* Card Avaliações no Dia */}
          <div className="bg-white rounded-[24px] border border-slate-100 border-b-[4px] border-b-slate-200 hover:border-b-blue-500 shadow-sm hover:shadow-md transition-all p-6 group cursor-default">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <CalendarDays size={22} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avaliações no Dia</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{formatInteger(resumo.totalDia)}</p>
          </div>

          {/* Card Avaliações no Mês */}
          <div className="bg-white rounded-[24px] border border-slate-100 border-b-[4px] border-b-slate-200 hover:border-b-emerald-500 shadow-sm hover:shadow-md transition-all p-6 group cursor-default">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <BarChart3 size={22} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avaliações no Mês</p>
            <p className="text-3xl font-black text-slate-900 mt-1">{formatInteger(resumo.totalMes)}</p>
          </div>
        </div>

        {lastUpdate && (
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
            <Clock size={14} />
            Última atualização nesta tela: {lastUpdate.toLocaleString('pt-BR')}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-[24px] p-5 flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black uppercase">Não foi possível carregar a planilha</p>
              <p className="text-sm font-bold mt-1">{error}</p>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-[32px] shadow-sm overflow-hidden">
          <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Tabela de Avaliações</h2>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                Exibindo {filteredAvaliacoes.length} de {avaliacoes.length} registro(s)
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Loja</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Sistema</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Nota Média</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Avaliações no Dia</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Avaliações no Mês</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="inline-flex items-center gap-3 text-slate-500 text-sm font-black uppercase tracking-widest">
                        <RefreshCw size={18} className="animate-spin" />
                        Carregando avaliações...
                      </div>
                    </td>
                  </tr>
                ) : filteredAvaliacoes.length ? (
                  filteredAvaliacoes.map((item, index) => (
                    <tr key={`${item.loja}-${item.sistema}-${index}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900 uppercase">{item.loja || '-'}</div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase text-slate-600">
                          {item.sistema || '-'}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${getNotaBadgeClass(item.notaMedia)}`}>
                          <Star size={13} fill="currentColor" />
                          {formatNota(item.notaMedia)}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-sm font-black text-slate-900">{formatInteger(item.avaliacoesDia)}</td>
                      <td className="px-6 py-4 text-sm font-black text-slate-900">{formatInteger(item.avaliacoesMes)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center text-sm font-bold text-slate-400">
                      Nenhuma avaliação encontrada para os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}