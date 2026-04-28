
import React, { useMemo, useRef, useState } from 'react';
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

type PriceGuideRow = {
  descricao: string;
  referencia: string;
  precoSamsung: number;
  descontoTelecel: number;
  descontoRebate: number;
  descontoTradeIn: number;
  descontoBogo: number;
  descontoSip: number;
  priceRebate: number;
  priceTradeIn: number;
  priceBogo: number;
  priceSip: number;
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

type ComparativoKind = 'REBATE_TRADEIN' | 'BOGO' | 'SIP';
type ComparativoTab = 'com_ofertas' | 'sem_ofertas';
type EditableDiscountField = 'descontoRebate' | 'descontoTradeIn' | 'descontoBogo' | 'descontoSip';

type PendingComparativoData = {
  pdfItems: PdfItem[];
  traducaoRows: any[];
  stockRows: any[];
  priceRows: any[];
  priceGuideRows: any[];
  salesRows: any[];
};


type LinhaTabela = {
  rowKey: string;
  hasOferta: boolean;
  isSelected: boolean;
  comparativoKind: ComparativoKind | null;
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
  priceRebate: number;
  priceTradeIn: number;
  priceBogo: number;
  priceSip: number;
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

const formatEditableNumber = (value: number | null | undefined) => {
  const n = Number(value || 0);
  if (!n) return '';
  return String(n).replace('.', ',');
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

const getCurrentMonthRange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  return {
    startDate: `${y}-${m}-01`,
    endDate: `${y}-${m}-${d}`,
  };
};

const API_BASE_URL = 'https://telefluxo-aplicacao.onrender.com';

const isLocalFrontend = () => {
  if (typeof window === 'undefined') return false;

  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
};

const getApiCandidates = (path: string) => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (isLocalFrontend()) {
    return [
      `http://localhost:3000${cleanPath}`,
      `${API_BASE_URL}${cleanPath}`,
    ];
  }

  return [
    `${API_BASE_URL}${cleanPath}`,
  ];
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


const postJsonToCandidates = async (path: string, payload: any) => {
  const candidates = getApiCandidates(path);
  let lastError = `Não consegui enviar ${path}`;

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        lastError = responseData?.error || `Falha ao enviar ${url} (${response.status})`;
        continue;
      }

      return { url, data: responseData };
    } catch (error: any) {
      lastError = error?.message || `Erro ao enviar ${url}`;
    }
  }

  throw new Error(lastError);
};

const getCurrentUserInfo = () => {
  for (const key of ['telefluxo_user', 'user']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.id || parsed?.name) return parsed;
    } catch {
      // ignore
    }
  }
  return {};
};

const PRICE_GUIDE_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1yInC46qAWka0S69njfFoXzJpYO4c1xVR_z3eEWBhkR4/export?format=csv&gid=0';

const normalizeHeader = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const getExcelColumnName = (index: number) => {
  let n = index + 1;
  let name = '';

  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }

  return name;
};

const fetchPriceGuideSheet = async () => {
  try {
    const response = await fetch(PRICE_GUIDE_SHEET_CSV_URL, {
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(`Não consegui ler a planilha guia de preços (${response.status})`);
      return { url: PRICE_GUIDE_SHEET_CSV_URL, data: [] };
    }

    const csvText = await response.text();

    const workbook = XLSX.read(csvText, { type: 'string' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return { url: PRICE_GUIDE_SHEET_CSV_URL, data: [] };
    }

    const sheet = workbook.Sheets[firstSheetName];

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    }) as any[][];

    if (rawRows.length < 2) {
      return { url: PRICE_GUIDE_SHEET_CSV_URL, data: [] };
    }

    const headers = (rawRows[0] || []).map((h: any) => String(h || '').trim());

    const data = rawRows.slice(1).map((cols) => {
      const row: any = {};

      headers.forEach((header, index) => {
        const value = cols[index] ?? '';
        const excelColumn = getExcelColumnName(index);

        if (header) row[header] = value;

        // Fallback por letra da coluna, útil quando o cabeçalho vem com quebra de linha ou símbolo.
        row[`__col${excelColumn}`] = value;
      });

      return row;
    });

    return {
      url: PRICE_GUIDE_SHEET_CSV_URL,
      data,
    };
  } catch (error) {
    console.warn('Falha ao ler planilha guia de preços. Mantendo estrutura atual.', error);
    return { url: PRICE_GUIDE_SHEET_CSV_URL, data: [] };
  }
};

const buildPriceGuideMap = (rows: any[]) => {
  const byDesc = new Map<string, PriceGuideRow>();
  const byRef = new Map<string, PriceGuideRow>();
  const allRows: PriceGuideRow[] = [];

  const getCandidate = (row: any, names: string[]) => {
    const keys = Object.keys(row || {});

    for (const name of names) {
      if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== '') {
        return row[name];
      }

      const wanted = normalizeHeader(name);
      const foundKey = keys.find((key) => normalizeHeader(key) === wanted);

      if (
        foundKey &&
        row?.[foundKey] !== undefined &&
        row?.[foundKey] !== null &&
        row?.[foundKey] !== ''
      ) {
        return row[foundKey];
      }
    }

    return '';
  };

  rows.forEach((row) => {
    const descricao = String(
      getCandidate(row, [
        'DESCRIÇÃO',
        'DESCRICAO',
        'DESCRIÇÃO 2',
        'DESCRICAO 2',
        'PRODUTO',
        'MODELO',
        'MODEL',
        '__colB',
        '__colA',
      ])
    ).trim();

    const referencia = familyFromReference(
      String(
        getCandidate(row, [
          'REFERENCIA',
          'REFERÊNCIA',
          'REFERENCIA 2',
          'REFERÊNCIA 2',
          'REF',
          'SKU',
          'CÓDIGO',
          'CODIGO',
          'REFERENCE',
          '__colC',
          '__colB',
          '__colA',
        ])
      )
    );

    const precoSamsung = toNumber(
      getCandidate(row, [
        'PREÇO SSG',
        'PRECO SSG',
        'PREÇO SAMSUNG',
        'PRECO SAMSUNG',
        'SSG',
        '__colD',
      ])
    );

    const descontoTelecel = toNumber(
      getCandidate(row, [
        'DESC. TELECEL',
        'DESC TELECEL',
        'DESCONTO TELECEL',
        'TOTAL DESCONTO TELECEL',
        '__colE',
      ])
    );

    const descontoRebate = toNumber(
      getCandidate(row, [
        'REBATE',
        'DESCONTO REBATE',
        '__colF',
      ])
    );

    const descontoTradeIn = toNumber(
      getCandidate(row, [
        'TRADE IN',
        'DESCONTO TRADE IN',
        '__colG',
      ])
    );

    const descontoBogo = toNumber(
      getCandidate(row, [
        'BOGO',
        'DESCONTO BOGO',
        '__colH',
      ])
    );

    const descontoSip = toNumber(
      getCandidate(row, [
        'SIP',
        'DESCONTO SIP',
        '__colI',
      ])
    );

    const priceRebate = toNumber(
      getCandidate(row, [
        'PRICE REBATE',
        'PREÇO REBATE',
        'PRECO REBATE',
        '__colAE',
      ])
    );

    const priceTradeIn = toNumber(
      getCandidate(row, [
        'PRICE TRADE IN',
        'PREÇO TRADE IN',
        'PRECO TRADE IN',
        '__colAF',
      ])
    );

    const priceBogo = toNumber(
      getCandidate(row, [
        'PRICE BOGO',
        'PREÇO BOGO',
        'PRECO BOGO',
        '__colAG',
      ])
    );

    const priceSip = toNumber(
      getCandidate(row, [
        'PRICE SIP',
        'PREÇO SIP',
        'PRECO SIP',
        '__colAH',
      ])
    );

    const ofertaAtual = toNumber(
      getCandidate(row, [
        'PREÇO FINAL',
        'PRECO FINAL',
        'OFERTA ATUAL',
        'PREÇO ATUAL',
        'PRECO ATUAL',
        '__colJ',
      ])
    );

    const payload: PriceGuideRow = {
      descricao,
      referencia,
      precoSamsung,
      descontoTelecel,
      descontoRebate,
      descontoTradeIn,
      descontoBogo,
      descontoSip,
      priceRebate,
      priceTradeIn,
      priceBogo,
      priceSip,
      ofertaAtual,
    };

    if (descricao || referencia) allRows.push(payload);
    if (descricao) byDesc.set(normalizeDesc(descricao), payload);
    if (referencia) byRef.set(referencia, payload);
  });

  return { byDesc, byRef, rows: allRows };
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

