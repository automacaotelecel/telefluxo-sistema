import React, { useMemo, useState } from 'react';
import {
  UploadCloud,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  FileSpreadsheet,
  Database,
  Calendar as CalendarIcon,
  CheckCircle2,
  Scale,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Filter,
  X
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type StoneGroup = {
  records: Array<{
    cnpj: string;
    mes: string;
    dataRetencao: string;
    previsaoCompleta: string;
    previsaoDate: string;
    valorRetidoString: string;
    valorReceberString: string;
    valorRetidoNum: number;
    valorReceberNum: number;
  }>;
  totalDia: number;
  totalRetidoDia: number;
};

type GroupedStoneData = Record<string, StoneGroup>;
type ExtratoMap = Record<string, number>;

export default function ControleStone() {
  const [activeTab, setActiveTab] = useState<'stone' | 'conciliacao'>('conciliacao');

  // --- ESTADOS DA STONE (PDF) ---
  const [groupedData, setGroupedData] = useState<GroupedStoneData>({});
  const [isProcessingStone, setIsProcessingStone] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [errorMsgStone, setErrorMsgStone] = useState('');

  // --- ESTADOS: EXTRATO BANCÁRIO (EXCEL) ---
  const [extratoData, setExtratoData] = useState<ExtratoMap>({});
  const [isProcessingExtrato, setIsProcessingExtrato] = useState(false);
  const [errorMsgExtrato, setErrorMsgExtrato] = useState('');

  // --- ESTADOS: FILTROS DA CONCILIAÇÃO ---
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const formatCurrencyString = (val: string, type: '-' | '+') => {
    const clean = val.replace(/[^\d\.,]/g, '');
    return `${type} R$ ${clean}`;
  };

  const parseCurrencyToNumber = (val: string) => {
    if (!val) return 0;
    const clean = val.replace(/[^\d,-]/g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  };

  const formatNumberToBRL = (val: number) => {
    if (val === undefined || val === null || Number.isNaN(val)) return 'R$ 0,00';
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const parseExcelCurrency = (value: unknown) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;

    const raw = String(value).trim();
    if (!raw) return 0;

    // Formato BR: 1.234,56
    if (raw.includes(',') && raw.includes('.')) {
      return parseFloat(raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
    }

    // Formato BR simples: 1234,56
    if (raw.includes(',') && !raw.includes('.')) {
      return parseFloat(raw.replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
    }

    return parseFloat(raw.replace(/[^\d.-]/g, '')) || 0;
  };

  const processFilesStone = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingStone(true);
    setErrorMsgStone('');
    const allRecords: Array<StoneGroup['records'][number]> = [];

    try {
      for (const file of Array.from(files as FileList)) {
        const nameParts = file.name.replace('.pdf', '').split(' - ');
        const cnpj = nameParts[0] ? nameParts[0].trim() : 'CNPJ INDEFINIDO';
        const mes = nameParts[1] ? nameParts[1].trim() : 'MÊS INDEFINIDO';

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const rowsMap = new Map<number, any[]>();

          textContent.items.forEach((item: any) => {
            const str = item.str?.trim?.() || '';
            if (!str) return;

            const y = Math.round(item.transform[5] / 4) * 4;
            if (!rowsMap.has(y)) rowsMap.set(y, []);
            rowsMap.get(y)!.push(item);
          });

          const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);

          for (const y of sortedY) {
            const rowItems = rowsMap.get(y) || [];
            rowItems.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
            const rowText = rowItems.map((item: any) => item.str.trim()).join(' ');

            const dates = rowText.match(/\d{2}\/\d{2}\/\d{4}/g);
            const minusMatch = rowText.match(/[-\u2013\u2014\u2212]\s*(?:R\$)?\s*[\d\.,]+/);
            const plusMatch = rowText.match(/\+\s*(?:R\$)?\s*[\d\.,]+/);

            if (dates && dates.length >= 2 && minusMatch && plusMatch) {
              const secondDateIdx = rowText.indexOf(dates[1]);
              const minusIdx = rowText.indexOf(minusMatch[0]);
              let previsaoCompleta = dates[1];

              if (minusIdx > secondDateIdx) {
                previsaoCompleta = rowText.substring(secondDateIdx, minusIdx).trim();
              }

              const previsaoDate = previsaoCompleta.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || dates[1];

              allRecords.push({
                cnpj,
                mes,
                dataRetencao: dates[0],
                previsaoCompleta,
                previsaoDate,
                valorRetidoString: formatCurrencyString(minusMatch[0], '-'),
                valorReceberString: formatCurrencyString(plusMatch[0], '+'),
                valorRetidoNum: parseCurrencyToNumber(minusMatch[0]),
                valorReceberNum: parseCurrencyToNumber(plusMatch[0]),
              });
            }
          }
        }
      }

      const grouped = allRecords.reduce<GroupedStoneData>((acc, curr) => {
        const key = curr.previsaoDate;
        if (!acc[key]) {
          acc[key] = { records: [], totalDia: 0, totalRetidoDia: 0 };
        }
        acc[key].records.push(curr);
        acc[key].totalDia += curr.valorReceberNum;
        acc[key].totalRetidoDia += Math.abs(curr.valorRetidoNum);
        return acc;
      }, {});

      const sortedGrouped = Object.keys(grouped)
        .sort((a, b) => {
          const [dayA, monthA, yearA] = a.split('/');
          const [dayB, monthB, yearB] = b.split('/');
          return new Date(`${yearB}-${monthB}-${dayB}`).getTime() - new Date(`${yearA}-${monthA}-${dayA}`).getTime();
        })
        .reduce<GroupedStoneData>((acc, key) => {
          acc[key] = grouped[key];
          return acc;
        }, {});

      setGroupedData(sortedGrouped);
    } catch (error: any) {
      setErrorMsgStone(`Falha na leitura: ${error.message}`);
    } finally {
      setIsProcessingStone(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleExportExcelStone = () => {
    const excelData: Array<Record<string, string | number>> = [];

    Object.keys(groupedData).forEach((dateKey) => {
      groupedData[dateKey].records.forEach((record) => {
        excelData.push({
          'Data de Retenção': record.dataRetencao,
          'Previsão de Liberação': record.previsaoDate,
          CNPJ: record.cnpj,
          'Mês/Ano': record.mes,
          'Valor Retido': Math.abs(record.valorRetidoNum),
          'Valor a Receber': Math.abs(record.valorReceberNum),
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Espelho Stone');
    XLSX.writeFile(workbook, `Espelho_Stone_${new Date().getTime()}.xlsx`);
  };

  const processExtratoBanco = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessingExtrato(true);
    setErrorMsgExtrato('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      const extratoMap: ExtratoMap = {};

      data.forEach((row) => {
        const keys = Object.keys(row);
        const dateKey = keys.find((k) => k.toUpperCase().includes('DATA'));
        const credKey = keys.find((k) => k.toUpperCase().includes('CREDITO') || k.toUpperCase().includes('CRÉDITO'));

        if (dateKey && credKey) {
          const rawDate = row[dateKey];
          let formattedDate = '';

          if (typeof rawDate === 'number') {
            const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
            formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
          } else if (typeof rawDate === 'string') {
            if (rawDate.includes('-')) {
              const parts = rawDate.split('-');
              if (parts.length === 3) {
                formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
              }
            } else {
              formattedDate = rawDate.trim();
            }
          }

          const numVal = parseExcelCurrency(row[credKey]);

          if (formattedDate && numVal > 0) {
            extratoMap[formattedDate] = (extratoMap[formattedDate] || 0) + numVal;
          }
        }
      });

      if (Object.keys(extratoMap).length === 0) {
        throw new Error("Não encontrei as colunas 'DATA' e 'CREDITO' no Excel.");
      }

      setExtratoData(extratoMap);
    } catch (error: any) {
      setErrorMsgExtrato(`Erro no Extrato: ${error.message}`);
    } finally {
      setIsProcessingExtrato(false);
      if (event.target) event.target.value = '';
    }
  };

  const parseBrDateToTime = (dateStr: string) => {
    const [d, m, y] = dateStr.split('/');
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  };

  const conciliacaoResult = useMemo(() => {
    const allDates = new Set<string>([
      ...Object.keys(groupedData),
      ...Object.keys(extratoData),
    ]);

    const startFilter = filterStartDate ? new Date(`${filterStartDate}T00:00:00`).getTime() : 0;
    const endFilter = filterEndDate ? new Date(`${filterEndDate}T23:59:59`).getTime() : Infinity;

    return Array.from(allDates)
      .filter((date) => {
        if (!filterStartDate && !filterEndDate) return true;
        const rowTime = parseBrDateToTime(date);
        return rowTime >= startFilter && rowTime <= endFilter;
      })
      .sort((a, b) => parseBrDateToTime(b) - parseBrDateToTime(a))
      .map((date) => {
        const vStone = groupedData[date]?.totalDia || 0;
        const vBanco = extratoData[date] || 0;
        const diffStoneBanco = Math.abs(vStone - vBanco);
        const bateuBanco = diffStoneBanco < 2 && vStone > 0;
        const faltaValor = Math.max(vStone - vBanco, 0);
        const sobraValor = vStone > 0 ? Math.max(vBanco - vStone, 0) : 0;

        return {
          date,
          vStone,
          vBanco,
          bateuBanco,
          isGhost: vStone === 0 && vBanco > 0,
          faltaValor,
          sobraValor,
        };
      });
  }, [groupedData, extratoData, filterStartDate, filterEndDate]);

  const conciliacaoTotais = useMemo(() => {
    let tStone = 0;
    let tBanco = 0;
    let tDivergencias = 0;

    conciliacaoResult.forEach((r) => {
      tStone += r.vStone;
      tBanco += r.vBanco;

      if (r.vStone > 0 && !r.bateuBanco) {
        tDivergencias += Math.abs(r.vStone - r.vBanco);
      }
    });

    return { tStone, tBanco, tDivergencias };
  }, [conciliacaoResult]);

  const conciliacaoResumo = useMemo(() => {
    let totalRecebido = 0;
    let totalAReceber = 0;
    let totalDepositoSolto = 0;
    let totalRecebidoAMaior = 0;
    let qtdDiasPendentes = 0;

    conciliacaoResult.forEach((r) => {
      const recebidoRelacionado = r.vStone > 0 ? Math.min(r.vStone, r.vBanco) : 0;
      const pendente = Math.max(r.vStone - r.vBanco, 0);
      const recebidoAMaior = r.vStone > 0 ? Math.max(r.vBanco - r.vStone, 0) : 0;

      totalRecebido += recebidoRelacionado;
      totalAReceber += pendente;
      totalRecebidoAMaior += recebidoAMaior;

      if (r.isGhost) totalDepositoSolto += r.vBanco;
      if (pendente > 0) qtdDiasPendentes += 1;
    });

    return {
      totalRecebido,
      totalAReceber,
      totalDepositoSolto,
      totalRecebidoAMaior,
      qtdDiasPendentes,
    };
  }, [conciliacaoResult]);

  const handleExportExcelConciliacao = () => {
    const excelData = conciliacaoResult.map((row) => ({
      Data: row.date,
      'Espelho Stone': row.vStone,
      'Extrato Bancário': row.vBanco,
      Status:
        row.vStone > 0 && row.vBanco > 0
          ? row.bateuBanco
            ? 'Recebido Ok'
            : row.sobraValor > 0
              ? 'Recebido a maior'
              : 'Recebimento pendente'
          : row.vStone > 0 && row.vBanco === 0
            ? 'Aguardando conta'
            : row.isGhost
              ? 'Depósito solto'
              : '-',
      Falta: row.faltaValor,
      Sobra: row.sobraValor,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Conciliacao');
    XLSX.writeFile(workbook, `Conciliacao_Stone_Banco_${new Date().getTime()}.xlsx`);
  };

  const clearFilters = () => {
    setFilterStartDate('');
    setFilterEndDate('');
  };

  const stoneDates = Object.keys(groupedData);
  const stoneTotalGeral = stoneDates.reduce((s, d) => s + groupedData[d].totalDia, 0);
  const stoneTotalRetido = stoneDates.reduce((s, d) => s + groupedData[d].totalRetidoDia, 0);
  const stoneTotalRegistros = stoneDates.reduce((s, d) => s + groupedData[d].records.length, 0);
  const stoneTaxaEfetiva = stoneTotalRetido > 0 ? ((stoneTotalRetido - stoneTotalGeral) / stoneTotalRetido) * 100 : 0;
  const stoneProximaData = stoneDates.length > 0 ? stoneDates[0] : null;
  const stoneProximoValor = stoneProximaData ? groupedData[stoneProximaData].totalDia : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] flex flex-col h-full font-sans antialiased">
      <header className="bg-white border-b border-slate-200 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shrink-0 shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Database className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight uppercase">
              Conciliação
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Stone & Banco</p>
          </div>
        </div>

        <nav className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 w-fit overflow-x-auto">
          <button
            onClick={() => setActiveTab('conciliacao')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'conciliacao' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Scale size={16} /> Conciliação Bancária
          </button>
          <button
            onClick={() => setActiveTab('stone')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all whitespace-nowrap ${activeTab === 'stone' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Espelho Stone (PDF)
          </button>
        </nav>
      </header>

      <main className="p-8 flex-1">
        {activeTab === 'conciliacao' && (
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            <section className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
              <div>
                <h2 className="text-2xl font-black text-slate-800 mb-1 flex items-center gap-2">
                  Auditoria de Dois Pontos <CheckCircle className="text-emerald-500" size={24} />
                </h2>
                <p className="text-slate-500 text-sm max-w-md">
                  Importe seus extratos e cruze automaticamente o Espelho Stone e o Caixa (Banco).
                </p>
              </div>

              <div className="flex flex-wrap gap-4 w-full md:w-auto justify-end">
                <label className={`cursor-pointer text-white px-8 py-3 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${isProcessingStone ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-200'}`}>
                  <UploadCloud size={18} /> {isProcessingStone ? 'Lendo PDFs...' : 'Subir Espelho Stone (PDF)'}
                  <input type="file" multiple accept=".pdf" className="hidden" onChange={processFilesStone} disabled={isProcessingStone} />
                </label>

                <label className={`cursor-pointer text-white px-8 py-3 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${isProcessingExtrato ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-200'}`}>
                  <FileSpreadsheet size={18} /> {isProcessingExtrato ? 'Lendo Excel...' : 'Subir Extrato Banco (Excel)'}
                  <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={processExtratoBanco} disabled={isProcessingExtrato} />
                </label>

                <button
                  onClick={handleExportExcelConciliacao}
                  disabled={conciliacaoResult.length === 0}
                  className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet size={18} /> Exportar Excel
                </button>
              </div>
            </section>

            {errorMsgStone && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-6 rounded-2xl flex items-center gap-3 font-bold">
                <AlertCircle size={24} /> {errorMsgStone}
              </div>
            )}

            {errorMsgExtrato && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-6 rounded-2xl flex items-center gap-3 font-bold">
                <AlertCircle size={24} /> {errorMsgExtrato}
              </div>
            )}

            <section className="bg-slate-100 border border-slate-200 p-2 rounded-[1.5rem] flex flex-col lg:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3 w-full lg:w-auto px-4">
                <Filter size={18} className="text-slate-400" />
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="bg-white border border-slate-200 text-sm font-bold text-slate-600 rounded-xl px-3 py-2 outline-none focus:border-blue-500 transition-all"
                  />
                  <span className="text-slate-400 font-bold">até</span>
                  <input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="bg-white border border-slate-200 text-sm font-bold text-slate-600 rounded-xl px-3 py-2 outline-none focus:border-blue-500 transition-all"
                  />
                </div>

                {(filterStartDate || filterEndDate) && (
                  <button onClick={clearFilters} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors" title="Limpar Filtros">
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex gap-2 w-full lg:w-auto">
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${Object.keys(groupedData).length > 0 ? 'bg-white text-orange-600' : 'bg-slate-200 text-slate-400'}`}>
                  <FileText size={14} /> 1. Espelho Stone
                </div>
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${Object.keys(extratoData).length > 0 ? 'bg-white text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
                  <FileSpreadsheet size={14} /> 2. Extrato Bancário
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm border-t-4 border-t-orange-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">1. Espelho Stone</p>
                <p className="text-2xl font-black text-slate-800">{formatNumberToBRL(conciliacaoTotais.tStone)}</p>
                <p className="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-100 pt-2">Total previsto pela Stone</p>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">2. Extrato Bancário</p>
                <p className="text-2xl font-black text-emerald-600">{formatNumberToBRL(conciliacaoTotais.tBanco)}</p>
                <p className="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-100 pt-2">Depósitos confirmados no banco</p>
              </div>

              <div className={`p-6 rounded-3xl border shadow-sm border-t-4 flex flex-col justify-between ${conciliacaoTotais.tDivergencias > 0 ? 'bg-red-50 border-red-200 border-t-red-500' : 'bg-white border-slate-200 border-t-slate-300'}`}>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1 text-slate-500">Divergências no Período</p>
                  <p className={`text-2xl font-black ${conciliacaoTotais.tDivergencias > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                    {formatNumberToBRL(conciliacaoTotais.tDivergencias)}
                  </p>
                </div>
                <p className="text-[10px] text-slate-500 mt-2 font-bold border-t border-slate-200/50 pt-2 flex items-center gap-1">
                  {conciliacaoTotais.tDivergencias > 0 ? <><AlertTriangle size={12} className="text-red-500" /> Atenção Necessária</> : <><CheckCircle2 size={12} className="text-emerald-500" /> Tudo Bateu</>}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Recebido</p>
                <p className="text-lg font-black text-blue-600">{formatNumberToBRL(conciliacaoResumo.totalRecebido)}</p>
                <p className="text-[10px] text-slate-400 mt-1">Recebido contra o previsto</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total a Receber</p>
                <p className="text-lg font-black text-orange-600">{formatNumberToBRL(conciliacaoResumo.totalAReceber)}</p>
                <p className="text-[10px] text-slate-400 mt-1">Ainda pendente no banco</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Recebido a Maior</p>
                <p className="text-lg font-black text-violet-600">{formatNumberToBRL(conciliacaoResumo.totalRecebidoAMaior)}</p>
                <p className="text-[10px] text-slate-400 mt-1">Entradas acima do previsto</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Depósito Solto</p>
                <p className="text-lg font-black text-red-500">{formatNumberToBRL(conciliacaoResumo.totalDepositoSolto)}</p>
                <p className="text-[10px] text-slate-400 mt-1">Banco sem Stone</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Dias Pendentes</p>
                <p className="text-lg font-black text-slate-700">{conciliacaoResumo.qtdDiasPendentes}</p>
                <p className="text-[10px] text-slate-400 mt-1">Datas com saldo a receber</p>
              </div>
            </div>

            {conciliacaoResult.length > 0 ? (
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full min-w-[760px] text-left">
                    <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-100 shadow-sm">
                      <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        <th className="sticky top-0 bg-slate-50 py-6 px-6">Data Evento</th>
                        <th className="sticky top-0 bg-slate-50 py-6 px-4 text-right">1. Espelho Stone</th>
                        <th className="sticky top-0 bg-slate-50 py-6 px-4 text-right border-l border-slate-200">2. Extrato Bancário</th>
                        <th className="sticky top-0 bg-slate-50 py-6 px-6 text-center border-l border-slate-200">Status Conciliação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {conciliacaoResult.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                          <td className="py-5 px-6">
                            <span className="font-black text-slate-700 text-sm">{row.date}</span>
                          </td>

                          <td className="py-5 px-4 text-right font-bold text-orange-600 bg-orange-50/10 group-hover:bg-orange-50/50 transition-colors">
                            {row.vStone > 0 ? formatNumberToBRL(row.vStone) : '-'}
                          </td>

                          <td className="py-5 px-4 text-right font-black text-emerald-600 border-l border-slate-100 bg-emerald-50/10 group-hover:bg-emerald-50/50 transition-colors">
                            {row.vBanco > 0 ? formatNumberToBRL(row.vBanco) : '-'}
                          </td>

                          <td className="py-5 px-6 border-l border-slate-100">
                            <div className="flex flex-col items-center gap-2">
                              {row.vStone > 0 && row.vBanco > 0 ? (
                                row.bateuBanco ? (
                                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg uppercase border border-emerald-100">
                                    <CheckCircle size={14} /> Recebido Ok
                                  </div>
                                ) : row.sobraValor > 0 ? (
                                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg uppercase border border-violet-100">
                                    <AlertTriangle size={14} /> Sobra: {formatNumberToBRL(row.sobraValor)}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg uppercase border border-red-100">
                                    <XCircle size={14} /> Falta: {formatNumberToBRL(row.faltaValor)}
                                  </div>
                                )
                              ) : row.vStone > 0 && row.vBanco === 0 ? (
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg uppercase border border-orange-100">
                                  <CalendarIcon size={14} /> Aguardando Conta
                                </div>
                              ) : row.isGhost ? (
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg uppercase border border-violet-100">
                                  <AlertTriangle size={14} /> Depósito Solto
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-bold uppercase">-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-20 flex flex-col items-center justify-center text-slate-300">
                <Scale size={64} className="mb-4 opacity-20" />
                <p className="font-black text-xs uppercase tracking-[0.3em]">Carregue arquivos ou ajuste o filtro</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'stone' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-800">Espelho Stone — Liberações Retidas</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Importe os PDFs da Stone. Cada arquivo deve ter o nome no formato: <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">CNPJ - MÊS.pdf</span>
                </p>
              </div>

              <div className="flex gap-3 shrink-0">
                <label className={`cursor-pointer text-white px-6 py-3 rounded-xl font-black text-xs uppercase flex items-center gap-2 shadow-md transition-all active:scale-95 ${isProcessingStone ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-700'}`}>
                  <UploadCloud size={16} />
                  {isProcessingStone ? 'Extraindo...' : 'Importar PDFs'}
                  <input type="file" multiple accept=".pdf" className="hidden" onChange={processFilesStone} disabled={isProcessingStone} />
                </label>

                <button
                  onClick={handleExportExcelStone}
                  disabled={stoneDates.length === 0}
                  className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase flex items-center gap-2 hover:bg-emerald-700 shadow-md transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet size={16} />
                  Exportar Excel
                </button>
              </div>
            </section>

            {errorMsgStone && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3 text-sm text-red-700">
                <AlertCircle size={16} className="shrink-0" />
                {errorMsgStone}
              </div>
            )}

            {stoneDates.length > 0 && (
              <>
                <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total a Receber</p>
                    <p className="text-2xl font-black text-emerald-600 leading-none">{formatNumberToBRL(stoneTotalGeral)}</p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Soma líquida de todas as liberações</p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Retido (Bruto)</p>
                    <p className="text-2xl font-black text-slate-700 leading-none">{formatNumberToBRL(stoneTotalRetido)}</p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Valor original antes das taxas Stone</p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Desconto Aplicado</p>
                    <div className="flex items-end gap-2 leading-none">
                      <p className="text-2xl font-black text-red-500">{stoneTaxaEfetiva.toFixed(2)}%</p>
                      <p className="text-sm font-bold text-red-400 mb-0.5">taxa</p>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">
                      {formatNumberToBRL(stoneTotalRetido - stoneTotalGeral)} descontados pela Stone
                    </p>
                  </div>

                  {stoneProximaData ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2">Maior Data de Liberação</p>
                      <p className="text-lg font-black text-slate-800 leading-none">{stoneProximaData}</p>
                      <p className="text-[10px] text-emerald-700 mt-1.5 font-black">{formatNumberToBRL(stoneProximoValor)}</p>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Lançamentos</p>
                      <p className="text-2xl font-black text-slate-700 leading-none">{stoneTotalRegistros}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Registros encontrados nos PDFs</p>
                    </div>
                  )}
                </section>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Lançamentos</p>
                    <p className="text-2xl font-black text-slate-800 leading-none">{stoneTotalRegistros}</p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Quantidade total de linhas válidas</p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Ticket Médio</p>
                    <p className="text-2xl font-black text-slate-700 leading-none">
                      {stoneTotalRegistros > 0 ? formatNumberToBRL(stoneTotalGeral / stoneTotalRegistros) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Valor líquido médio por registro</p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Média por Liberação</p>
                    <p className="text-2xl font-black text-slate-700 leading-none">
                      {stoneDates.length > 0 ? formatNumberToBRL(stoneTotalGeral / stoneDates.length) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Valor médio por data de liberação</p>
                  </div>
                </section>
              </>
            )}

            {stoneDates.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Liberações por data — MAIORES DATAS PRIMEIRO</p>
                  <p className="text-xs text-slate-400 font-medium">Clique em uma data para ver os lançamentos</p>
                </div>

                {stoneDates.map((date) => {
                  const isOpen = !!expandedDates[date];
                  const grupo = groupedData[date];
                  const qtd = grupo.records.length;
                  const mediaValor = grupo.totalDia / qtd;

                  return (
                    <div key={date} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-blue-200 transition-all shadow-sm">
                      <div
                        onClick={() => setExpandedDates((prev) => ({ ...prev, [date]: !prev[date] }))}
                        className="px-6 py-5 flex items-center justify-between cursor-pointer hover:bg-slate-50/60 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all border ${isOpen ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </div>

                          <div>
                            <div className="flex items-center gap-3">
                              <p className="text-base font-black text-slate-800">{date}</p>
                              <span className="bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wide px-2.5 py-0.5 rounded-full">
                                {qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Previsão de liberação pela Stone</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-right">
                          <div className="hidden md:block">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Ticket Médio</p>
                            <p className="text-sm font-bold text-slate-600">{formatNumberToBRL(mediaValor)}</p>
                          </div>

                          <div className="w-px h-8 bg-slate-100 hidden md:block" />

                          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-5 py-2.5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-0.5">Total a Receber</p>
                            <p className="text-lg font-black text-emerald-700">{formatNumberToBRL(grupo.totalDia)}</p>
                          </div>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="border-t border-slate-100">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-3 px-6">Filial / CNPJ</th>
                                <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-3 px-4">Mês de Referência</th>
                                <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-3 px-4">Data da Retenção</th>
                                <th className="text-[10px] font-black text-red-400 uppercase tracking-widest py-3 px-4 text-right">Valor Retido</th>
                                <th className="text-[10px] font-black text-emerald-600 uppercase tracking-widest py-3 px-6 text-right">Valor a Receber</th>
                              </tr>
                            </thead>

                            <tbody className="divide-y divide-slate-50">
                              {grupo.records.map((r, idx) => (
                                <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                  <td className="py-4 px-6">
                                    <p className="font-bold text-slate-700 text-sm">{r.cnpj}</p>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className="bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md">
                                      {r.mes}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4 text-sm text-slate-500 font-medium">{r.dataRetencao}</td>
                                  <td className="py-4 px-4 text-right text-sm font-bold text-red-500">
                                    {formatNumberToBRL(Math.abs(r.valorRetidoNum))}
                                  </td>
                                  <td className="py-4 px-6 text-right font-black text-emerald-600 text-base">
                                    {formatNumberToBRL(r.valorReceberNum)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>

                            <tfoot>
                              <tr className="bg-slate-50 border-t-2 border-slate-200">
                                <td colSpan={3} className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  Subtotal — {qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}
                                </td>
                                <td className="py-3 px-4 text-right font-black text-red-500 text-sm">
                                  {formatNumberToBRL(grupo.totalRetidoDia)}
                                </td>
                                <td className="py-3 px-6 text-right font-black text-emerald-700 text-base">
                                  {formatNumberToBRL(grupo.totalDia)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-28 flex flex-col items-center justify-center text-slate-300 gap-5">
                <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm border border-slate-100">
                  <FileText size={36} className="text-slate-200" />
                </div>
                <div className="text-center">
                  <p className="font-black text-xs uppercase tracking-[0.3em] text-slate-300">Nenhum arquivo importado</p>
                  <p className="text-xs text-slate-300 mt-1">Clique em "Importar PDFs" para começar</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
