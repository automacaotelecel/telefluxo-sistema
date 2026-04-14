
import React, { useMemo, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Search, UploadCloud } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Objetivo:
 * - reproduzir o quadro operacional no estilo do Excel
 * - uma linha por MODELO + CAMPANHA
 * - juntar:
 *   PDF (campanha/período/qtd/verba)
 *   Google Sheets (basicModel -> descrição/ref)
 *   /stock (estoque/custo/lojas)
 *   /sales (vendas no período)
 *   /price-table (preço sistema)
 */

type TraducaoMkt = {
  basicModel: string;
  marketingName: string;
  descricao2: string;
  referencia2: string;
};

type PdfItem = {
  arquivo: string;
  refCampanha: string;
  campanha: string;
  tipoCampanha: string;
  inicio: string;
  termino: string;
  modeloPdf: string;
  quantidadeCarta: number;
  verbaUnitaria: number;
  verbaTotal: number;
};

type PriceRow = {
  descricao: string;
  referencia: string;
  precoSamsung: number;
  precoTelecel: number;
  ofertaAtual: number;
};

type StockRow = {
  referencia2: string;
  descricao: string;
  quantidade: number;
  custoMedio: number;
  custoTotal: number;
  lojas: string[];
  status: string;
};

type SaleAgg = {
  quantidade: number;
};

type LinhaTabela = {
  descricao: string;
  referencia: string;
  precoSamsung: number;
  precoTelecel: number;
  totalDescontoTelecel: number;
  descontoRebate: number;
  descontoTradeIn: number;
  descontoBogo: number;
  descontoSip: number;
  totalDesconto: number;
  precoPromocional: number;
  tipoPromocao: string;
  periodo: string;
  refCampanha: string;
  campanha: string;
  modeloPdf: string;
  basicModel: string;
  qtdEstoque: number;
  custoTotalEstoque: number;
  custoMedioEstoque: number;
  margemEstoque: number | null;
  novoCustoMedio: number | null;
  margemPrice: number | null;
  qtdVendida: number;
  verbaUnitaria: number;
  verbaTotal: number;
  ofertaAtual: number;
  lojas: string;
  status: string;
};

const formatMoney = (value: number | null | undefined) => {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatNumber = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('pt-BR');

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(2).replace('.', ',')}%`;
};

const normalizeLine = (value: string) =>
  String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[‐‑–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeBasicModel = (value: string) => {
  const raw = String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐‑–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9\/-]/g, '');

  if (!raw) return '';

  let model = raw
    .replace(/^BSM(?!-)/, 'BSM-')
    .replace(/^BSM--+/, 'BSM-')
    .replace(/-+/g, '-');

  if (model.startsWith('BSM/') || model === 'BSM') {
    model = model.replace(/^BSM\/?/, 'BSM-');
  }

  if (!model.startsWith('BSM-')) {
    model = `BSM-${model.replace(/^BSM/, '')}`;
  }

  return model;
};

const normalizeReference = (value: string) =>
  String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐‑–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();

const normalizeDesc = (value: string) =>
  String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseMoneyBR = (value: string) => {
  if (!value) return 0;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
};

const toNumber = (value: any) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
};

const familyFromReference = (value: string) => {
  const ref = normalizeReference(value);
  const m = ref.match(/^([A-Z]{2,3}-[A-Z]?\d{3})/i);
  return m?.[1]?.toUpperCase() || ref;
};

const getCurrentUserId = () => {
  for (const key of ['telefluxo_user', 'user']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.id) return String(parsed.id);
    } catch {
      // ignore
    }
  }
  return '';
};

const getApiCandidates = (path: string) => {
  const sameOrigin = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}${path}`
    : '';

  if (path === '/api/comparativos/mkt-base' || path.startsWith('/price-table')) {
    return [sameOrigin, `http://localhost:3000${path}`].filter(Boolean);
  }

  return [
    sameOrigin,
    `http://localhost:3000${path}`,
    `https://telefluxo-aplicacao.onrender.com${path}`,
  ].filter(Boolean);
};