const floorMoney = (value: number) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

const PRICE_TO_DISCOUNT_FACTOR = 1.9;

const roundToStep = (value: number, step: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / step) * step;
};

const calculateDiscountFromPrice = (priceValue: number) => {
  const price = Number(priceValue || 0);
  if (!Number.isFinite(price) || price <= 0) return 0;

  // Regra operacional aproximada do comparativo:
  // o desconto nasce do Price x ~2, com arredondamento comercial.
  // Pelos exemplos da planilha, o fator 1.9 + arredondamento em degraus
  // reproduz melhor os descontos do modelo do que multiplicar por 2 seco.
  const estimatedDiscount = price * PRICE_TO_DISCOUNT_FACTOR;
  const step = estimatedDiscount < 300 ? 10 : 50;

  return roundToStep(estimatedDiscount, step);
};

const recalculateRow = (row: LinhaTabela): LinhaTabela => {
  const totalDescontoBruto =
    row.totalDescontoTelecel +
    row.descontoRebate +
    row.descontoTradeIn +
    row.descontoBogo +
    row.descontoSip;

  // Regra operacional: o total desconto aparece sem centavos.
  // Ex.: R$ 2.218,58 vira R$ 2.218,00.
  const totalDesconto = floorMoney(totalDescontoBruto);

  // Coluna N do comparativo: PREÇO PROMOCIONAL (TELECEL + SAMSUNG)
  // O preço promocional usa o total desconto já sem centavos.
  const precoPromocional = row.precoSamsung > 0 ? Math.max(row.precoSamsung - totalDesconto, 0) : 0;

  // Coluna T do comparativo: NOVO CUSTO MÉDIO ESTOQUE (PRICE)
  // Aqui entram os campos Price, não os descontos brutos da Samsung.
  const novoCustoMedioBruto =
    row.custoMedioEstoque -
    row.priceRebate -
    row.priceTradeIn -
    row.priceBogo -
    row.priceSip;

  const novoCustoMedio = Number.isFinite(novoCustoMedioBruto) ? novoCustoMedioBruto : null;
  const margemEstoque = row.precoTelecel > 0 ? 1 - row.custoMedioEstoque / row.precoTelecel : null;

  // Fórmula fiel ao Excel: =100%-(NOVO CUSTO MÉDIO ESTOQUE / PREÇO PROMOCIONAL)
  const margemPrice =
    precoPromocional > 0 && novoCustoMedio !== null
      ? 1 - novoCustoMedio / precoPromocional
      : null;

  let status = row.status || '-';
  if (row.ofertaAtual > 0 && precoPromocional > 0) {
    if (row.ofertaAtual < precoPromocional) status = 'MENOR';
    else if (row.ofertaAtual > precoPromocional) status = 'MAIOR';
    else status = 'IGUAL';
  }

  return {
    ...row,
    totalDesconto,
    precoPromocional,
    novoCustoMedio,
    margemEstoque,
    margemPrice,
    status,
  };
};

const getCampaignText = (item: PdfItem) =>
  normalizeDesc(`${item.tipoCampanha || ''} ${item.campanha || ''} ${item.arquivo || ''} ${item.refCampanha || ''} ${item.modeloPdf || ''}`);

const getCampaignKind = (item: PdfItem): ComparativoKind | null => {
  const text = getCampaignText(item);

  if (/\b(SIP)\b/i.test(text)) return 'SIP';
  if (/\b(BUNDLE|BOGO|MULTI\s*BUY|MULTI-BUY|MULTIBUY)\b/i.test(text)) return 'BOGO';
  if (/\b(VOUCHER|TRADE\s*IN|TRADE-IN|TRADEIN|REBATE|SELL\s*OUT|SELLOUT)\b/i.test(text)) return 'REBATE_TRADEIN';

  return null;
};

const getCampaignPriceFields = (item: PdfItem) => {
  const text = getCampaignText(item);
  const value = toNumber(item.verbaUnitaria);

  return {
    priceRebate: /\b(REBATE|SELL\s*OUT|SELLOUT)\b/i.test(text) ? value : 0,
    priceTradeIn: /\b(VOUCHER|TRADE\s*IN|TRADE-IN|TRADEIN)\b/i.test(text) ? value : 0,
    priceBogo: /\b(BUNDLE|BOGO|MULTI\s*BUY|MULTI-BUY|MULTIBUY)\b/i.test(text) ? value : 0,
    priceSip: /\b(SIP)\b/i.test(text) ? value : 0,
  };
};

