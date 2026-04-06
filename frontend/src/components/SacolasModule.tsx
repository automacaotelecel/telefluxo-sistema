import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  RefreshCw,
  ShoppingBag,
  Store,
  Truck,
} from 'lucide-react';

type BagType = 'PP' | 'P' | 'M' | 'G' | 'GG';

type StockBuckets = {
  wearables: number;
  accessories: number;
  smartphones: number;
  tablets: number;
  notebooks: number;
};

type SalesBuckets = StockBuckets;

type StoreBagStock = {
  store: string;
  PP: number;
  P: number;
  M: number;
  G: number;
  GG: number;
};

type DetailedStoreRow = {
  store: string;
  current: Record<BagType, number>;
  ideal: Record<BagType, number>;
  deficit: Record<BagType, number>;
  daysRemaining: Record<BagType, number | null>;
  send: Record<BagType, number>;
  daysAfterSend: Record<BagType, number | null>;
};

type Props = {
  currentUser?: any;
};

const BAG_TYPES: BagType[] = ['PP', 'P', 'M', 'G', 'GG'];

const API_BASE = (() => {
  if (typeof window === 'undefined') return 'https://telefluxo-aplicacao.onrender.com';
  return window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://telefluxo-aplicacao.onrender.com';
})();

/**
 * IMPORTANTE:
 * 1) A planilha precisa estar pública/publicada para CSV.
 * 2) Se o seu link do Google Sheets ainda estiver privado, publique e troque a URL abaixo.
 */
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTnENvY08X1XEDRAF-NKBpx4HRbG0cWfjR8p3_fBVHqsjUaOW9OZzwxMw3JJcflvwG6YTAGHb3FJuJJ/pub?output=csv&gid=1355395266&single=true';

/**
 * Ajuste SOMENTE estas duas rotas para as rotas reais do seu backend.
 * O componente já tenta normalizar nomes de campos diferentes.
 */
const STOCK_ENDPOINT_CANDIDATES = [
  `${API_BASE}/api/stock/summary`,
  `${API_BASE}/api/stock/resumo`,
  `${API_BASE}/api/estoque/summary`,
  `${API_BASE}/api/estoque/resumo`,
  `${API_BASE}/api/estoque`,
  `${API_BASE}/stock/summary`,
  `${API_BASE}/stock/resumo`,
  `${API_BASE}/stock`,
];

const SALES_ENDPOINT_CANDIDATES = [
  `${API_BASE}/api/sales/current-month-summary`,
  `${API_BASE}/api/sales/month-summary`,
  `${API_BASE}/api/sales/current-month`,
  `${API_BASE}/api/vendas/current-month-summary`,
  `${API_BASE}/api/vendas/month-summary`,
  `${API_BASE}/api/vendas/resumo-mes`,
  `${API_BASE}/api/vendas/mes-atual`,
  `${API_BASE}/api/vendas/current-month`,
  `${API_BASE}/sales/current-month-summary`,
  `${API_BASE}/sales/month-summary`,
  `${API_BASE}/vendas/resumo-mes`,
  `${API_BASE}/vendas/mes-atual`,
];

const OFFICE_STOCK_STORAGE_KEY = 'telefluxo_sacolas_office_stock_v1';

const BAG_LABELS: Record<BagType, string> = {
  PP: 'Sacola PP',
  P: 'Sacola P',
  M: 'Sacola M',
  G: 'Sacola G',
  GG: 'Sacola GG',
};

const TYPE_NORMALIZER: Record<string, BagType> = {
  PP: 'PP',
  P: 'P',
  M: 'M',
  G: 'G',
  GG: 'GG',
  'SACOLA PP': 'PP',
  'SACOLA P': 'P',
  'SACOLA M': 'M',
  'SACOLA G': 'G',
  'SACOLA GG': 'GG',
  'BOLSA PP': 'PP',
  'BOLSA P': 'P',
  'BOLSA M': 'M',
  'BOLSA G': 'G',
  'BOLSA GG': 'GG',
};