const fetchJsonFromCandidates = async (path: string) => {
  const candidates = getApiCandidates(path);
  let lastError = `Não consegui acessar ${path}`;

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = `Falha ao ler ${url} (${response.status})`;
        continue;
      }
      return { url, data: await response.json() };
    } catch (error: any) {
      lastError = error?.message || `Erro ao acessar ${url}`;
    }
  }

  throw new Error(lastError);
};

const extractFieldFromLines = (lines: string[], label: string) => {
  const lowerLabel = label.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeLine(lines[i]);
    if (!line.toLowerCase().startsWith(lowerLabel)) continue;

    const valueFromSameLine = normalizeLine(line.replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), ''));
    if (valueFromSameLine) return valueFromSameLine;

    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = normalizeLine(lines[j]);
      if (!nextLine || nextLine === ':') continue;
      return nextLine;
    }
  }

  return '';
};

const extractTitleFromLines = (lines: string[]) => {
  const idx = lines.findIndex((line) => normalizeLine(line).toLowerCase().startsWith('título da campanha'));
  if (idx < 0) return '';

  const collected: string[] = [];
  const currentLine = normalizeLine(lines[idx]);
  const titleStart = normalizeLine(currentLine.replace(/^Título da campanha\s*:?\s*/i, ''));
  if (titleStart) collected.push(titleStart);

  for (let i = idx + 1; i < lines.length; i++) {
    const line = normalizeLine(lines[i]);
    if (!line) continue;
    if (/^(Produto|Modelo|Period|Período|Verba unit\.|Quantidade|\*?Verba Max\.|Início|Término)$/i.test(line)) break;
    if (/^SMART PHONE\b/i.test(line)) break;
    collected.push(line);
  }

  return normalizeLine(collected.join(' '));
};

const extractPdfContent = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines: string[] = [];
  const allTextParts: string[] = [];
  const pagesToRead = Math.min(pdf.numPages, 2);

  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rowsMap = new Map<number, any[]>();

    (textContent.items as any[]).forEach((item: any) => {
      const str = normalizeLine(item.str || '');
      if (!str) return;
      allTextParts.push(str);
      const y = Math.round((item.transform?.[5] || 0) / 2) * 2;
      if (!rowsMap.has(y)) rowsMap.set(y, []);
      rowsMap.get(y)?.push(item);
    });

    const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);
    sortedY.forEach((y) => {
      const rowItems = rowsMap.get(y) || [];
      rowItems.sort((a: any, b: any) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0));
      const rowText = normalizeLine(rowItems.map((item: any) => item.str || '').join(' '));
      if (rowText) lines.push(rowText);
    });
  }

  return {
    lines,
    fullText: normalizeLine(allTextParts.join(' ')),
  };
};