const getComparativoKindLabel = (kind: ComparativoKind) => {
  if (kind === 'REBATE_TRADEIN') return 'Rebate e Trade In';
  if (kind === 'BOGO') return 'Bogo';
  return 'SIP';
};

const getMergeKey = (row: LinhaTabela) => {
  // Uma linha por aparelho exato: a descrição completa é a chave mais fiel.
  // Não usamos referência como primeira chave porque modelos como 256GB e 512GB
  // podem compartilhar o mesmo prefixo de referência.
  const byDescription = normalizeDesc(row.descricao || '');
  if (byDescription) return byDescription;

  const byBasicModel = normalizeBasicModel(row.basicModel || row.modeloPdf || '');
  if (byBasicModel) return byBasicModel;

  return normalizeReference(row.referencia || '');
};

const mergeDuplicateRowsByModel = (inputRows: LinhaTabela[]) => {
  const map = new Map<string, LinhaTabela>();

  inputRows.forEach((row) => {
    const key = getMergeKey(row);
    if (!key) return;

    const current = map.get(key);
    if (!current) {
      map.set(key, recalculateRow({ ...row, rowKey: `modelo-${key}` }));
      return;
    }

    const merged: LinhaTabela = {
      ...current,
      hasOferta: current.hasOferta || row.hasOferta,
      isSelected: current.isSelected && row.isSelected,
      comparativoKind: current.comparativoKind || row.comparativoKind,
      // Mantém uma única linha por aparelho, sem somar estoque/venda repetida.
      // Se alguma fonte vier zerada em uma linha e preenchida em outra, aproveita o valor preenchido.
      precoSamsung: current.precoSamsung || row.precoSamsung,
      precoTelecel: current.precoTelecel || row.precoTelecel,
      totalDescontoTelecel: current.totalDescontoTelecel || row.totalDescontoTelecel,
      descontoRebate: current.descontoRebate || row.descontoRebate,
      descontoTradeIn: current.descontoTradeIn || row.descontoTradeIn,
      descontoBogo: current.descontoBogo || row.descontoBogo,
      descontoSip: current.descontoSip || row.descontoSip,
      qtdEstoque: current.qtdEstoque || row.qtdEstoque,
      custoTotalEstoque: current.custoTotalEstoque || row.custoTotalEstoque,
      custoMedioEstoque: current.custoMedioEstoque || row.custoMedioEstoque,
      qtdVendida: Math.max(current.qtdVendida || 0, row.qtdVendida || 0),
      priceRebate: current.priceRebate || row.priceRebate,
      priceTradeIn: current.priceTradeIn || row.priceTradeIn,
      priceBogo: current.priceBogo || row.priceBogo,
      priceSip: current.priceSip || row.priceSip,
      verbaUnitaria: current.verbaUnitaria || row.verbaUnitaria,
      verbaTotal: current.verbaTotal || row.verbaTotal,
      ofertaAtual: current.ofertaAtual || row.ofertaAtual,
      status: current.status || row.status,
    };

    map.set(key, recalculateRow(merged));
  });

  return Array.from(map.values());
};

const TruncateText = ({ value, className = '' }: { value: string; className?: string }) => (
  <div className={`truncate ${className}`} title={value || '-'}>
    {value || '-'}
  </div>
);

const TableHeader = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <th className={`px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-left border-b border-slate-200 whitespace-nowrap ${className}`}>
    {children}
  </th>
);

