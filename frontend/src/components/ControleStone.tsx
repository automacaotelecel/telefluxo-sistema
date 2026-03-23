import React, { useState, useEffect, useMemo } from 'react';
import { 
  UploadCloud, ChevronDown, ChevronRight, FileText, AlertCircle, 
  FileSpreadsheet, Database, CreditCard, PieChart as PieChartIcon, 
  Calendar as CalendarIcon, RefreshCw, TrendingUp, ArrowUpRight, CheckCircle2,
  Hash, Layers, ArrowRightLeft, Info,
  Scale, CheckCircle, XCircle, AlertTriangle, Filter, X
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer
} from 'recharts';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const COLORS = ['#2563eb', '#8b5cf6', '#059669', '#ea580c', '#ef4444', '#14b8a6'];

const API_URL = "https://telefluxo-aplicacao.onrender.com/api/linx/pagamentos";
//const API_URL = "http://localhost:3000/api/linx/pagamentos";

export default function ControleStone() {
  const [activeTab, setActiveTab] = useState<'stone' | 'linx' | 'conciliacao'>('conciliacao');

  // --- ESTADOS DA STONE (PDF) ---
  const [groupedData, setGroupedData] = useState<any>({});
  const [isProcessingStone, setIsProcessingStone] = useState(false);
  const [expandedDates, setExpandedDates] = useState<any>({});
  const [errorMsgStone, setErrorMsgStone] = useState('');

  // --- ESTADOS DA LINX (API) ---
  const [linxData, setLinxData] = useState<any>(null);
  const [isProcessingLinx, setIsProcessingLinx] = useState(false);
  const [errorMsgLinx, setErrorMsgLinx] = useState('');
  const [selectedCategoria, setSelectedCategoria] = useState<string | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);

  // --- ESTADOS: EXTRATO BANCÁRIO (EXCEL) ---
  const [extratoData, setExtratoData] = useState<any>({});
  const [isProcessingExtrato, setIsProcessingExtrato] = useState(false);
  const [errorMsgExtrato, setErrorMsgExtrato] = useState('');

  // --- ESTADOS: FILTROS DA CONCILIAÇÃO ---
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // ==========================================
  // LÓGICA DA STONE
  // ==========================================
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
    // Se vier vazio, nulo ou não for número, retorna 0 garantindo que a tela não quebre
    if (val === undefined || val === null || isNaN(val)) return 'R$ 0,00';
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const processFilesStone = async (event: any) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsProcessingStone(true);
    setErrorMsgStone('');
    const allRecords: any[] = [];

    try {
      for (let file of files) {
        const nameParts = file.name.replace('.pdf', '').split(' - ');
        const cnpj = nameParts[0] ? nameParts[0].trim() : 'CNPJ INDEFINIDO';
        const mes  = nameParts[1] ? nameParts[1].trim() : 'MÊS INDEFINIDO';

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const rowsMap = new Map();

          textContent.items.forEach((item: any) => {
            const str = item.str.trim();
            if (!str) return;
            const y = Math.round(item.transform[5] / 4) * 4;
            if (!rowsMap.has(y)) rowsMap.set(y, []);
            rowsMap.get(y).push(item);
          });

          const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);

          for (let y of sortedY) {
            const rowItems = rowsMap.get(y);
            rowItems.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
            const rowText = rowItems.map((item: any) => item.str.trim()).join(' ');

            const dates = rowText.match(/\d{2}\/\d{2}\/\d{4}/g);
            const minusMatch = rowText.match(/[-\u2013\u2014\u2212]\s*(?:R\$)?\s*[\d\.,]+/);
            const plusMatch  = rowText.match(/\+\s*(?:R\$)?\s*[\d\.,]+/);

            if (dates && dates.length >= 2 && minusMatch && plusMatch) {
              const secondDateIdx = rowText.indexOf(dates[1]);
              const minusIdx = rowText.indexOf(minusMatch[0]);
              let previsaoCompleta = dates[1];
              if (minusIdx > secondDateIdx) {
                previsaoCompleta = rowText.substring(secondDateIdx, minusIdx).trim();
              }
              const previsaoDate = previsaoCompleta.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || dates[1];

              allRecords.push({
                cnpj, mes, dataRetencao: dates[0], previsaoCompleta, previsaoDate,
                valorRetidoString: formatCurrencyString(minusMatch[0], '-'),
                valorReceberString: formatCurrencyString(plusMatch[0], '+'),
                valorRetidoNum: parseCurrencyToNumber(minusMatch[0]),
                valorReceberNum: parseCurrencyToNumber(plusMatch[0])
              });
            }
          }
        }
      }

      const grouped = allRecords.reduce((acc, curr) => {
        const key = curr.previsaoDate;
        if (!acc[key]) acc[key] = { records: [], totalDia: 0, totalRetidoDia: 0 };
        acc[key].records.push(curr);
        acc[key].totalDia      += curr.valorReceberNum;
        acc[key].totalRetidoDia += Math.abs(curr.valorRetidoNum);
        return acc;
      }, {});

      // ORDENAÇÃO ALTERADA: Agora do maior para o menor (Decrescente)
      const sortedGrouped = Object.keys(grouped)
        .sort((a, b) => {
          const [dayA, monthA, yearA] = a.split('/');
          const [dayB, monthB, yearB] = b.split('/');
          // Date B menos Date A traz as maiores datas primeiro
          return new Date(`${yearB}-${monthB}-${dayB}`).getTime() - new Date(`${yearA}-${monthA}-${dayA}`).getTime();
        })
        .reduce((acc: any, key) => { acc[key] = grouped[key]; return acc; }, {});

      setGroupedData(sortedGrouped);
    } catch (error: any) {
      setErrorMsgStone(`Falha na leitura: ${error.message}`);
    } finally {
      setIsProcessingStone(false);
      event.target.value = null;
    }
  };

  const handleExportExcelStone = () => {
    const excelData: any[] = [];
    Object.keys(groupedData).forEach((dateKey) => {
      groupedData[dateKey].records.forEach((record: any) => {
        excelData.push({
          "Data de Retenção":      record.dataRetencao,
          "Previsão de Liberação": record.previsaoDate,
          "CNPJ":                  record.cnpj,
          "Mês/Ano":               record.mes,
          "Valor Retido":          Math.abs(record.valorRetidoNum),
          "Valor a Receber":       Math.abs(record.valorReceberNum)
        });
      });
    });
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extratos Stone");
    XLSX.writeFile(workbook, `Stone_Consolidado_${new Date().getTime()}.xlsx`);
  };

  // ==========================================
  // LÓGICA DA LINX
  // ==========================================
  useEffect(() => {
    if ((activeTab === 'linx' || activeTab === 'conciliacao') && !linxData) fetchLinxDataFromAPI();
  }, [activeTab]);

  const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
  const addBusinessDays = (date: Date, days: number) => {
    let result = new Date(date); let added = 0;
    while (added < days) { result.setDate(result.getDate() + 1); if (!isWeekend(result)) added++; }
    return result;
  };
  const addCalendarDays = (date: Date, days: number) => {
    let result = new Date(date); result.setDate(result.getDate() + days); return result;
  };
  const formatVisualDate = (isoString: string) => {
    const [year, month, day] = isoString.split('-'); return `${day}/${month}/${year}`;
  };

  const parseMoney = (value: any) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    const s = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    return parseFloat(s) || 0;
  };

  const getParcelasNumber = (record: any) => {
    const qtd = parseInt(String(record.qtde_parcelas ?? '').trim(), 10);
    if (!isNaN(qtd) && qtd > 0) return qtd;
    const plano = String(record.desc_plano || '');
    const match = plano.match(/(\d+)\s*x/i);
    if (match) return parseInt(match[1], 10);
    return 1;
  };

  const getTipoTexto = (record: any) => {
    return String(record.forma_pgto || record.desc_plano || '').toLowerCase();
  };

  const isPixOrDinheiro = (record: any) => {
    const t = getTipoTexto(record);
    return t.includes('pix') || t.includes('dinheiro');
  };

  const isDebito = (record: any) => {
    const t = getTipoTexto(record);
    const cartao = String(record.credito_debito || record.tipo_transacao || '').toLowerCase();
    return t.includes('débito') || t.includes('debito') || cartao === 'd';
  };

  const isCredito = (record: any) => {
    if (isPixOrDinheiro(record) || isDebito(record)) return false;
    return true;
  };

  const fetchLinxDataFromAPI = async () => {
    setIsProcessingLinx(true);
    setErrorMsgLinx('');

    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("API Offline.");

      const values = await response.json();
      if (!values || values.length === 0) throw new Error("Sem dados.");

      let totalVendido = 0;
      let pagamentosPorTipo: Record<string, number> = {};
      let parcelasCount: Record<string, number> = {};
      let projecaoRecebimento: Record<string, number> = {};

      let mapProjecaoFormatada: Record<string, number> = {};

      let categoriaGeral: Record<string, number> = {
        'Dinheiro / PIX': 0,
        'Débito': 0,
        'Crédito À Vista': 0,
        'Crédito Parcelado': 0
      };

      let parcelasPorNumero: Record<string, { total: number; qtd: number }> = {};

      values.forEach((record: any) => {
        const valorOriginal = parseMoney(record.valor_pagamento);
        const parcelas = getParcelasNumber(record);
        const formaLabel = String(record.forma_pgto || record.desc_plano || 'Diversos').trim();
        const dataOrigem = record.data_lancamento || new Date().toISOString();

        if (valorOriginal <= 0) return;

        totalVendido += valorOriginal;
        pagamentosPorTipo[formaLabel] = (pagamentosPorTipo[formaLabel] || 0) + valorOriginal;
        parcelasCount[`${parcelas}x`] = (parcelasCount[`${parcelas}x`] || 0) + valorOriginal;

        if (isPixOrDinheiro(record)) {
          categoriaGeral['Dinheiro / PIX'] += valorOriginal;
        } else if (isDebito(record)) {
          categoriaGeral['Débito'] += valorOriginal;
        } else if (parcelas <= 1) {
          categoriaGeral['Crédito À Vista'] += valorOriginal;
        } else {
          categoriaGeral['Crédito Parcelado'] += valorOriginal;
        }

        if (isCredito(record) && parcelas > 1) {
          const key = String(parcelas);
          if (!parcelasPorNumero[key]) parcelasPorNumero[key] = { total: 0, qtd: 0 };
          parcelasPorNumero[key].total += valorOriginal;
          parcelasPorNumero[key].qtd += 1;
        }

        const dataBaseStr = String(dataOrigem).substring(0, 10);
        const baseDate = new Date(`${dataBaseStr}T12:00:00`);

        const registrar = (dataAlvo: Date, valorParcela: number) => {
          const iso = dataAlvo.toISOString().substring(0, 10);
          projecaoRecebimento[iso] = (projecaoRecebimento[iso] || 0) + valorParcela;
          const ptBrDate = formatVisualDate(iso);
          mapProjecaoFormatada[ptBrDate] = (mapProjecaoFormatada[ptBrDate] || 0) + valorParcela;
        };

        if (isPixOrDinheiro(record)) {
          registrar(baseDate, valorOriginal);
        } else if (isDebito(record)) {
          let dP = addBusinessDays(baseDate, 1);
          dP = addCalendarDays(dP, 30);
          registrar(dP, valorOriginal);
        } else {
          if (parcelas <= 1) {
            registrar(addCalendarDays(baseDate, 30), valorOriginal);
          } else {
            const valorParcela = valorOriginal / parcelas;
            for (let p = 1; p <= parcelas; p++) {
              registrar(addCalendarDays(baseDate, 30 + ((p - 1) * 30)), valorParcela);
            }
          }
        }
      });

      const totalTipo = Object.values(pagamentosPorTipo).reduce((a, b) => a + b, 0);
      const totalCategoria = Object.values(categoriaGeral).reduce((a, b) => a + b, 0);
      const totalParcelado = categoriaGeral['Crédito Parcelado'];

      const sortedChartData = Object.keys(projecaoRecebimento)
        .sort()
        .map(iso => ({
          dataStrVisual: formatVisualDate(iso),
          isoDate: iso,
          valor: projecaoRecebimento[iso]
        }))
        .slice(0, 15);

      const totalProjetado = sortedChartData.reduce((a, b) => a + b.valor, 0);
      const mediaProjetada = sortedChartData.length > 0 ? totalProjetado / sortedChartData.length : 0;

      const parcelasOrdenadas = Object.keys(parcelasPorNumero)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => ({
          parcela: Number(k),
          label: `${k}x`,
          total: parcelasPorNumero[k].total,
          qtd: parcelasPorNumero[k].qtd,
          pct: totalVendido > 0 ? Math.round((parcelasPorNumero[k].total / totalVendido) * 100) : 0,
          pctDoParccelado: totalParcelado > 0 ? Math.round((parcelasPorNumero[k].total / totalParcelado) * 100) : 0,
        }));

      setLinxData({
        totalVendido,
        totalProjetado,
        mediaProjetada,
        categoriaGeral: Object.keys(categoriaGeral)
          .filter(k => categoriaGeral[k] > 0)
          .map(k => ({ name: k, value: categoriaGeral[k], pct: totalCategoria > 0 ? Math.round((categoriaGeral[k] / totalCategoria) * 100) : 0 }))
          .sort((a, b) => b.value - a.value),
        chartTipo: Object.keys(pagamentosPorTipo)
          .map(k => ({ name: k, value: pagamentosPorTipo[k], pct: totalTipo > 0 ? Math.round((pagamentosPorTipo[k] / totalTipo) * 100) : 0 }))
          .sort((a, b) => b.value - a.value),
        chartParcelas: Object.keys(parcelasCount)
          .sort((a, b) => Number(a.replace('x', '')) - Number(b.replace('x', '')))
          .map(k => ({ name: k, value: parcelasCount[k] })),
        parcelasOrdenadas,
        totalParcelado,
        chartData: sortedChartData,
        totalRegistros: values.length,
        ticketMedio: values.length > 0 ? totalVendido / values.length : 0,
        pctParcelado: totalVendido > 0 ? Math.round((categoriaGeral['Crédito Parcelado'] / totalVendido) * 100) : 0,
        pctAVista: totalVendido > 0 ? Math.round(((categoriaGeral['Dinheiro / PIX'] + categoriaGeral['Débito'] + categoriaGeral['Crédito À Vista']) / totalVendido) * 100) : 0,
        maiorPico: sortedChartData.length > 0 ? sortedChartData.reduce((max, d) => d.valor > max.valor ? d : max, sortedChartData[0]) : null,
        mapProjecao: mapProjecaoFormatada
      });
    } catch (e: any) {
      setErrorMsgLinx(e.message);
    } finally {
      setIsProcessingLinx(false);
    }
  };

  const stoneDates      = Object.keys(groupedData);
  const stoneTotalGeral = stoneDates.reduce((s, d) => s + groupedData[d].totalDia, 0);
  const stoneTotalRetido = stoneDates.reduce((s, d) => s + groupedData[d].totalRetidoDia, 0);
  const stoneTotalRegistros = stoneDates.reduce((s, d) => s + groupedData[d].records.length, 0);
  const stoneTaxaEfetiva = stoneTotalRetido > 0 ? ((stoneTotalRetido - stoneTotalGeral) / stoneTotalRetido) * 100 : 0;
  const stoneProximaData = stoneDates.length > 0 ? stoneDates[0] : null;
  const stoneProximoValor = stoneProximaData ? groupedData[stoneProximaData].totalDia : 0;


  // ==========================================
  // LÓGICA DO EXTRATO BANCÁRIO (EXCEL)
  // ==========================================
  const processExtratoBanco = async (event: any) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsProcessingExtrato(true);
    setErrorMsgExtrato('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      const extratoMap: any = {};

      data.forEach((row: any) => {
        const keys = Object.keys(row);
        const dateKey = keys.find(k => k.toUpperCase().includes('DATA'));
        const credKey = keys.find(k => k.toUpperCase().includes('CREDITO') || k.toUpperCase().includes('CRÉDITO'));

        if (dateKey && credKey) {
          let rawDate = row[dateKey];
          let formattedDate = '';
          
          if (typeof rawDate === 'number') {
            const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
            formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth()+1).padStart(2, '0')}/${d.getUTCFullYear()}`;
          } else if (typeof rawDate === 'string') {
            if (rawDate.includes('-')) {
              const parts = rawDate.split('-');
              if (parts.length === 3) formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
            } else {
              formattedDate = rawDate.trim();
            }
          }

          let val = row[credKey];
          let numVal = 0;
          if (typeof val === 'number') numVal = val;
          else if (typeof val === 'string') numVal = parseFloat(val.replace(/[^\d.-]/g, '')) || 0;

          if (formattedDate && numVal > 0) {
            extratoMap[formattedDate] = (extratoMap[formattedDate] || 0) + numVal;
          }
        }
      });

      if (Object.keys(extratoMap).length === 0) throw new Error("Não encontrei as colunas 'DATA' e 'CREDITO' no Excel.");
      
      setExtratoData(extratoMap);
    } catch (error: any) {
      setErrorMsgExtrato(`Erro no Extrato: ${error.message}`);
    } finally {
      setIsProcessingExtrato(false);
      event.target.value = null;
    }
  };

  // ==========================================
  // LÓGICA DO MOTOR DE CONCILIAÇÃO & FILTRO
  // ==========================================
  const parseBrDateToTime = (dateStr: string) => {
    const [d, m, y] = dateStr.split('/');
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  };

  const conciliacaoResult = useMemo(() => {
    const allDates = new Set([
      ...(linxData?.mapProjecao ? Object.keys(linxData.mapProjecao) : []),
      ...Object.keys(groupedData),
      ...Object.keys(extratoData)
    ]);

    const startFilter = filterStartDate ? new Date(filterStartDate + "T00:00:00").getTime() : 0;
    const endFilter = filterEndDate ? new Date(filterEndDate + "T23:59:59").getTime() : Infinity;

    return Array.from(allDates)
      .filter(date => {
        if (!filterStartDate && !filterEndDate) return true;
        const rowTime = parseBrDateToTime(date);
        return rowTime >= startFilter && rowTime <= endFilter;
      })
      .sort((a, b) => parseBrDateToTime(b) - parseBrDateToTime(a)) // Decrescente
      .map(date => {
        const vLinx = linxData?.mapProjecao?.[date] || 0;
        const vStone = groupedData[date]?.totalDia || 0;
        const vBanco = extratoData[date] || 0;

        const diffStoneBanco = Math.abs(vStone - vBanco);
        const bateuBanco = diffStoneBanco < 2.00 && vStone > 0;

        const diffLinxStone = Math.abs(vLinx - vStone);
        const bateuStone = diffLinxStone < 2.00 && vLinx > 0;

        return {
          date, vLinx, vStone, vBanco, bateuBanco, bateuStone,
          isGhost: vLinx === 0 && vStone === 0 && vBanco > 0,
          diffBancoValue: vStone > 0 && !bateuBanco ? (vStone - vBanco) : 0
        };
      });
  }, [linxData, groupedData, extratoData, filterStartDate, filterEndDate]);

  // Totais da Conciliação (Calculados em cima da tabela filtrada)
  const conciliacaoTotais = useMemo(() => {
    // CORREÇÃO: Nome da variável agora é tDivergencias
    let tLinx = 0, tStone = 0, tBanco = 0, tDivergencias = 0;
    
    conciliacaoResult.forEach(r => {
      tLinx += r.vLinx;
      tStone += r.vStone;
      tBanco += r.vBanco;
      if (r.vStone > 0 && !r.bateuBanco) {
        tDivergencias += Math.abs(r.vStone - r.vBanco);
      }
    });
    
    return { tLinx, tStone, tBanco, tDivergencias };
  }, [conciliacaoResult]);

  const clearFilters = () => {
    setFilterStartDate('');
    setFilterEndDate('');
  };


  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] flex flex-col h-full font-sans antialiased">

      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shrink-0 shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Database className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight uppercase">
              TeleFluxo <span className="text-blue-600">Finance</span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conciliação & Recebíveis</p>
          </div>
        </div>

        <nav className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 w-fit overflow-x-auto">
          <button
            onClick={() => setActiveTab('conciliacao')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'conciliacao' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Scale size={16}/> Conciliação Bancária
          </button>
          <button
            onClick={() => setActiveTab('stone')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all whitespace-nowrap ${activeTab === 'stone' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Extratos Stone (PDF)
          </button>
          <button
            onClick={() => setActiveTab('linx')}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all whitespace-nowrap ${activeTab === 'linx' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Projeção Linx (API)
          </button>
        </nav>
      </header>

      <main className="p-8 flex-1">

        {/* ══════════════════════════════════════════
            ABA: CONCILIAÇÃO BANCÁRIA
        ══════════════════════════════════════════ */}
        {activeTab === 'conciliacao' && (
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            
            {/* Seção de Ações Principais */}
            <section className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
              <div>
                <h2 className="text-2xl font-black text-slate-800 mb-1 flex items-center gap-2">
                   Auditoria de Três Pontas <CheckCircle className="text-emerald-500" size={24}/>
                </h2>
                <p className="text-slate-500 text-sm max-w-md">Importe seus extratos e cruze automaticamente as Vendas (Linx), a Previsão (Stone) e o Caixa (Banco).</p>
              </div>
              <div className="flex gap-4 w-full md:w-auto">
                <label className={`cursor-pointer text-white px-8 py-3 rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${isProcessingExtrato ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-200'}`}>
                  <FileSpreadsheet size={18} /> {isProcessingExtrato ? 'Lendo Excel...' : 'Subir Extrato Banco (Excel)'}
                  <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={processExtratoBanco} disabled={isProcessingExtrato} />
                </label>
                <button onClick={fetchLinxDataFromAPI} className="bg-slate-50 border border-slate-200 text-slate-600 p-3 rounded-2xl hover:bg-slate-100 transition-colors">
                  <RefreshCw size={20} className={isProcessingLinx ? 'animate-spin' : ''} />
                </button>
              </div>
            </section>

            {errorMsgExtrato && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-6 rounded-2xl flex items-center gap-3 font-bold">
                <AlertCircle size={24} /> {errorMsgExtrato}
              </div>
            )}

            {/* Barra de Filtro e Indicadores de Status */}
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
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${linxData ? "bg-white text-blue-600" : "bg-slate-200 text-slate-400"}`}>
                  <Database size={14}/> 1. Vendas API
                </div>
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${Object.keys(groupedData).length > 0 ? "bg-white text-orange-600" : "bg-slate-200 text-slate-400"}`}>
                  <FileText size={14}/> 2. PDFs Stone
                </div>
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 ${Object.keys(extratoData).length > 0 ? "bg-white text-emerald-600" : "bg-slate-200 text-slate-400"}`}>
                  <FileSpreadsheet size={14}/> 3. Excel Banco
                </div>
              </div>
            </section>

            {/* CARDS DE KPI DE AUDITORIA */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">1. Total Vendido (Linx)</p>
                  <p className="text-2xl font-black text-slate-800">{formatNumberToBRL(conciliacaoTotais.tLinx)}</p>
                  <p className="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-100 pt-2">Origem API / PDV</p>
               </div>
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm border-t-4 border-t-orange-500">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">2. Prometido (Stone)</p>
                  <p className="text-2xl font-black text-slate-800">{formatNumberToBRL(conciliacaoTotais.tStone)}</p>
                  <p className="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-100 pt-2">A Receber Líquido</p>
               </div>
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">3. Entrou na Conta (Banco)</p>
                  <p className="text-2xl font-black text-emerald-600">{formatNumberToBRL(conciliacaoTotais.tBanco)}</p>
                  <p className="text-[10px] text-slate-400 mt-2 font-medium border-t border-slate-100 pt-2">Depósitos Confirmados</p>
               </div>
               <div className={`p-6 rounded-3xl border shadow-sm border-t-4 flex flex-col justify-between ${conciliacaoTotais.tDivergencias > 0 ? 'bg-red-50 border-red-200 border-t-red-500' : 'bg-white border-slate-200 border-t-slate-300'}`}>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-1 text-slate-500">Divergências no Período</p>
                    <p className={`text-2xl font-black ${conciliacaoTotais.tDivergencias > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                      {formatNumberToBRL(conciliacaoTotais.tDivergencias)}
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 font-bold border-t border-slate-200/50 pt-2 flex items-center gap-1">
                    {conciliacaoTotais.tDivergencias > 0 ? <><AlertTriangle size={12} className="text-red-500"/> Atenção Necessária</> : <><CheckCircle2 size={12} className="text-emerald-500"/> Tudo Bateu</>}
                  </p>
               </div>
            </div>

            {/* TABELA DE AUDITORIA */}
            {conciliacaoResult.length > 0 ? (
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        <th className="py-6 px-6">Data Evento</th>
                        <th className="py-6 px-4 text-right">1. Vendido (Linx)</th>
                        <th className="py-6 px-4 text-right border-l border-slate-200">2. A Receber (Stone)</th>
                        <th className="py-6 px-4 text-right">3. Na Conta (Banco)</th>
                        <th className="py-6 px-6 text-center border-l border-slate-200">Status Conciliação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {conciliacaoResult.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                          <td className="py-5 px-6">
                            <span className="font-black text-slate-700 text-sm">{row.date}</span>
                          </td>
                          <td className="py-5 px-4 text-right font-bold text-blue-600 bg-blue-50/10 group-hover:bg-blue-50/50 transition-colors">
                            {row.vLinx > 0 ? formatNumberToBRL(row.vLinx) : '-'}
                          </td>
                          <td className="py-5 px-4 text-right font-bold text-orange-600 border-l border-slate-100 bg-orange-50/10 group-hover:bg-orange-50/50 transition-colors">
                            {row.vStone > 0 ? formatNumberToBRL(row.vStone) : '-'}
                          </td>
                          <td className="py-5 px-4 text-right font-black text-emerald-600 bg-emerald-50/10 group-hover:bg-emerald-50/50 transition-colors">
                            {row.vBanco > 0 ? formatNumberToBRL(row.vBanco) : '-'}
                          </td>
                          <td className="py-5 px-6 border-l border-slate-100">
                             <div className="flex flex-col items-center gap-2">
                                {/* Badge Principal */}
                                {row.vStone > 0 && row.vBanco > 0 ? (
                                   row.bateuBanco ? (
                                     <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg uppercase border border-emerald-100">
                                       <CheckCircle size={14}/> Recebido Ok
                                     </div>
                                   ) : (
                                     <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg uppercase border border-red-100">
                                       <XCircle size={14}/> Falta: {formatNumberToBRL(row.vStone - row.vBanco)}
                                     </div>
                                   )
                                ) : row.vStone > 0 && row.vBanco === 0 ? (
                                   <div className="flex items-center gap-1.5 text-[10px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg uppercase border border-orange-100">
                                      <CalendarIcon size={14}/> Aguardando Conta
                                   </div>
                                ) : row.isGhost ? (
                                   <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg uppercase border border-violet-100">
                                      <AlertTriangle size={14}/> Depósito Solto
                                   </div>
                                ) : (
                                   <span className="text-[10px] text-slate-300 font-bold uppercase">-</span>
                                )}

                                {/* Aviso Secundário: API x Stone */}
                                {!row.bateuStone && row.vLinx > 0 && row.vStone > 0 && (
                                   <span className="text-[9px] font-bold text-slate-400 uppercase">
                                     Quebra API: {formatNumberToBRL(Math.abs(row.vLinx - row.vStone))}
                                   </span>
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

        {/* ══════════════════════════════════════════
            ABA: STONE
        ══════════════════════════════════════════ */}
        {activeTab === 'stone' && (
          <div className="max-w-7xl mx-auto space-y-6">

            <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-800">Extratos Stone — Liberações Retidas</h2>
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
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Registros processados dos PDFs</p>
                  </div>
                )}

              </section>

              <section className="grid grid-cols-2 md:grid-cols-4 gap-4 -mt-2">

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Datas de Liberação</p>
                  <p className="text-2xl font-black text-blue-600 leading-none">{stoneDates.length}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Datas distintas mapeadas</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total de Lançamentos</p>
                  <p className="text-2xl font-black text-slate-700 leading-none">{stoneTotalRegistros}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Registros processados dos PDFs</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Ticket Médio / Lançamento</p>
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
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    Liberações por data — MAIORES DATAS PRIMEIRO
                  </p>
                  <p className="text-xs text-slate-400 font-medium">Clique em uma data para ver os lançamentos</p>
                </div>

                {stoneDates.map((date) => {
                  const isOpen      = !!expandedDates[date];
                  const grupo       = groupedData[date];
                  const qtd         = grupo.records.length;
                  const mediaValor  = grupo.totalDia / qtd;

                  return (
                    <div key={date} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-blue-200 transition-all shadow-sm">

                      <div
                        onClick={() => setExpandedDates((p: any) => ({ ...p, [date]: !p[date] }))}
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
                              {grupo.records.map((r: any, idx: number) => (
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

        {/* ══════════════════════════════════════════
            ABA: LINX 
        ══════════════════════════════════════════ */}
        {activeTab === 'linx' && (
          <div className="max-w-7xl mx-auto space-y-6">

            {errorMsgLinx && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3 text-sm text-red-700">
                <AlertCircle size={16} className="shrink-0" />
                {errorMsgLinx}
              </div>
            )}

            {isProcessingLinx && (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 flex flex-col items-center gap-3 text-slate-400">
                <RefreshCw size={28} className="animate-spin text-blue-500" />
                <p className="text-sm font-bold">Carregando dados da API Linx...</p>
              </div>
            )}

            {!isProcessingLinx && linxData && (
              <>
                <section>
                  <div className="flex items-center justify-between mb-3 px-1">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Resumo do Período</p>
                    <button
                      onClick={fetchLinxDataFromAPI}
                      className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <RefreshCw size={13} /> Atualizar dados
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Vendido</p>
                      <p className="text-2xl font-black text-slate-800 leading-none">{formatNumberToBRL(linxData.totalVendido)}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">{linxData.totalRegistros} transações registradas</p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Projetado</p>
                      <p className="text-2xl font-black text-blue-600 leading-none">{formatNumberToBRL(linxData.totalProjetado)}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Entradas nas próximas datas</p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Ticket Médio</p>
                      <p className="text-2xl font-black text-slate-700 leading-none">{formatNumberToBRL(linxData.ticketMedio)}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Valor médio por transação</p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Média Diária Projetada</p>
                      <p className="text-2xl font-black text-slate-700 leading-none">{formatNumberToBRL(linxData.mediaProjetada)}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Recebimento médio por data</p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Principal Forma</p>
                        <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded-full">{linxData.chartTipo[0]?.pct}%</span>
                      </div>
                      <p className="text-lg font-black text-slate-800 leading-none">{linxData.chartTipo[0]?.name || '—'}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">{formatNumberToBRL(linxData.chartTipo[0]?.value || 0)} em vendas</p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">À Vista vs Parcelado</p>
                      <div className="flex items-end gap-2 leading-none mb-2">
                        <span className="text-xl font-black text-emerald-600">{linxData.pctAVista}%</span>
                        <span className="text-slate-300 font-bold text-sm mb-0.5">/</span>
                        <span className="text-xl font-black text-blue-600">{linxData.pctParcelado}%</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${linxData.pctAVista}%` }} />
                        <div className="h-full bg-blue-500 transition-all" style={{ width: `${linxData.pctParcelado}%` }} />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <p className="text-[10px] text-emerald-600 font-bold">À vista / Débito / PIX</p>
                        <p className="text-[10px] text-blue-600 font-bold">Parcelado</p>
                      </div>
                    </div>

                    {linxData.maiorPico && (
                      <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm bg-amber-50/30">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">Maior Entrada Projetada</p>
                        <p className="text-xl font-black text-slate-800 leading-none">{formatNumberToBRL(linxData.maiorPico.valor)}</p>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-medium">📅 {linxData.maiorPico.dataStrVisual}</p>
                      </div>
                    )}

                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Crédito Parcelado</p>
                      <p className="text-2xl font-black text-blue-600 leading-none">{formatNumberToBRL(linxData.totalParcelado)}</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-medium">
                        {linxData.pctParcelado}% do total vendido · {linxData.parcelasOrdenadas?.length || 0} modalidades
                      </p>
                    </div>

                  </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

                    <div className="px-8 pt-7 pb-5 border-b border-slate-100">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-base font-black text-slate-800">Projeção de Recebimentos</h3>
                          <p className="text-xs text-slate-400 mt-0.5 font-medium">
                            Entradas estimadas por data — baseado nos prazos de liquidação por forma de pagamento
                          </p>
                        </div>
                        <button
                          onClick={fetchLinxDataFromAPI}
                          className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors mt-0.5"
                        >
                          <RefreshCw size={12} /> Atualizar
                        </button>
                      </div>

                      <div className="flex items-center gap-6 mt-5">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total projetado</p>
                          <p className="text-sm font-black text-blue-600 mt-0.5">{formatNumberToBRL(linxData.totalProjetado)}</p>
                        </div>
                        <div className="w-px h-8 bg-slate-100" />
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Média por data</p>
                          <p className="text-sm font-black text-slate-600 mt-0.5">{formatNumberToBRL(linxData.mediaProjetada)}</p>
                        </div>
                        <div className="w-px h-8 bg-slate-100" />
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Datas mapeadas</p>
                          <p className="text-sm font-black text-slate-600 mt-0.5">{linxData.chartData.length}</p>
                        </div>
                        {linxData.maiorPico && (
                          <>
                            <div className="w-px h-8 bg-slate-100" />
                            <div>
                              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Maior entrada</p>
                              <p className="text-sm font-black text-amber-600 mt-0.5">{formatNumberToBRL(linxData.maiorPico.valor)}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="grid grid-cols-12 px-8 py-2.5 bg-slate-50 border-b border-slate-100">
                        <p className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">#</p>
                        <p className="col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Recebimento</p>
                        <p className="col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Barra</p>
                        <p className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Valor</p>
                      </div>

                      {(() => {
                        const lista = showAllDates ? linxData.chartData : linxData.chartData.slice(0, 10);
                        const maxValor = Math.max(...linxData.chartData.map((d: any) => d.valor));
                        return lista.map((d: any, i: number) => {
                          const isPico = linxData.maiorPico && d.dataStrVisual === linxData.maiorPico.dataStrVisual;
                          const pct = maxValor > 0 ? (d.valor / maxValor) * 100 : 0;
                          return (
                            <div
                              key={i}
                              className={`grid grid-cols-12 items-center px-8 py-3.5 border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${isPico ? 'bg-amber-50/40' : ''}`}
                            >
                              <p className="col-span-1 text-[10px] font-black text-slate-300">{i + 1}</p>
                              <div className="col-span-5 flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black ${isPico ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                  {d.dataStrVisual.substring(0, 2)}
                                </div>
                                <div>
                                  <p className={`text-sm font-bold ${isPico ? 'text-amber-700' : 'text-slate-700'}`}>{d.dataStrVisual}</p>
                                  {isPico && <p className="text-[9px] font-black text-amber-500 uppercase tracking-wide">Maior entrada</p>}
                                </div>
                              </div>
                              <div className="col-span-4 pr-4">
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${isPico ? 'bg-amber-400' : 'bg-blue-500'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <p className={`col-span-2 text-sm font-black text-right ${isPico ? 'text-amber-600' : 'text-slate-800'}`}>
                                {formatNumberToBRL(d.valor)}
                              </p>
                            </div>
                          );
                        });
                      })()}

                      {linxData.chartData.length > 10 && (
                        <button
                          onClick={() => setShowAllDates(v => !v)}
                          className="w-full py-4 flex items-center justify-center gap-2 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors border-t border-slate-100"
                        >
                          {showAllDates ? (
                            <><ChevronDown size={14} className="rotate-180" /> Mostrar menos</>
                          ) : (
                            <><ChevronDown size={14} /> Ver todas as {linxData.chartData.length} datas</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

                    <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                      <h3 className="text-base font-black text-slate-800">Formas de Pagamento</h3>
                      <p className="text-xs text-slate-400 mt-0.5 font-medium">
                        {selectedCategoria ? (
                          <span>
                            Detalhamento de <span className="text-blue-600 font-bold">{selectedCategoria}</span>
                            {' '}—{' '}
                            <button onClick={() => setSelectedCategoria(null)} className="text-slate-400 hover:text-red-500 underline underline-offset-2">
                              voltar
                            </button>
                          </span>
                        ) : 'Clique em Crédito Parcelado para detalhar'}
                      </p>
                    </div>

                    {!selectedCategoria && (
                      <div className="p-6">
                        <div className="h-[150px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={linxData.categoriaGeral}
                                innerRadius={45} outerRadius={68}
                                paddingAngle={3} dataKey="value" stroke="none"
                                onClick={(entry: any) => {
                                  if (entry.name === 'Crédito Parcelado' && linxData.parcelasOrdenadas?.length > 0) {
                                    setSelectedCategoria('Crédito Parcelado');
                                  }
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                {linxData.categoriaGeral.map((item: any, i: number) => (
                                  <Cell
                                    key={i}
                                    fill={COLORS[i % COLORS.length]}
                                    opacity={item.name === 'Crédito Parcelado' ? 1 : 0.85}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                content={({ active, payload }) =>
                                  active && payload ? (
                                    <div className="bg-white shadow-xl rounded-xl border border-slate-100 p-3">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{payload[0]?.name}</p>
                                      <p className="text-sm font-black text-slate-800">{formatNumberToBRL(payload[0].value as number)}</p>
                                      {payload[0]?.name === 'Crédito Parcelado' && (
                                        <p className="text-[9px] text-blue-500 font-bold mt-1">Clique para detalhar ↗</p>
                                      )}
                                    </div>
                                  ) : null
                                }
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="space-y-2.5 mt-2">
                          {linxData.categoriaGeral.map((item: any, i: number) => {
                            const isParcelado = item.name === 'Crédito Parcelado';
                            return (
                              <div
                                key={i}
                                onClick={() => isParcelado && linxData.parcelasOrdenadas?.length > 0 && setSelectedCategoria('Crédito Parcelado')}
                                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors ${isParcelado ? 'hover:bg-blue-50 cursor-pointer' : ''}`}
                              >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                                <span className="text-xs font-semibold text-slate-700 flex-1 truncate">{item.name}</span>
                                <span className="text-[10px] font-black text-slate-400 w-8 text-right">{item.pct}%</span>
                                <span className="text-xs font-bold text-slate-600 text-right" style={{ minWidth: 88 }}>
                                  {formatNumberToBRL(item.value)}
                                </span>
                                {isParcelado && (
                                  <ChevronRight size={13} className="text-blue-400 shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {selectedCategoria === 'Crédito Parcelado' && linxData.parcelasOrdenadas?.length > 0 && (
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Parcelado</p>
                            <p className="text-lg font-black text-blue-600">{formatNumberToBRL(linxData.totalParcelado)}</p>
                          </div>
                          <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2.5 py-1 rounded-full">
                            {linxData.parcelasOrdenadas.length} modalidades
                          </span>
                        </div>

                        <div className="space-y-1">
                          {linxData.parcelasOrdenadas.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                                <span className="text-xs font-black text-blue-600">{p.label.replace('À Vista (', '').replace(')', '')}</span>
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-bold text-slate-700">{p.label}</p>
                                  <p className="text-xs font-black text-slate-800">{formatNumberToBRL(p.total)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-blue-500"
                                      style={{ width: `${p.pctDoParccelado}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-black text-slate-400 shrink-0 w-14 text-right">
                                    {p.qtd} vend. · {p.pctDoParccelado}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </>
            )}

            {!isProcessingLinx && !linxData && !errorMsgLinx && (
              <div className="py-28 flex flex-col items-center justify-center text-slate-300 gap-5">
                <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm border border-slate-100">
                  <TrendingUp size={36} className="text-slate-200" />
                </div>
                <div className="text-center">
                  <p className="font-black text-xs uppercase tracking-[0.3em] text-slate-300">Aguardando dados da API</p>
                  <p className="text-xs text-slate-300 mt-1">Conectando em <span className="font-mono">{API_URL}</span></p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ==========================================
// COMPONENTES AUXILIARES
// ==========================================
function StatusBadge({ label, status, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    slate: "bg-white text-slate-400 border-slate-200"
  };
  return (
    <div className={`border p-4 rounded-[1rem] flex items-center justify-between ${colors[color]}`}>
      <span className="text-xs font-black uppercase tracking-widest">{label}</span>
      <span className="text-sm font-bold">{status}</span>
    </div>
  );
}