function normalizeText(value: any): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeStoreName(raw: any): string {
  const base = normalizeText(raw)
    .replace(/^SAMSUNG\s*-\s*MRF\s*-\s*/i, '')
    .replace(/^SSG\s+/i, '');

  const aliases: Record<string, string> = {
    UBERLANDIA: 'UBERLÂNDIA SHOPPING',
    'UBERLANDIA SHOPPING': 'UBERLÂNDIA SHOPPING',
    UBERABA: 'UBERABA SHOPPING',
    'CNB SHOPPING': 'CONJUNTO NACIONAL',
    'CNB QUIOSQUE': 'CONJUNTO NACIONAL QUIOSQUE',
    'PASSEIO DAS AGUAS': 'PASSEIO DAS AGUAS',
    'PASSEIO DAS ÁGUAS': 'PASSEIO DAS AGUAS',
    'TERRACO SHOPPING': 'TERRAÇO SHOPPING',
    'ESTOQUE CD': 'CD TAGUATINGA',
    CD: 'CD TAGUATINGA',
  };

  return aliases[base] || base;
}

function toNumberSafe(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const str = String(value).trim();
  if (!str) return 0;

  // Trata formatos BR e EN
  const normalized = str
    .replace(/R\$/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function findColumn(row: Record<string, any>, candidates: string[]): string | null {
  const keys = Object.keys(row || {});
  const normalizedKeys = keys.map((key) => normalizeText(key));

  for (const candidate of candidates) {
    const candidateNorm = normalizeText(candidate);
    const index = normalizedKeys.indexOf(candidateNorm);
    if (index >= 0) return keys[index];
  }

  return null;
}

function parseRowDate(row: Record<string, any>): Date | null {
  const dateColumn = findColumn(row, [
    'DATA',
    'DATE',
    'DATA_EMISSAO',
    'DATA MOVIMENTO',
    'DATA_MOVIMENTO',
    'DIA',
    'DT',
  ]);

  if (dateColumn) {
    const raw = String(row[dateColumn] ?? '').trim();
    if (raw) {
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime())) return dt;
      }

      const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) {
        const dt = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
        if (!Number.isNaN(dt.getTime())) return dt;
      }
    }
  }

  const monthColumn = findColumn(row, ['MES', 'MÊS', 'MONTH']);
  const yearColumn = findColumn(row, ['ANO', 'YEAR']);

  if (monthColumn && yearColumn) {
    const monthValue = toNumberSafe(row[monthColumn]);
    const yearValue = toNumberSafe(row[yearColumn]);
    if (monthValue >= 1 && monthValue <= 12 && yearValue >= 2000) {
      return new Date(yearValue, monthValue - 1, 1);
    }
  }

  return null;
}

function getCurrentMonthFilter() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    daysElapsed: now.getDate(),
    monthLabel: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

function bucketTargetFromStock(stock: StockBuckets): Record<BagType, number> {
  return {
    PP: stock.wearables,
    P: stock.wearables + stock.accessories,
    M: stock.smartphones + stock.accessories,
    G: stock.smartphones + stock.tablets,
    GG: stock.notebooks,
  };
}

function bucketConsumptionFromSales(sales: SalesBuckets): Record<BagType, number> {
  return {
    PP: sales.wearables,
    P: sales.wearables + sales.accessories,
    M: sales.smartphones + sales.accessories,
    G: sales.smartphones + sales.tablets,
    GG: sales.notebooks,
  };
}

function emptyBuckets(): StockBuckets {
  return {
    wearables: 0,
    accessories: 0,
    smartphones: 0,
    tablets: 0,
    notebooks: 0,
  };
}

function getStoreField(row: Record<string, any>): string {
  const storeColumn = findColumn(row, [
    'LOJA',
    'LOJA SISTEMA',
    'NOME_FANTASIA',
    'FILIAL',
    'STORE',
    'UNIDADE',
  ]);

  return normalizeStoreName(storeColumn ? row[storeColumn] : 'SEM LOJA');
}