const TableCell = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-2.5 py-2 text-[12px] leading-5 text-slate-700 border-b border-slate-100 align-middle ${className}`}>{children}</td>
);

const GroupHeader = ({ children, className = '', colSpan }: { children: React.ReactNode; className?: string; colSpan: number }) => (
  <th
    colSpan={colSpan}
    className={`px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-center border-b border-slate-200 whitespace-nowrap ${className}`}
  >
    {children}
  </th>
);

const ToggleGroupButton = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center justify-center gap-1 rounded-full border border-current/20 bg-white/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] shadow-sm transition hover:bg-white"
    title={open ? `Recolher ${label}` : `Abrir ${label}`}
  >
    <span className="text-[13px] leading-none">{open ? '−' : '+'}</span>
    {label}
  </button>
);


export default function ComparativosModule() {
  const [rows, setRows] = useState<LinhaTabela[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [apiInfo, setApiInfo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDiscountDetails, setShowDiscountDetails] = useState(false);
  const [showPriceDetails, setShowPriceDetails] = useState(false);
  const [showOfferDetails, setShowOfferDetails] = useState(false);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);

  const [pendingData, setPendingData] = useState<PendingComparativoData | null>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareKindDraft, setCompareKindDraft] = useState<ComparativoKind>('REBATE_TRADEIN');
  const [selectedComparativoKind, setSelectedComparativoKind] = useState<ComparativoKind>('REBATE_TRADEIN');
  const [activeTab, setActiveTab] = useState<ComparativoTab>('com_ofertas');
  const [showFlowSendModal, setShowFlowSendModal] = useState(false);
  const [sendingToFlow, setSendingToFlow] = useState(false);
  const [flowTitleDraft, setFlowTitleDraft] = useState('');
  const [flowSendMsg, setFlowSendMsg] = useState('');

  const syncHorizontalScroll = (source: 'top' | 'table') => {
    if (syncingScrollRef.current) return;

    const from = source === 'top' ? topScrollRef.current : tableScrollRef.current;
    const to = source === 'top' ? tableScrollRef.current : topScrollRef.current;

    if (!from || !to) return;

    syncingScrollRef.current = true;
    to.scrollLeft = from.scrollLeft;

    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  const updateTotalDescontoTelecel = (rowKey: string, rawValue: string) => {
    const value = toNumber(rawValue);

    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.rowKey !== rowKey) return row;
        return recalculateRow({
          ...row,
          totalDescontoTelecel: value,
        });
      })
    );
  };

  const updateDiscountField = (rowKey: string, field: EditableDiscountField, rawValue: string) => {
    const value = toNumber(rawValue);

    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.rowKey !== rowKey) return row;

        return recalculateRow({
          ...row,
          [field]: value,
        });
      })
    );
  };

  const toggleRowSelected = (rowKey: string) => {
    setRows((prevRows) =>
      prevRows.map((row) =>
        row.rowKey === rowKey
          ? { ...row, isSelected: !row.isSelected }
          : row
      )
    );
  };

  const buildRowsForComparativo = (data: PendingComparativoData, kind: ComparativoKind) => {
    const traducaoMap = buildTraducaoMap(data.traducaoRows);
    const stockMap = buildStockMap(data.stockRows);
    const priceMap = buildPriceMap(data.priceRows);
    const priceGuideMap = buildPriceGuideMap(data.priceGuideRows);
    const salesMap = buildSalesMap(data.salesRows);

    const getSalesQuantity = (descricao: string, referencia: string) =>
      salesMap.byDesc.get(normalizeDesc(descricao))?.quantidade ||
      salesMap.byFamily.get(referencia)?.quantidade ||
      0;

    const buildBaseRow = ({
      rowKey,
      descricao,
      referencia,
      priceGuide,
      price,
      stock,
      qtdVendida,
      hasOferta,
      campaignItem,
      campaignPrices,
    }: {
      rowKey: string;
      descricao: string;
      referencia: string;
      priceGuide?: PriceGuideRow;
      price?: PriceRow;
      stock?: StockRow;
      qtdVendida: number;
      hasOferta: boolean;
      campaignItem?: PdfItem;
      campaignPrices?: { priceRebate: number; priceTradeIn: number; priceBogo: number; priceSip: number };
    }) => {
      const precoSamsung = priceGuide?.precoSamsung || price?.precoSamsung || 0;
      const precoTelecel = price?.precoTelecel || 0;
      const ofertaAtual = priceGuide?.ofertaAtual || price?.ofertaAtual || 0;

      const totalDescontoTelecel =
        priceGuide?.descontoTelecel ||
        (precoSamsung > 0 && precoTelecel > 0
          ? Math.max(precoSamsung - precoTelecel, 0)
          : 0);

      // Regra operacional:
      // - Com ofertas: o Price vem primeiro da carta; se não houver, cai na planilha guia.
      // - Sem ofertas: não existe Price, então não pode existir desconto baseado em Price.
      const effectivePriceRebate = hasOferta ? (campaignPrices?.priceRebate || priceGuide?.priceRebate || 0) : 0;
      const effectivePriceTradeIn = hasOferta ? (campaignPrices?.priceTradeIn || priceGuide?.priceTradeIn || 0) : 0;
      const effectivePriceBogo = hasOferta ? (campaignPrices?.priceBogo || priceGuide?.priceBogo || 0) : 0;
      const effectivePriceSip = hasOferta ? (campaignPrices?.priceSip || priceGuide?.priceSip || 0) : 0;

      const baseRow: LinhaTabela = {
        rowKey,
        hasOferta,
        isSelected: true,
        comparativoKind: kind,
        descricao: descricao || stock?.descricao || '-',
        referencia,
        precoSamsung,
        precoTelecel,
        totalDescontoTelecel,
        // Os descontos de campanha agora nascem sempre do respectivo Price.
        // Ex.: Price Rebate -> Desc. Rebate; Price Trade In -> Desc. Trade In.
        // Se Price = 0, então o desconto também precisa ser 0.
        // O usuário ainda pode editar manualmente os campos na tela.
        descontoRebate: calculateDiscountFromPrice(effectivePriceRebate),
        descontoTradeIn: calculateDiscountFromPrice(effectivePriceTradeIn),
        descontoBogo: calculateDiscountFromPrice(effectivePriceBogo),
        descontoSip: calculateDiscountFromPrice(effectivePriceSip),
        totalDesconto: 0,
        precoPromocional: 0,
        tipoPromocao: campaignItem?.tipoCampanha || getComparativoKindLabel(kind),
        periodo: campaignItem?.inicio && campaignItem?.termino ? `${campaignItem.inicio} a ${campaignItem.termino}` : '-',
        refCampanha: campaignItem?.refCampanha || '',
        campanha: campaignItem?.campanha || '',
        modeloPdf: campaignItem?.modeloPdf || '',
        basicModel: campaignItem ? normalizeBasicModel(campaignItem.modeloPdf) : '',
        qtdEstoque: stock?.quantidade || 0,
        custoTotalEstoque: stock?.custoTotal || 0,
        custoMedioEstoque: stock?.custoMedio || 0,
        margemEstoque: null,
        novoCustoMedio: null,
        margemPrice: null,
        qtdVendida,
        priceRebate: effectivePriceRebate,
        priceTradeIn: effectivePriceTradeIn,
        priceBogo: effectivePriceBogo,
        priceSip: effectivePriceSip,
        verbaUnitaria: campaignItem?.verbaUnitaria || 0,
        verbaTotal: campaignItem?.verbaTotal || 0,
        ofertaAtual,
        lojas: stock?.lojas.join(' | ') || '-',
        status: stock?.status || '-',
      };

      return recalculateRow(baseRow);
    };

    const selectedPdfItems = data.pdfItems.filter((item) => getCampaignKind(item) === kind);

    const offerRowsRaw: LinhaTabela[] = selectedPdfItems.map((item, index) => {
      const basicModel = normalizeBasicModel(item.modeloPdf);
      const traducao = traducaoMap.get(basicModel);
      const descricao = traducao?.descricao2 || traducao?.marketingName || item.modeloPdf || '-';
      const referencia = familyFromReference(traducao?.referencia2 || '');
      const stock = stockMap.get(referencia);
      const price =
        priceMap.byDesc.get(normalizeDesc(descricao)) ||
        priceMap.byRef.get(referencia);

      const priceGuide =
        priceGuideMap.byDesc.get(normalizeDesc(descricao)) ||
        priceGuideMap.byRef.get(referencia);

      return buildBaseRow({
        rowKey: `oferta-${item.refCampanha || item.arquivo}-${basicModel}-${item.inicio}-${item.termino}-${index}`,
        descricao,
        referencia,
        priceGuide,
        price,
        stock,
        qtdVendida: getSalesQuantity(descricao, referencia),
        hasOferta: true,
        campaignItem: item,
        campaignPrices: getCampaignPriceFields(item),
      });
    });

    const offerRows = mergeDuplicateRowsByModel(offerRowsRaw);
    const offerKeys = new Set(offerRows.map((row) => getMergeKey(row)));

    const noOfferRowsRaw: LinhaTabela[] = priceGuideMap.rows
      .filter((guide) => {
        const fakeKey = normalizeDesc(guide.descricao || '') || normalizeReference(guide.referencia || '');
        if (!fakeKey) return false;
        return !offerKeys.has(fakeKey);
      })
      .map((guide, index) => {
        const descricao = guide.descricao || '-';
        const referencia = guide.referencia || '';
        const stock = stockMap.get(referencia);
        const price =
          priceMap.byDesc.get(normalizeDesc(descricao)) ||
          priceMap.byRef.get(referencia);

        return buildBaseRow({
          rowKey: `sem-oferta-${normalizeDesc(descricao) || referencia}-${index}`,
          descricao,
          referencia,
          priceGuide: guide,
          price,
          stock,
          qtdVendida: getSalesQuantity(descricao, referencia),
          hasOferta: false,
        });
      });

    const noOfferRows = mergeDuplicateRowsByModel(noOfferRowsRaw);

    const finalRows = [...offerRows, ...noOfferRows].sort((a, b) =>
      a.descricao.localeCompare(b.descricao, 'pt-BR')
    );

    return {
      finalRows,
      apiInfoText:
        `Google Sheets: ${traducaoMap.size} modelos · Cartas: ${selectedPdfItems.length} itens · Guia preços: ${priceGuideMap.byDesc.size + priceGuideMap.byRef.size} chaves · Estoque: ${stockMap.size} famílias · Vendas mês: ${salesMap.byDesc.size} descrições · Preços sistema: ${priceMap.byDesc.size + priceMap.byRef.size} chaves`,
    };
  };

  const applyComparativoKind = (kind: ComparativoKind) => {
    if (!pendingData) return;

    const { finalRows, apiInfoText } = buildRowsForComparativo(pendingData, kind);

    setSelectedComparativoKind(kind);
    setRows(finalRows);
    setApiInfo(apiInfoText);
    setActiveTab('com_ofertas');
    setShowCompareModal(false);
  };

  const processFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;

    setLoading(true);
    setErrorMsg('');
    setApiInfo('');
    setRows([]);

    try {
      const pdfItems = (await Promise.all(files.map((file) => parseCampaignFromPdf(file)))).flat();

      const { startDate, endDate } = getCurrentMonthRange();
      const userId = getCurrentUserId();

      const [baseResp, stockResp, priceResp, priceGuideResp, salesResp] = await Promise.all([
        fetchJsonFromCandidates('/api/comparativos/mkt-base'),
        fetchJsonFromCandidates('/stock'),
        fetchJsonFromCandidates('/price-table?category=Aparelhos'),
        fetchPriceGuideSheet(),
        userId && startDate && endDate
          ? fetchJsonFromCandidates(`/sales?userId=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
          : Promise.resolve({ url: '', data: { sales: [] } }),
      ]);

      const traducaoRows = Array.isArray(baseResp.data?.rows)
        ? baseResp.data.rows
        : Array.isArray(baseResp.data)
          ? baseResp.data
          : [];

      const nextPendingData: PendingComparativoData = {
        pdfItems,
        traducaoRows,
        stockRows: Array.isArray(stockResp.data) ? stockResp.data : [],
        priceRows: Array.isArray(priceResp.data) ? priceResp.data : [],
        priceGuideRows: Array.isArray(priceGuideResp.data) ? priceGuideResp.data : [],
        salesRows: Array.isArray(salesResp.data?.sales) ? salesResp.data.sales : [],
      };

      setPendingData(nextPendingData);
      setCompareKindDraft('REBATE_TRADEIN');
      setShowCompareModal(true);
      setApiInfo(`Cartas lidas: ${pdfItems.length} itens. Escolha o tipo de comparativo para tratar.`);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao processar comparativo.');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const currentTabRows = useMemo(() => {
    return rows.filter((row) => activeTab === 'com_ofertas' ? row.hasOferta : !row.hasOferta);
  }, [rows, activeTab]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return currentTabRows;

    return currentTabRows.filter((row) =>
      [
        row.descricao,
        row.referencia,
        row.refCampanha,
        row.campanha,
        row.modeloPdf,
        row.basicModel,
        row.tipoPromocao,
        row.lojas,
        row.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [currentTabRows, searchTerm]);

  const offerRowsCount = useMemo(() => rows.filter((row) => row.hasOferta).length, [rows]);
  const noOfferRowsCount = useMemo(() => rows.filter((row) => !row.hasOferta).length, [rows]);

  const summary = useMemo(() => ({
    campanhas: new Set(filteredRows.map((r) => r.refCampanha).filter(Boolean)).size,
    modelos: filteredRows.length,
    estoque: filteredRows.reduce((sum, r) => sum + r.qtdEstoque, 0),
    vendida: filteredRows.reduce((sum, r) => sum + r.qtdVendida, 0),
    verba: filteredRows.reduce((sum, r) => sum + r.verbaTotal, 0),
  }), [filteredRows]);

  const buildExportData = (sourceRows: LinhaTabela[]) =>
    sourceRows
      .filter((row) => row.isSelected)
      .map((row) => ({
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
        'PRICE REBATE': row.priceRebate,
        'PRICE TRADE IN': row.priceTradeIn,
        'PRICE BOGO': row.priceBogo,
        'PRICE SIP': row.priceSip,
        'PRICE CAMPANHA': row.verbaUnitaria,
        'VERBA TOTAL': row.verbaTotal,
        'OFERTA ATUAL': row.ofertaAtual,
        'LOJAS': row.lojas,
        'STATUS': row.status,
      }));

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();

    const comOfertas = buildExportData(rows.filter((row) => row.hasOferta));
    const semOfertas = buildExportData(rows.filter((row) => !row.hasOferta));

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(comOfertas),
      'Com Ofertas'
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(semOfertas),
      'Sem Ofertas'
    );

    XLSX.writeFile(workbook, `comparativo_ofertas_${Date.now()}.xlsx`);
  };



  const openSendToFlowModal = () => {
    if (!rows.length) {
      setErrorMsg('Monte um comparativo antes de enviar para análise.');
      return;
    }

    const now = new Date();
    const dateLabel = now.toLocaleDateString('pt-BR');
    setFlowTitleDraft(`${getComparativoKindLabel(selectedComparativoKind)} - ${dateLabel}`);
    setFlowSendMsg('');
    setShowFlowSendModal(true);
  };

  const sendSelectedComparativoToFlow = async () => {
    const selectedRows = rows.filter((row) => row.isSelected);
    const comOfertas = selectedRows.filter((row) => row.hasOferta);
    const semOfertas = selectedRows.filter((row) => !row.hasOferta);
    const currentUser = getCurrentUserInfo();

    if (!selectedRows.length) {
      setFlowSendMsg('Selecione pelo menos um produto para enviar.');
      return;
    }

    setSendingToFlow(true);
    setFlowSendMsg('');

    try {
      await postJsonToCandidates('/api/comparativos/fluxo', {
        titulo: flowTitleDraft || `${getComparativoKindLabel(selectedComparativoKind)} - ${new Date().toLocaleDateString('pt-BR')}`,
        tipoComparativo: selectedComparativoKind,
        criadoPorId: String(currentUser?.id || getCurrentUserId() || ''),
        criadoPorNome: String(currentUser?.name || currentUser?.nome || 'Usuário'),
        comOfertas,
        semOfertas,
        resumo: {
          totalSelecionados: selectedRows.length,
          totalComOfertas: comOfertas.length,
          totalSemOfertas: semOfertas.length,
          geradoEm: new Date().toISOString(),
        },
      });

      setFlowSendMsg('Comparativo enviado para análise com sucesso. Ele já está no Fluxo Comparativo.');
    } catch (error: any) {
      setFlowSendMsg(error?.message || 'Erro ao enviar comparativo para análise.');
    } finally {
      setSendingToFlow(false);
    }
  };

  const discountColSpan = showDiscountDetails ? 6 : 3;
  const priceColSpan = showPriceDetails ? 4 : 1;
  const offerColSpan = showOfferDetails ? 2 : 1;
  const totalTableCols = 15 + (showDiscountDetails ? 3 : 0) + (showPriceDetails ? 3 : 0) + (showOfferDetails ? 1 : 0);
  const tableMinWidth =
    showDiscountDetails || showPriceDetails || showOfferDetails
      ? 'min-w-[2850px]'
      : 'min-w-[2350px]';

  return (
    <>
      <style>
        {`
          .comparativo-scroll::-webkit-scrollbar {
            height: 16px;
            width: 14px;
          }

          .comparativo-scroll::-webkit-scrollbar-track {
            background: #dbe3ee;
            border-radius: 999px;
          }

          .comparativo-scroll::-webkit-scrollbar-thumb {
            background: #64748b;
            border-radius: 999px;
            border: 3px solid #dbe3ee;
          }

          .comparativo-scroll::-webkit-scrollbar-thumb:hover {
            background: #334155;
          }
        `}
      </style>

      <div className="min-h-screen w-full bg-slate-50">
      <div className="w-full max-w-none space-y-3 px-1.5 py-2 md:px-2">
        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[18px] font-black uppercase tracking-tight text-slate-900 md:text-[20px]">
                Comparativo de Ofertas
              </h1>
              <p className="mt-1 text-[11px] text-slate-500">
                Importação de cartas, cruzamento com estoque, vendas, tabela de preço e guia de ofertas.
              </p>
              {apiInfo && (
                <p className="mt-2 max-w-[1200px] truncate text-[10px] font-black uppercase tracking-widest text-emerald-600" title={apiInfo}>
                  {apiInfo}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-slate-800">
                <UploadCloud size={15} />
                Importar PDFs
                <input type="file" className="hidden" accept="application/pdf" multiple onChange={processFiles} />
              </label>

              <button
                type="button"
                onClick={exportExcel}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <FileSpreadsheet size={15} />
                Exportar Excel
              </button>


              <button
                type="button"
                onClick={openSendToFlowModal}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-blue-800"
              >
                Enviar para análise
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-red-700">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">{errorMsg}</div>
            </div>
          )}
        </div>

        <div className="rounded-[22px] border border-slate-200 bg-white p-2.5 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <h2 className="text-[18px] font-black uppercase tracking-tight text-slate-900">
              Comparativo
            </h2>

            <div className="relative w-full xl:w-[480px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por descrição, preço, status ou modelo"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-xs outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('com_ofertas')}
                className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition ${
                  activeTab === 'com_ofertas'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Com ofertas ({offerRowsCount})
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('sem_ofertas')}
                className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition ${
                  activeTab === 'sem_ofertas'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Sem ofertas ({noOfferRowsCount})
              </button>
            </div>

            <div className="text-[11px] font-semibold text-slate-500">
              Comparativo: <span className="font-black text-slate-800">{getComparativoKindLabel(selectedComparativoKind)}</span> ·
              Produtos na tela: <span className="font-black text-slate-800">{formatNumber(summary.modelos)}</span> ·
              Selecionados: <span className="font-black text-emerald-700">{formatNumber(filteredRows.filter((row) => row.isSelected).length)}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div
              ref={topScrollRef}
              onScroll={() => syncHorizontalScroll('top')}
              className="comparativo-scroll h-5 w-full overflow-x-scroll overflow-y-hidden border-b border-slate-200 bg-slate-100"
            >
              <div className={`${tableMinWidth} h-1`} />
            </div>

            <div
              ref={tableScrollRef}
              onScroll={() => syncHorizontalScroll('table')}
              className="comparativo-scroll max-h-[calc(100vh-225px)] min-h-[560px] w-full overflow-x-scroll overflow-y-auto overscroll-contain rounded-xl pb-4"
              style={{ scrollbarGutter: 'stable both-edges' }}
            >
              <table className={`w-max ${tableMinWidth} table-auto border-separate border-spacing-0 bg-white`}>
                <thead className="sticky top-0 z-30 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <GroupHeader colSpan={1} className="sticky left-0 top-0 z-40 bg-[#d9d9d9] text-[#003366] shadow-[1px_0_0_0_rgba(148,163,184,0.55)]">
                      Produto
                    </GroupHeader>
                    <GroupHeader colSpan={2} className="bg-[#d9ffd9] text-[#006100]">Preços</GroupHeader>
                    <GroupHeader colSpan={discountColSpan} className="bg-[#9dccf6] text-[#003366]">
                      <ToggleGroupButton
                        open={showDiscountDetails}
                        label="Descontos"
                        onClick={() => setShowDiscountDetails((prev) => !prev)}
                      />
                    </GroupHeader>
                    <GroupHeader colSpan={1} className="bg-[#fff2cc] text-[#7f6000]">Preço Promo</GroupHeader>
                    <GroupHeader colSpan={6} className="bg-[#eaf2f8] text-[#1f4e79]">Operação</GroupHeader>
                    <GroupHeader colSpan={priceColSpan} className="bg-[#e2f0d9] text-[#003b8f]">
                      <ToggleGroupButton
                        open={showPriceDetails}
                        label="Prices"
                        onClick={() => setShowPriceDetails((prev) => !prev)}
                      />
                    </GroupHeader>
                    <GroupHeader colSpan={offerColSpan} className="bg-[#92d050] text-[#003b8f]">
                      <ToggleGroupButton
                        open={showOfferDetails}
                        label="Oferta"
                        onClick={() => setShowOfferDetails((prev) => !prev)}
                      />
                    </GroupHeader>
                  </tr>
                  <tr className="sticky top-[29px] z-30 bg-white">
                    <TableHeader className="sticky left-0 z-40 w-[320px] min-w-[320px] bg-[#d9d9d9] text-[#003366] shadow-[1px_0_0_0_rgba(148,163,184,0.55)]">Descrição</TableHeader>

                    <TableHeader className="w-[96px] bg-[#d9ffd9]">Preço Samsung</TableHeader>
                    <TableHeader className="w-[92px] bg-[#d9ffd9]">Preço Telecel</TableHeader>

                    <TableHeader className="w-[112px] bg-[#9dccf6]">Total Desc. Telecel</TableHeader>
                    {showDiscountDetails && (
                      <>
                        <TableHeader className="w-[104px] bg-[#9dccf6]">Desc. Rebate</TableHeader>
                        <TableHeader className="w-[108px] bg-[#9dccf6]">Desc. Trade In</TableHeader>
                        <TableHeader className="w-[96px] bg-[#9dccf6]">Desc. Bogo</TableHeader>
                        <TableHeader className="w-[86px] bg-[#9dccf6]">Desc. SIP</TableHeader>
                      </>
                    )}
                    {!showDiscountDetails && (
                      <TableHeader className="w-[58px] bg-[#9dccf6] text-center">+</TableHeader>
                    )}
                    <TableHeader className="w-[118px] bg-[#fff2cc] text-[#7f6000]">Total Desconto</TableHeader>

                    <TableHeader className="w-[122px] bg-[#fff2cc]">Preço Promocional</TableHeader>

                    <TableHeader className="w-[70px] bg-[#eaf2f8] text-right">Qtd Est.</TableHeader>
                    <TableHeader className="w-[116px] bg-[#eaf2f8] text-right">Custo Médio</TableHeader>
                    <TableHeader className="w-[92px] bg-[#eaf2f8] text-right">Margem Est.</TableHeader>
                    <TableHeader className="w-[118px] bg-[#eaf2f8] text-right">Novo Custo Médio</TableHeader>
                    <TableHeader className="w-[100px] bg-[#eaf2f8] text-right">Margem Price</TableHeader>
                    <TableHeader className="w-[78px] bg-[#eaf2f8] text-right">Qtd Vend.</TableHeader>

                    {showPriceDetails ? (
                      <>
                        <TableHeader className="w-[98px] bg-[#e2f0d9]">Price Rebate</TableHeader>
                        <TableHeader className="w-[104px] bg-[#e2f0d9]">Price Trade In</TableHeader>
                        <TableHeader className="w-[94px] bg-[#e2f0d9]">Price Bogo</TableHeader>
                        <TableHeader className="w-[86px] bg-[#e2f0d9]">Price SIP</TableHeader>
                      </>
                    ) : (
                      <TableHeader className="w-[58px] bg-[#e2f0d9] text-center">+</TableHeader>
                    )}

                    {showOfferDetails ? (
                      <>
                        <TableHeader className="w-[112px] bg-[#92d050] text-[#003b8f]">Oferta Atual</TableHeader>
                        <TableHeader className="w-[96px] bg-[#92d050] text-[#003b8f]">Status</TableHeader>
                      </>
                    ) : (
                      <TableHeader className="w-[58px] bg-[#92d050] text-center text-[#003b8f]">+</TableHeader>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const baseRow = idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60';
                    const descBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40';
                    const margemPriceProblem = row.margemPrice !== null && row.margemPrice < 0.25;
                    const rowMuted = !row.isSelected ? 'opacity-45' : '';

                    return (
                      <tr key={row.rowKey || `${row.refCampanha}-${row.basicModel}-${idx}`} className={`${baseRow} ${rowMuted}`}>
                        <TableCell className={`sticky left-0 z-20 w-[320px] min-w-[320px] whitespace-nowrap font-black text-slate-900 shadow-[1px_0_0_0_rgba(148,163,184,0.35)] ${descBg}`}>
                          <div className="flex min-w-[300px] items-center gap-2">
                            <input
                              type="checkbox"
                              checked={row.isSelected}
                              onChange={() => toggleRowSelected(row.rowKey)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              title="Marcar/desmarcar produto para exportação"
                            />
                            <span>{row.descricao || '-'}</span>
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap bg-[#edffed]">{formatMoney(row.precoSamsung)}</TableCell>
                        <TableCell className="whitespace-nowrap bg-[#edffed] font-semibold">{formatMoney(row.precoTelecel)}</TableCell>

                        <TableCell className="bg-[#d9ecff]">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatEditableNumber(row.totalDescontoTelecel)}
                            onChange={(e) => updateTotalDescontoTelecel(row.rowKey, e.target.value)}
                            className="w-full rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-right text-[11px] font-black text-red-600 outline-none focus:border-red-400 focus:bg-white"
                            placeholder="0,00"
                          />
                        </TableCell>
                        {showDiscountDetails && (
                          <>
                            <TableCell className="bg-[#d9ecff]">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatEditableNumber(row.descontoRebate)}
                                onChange={(e) => updateDiscountField(row.rowKey, 'descontoRebate', e.target.value)}
                                className="w-full min-w-[88px] rounded-md border border-sky-200 bg-white/80 px-1.5 py-0.5 text-right text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-500 focus:bg-white"
                                placeholder="0,00"
                              />
                            </TableCell>
                            <TableCell className="bg-[#d9ecff]">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatEditableNumber(row.descontoTradeIn)}
                                onChange={(e) => updateDiscountField(row.rowKey, 'descontoTradeIn', e.target.value)}
                                className="w-full min-w-[88px] rounded-md border border-sky-200 bg-white/80 px-1.5 py-0.5 text-right text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-500 focus:bg-white"
                                placeholder="0,00"
                              />
                            </TableCell>
                            <TableCell className="bg-[#d9ecff]">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatEditableNumber(row.descontoBogo)}
                                onChange={(e) => updateDiscountField(row.rowKey, 'descontoBogo', e.target.value)}
                                className="w-full min-w-[88px] rounded-md border border-sky-200 bg-white/80 px-1.5 py-0.5 text-right text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-500 focus:bg-white"
                                placeholder="0,00"
                              />
                            </TableCell>
                            <TableCell className="bg-[#d9ecff]">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formatEditableNumber(row.descontoSip)}
                                onChange={(e) => updateDiscountField(row.rowKey, 'descontoSip', e.target.value)}
                                className="w-full min-w-[88px] rounded-md border border-sky-200 bg-white/80 px-1.5 py-0.5 text-right text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-500 focus:bg-white"
                                placeholder="0,00"
                              />
                            </TableCell>
                          </>
                        )}
                        {!showDiscountDetails && (
                          <TableCell className="bg-[#d9ecff] text-center">
                            <button
                              type="button"
                              onClick={() => setShowDiscountDetails(true)}
                              className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs font-black text-sky-700 shadow-sm hover:bg-sky-50"
                              title="Abrir descontos detalhados"
                            >
                              +
                            </button>
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap bg-[#fff2cc] font-black text-red-600">{formatMoney(row.totalDesconto)}</TableCell>

                        <TableCell className="whitespace-nowrap bg-[#fff8d6] font-black text-orange-600">{formatMoney(row.precoPromocional)}</TableCell>

                        <TableCell className="bg-[#f2f7fb] text-right font-black text-emerald-600">{formatNumber(row.qtdEstoque)}</TableCell>
                        <TableCell className="whitespace-nowrap bg-[#f2f7fb] text-right">{formatMoney(row.custoMedioEstoque)}</TableCell>
                        <TableCell className="whitespace-nowrap bg-[#f2f7fb] text-right">{formatPercent(row.margemEstoque)}</TableCell>
                        <TableCell className="whitespace-nowrap bg-[#f2f7fb] text-right">{row.novoCustoMedio === null ? '-' : formatMoney(row.novoCustoMedio)}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-black ${margemPriceProblem ? 'bg-red-50 text-red-600' : 'bg-[#f2f7fb] text-slate-700'}`}>
                          {formatPercent(row.margemPrice)}
                        </TableCell>
                        <TableCell className="bg-[#f2f7fb] text-right font-black text-blue-600">{formatNumber(row.qtdVendida)}</TableCell>

                        {showPriceDetails ? (
                          <>
                            <TableCell className="whitespace-nowrap bg-[#edf7e8]">{formatMoney(row.priceRebate)}</TableCell>
                            <TableCell className="whitespace-nowrap bg-[#edf7e8]">{formatMoney(row.priceTradeIn)}</TableCell>
                            <TableCell className="whitespace-nowrap bg-[#edf7e8]">{formatMoney(row.priceBogo)}</TableCell>
                            <TableCell className="whitespace-nowrap bg-[#edf7e8]">{formatMoney(row.priceSip)}</TableCell>
                          </>
                        ) : (
                          <TableCell className="bg-[#edf7e8] text-center">
                            <button
                              type="button"
                              onClick={() => setShowPriceDetails(true)}
                              className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-xs font-black text-blue-700 shadow-sm hover:bg-blue-50"
                              title="Abrir prices"
                            >
                              +
                            </button>
                          </TableCell>
                        )}

                        {showOfferDetails ? (
                          <>
                            <TableCell className="whitespace-nowrap bg-[#e2f0d9] font-semibold text-blue-700">{formatMoney(row.ofertaAtual)}</TableCell>
                            <TableCell className={`whitespace-nowrap bg-[#e2f0d9] font-black ${row.status === 'MENOR' ? 'text-emerald-700' : row.status === 'MAIOR' ? 'text-red-600' : 'text-slate-700'}`}>
                              {row.status}
                            </TableCell>
                          </>
                        ) : (
                          <TableCell className="bg-[#e2f0d9] text-center">
                            <button
                              type="button"
                              onClick={() => setShowOfferDetails(true)}
                              className="rounded-full border border-lime-300 bg-white px-2 py-0.5 text-xs font-black text-lime-700 shadow-sm hover:bg-lime-50"
                              title="Abrir oferta e status"
                            >
                              +
                            </button>
                          </TableCell>
                        )}
                      </tr>
                    );
                  })}

                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={totalTableCols} className="px-4 py-16 text-center text-slate-400">
                        Importe as cartas em PDF para montar o comparativo ou verifique a aba selecionada.
                      </td>
                    </tr>
                  )}

                  {loading && (
                    <tr>
                      <td colSpan={totalTableCols} className="px-4 py-16 text-center text-slate-500">
                        Processando cartas e cruzando com o sistema...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      </div>

      {showCompareModal && pendingData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-[520px] rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5">
              <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                Qual comparativo tratar?
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Escolha uma opção para separar os produtos com ofertas e gerar a aba de produtos sem ofertas.
              </p>
            </div>

            <div className="space-y-3">
              {([
                ['REBATE_TRADEIN', 'Rebate e Trade In', 'Cartas Rebate Sell Out + Voucher / Trade In'],
                ['BOGO', 'Bogo', 'Cartas Bundle / Bogo'],
                ['SIP', 'SIP', 'Cartas SIP'],
              ] as Array<[ComparativoKind, string, string]>).map(([value, title, description]) => {
                const count = pendingData.pdfItems.filter((item) => getCampaignKind(item) === value).length;

                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border p-4 transition ${
                      compareKindDraft === value
                        ? 'border-slate-900 bg-slate-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="comparativo-kind"
                        checked={compareKindDraft === value}
                        onChange={() => setCompareKindDraft(value)}
                        className="mt-1 h-4 w-4 text-slate-900 focus:ring-slate-900"
                      />
                      <div>
                        <div className="text-sm font-black uppercase tracking-wide text-slate-900">{title}</div>
                        <div className="mt-1 text-xs text-slate-500">{description}</div>
                      </div>
                    </div>

                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                      {count} itens
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCompareModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => applyComparativoKind(compareKindDraft)}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800"
              >
                Gerar comparativo
              </button>
            </div>
          </div>
        </div>
      )}


      {showFlowSendModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[26px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">
                Qual comparativo você quer enviar?
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                O relatório será enviado para o Fluxo Comparativo como <strong>Em análise</strong>. Depois disso, a validação fica com a presidência.
              </p>
            </div>

            <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-500">
              Comparativo
            </label>
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <input type="radio" checked readOnly className="mt-1" />
                <div className="min-w-0 flex-1">
                  <input
                    value={flowTitleDraft}
                    onChange={(event) => setFlowTitleDraft(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                  />
                  <div className="mt-2 text-xs text-slate-500">
                    Tipo: <strong>{getComparativoKindLabel(selectedComparativoKind)}</strong> · Com ofertas: <strong>{rows.filter((row) => row.hasOferta && row.isSelected).length}</strong> · Sem ofertas: <strong>{rows.filter((row) => !row.hasOferta && row.isSelected).length}</strong>
                  </div>
                </div>
              </div>
            </div>

            {flowSendMsg && (
              <div className={`mb-4 rounded-2xl border p-3 text-sm font-semibold ${flowSendMsg.includes('sucesso') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {flowSendMsg}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowFlowSendModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase text-slate-600 hover:bg-slate-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={sendSelectedComparativoToFlow}
                disabled={sendingToFlow}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingToFlow ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