const parseItemsFromText = (fullText: string) => {
  const items: Array<{
    modelo: string;
    inicio: string;
    termino: string;
    verbaUnitaria: number;
    quantidade: number;
    verbaTotal: number;
  }> = [];

  const normalized = normalizeLine(fullText)
    .replace(/BSM\s+-\s+/g, 'BSM-')
    .replace(/BSM\s+/g, 'BSM-');

  const patterns = [
    /(?:SMART PHONE\s+)?(BSM-[A-Z]\d{3}[A-Z0-9\/-]+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+([\d\.,]+)\s+(\d+)\s+([\d\.,]+)/gi,
    /(?:SMART PHONE\s+)?(?:BSM-)?([A-Z]\d{3}[A-Z0-9\/-]+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+([\d\.,]+)\s+(\d+)\s+([\d\.,]+)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const rawModel = match[1].startsWith('BSM-') ? match[1] : `BSM-${match[1]}`;
      const modelo = normalizeBasicModel(rawModel);
      if (!modelo) continue;

      const exists = items.some((item) => item.modelo === modelo && item.inicio === match![2] && item.termino === match![3]);
      if (exists) continue;

      items.push({
        modelo,
        inicio: match[2],
        termino: match[3],
        verbaUnitaria: parseMoneyBR(match[4]),
        quantidade: Number(match[5]) || 0,
        verbaTotal: parseMoneyBR(match[6]),
      });
    }
  }

  return items;
};

const parseCampaignFromPdf = async (file: File): Promise<PdfItem[]> => {
  const parsed = await extractPdfContent(file);
  const { lines, fullText } = parsed;

  const refCampanha =
    fullText.match(/N[ºo°]\s*Referência do Programa\s*:?\s*([A-Z0-9]+)/i)?.[1] || '';

  const campanha = extractTitleFromLines(lines);
  const tipoCampanha = normalizeLine(lines[0] || 'CAMPANHA');

  const rawItems = parseItemsFromText(fullText);
  return rawItems.map((item) => ({
    arquivo: file.name,
    refCampanha,
    campanha,
    tipoCampanha,
    inicio: item.inicio,
    termino: item.termino,
    modeloPdf: item.modelo,
    quantidadeCarta: item.quantidade,
    verbaUnitaria: item.verbaUnitaria,
    verbaTotal: item.verbaTotal,
  }));
};

const buildTraducaoMap = (rows: any[]) => {
  const map = new Map<string, TraducaoMkt>();

  rows.forEach((row) => {
    const basicModel = normalizeBasicModel(row.basicModel || row.basic_model || row['Basic Model'] || '');
    if (!basicModel) return;

    map.set(basicModel, {
      basicModel,
      marketingName: String(row.marketingName || row.marketing_name || row['Marketing Name'] || '').trim(),
      descricao2: String(row.descricao2 || row['DESCRIÇÃO 2'] || row['DESCRICAO 2'] || '').trim(),
      referencia2: normalizeReference(row.referencia2 || row['REFERENCIA 2'] || row['REFERÊNCIA 2'] || ''),
    });
  });

  return map;
};

const buildStockMap = (records: any[]) => {
  const grouped = new Map<string, StockRow>();

  records.forEach((item) => {
    const reference = normalizeReference(item.reference || item.REFERENCIA || item.REFERENCIA2 || item.referencia2 || '');
    const reference2 = familyFromReference(reference || item.referencia2 || item.REFERENCIA2 || '');
    if (!reference2) return;

    const descricao = String(item.description || item.DESCRICAO || item['DESCRIÇÃO 2'] || '').trim();
    const quantity = toNumber(item.quantity || item.QUANTIDADE || item.SALDO);
    const avgCost =
      toNumber(item.averageCost || item.CUSTO_MEDIO || item['CUSTO MÉDIO ESTOQUE'] || item['CUSTO NOVO PREÇO']) ||
      toNumber(item.costPrice || item.PRECO_CUSTO || item['CUSTO COMPRA CORRETO']);
    const store = String(item.storeName || item.NOME_FANTASIA || '').trim();
    const status = String(item.status || item.STATUS || item.Coluna3 || '').trim();

    if (!grouped.has(reference2)) {
      grouped.set(reference2, {
        referencia2: reference2,
        descricao,
        quantidade: 0,
        custoMedio: 0,
        custoTotal: 0,
        lojas: [],
        status,
      });
    }

    const current = grouped.get(reference2)!;
    current.quantidade += quantity;
    current.custoTotal += avgCost * quantity;
    if (store && !current.lojas.includes(store)) current.lojas.push(store);
    if (!current.descricao && descricao) current.descricao = descricao;
    if (!current.status && status) current.status = status;
  });

  grouped.forEach((row) => {
    row.custoMedio = row.quantidade > 0 ? row.custoTotal / row.quantidade : 0;
  });

  return grouped;
};

const buildSalesMap = (rows: any[]) => {
  const byDesc = new Map<string, SaleAgg>();
  const byFamily = new Map<string, SaleAgg>();

  rows.forEach((row) => {
    const desc = normalizeDesc(row.DESCRICAO || row.descricao || row['DESCRIÇÃO 2'] || '');
    const familia = familyFromReference(String(row.FAMILIA || row.familia || row.REFERENCIA || row.referencia || ''));
    const qtd = toNumber(row.QUANTIDADE ?? row.quantidade ?? 0);

    if (desc) {
      byDesc.set(desc, { quantidade: (byDesc.get(desc)?.quantidade || 0) + qtd });
    }
    if (familia) {
      byFamily.set(familia, { quantidade: (byFamily.get(familia)?.quantidade || 0) + qtd });
    }
  });

  return { byDesc, byFamily };
};

const buildPriceMap = (rows: any[]) => {
  const byDesc = new Map<string, PriceRow>();
  const byRef = new Map<string, PriceRow>();

  const getCandidate = (row: any, names: string[]) => {
    for (const n of names) {
      if (row?.[n] !== undefined && row?.[n] !== null && row?.[n] !== '') return row[n];
    }
    return '';
  };

  rows.forEach((row) => {
    const descricao = String(
      getCandidate(row, ['DESCRIÇÃO', 'descricao', 'description', 'model', 'modelo'])
    ).trim();

    const referencia = familyFromReference(
      String(getCandidate(row, ['REFERENCIA', 'referencia', 'reference', 'sku', 'SKU']))
    );

    const precoSamsung = toNumber(getCandidate(row, ['PREÇO SAMSUNG', 'precoSamsung', 'preco_samsung', 'samsungPrice']));
    const precoTelecel = toNumber(getCandidate(row, ['PREÇO TELECEL', 'precoTelecel', 'preco_telecel', 'price', 'currentPrice']));
    const ofertaAtual = toNumber(getCandidate(row, ['PREÇO FINAL', 'precoFinal', 'preco_final', 'offerPrice', 'ofertaAtual']));

    const payload: PriceRow = {
      descricao,
      referencia,
      precoSamsung,
      precoTelecel,
      ofertaAtual,
    };

    if (descricao) byDesc.set(normalizeDesc(descricao), payload);
    if (referencia) byRef.set(referencia, payload);
  });

  return { byDesc, byRef };
};

const margin = (price: number, cost: number) => {
  if (!price || price <= 0) return null;
  return (price - cost) / price;
};

const TableHeader = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <th className={`px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-left border-b border-slate-200 whitespace-nowrap ${className}`}>
    {children}
  </th>
);