function normalizeStockLikeRows(rows: any[]): Record<string, StockBuckets> {
  const grouped: Record<string, StockBuckets> = {};

  for (const rawRow of rows || []) {
    const row = rawRow || {};
    const store = getStoreField(row);

    if (!grouped[store]) grouped[store] = emptyBuckets();

    const wearablesKey = findColumn(row, ['WEARABLES', 'ESTOQUE_WEARABLES', 'QTD_WEARABLES', 'WEARABLE']);
    const accessoriesKey = findColumn(row, ['ACESSORIOS', 'ACESSÓRIOS', 'ESTOQUE_ACESSORIOS', 'QTD_ACESSORIOS', 'ACESSORIOS_ESTOQUE']);
    const smartphonesKey = findColumn(row, ['SMARTPHONES', 'SMARTPHONE', 'ESTOQUE_SMARTPHONES', 'QTD_SMARTPHONES']);
    const tabletsKey = findColumn(row, ['TABLETS', 'TABLET', 'ESTOQUE_TABLETS', 'QTD_TABLETS']);
    const notebooksKey = findColumn(row, ['NOTEBOOKS', 'NOTEBOOK', 'ESTOQUE_NOTEBOOKS', 'QTD_NOTEBOOKS']);

    if (wearablesKey || accessoriesKey || smartphonesKey || tabletsKey || notebooksKey) {
      grouped[store].wearables += toNumberSafe(wearablesKey ? row[wearablesKey] : 0);
      grouped[store].accessories += toNumberSafe(accessoriesKey ? row[accessoriesKey] : 0);
      grouped[store].smartphones += toNumberSafe(smartphonesKey ? row[smartphonesKey] : 0);
      grouped[store].tablets += toNumberSafe(tabletsKey ? row[tabletsKey] : 0);
      grouped[store].notebooks += toNumberSafe(notebooksKey ? row[notebooksKey] : 0);
      continue;
    }

    // fallback para payload linha a linha por produto/categoria
    const categoryColumn = findColumn(row, ['CATEGORIA', 'FAMILIA', 'GRUPO', 'TIPO']);
    const quantityColumn = findColumn(row, ['QUANTIDADE', 'QTD', 'ESTOQUE', 'SALDO']);
    const category = normalizeText(categoryColumn ? row[categoryColumn] : '');
    const quantity = toNumberSafe(quantityColumn ? row[quantityColumn] : 0);

    if (category.includes('WEAR')) grouped[store].wearables += quantity;
    else if (category.includes('ACESS')) grouped[store].accessories += quantity;
    else if (category.includes('SMART')) grouped[store].smartphones += quantity;
    else if (category.includes('TABLET')) grouped[store].tablets += quantity;
    else if (category.includes('NOTE')) grouped[store].notebooks += quantity;
  }

  return grouped;
}

function normalizeSalesRows(rows: any[], currentMonth: { year: number; month: number }): Record<string, SalesBuckets> {
  const grouped: Record<string, SalesBuckets> = {};

  for (const rawRow of rows || []) {
    const row = rawRow || {};
    const rowDate = parseRowDate(row);
    if (rowDate && (rowDate.getFullYear() !== currentMonth.year || rowDate.getMonth() !== currentMonth.month)) {
      continue;
    }

    const store = getStoreField(row);
    if (!grouped[store]) grouped[store] = emptyBuckets();

    const wearablesKey = findColumn(row, ['WEARABLES', 'VENDAS_WEARABLES', 'QTD_WEARABLES']);
    const accessoriesKey = findColumn(row, ['ACESSORIOS', 'ACESSÓRIOS', 'VENDAS_ACESSORIOS', 'QTD_ACESSORIOS']);
    const smartphonesKey = findColumn(row, ['SMARTPHONES', 'SMARTPHONE', 'VENDAS_SMARTPHONES', 'QTD_SMARTPHONES']);
    const tabletsKey = findColumn(row, ['TABLETS', 'TABLET', 'VENDAS_TABLETS', 'QTD_TABLETS']);
    const notebooksKey = findColumn(row, ['NOTEBOOKS', 'NOTEBOOK', 'VENDAS_NOTEBOOKS', 'QTD_NOTEBOOKS']);

    if (wearablesKey || accessoriesKey || smartphonesKey || tabletsKey || notebooksKey) {
      grouped[store].wearables += toNumberSafe(wearablesKey ? row[wearablesKey] : 0);
      grouped[store].accessories += toNumberSafe(accessoriesKey ? row[accessoriesKey] : 0);
      grouped[store].smartphones += toNumberSafe(smartphonesKey ? row[smartphonesKey] : 0);
      grouped[store].tablets += toNumberSafe(tabletsKey ? row[tabletsKey] : 0);
      grouped[store].notebooks += toNumberSafe(notebooksKey ? row[notebooksKey] : 0);
      continue;
    }

    const categoryColumn = findColumn(row, ['CATEGORIA', 'FAMILIA', 'GRUPO', 'TIPO', 'DESCRICAO', 'DESCRIÇÃO']);
    const quantityColumn = findColumn(row, ['QUANTIDADE', 'QTD', 'QTD REAL', 'QTD_REAL']);
    const category = normalizeText(categoryColumn ? row[categoryColumn] : '');
    const quantity = toNumberSafe(quantityColumn ? row[quantityColumn] : 0);

    if (category.includes('WEAR')) grouped[store].wearables += quantity;
    else if (category.includes('ACESS')) grouped[store].accessories += quantity;
    else if (category.includes('SMART')) grouped[store].smartphones += quantity;
    else if (category.includes('TABLET')) grouped[store].tablets += quantity;
    else if (category.includes('NOTE')) grouped[store].notebooks += quantity;
  }

  return grouped;
}