const TableCell = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-3 py-3 text-sm text-slate-700 border-b border-slate-100 align-top ${className}`}>{children}</td>
);

export default function ComparativosModule() {
  const [rows, setRows] = useState<LinhaTabela[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [apiInfo, setApiInfo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const processFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;

    setLoading(true);
    setErrorMsg('');
    setApiInfo('');

    try {
      const pdfItems = (await Promise.all(files.map((file) => parseCampaignFromPdf(file)))).flat();

      const allDates = pdfItems.flatMap((i) => [i.inicio, i.termino]).filter(Boolean);
      const isoDates = allDates
        .map((d) => {
          const [day, month, year] = d.split('.');
          return `${year}-${month}-${day}`;
        })
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

      const startDate = isoDates[0] || '';
      const endDate = isoDates[isoDates.length - 1] || '';
      const userId = getCurrentUserId();

      const [baseResp, stockResp, priceResp, salesResp] = await Promise.all([
        fetchJsonFromCandidates('/api/comparativos/mkt-base'),
        fetchJsonFromCandidates('/stock'),
        fetchJsonFromCandidates('/price-table?category=Aparelhos'),
        userId && startDate && endDate
          ? fetchJsonFromCandidates(`/sales?userId=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
          : Promise.resolve({ url: '', data: { sales: [] } }),
      ]);

      const traducaoRows = Array.isArray(baseResp.data?.rows)
        ? baseResp.data.rows
        : Array.isArray(baseResp.data)
          ? baseResp.data
          : [];

      const traducaoMap = buildTraducaoMap(traducaoRows);
      const stockMap = buildStockMap(Array.isArray(stockResp.data) ? stockResp.data : []);
      const priceMap = buildPriceMap(Array.isArray(priceResp.data) ? priceResp.data : []);
      const salesMap = buildSalesMap(Array.isArray(salesResp.data?.sales) ? salesResp.data.sales : []);

      const finalRows: LinhaTabela[] = pdfItems.map((item) => {
        const traducao = traducaoMap.get(normalizeBasicModel(item.modeloPdf));
        const descricao = traducao?.descricao2 || traducao?.marketingName || '-';
        const referencia = familyFromReference(traducao?.referencia2 || '');
        const stock = stockMap.get(referencia);
        const price =
          priceMap.byRef.get(referencia) ||
          priceMap.byDesc.get(normalizeDesc(descricao));

        const qtdVendida =
          salesMap.byDesc.get(normalizeDesc(descricao))?.quantidade ||
          salesMap.byFamily.get(referencia)?.quantidade ||
          0;

        const precoSamsung = price?.precoSamsung || 0;
        const precoTelecel = price?.precoTelecel || 0;
        const ofertaAtual = price?.ofertaAtual || 0;
        const totalDescontoTelecel = Math.max(precoSamsung - precoTelecel, 0);

        // No PDF atual só temos verba unitária/total por item.
        // Então colocamos a verba unitária como desconto principal da campanha.
        const descontoRebate = item.tipoCampanha.toUpperCase().includes('REBATE') ? item.verbaUnitaria : 0;
        const descontoTradeIn = item.tipoCampanha.toUpperCase().includes('TRADE') ? item.verbaUnitaria : 0;
        const descontoBogo = item.tipoCampanha.toUpperCase().includes('BOGO') ? item.verbaUnitaria : 0;
        const descontoSip = item.tipoCampanha.toUpperCase().includes('SIP') ? item.verbaUnitaria : 0;

        const totalDesconto = totalDescontoTelecel + descontoRebate + descontoTradeIn + descontoBogo + descontoSip;
        const precoPromocional = precoSamsung > 0 ? Math.max(precoSamsung - totalDesconto, 0) : 0;
        const custoMedioEstoque = stock?.custoMedio || 0;
        const custoTotalEstoque = stock?.custoTotal || 0;
        const novoCustoMedio = custoMedioEstoque - item.verbaUnitaria;
        const margemEstoque = precoTelecel > 0 ? margin(precoTelecel, custoMedioEstoque) : null;
        const margemPrice = precoPromocional > 0 ? margin(precoPromocional, Math.max(novoCustoMedio, 0)) : null;

        let status = '-';
        if (ofertaAtual > 0 && precoPromocional > 0) {
          if (ofertaAtual < precoPromocional) status = 'MENOR';
          else if (ofertaAtual > precoPromocional) status = 'MAIOR';
          else status = 'IGUAL';
        } else if (stock?.status) {
          status = stock.status;
        }

        return {
          descricao: descricao || stock?.descricao || '-',
          referencia,
          precoSamsung,
          precoTelecel,
          totalDescontoTelecel,
          descontoRebate,
          descontoTradeIn,
          descontoBogo,
          descontoSip,
          totalDesconto,
          precoPromocional,
          tipoPromocao: item.tipoCampanha,
          periodo: item.inicio && item.termino ? `${item.inicio} a ${item.termino}` : '-',
          refCampanha: item.refCampanha,
          campanha: item.campanha,
          modeloPdf: item.modeloPdf,
          basicModel: traducao?.basicModel || normalizeBasicModel(item.modeloPdf),
          qtdEstoque: stock?.quantidade || 0,
          custoTotalEstoque,
          custoMedioEstoque,
          margemEstoque,
          novoCustoMedio: Number.isFinite(novoCustoMedio) ? novoCustoMedio : null,
          margemPrice,
          qtdVendida,
          verbaUnitaria: item.verbaUnitaria,
          verbaTotal: item.verbaTotal,
          ofertaAtual,
          lojas: stock?.lojas.join(' | ') || '-',
          status,
        };
      });

      finalRows.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

      setRows(finalRows);
      setApiInfo(
        `Google Sheets: ${traducaoMap.size} modelos · Estoque: ${stockMap.size} famílias · Vendas: ${salesMap.byDesc.size} descrições · Preços: ${priceMap.byDesc.size + priceMap.byRef.size} chaves`
      );
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao processar comparativo.');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) =>
      [
        row.descricao,
        row.referencia,
        row.refCampanha,
        row.campanha,
        row.modeloPdf,
        row.basicModel,
        row.tipoPromocao,
        row.lojas,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [rows, searchTerm]);

  const summary = useMemo(() => ({
    campanhas: new Set(filteredRows.map((r) => r.refCampanha)).size,
    modelos: filteredRows.length,
    estoque: filteredRows.reduce((sum, r) => sum + r.qtdEstoque, 0),
    vendida: filteredRows.reduce((sum, r) => sum + r.qtdVendida, 0),
    verba: filteredRows.reduce((sum, r) => sum + r.verbaTotal, 0),
  }), [filteredRows]);

  const exportExcel = () => {
    const data = filteredRows.map((row) => ({
      'DESCRIÇÃO': row.descricao,
      'REFERENCIA': row.referencia,
      'PREÇO SAMSUNG': row.precoSamsung,
      'PREÇO TELECEL': row.precoTelecel,
      'TOTAL DESCONTO TELECEL': row.totalDescontoTelecel,
      'DESCONTO REBATE': row.descontoRebate,
      'DESCONTO TRADE IN': row.descontoTradeIn,
      'DESCONTO BOGO': row.descontoBogo,
      'DESCONTO SIP': row.descontoSip,
      'TOTAL DESCONTO (TELECEL + SAMSUNG)': row.totalDesconto,
      'PREÇO PROMOCIONAL (TELECEL + SAMSUNG)': row.precoPromocional,
      'TIPO DE PROMOÇÃO SAMSUNG E DATA': row.tipoPromocao,
      'PERÍODO': row.periodo,
      'REF. CAMPANHA': row.refCampanha,
      'CAMPANHA': row.campanha,
      'MODELO PDF': row.modeloPdf,
      'BASIC MODEL': row.basicModel,
      'QTD EM ESTOQUE': row.qtdEstoque,
      'CUSTO TOTAL EM ESTOQUE': row.custoTotalEstoque,
      'CUSTO MÉDIO ESTOQUE': row.custoMedioEstoque,
      'MARGEM ESTOQUE': row.margemEstoque,
      'NOVO CUSTO MÉDIO ESTOQUE (PRICE)': row.novoCustoMedio,
      'MARGEM PRICE': row.margemPrice,
      'QTD VENDIDA': row.qtdVendida,
      'PRICE CAMPANHA': row.verbaUnitaria,
      'VERBA TOTAL': row.verbaTotal,
      'OFERTA ATUAL': row.ofertaAtual,
      'LOJAS': row.lojas,
      'STATUS': row.status,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Comparativo');
    XLSX.writeFile(workbook, `comparativo_ofertas_${Date.now()}.xlsx`);
  };

  return (
    <div className="w-full bg-slate-50 min-h-screen">
      <div className="mx-auto max-w-[1700px] px-6 py-6 space-y-5">
        <div className="bg-white rounded-[28px] border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[18px] font-black uppercase tracking-tight text-slate-900">
                Comparativo de Ofertas
              </h1>
              <p className="text-[12px] text-slate-500 mt-1">
                Quadro no estilo do Excel: sistema + cartas + estoque + vendas.
              </p>
              {apiInfo && (
                <p className="mt-3 text-[11px] font-black uppercase tracking-widest text-emerald-600">
                  {apiInfo}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-5 py-3 text-sm font-black cursor-pointer shadow-sm">
                <UploadCloud size={16} />
                Importar PDFs
                <input type="file" className="hidden" accept="application/pdf" multiple onChange={processFiles} />
              </label>

              <button
                type="button"
                onClick={exportExcel}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 text-white px-5 py-3 text-sm font-black shadow-sm"
              >
                <FileSpreadsheet size={16} />
                Exportar Excel
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">{errorMsg}</div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-[28px] border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-[16px] font-black uppercase tracking-tight text-slate-900">
                Quadro consolidado
              </h2>
              <p className="text-[12px] text-slate-500 mt-1">
                Uma linha por modelo + campanha, no padrão operacional do Excel.
              </p>
            </div>

            <div className="relative w-full xl:w-[360px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por descrição, campanha, referência ou modelo"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 xl:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Campanhas</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{formatNumber(summary.campanhas)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Modelos</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{formatNumber(summary.modelos)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Qtd. Estoque</div>
              <div className="mt-2 text-3xl font-black text-emerald-600">{formatNumber(summary.estoque)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Qtd. Vendida</div>
              <div className="mt-2 text-3xl font-black text-blue-600">{formatNumber(summary.vendida)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Verba Total</div>
              <div className="mt-2 text-3xl font-black text-violet-600">{formatMoney(summary.verba)}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">Role para os lados para ver todas as colunas</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">Role para baixo para ver todas as linhas</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">Descrição e Referência ficam fixas</span>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            <div className="max-h-[72vh] overflow-auto overscroll-contain">
              <table className="min-w-[3200px] w-full border-separate border-spacing-0 bg-white">
                <thead className="sticky top-0 z-30 bg-slate-50 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <TableHeader className="sticky left-0 z-40 min-w-[220px] bg-slate-50 shadow-[1px_0_0_0_rgba(226,232,240,1)]">Descrição</TableHeader>
                    <TableHeader className="sticky left-[220px] z-40 min-w-[110px] bg-slate-50 shadow-[1px_0_0_0_rgba(226,232,240,1)]">Referência</TableHeader>
                    <TableHeader className="min-w-[95px]">Preço Samsung</TableHeader>
                    <TableHeader className="min-w-[95px]">Preço Telecel</TableHeader>
                    <TableHeader className="min-w-[130px]">Total Desconto Telecel</TableHeader>
                    <TableHeader className="min-w-[110px]">Desconto Rebate</TableHeader>
                    <TableHeader className="min-w-[115px]">Desconto Trade In</TableHeader>
                    <TableHeader className="min-w-[100px]">Desconto Bogo</TableHeader>
                    <TableHeader className="min-w-[95px]">Desconto SIP</TableHeader>
                    <TableHeader className="min-w-[110px]">Total Desconto</TableHeader>
                    <TableHeader className="min-w-[120px]">Preço Promocional</TableHeader>
                    <TableHeader className="min-w-[180px]">Tipo Promoção</TableHeader>
                    <TableHeader className="min-w-[145px]">Período</TableHeader>
                    <TableHeader className="min-w-[135px]">Ref. Campanha</TableHeader>
                    <TableHeader className="min-w-[280px]">Campanha</TableHeader>
                    <TableHeader className="min-w-[155px]">Modelo PDF</TableHeader>
                    <TableHeader className="min-w-[155px]">Basic Model</TableHeader>
                    <TableHeader className="min-w-[95px] text-right">Qtd Estoque</TableHeader>
                    <TableHeader className="min-w-[125px] text-right">Custo Total Estoque</TableHeader>
                    <TableHeader className="min-w-[125px] text-right">Custo Médio Estoque</TableHeader>
                    <TableHeader className="min-w-[105px] text-right">Margem Estoque</TableHeader>
                    <TableHeader className="min-w-[120px] text-right">Novo Custo Médio</TableHeader>
                    <TableHeader className="min-w-[100px] text-right">Margem Price</TableHeader>
                    <TableHeader className="min-w-[95px] text-right">Qtd Vendida</TableHeader>
                    <TableHeader className="min-w-[105px] text-right">Price Campanha</TableHeader>
                    <TableHeader className="min-w-[105px] text-right">Verba Total</TableHeader>
                    <TableHeader className="min-w-[105px] text-right">Oferta Atual</TableHeader>
                    <TableHeader className="min-w-[280px]">Lojas</TableHeader>
                    <TableHeader className="min-w-[90px]">Status</TableHeader>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => (
                    <tr key={`${row.refCampanha}-${row.basicModel}-${idx}`} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}>
                      <TableCell className="sticky left-0 z-20 min-w-[220px] bg-inherit font-black text-slate-900 shadow-[1px_0_0_0_rgba(241,245,249,1)] break-words">
                        {row.descricao}
                      </TableCell>
                      <TableCell className="sticky left-[220px] z-20 min-w-[110px] bg-inherit whitespace-nowrap shadow-[1px_0_0_0_rgba(241,245,249,1)]">
                        {row.referencia || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.precoSamsung)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.precoTelecel)}</TableCell>
                      <TableCell className="whitespace-nowrap text-red-600 font-semibold">{formatMoney(row.totalDescontoTelecel)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.descontoRebate)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.descontoTradeIn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.descontoBogo)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMoney(row.descontoSip)}</TableCell>
                      <TableCell className="whitespace-nowrap text-red-600 font-black">{formatMoney(row.totalDesconto)}</TableCell>
                      <TableCell className="whitespace-nowrap text-orange-600 font-black">{formatMoney(row.precoPromocional)}</TableCell>
                      <TableCell className="min-w-[180px] break-words">{row.tipoPromocao}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.periodo}</TableCell>
                      <TableCell className="font-black whitespace-nowrap">{row.refCampanha || '-'}</TableCell>
                      <TableCell className="min-w-[280px] break-words">{row.campanha || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.modeloPdf}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.basicModel}</TableCell>
                      <TableCell className="text-right font-black text-emerald-600">{formatNumber(row.qtdEstoque)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatMoney(row.custoTotalEstoque)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatMoney(row.custoMedioEstoque)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatPercent(row.margemEstoque)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{row.novoCustoMedio === null ? '-' : formatMoney(row.novoCustoMedio)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatPercent(row.margemPrice)}</TableCell>
                      <TableCell className="text-right font-black text-blue-600">{formatNumber(row.qtdVendida)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatMoney(row.verbaUnitaria)}</TableCell>
                      <TableCell className="text-right font-black text-violet-600 whitespace-nowrap">{formatMoney(row.verbaTotal)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatMoney(row.ofertaAtual)}</TableCell>
                      <TableCell className="min-w-[280px] break-words">{row.lojas}</TableCell>
                      <TableCell className={`font-black whitespace-nowrap ${row.status === 'MENOR' ? 'text-emerald-600' : row.status === 'MAIOR' ? 'text-red-600' : 'text-slate-700'}`}>
                        {row.status}
                      </TableCell>
                    </tr>
                  ))}
                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={29} className="px-4 py-16 text-center text-slate-400">
                        Importe as cartas em PDF para montar o quadro.
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={29} className="px-4 py-16 text-center text-slate-500">
                        Processando cartas e cruzando com o sistema...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>        </div>
      </div>
    </div>
  );
}