function normalizeSheetRows(rows: Record<string, string>[], currentMonth: { year: number; month: number }): StoreBagStock[] {
  const grouped: Record<string, StoreBagStock> = {};

  for (const row of rows || []) {
    const store = getStoreField(row);
    const parsedDate = parseRowDate(row);

    if (parsedDate && (parsedDate.getFullYear() !== currentMonth.year || parsedDate.getMonth() !== currentMonth.month)) {
      continue;
    }

    if (!grouped[store]) {
      grouped[store] = { store, PP: 0, P: 0, M: 0, G: 0, GG: 0 };
    }

    const typeColumn = findColumn(row, ['TIPO', 'TIPO SACOLA', 'TIPO_SACOLA', 'SACOLA']);
    const quantityColumn = findColumn(row, ['QUANTIDADE', 'QTD', 'SALDO', 'ESTOQUE', 'QTDE']);

    if (typeColumn && quantityColumn) {
      const rawType = normalizeText(row[typeColumn]);
      const bagType = TYPE_NORMALIZER[rawType];
      if (bagType) {
        grouped[store][bagType] += toNumberSafe(row[quantityColumn]);
        continue;
      }
    }

    const ppKey = findColumn(row, ['SACOLA PP', 'PP', 'QTD_PP', 'ESTOQUE_PP', 'SALDO_PP']);
    const pKey = findColumn(row, ['SACOLA P', 'P', 'QTD_P', 'ESTOQUE_P', 'SALDO_P']);
    const mKey = findColumn(row, ['SACOLA M', 'M', 'QTD_M', 'ESTOQUE_M', 'SALDO_M']);
    const gKey = findColumn(row, ['SACOLA G', 'G', 'QTD_G', 'ESTOQUE_G', 'SALDO_G']);
    const ggKey = findColumn(row, ['SACOLA GG', 'GG', 'QTD_GG', 'ESTOQUE_GG', 'SALDO_GG']);

    grouped[store].PP += toNumberSafe(ppKey ? row[ppKey] : 0);
    grouped[store].P += toNumberSafe(pKey ? row[pKey] : 0);
    grouped[store].M += toNumberSafe(mKey ? row[mKey] : 0);
    grouped[store].G += toNumberSafe(gKey ? row[gKey] : 0);
    grouped[store].GG += toNumberSafe(ggKey ? row[ggKey] : 0);
  }

  return Object.values(grouped).sort((a, b) => a.store.localeCompare(b.store, 'pt-BR'));
}

function computeDaysRemaining(quantity: number, monthlyConsumption: number, daysElapsed: number): number | null {
  if (monthlyConsumption <= 0 || daysElapsed <= 0) return null;
  const dailyConsumption = monthlyConsumption / daysElapsed;
  if (dailyConsumption <= 0) return null;
  return quantity / dailyConsumption;
}

function getOfficeStockInitial(): Record<BagType, number> {
  if (typeof window === 'undefined') {
    return { PP: 0, P: 0, M: 0, G: 0, GG: 0 };
  }

  try {
    const raw = window.localStorage.getItem(OFFICE_STOCK_STORAGE_KEY);
    if (!raw) return { PP: 0, P: 0, M: 0, G: 0, GG: 0 };
    const parsed = JSON.parse(raw);
    return {
      PP: toNumberSafe(parsed?.PP),
      P: toNumberSafe(parsed?.P),
      M: toNumberSafe(parsed?.M),
      G: toNumberSafe(parsed?.G),
      GG: toNumberSafe(parsed?.GG),
    };
  } catch {
    return { PP: 0, P: 0, M: 0, G: 0, GG: 0 };
  }
}


function extractRowsFromPayload(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload?.data,
    payload?.rows,
    payload?.result,
    payload?.results,
    payload?.items,
    payload?.stock,
    payload?.stocks,
    payload?.sales,
    payload?.vendas,
    payload?.estoque,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

async function fetchFirstWorkingJson(
  urls: string[],
): Promise<{ rows: any[]; url: string | null; errorMessage: string | null }> {
  let lastError = 'Nenhuma rota retornou JSON utilizável.';

  for (const url of urls) {
    try {
      const response = await fetch(url);
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        lastError = `Rota ${url} retornou status ${response.status}.`;
        continue;
      }

      if (!contentType.includes('application/json')) {
        const rawText = await response.text();
        if (/^\s*[\[{]/.test(rawText)) {
          try {
            const parsed = JSON.parse(rawText);
            const rows = extractRowsFromPayload(parsed);
            if (rows.length > 0 || Array.isArray(parsed)) {
              return { rows, url, errorMessage: null };
            }
          } catch {
            lastError = `Rota ${url} não retornou JSON válido.`;
            continue;
          }
        }

        lastError = `Rota ${url} não retornou application/json.`;
        continue;
      }

      const payload = await response.json();
      const rows = extractRowsFromPayload(payload);
      if (rows.length > 0 || Array.isArray(payload)) {
        return { rows, url, errorMessage: null };
      }

      lastError = `Rota ${url} retornou JSON, mas sem lista de dados.`;
    } catch (err: any) {
      lastError = `Falha ao consultar ${url}: ${err?.message || 'erro desconhecido'}`;
    }
  }

  return { rows: [], url: null, errorMessage: lastError };
}

function getScopedStoreName(currentUser?: any): string | null {
  if (!currentUser) return null;
  const role = normalizeText(currentUser?.role);
  if (role !== 'LOJA') return null;

  return (
    normalizeStoreName(currentUser?.store) ||
    normalizeStoreName(currentUser?.operation) ||
    normalizeStoreName(currentUser?.name) ||
    null
  );
}

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-orange-600 border border-orange-200">
    {children}
  </span>
);

const MetricCard: React.FC<{
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}> = ({ title, value, subtitle, icon }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{subtitle}</p>
      </div>
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
    </div>
  </div>
);

export default function SacolasModule({ currentUser }: Props) {
  const [sheetRows, setSheetRows] = useState<Record<string, string>[]>([]);
  const [stockPayload, setStockPayload] = useState<any[]>([]);
  const [salesPayload, setSalesPayload] = useState<any[]>([]);
  const [officeStock, setOfficeStock] = useState<Record<BagType, number>>(getOfficeStockInitial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resolvedStockUrl, setResolvedStockUrl] = useState<string>('');
  const [resolvedSalesUrl, setResolvedSalesUrl] = useState<string>('');
  const [storeFilter, setStoreFilter] = useState('TODAS');

  const currentMonth = useMemo(() => getCurrentMonthFilter(), []);
  const scopedStore = useMemo(() => getScopedStoreName(currentUser), [currentUser]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OFFICE_STOCK_STORAGE_KEY, JSON.stringify(officeStock));
    }
  }, [officeStock]);

  async function carregarDados() {
    setLoading(true);
    setError('');
    setWarnings([]);

    const nextWarnings: string[] = [];

    try {
      const sheetResponse = await fetch(SHEET_CSV_URL);
      const sheetText = await sheetResponse.text();

      if (!sheetResponse.ok || /<html/i.test(sheetText)) {
        throw new Error('A planilha do Google não está pública para leitura em CSV. Publique a aba ou ajuste a URL export?format=csv.');
      }

      setSheetRows(parseCsv(sheetText));

      const [stockResolved, salesResolved] = await Promise.all([
        fetchFirstWorkingJson(STOCK_ENDPOINT_CANDIDATES),
        fetchFirstWorkingJson(SALES_ENDPOINT_CANDIDATES),
      ]);

      if (stockResolved.url) {
        setResolvedStockUrl(stockResolved.url);
        setStockPayload(stockResolved.rows);
      } else {
        setResolvedStockUrl('');
        setStockPayload([]);
        nextWarnings.push(
          `Não consegui localizar automaticamente a rota de estoque. Último retorno: ${stockResolved.errorMessage || 'sem detalhes'}`
        );
      }

      if (salesResolved.url) {
        setResolvedSalesUrl(salesResolved.url);
        setSalesPayload(salesResolved.rows);
      } else {
        setResolvedSalesUrl('');
        setSalesPayload([]);
        nextWarnings.push(
          `Não consegui localizar automaticamente a rota de vendas do mês. Último retorno: ${salesResolved.errorMessage || 'sem detalhes'}`
        );
      }

      setWarnings(nextWarnings);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar a tela de sacolas.');
      setSheetRows([]);
      setStockPayload([]);
      setSalesPayload([]);
      setResolvedStockUrl('');
      setResolvedSalesUrl('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  const currentMonthBagStocks = useMemo(
    () => normalizeSheetRows(sheetRows, currentMonth),
    [sheetRows, currentMonth],
  );

  const stockByStore = useMemo(
    () => normalizeStockLikeRows(stockPayload),
    [stockPayload],
  );

  const salesByStore = useMemo(
    () => normalizeSalesRows(salesPayload, currentMonth),
    [salesPayload, currentMonth],
  );

  const allStores = useMemo(() => {
    const bagStores = currentMonthBagStocks.map((item) => item.store);
    const stockStores = Object.keys(stockByStore);
    const salesStores = Object.keys(salesByStore);
    const joined = Array.from(new Set([...bagStores, ...stockStores, ...salesStores])).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return scopedStore ? joined.filter((store) => store === scopedStore) : joined;
  }, [currentMonthBagStocks, salesByStore, scopedStore, stockByStore]);

  useEffect(() => {
    if (scopedStore) {
      setStoreFilter(scopedStore);
    }
  }, [scopedStore]);

  const detailedRows = useMemo(() => {
    const bagMap: Record<string, StoreBagStock> = {};
    currentMonthBagStocks.forEach((row) => {
      bagMap[row.store] = row;
    });

    const baseRows: DetailedStoreRow[] = allStores.map((store) => {
      const bagStock = bagMap[store] || { store, PP: 0, P: 0, M: 0, G: 0, GG: 0 };
      const stock = stockByStore[store] || emptyBuckets();
      const sales = salesByStore[store] || emptyBuckets();
      const ideal = bucketTargetFromStock(stock);
      const consumption = bucketConsumptionFromSales(sales);

      return {
        store,
        current: {
          PP: bagStock.PP,
          P: bagStock.P,
          M: bagStock.M,
          G: bagStock.G,
          GG: bagStock.GG,
        },
        ideal,
        deficit: {
          PP: Math.max(ideal.PP - bagStock.PP, 0),
          P: Math.max(ideal.P - bagStock.P, 0),
          M: Math.max(ideal.M - bagStock.M, 0),
          G: Math.max(ideal.G - bagStock.G, 0),
          GG: Math.max(ideal.GG - bagStock.GG, 0),
        },
        daysRemaining: {
          PP: computeDaysRemaining(bagStock.PP, consumption.PP, currentMonth.daysElapsed),
          P: computeDaysRemaining(bagStock.P, consumption.P, currentMonth.daysElapsed),
          M: computeDaysRemaining(bagStock.M, consumption.M, currentMonth.daysElapsed),
          G: computeDaysRemaining(bagStock.G, consumption.G, currentMonth.daysElapsed),
          GG: computeDaysRemaining(bagStock.GG, consumption.GG, currentMonth.daysElapsed),
        },
        send: { PP: 0, P: 0, M: 0, G: 0, GG: 0 },
        daysAfterSend: { PP: null, P: null, M: null, G: null, GG: null },
      };
    });

    const officeRemaining: Record<BagType, number> = { ...officeStock };

    for (const bagType of BAG_TYPES) {
      const sorted = [...baseRows].sort((a, b) => {
        const aDays = a.daysRemaining[bagType] ?? Number.POSITIVE_INFINITY;
        const bDays = b.daysRemaining[bagType] ?? Number.POSITIVE_INFINITY;
        if (aDays !== bDays) return aDays - bDays;
        return b.deficit[bagType] - a.deficit[bagType];
      });

      for (const row of sorted) {
        if (officeRemaining[bagType] <= 0) break;
        if (row.deficit[bagType] <= 0) continue;

        const allocation = Math.min(row.deficit[bagType], officeRemaining[bagType]);
        row.send[bagType] = allocation;
        officeRemaining[bagType] -= allocation;
      }
    }

    for (const row of baseRows) {
      const sales = salesByStore[row.store] || emptyBuckets();
      const consumption = bucketConsumptionFromSales(sales);
      row.daysAfterSend = {
        PP: computeDaysRemaining(row.current.PP + row.send.PP, consumption.PP, currentMonth.daysElapsed),
        P: computeDaysRemaining(row.current.P + row.send.P, consumption.P, currentMonth.daysElapsed),
        M: computeDaysRemaining(row.current.M + row.send.M, consumption.M, currentMonth.daysElapsed),
        G: computeDaysRemaining(row.current.G + row.send.G, consumption.G, currentMonth.daysElapsed),
        GG: computeDaysRemaining(row.current.GG + row.send.GG, consumption.GG, currentMonth.daysElapsed),
      };
    }

    return baseRows;
  }, [allStores, currentMonth.daysElapsed, currentMonthBagStocks, officeStock, salesByStore, stockByStore]);

  const visibleRows = useMemo(() => {
    if (storeFilter === 'TODAS') return detailedRows;
    return detailedRows.filter((row) => row.store === storeFilter);
  }, [detailedRows, storeFilter]);

  const totals = useMemo(() => {
    return BAG_TYPES.reduce(
      (acc, bagType) => {
        acc.current[bagType] = visibleRows.reduce((sum, row) => sum + row.current[bagType], 0);
        acc.ideal[bagType] = visibleRows.reduce((sum, row) => sum + row.ideal[bagType], 0);
        acc.deficit[bagType] = visibleRows.reduce((sum, row) => sum + row.deficit[bagType], 0);
        acc.send[bagType] = visibleRows.reduce((sum, row) => sum + row.send[bagType], 0);
        acc.officeRemaining[bagType] = Math.max(officeStock[bagType] - acc.send[bagType], 0);
        return acc;
      },
      {
        current: { PP: 0, P: 0, M: 0, G: 0, GG: 0 } as Record<BagType, number>,
        ideal: { PP: 0, P: 0, M: 0, G: 0, GG: 0 } as Record<BagType, number>,
        deficit: { PP: 0, P: 0, M: 0, G: 0, GG: 0 } as Record<BagType, number>,
        send: { PP: 0, P: 0, M: 0, G: 0, GG: 0 } as Record<BagType, number>,
        officeRemaining: { PP: 0, P: 0, M: 0, G: 0, GG: 0 } as Record<BagType, number>,
      },
    );
  }, [officeStock, visibleRows]);

  const formatDays = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${value.toFixed(1)} d`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Controle de Sacolas</h1>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Mês vigente: {currentMonth.monthLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge>Submenu de estoque</Badge>
            <button
              onClick={carregarDados}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-white shadow-lg transition-all hover:bg-slate-800 active:scale-95"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5" size={18} />
              <div>
                <p className="text-sm font-black uppercase tracking-wide">Falha ao carregar a tela</p>
                <p className="mt-1 text-sm">{error}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-red-500">
                  Dica: publique a aba da planilha em CSV ou ajuste a URL de exportação no componente.
                </p>
              </div>
            </div>
          </div>
        )}

        {!error && warnings.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5" size={18} />
              <div className="space-y-1 text-sm">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {!error && (resolvedStockUrl || resolvedSalesUrl) && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 shadow-sm">
            <div className="space-y-1 text-sm">
              {resolvedStockUrl && <p><span className="font-black">Estoque:</span> {resolvedStockUrl}</p>}
              {resolvedSalesUrl && <p><span className="font-black">Vendas:</span> {resolvedSalesUrl}</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Lojas consideradas"
            value={String(visibleRows.length)}
            subtitle="escopo atual da tela"
            icon={<Store size={18} />}
          />
          <MetricCard
            title="Sacolas atuais"
            value={String(BAG_TYPES.reduce((sum, type) => sum + totals.current[type], 0))}
            subtitle="somatório das lojas"
            icon={<ShoppingBag size={18} />}
          />
          <MetricCard
            title="Necessidade total"
            value={String(BAG_TYPES.reduce((sum, type) => sum + totals.deficit[type], 0))}
            subtitle="déficit calculado"
            icon={<Boxes size={18} />}
          />
          <MetricCard
            title="Envio sugerido"
            value={String(BAG_TYPES.reduce((sum, type) => sum + totals.send[type], 0))}
            subtitle="limitado ao escritório"
            icon={<Truck size={18} />}
          />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Sacolas em estoque</h2>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Informe o estoque do escritório por tipo
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!scopedStore && (
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 outline-none transition-all focus:border-orange-400"
                >
                  <option value="TODAS">Todas as lojas</option>
                  {allStores.map((store) => (
                    <option key={store} value={store}>
                      {store}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {BAG_TYPES.map((bagType) => (
              <div key={bagType} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black uppercase tracking-wide text-slate-700">{BAG_LABELS[bagType]}</p>
                  <Badge>{bagType}</Badge>
                </div>

                <label className="mt-4 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Sacolas em estoque
                </label>
                <input
                  type="number"
                  min={0}
                  value={officeStock[bagType]}
                  onChange={(e) =>
                    setOfficeStock((prev) => ({
                      ...prev,
                      [bagType]: Math.max(0, toNumberSafe(e.target.value)),
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg font-black text-slate-900 outline-none transition-all focus:border-orange-400"
                />

                <div className="mt-4 space-y-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <div className="flex items-center justify-between">
                    <span>Nas lojas</span>
                    <span className="text-slate-900">{totals.current[bagType]}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Necessidade</span>
                    <span className="text-slate-900">{totals.deficit[bagType]}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Enviar</span>
                    <span className="text-emerald-600">{totals.send[bagType]}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Saldo escritório</span>
                    <span className="text-orange-600">{totals.officeRemaining[bagType]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 md:px-6">
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Tabela de distribuição</h2>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Cálculo baseado no estoque da loja e na venda do mês vigente
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1500px] w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Loja</th>
                  {BAG_TYPES.map((bagType) => (
                    <React.Fragment key={bagType}>
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{bagType} atual</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{bagType} ideal</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{bagType} enviar</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{bagType} dura</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{bagType} pós-envio</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={26} className="px-4 py-12 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                      Carregando dados de sacolas...
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={26} className="px-4 py-12 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                      Nenhum dado encontrado para o filtro atual.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr key={row.store} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="sticky left-0 z-10 bg-white px-4 py-4 text-sm font-black uppercase tracking-wide text-slate-800">
                        {row.store}
                      </td>
                      {BAG_TYPES.map((bagType) => (
                        <React.Fragment key={`${row.store}-${bagType}`}>
                          <td className="px-3 py-4 text-right text-sm font-black text-slate-700">{row.current[bagType]}</td>
                          <td className="px-3 py-4 text-right text-sm font-black text-slate-900">{row.ideal[bagType]}</td>
                          <td className="px-3 py-4 text-right text-sm font-black text-emerald-600">{row.send[bagType]}</td>
                          <td className="px-3 py-4 text-right text-sm font-black text-orange-600">{formatDays(row.daysRemaining[bagType])}</td>
                          <td className="px-3 py-4 text-right text-sm font-black text-blue-600">{formatDays(row.daysAfterSend[bagType])}</td>
                        </React.Fragment>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Regras aplicadas</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-slate-700">PP</p>
              <p className="mt-2 text-sm text-slate-500">Somente wearables.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-slate-700">P</p>
              <p className="mt-2 text-sm text-slate-500">Wearables e acessórios.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-slate-700">M</p>
              <p className="mt-2 text-sm text-slate-500">Smartphones e acessórios.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-slate-700">G</p>
              <p className="mt-2 text-sm text-slate-500">Smartphones e tablets.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-slate-700">GG</p>
              <p className="mt-2 text-sm text-slate-500">Notebooks.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
