import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Search, Box, Store, 
  TrendingUp, AlertCircle, LayoutGrid, List as ListIcon,
  Smartphone, Tag, Filter, MapPin, X, Download, ChevronRight, ArrowLeft, ShoppingBag, RefreshCw, Truck, ArrowRight, ShoppingCart, Calendar, Bug, Activity, Clock, ArrowLeftRight,
  BarChart3, Layers, Eye, EyeOff
} from 'lucide-react';
import * as XLSX from 'xlsx';

// --- COMPONENTE AUXILIAR PARA MULTI-SELECT ---
const MultiSelectDropdown = ({ options, selected, onChange, placeholder }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((item: string) => item !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  const clear = (e: any) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div ref={wrapperRef} className="relative w-full md:w-auto shrink-0 z-20">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white border border-slate-200 text-slate-600 text-[10px] md:text-xs font-bold uppercase px-3 md:px-4 py-2 md:py-2.5 rounded-xl outline-none cursor-pointer hover:border-indigo-300 shadow-sm flex items-center justify-between gap-2 min-w-[160px] h-full"
      >
        <span className="truncate">
          {selected.length === 0 ? placeholder : `${selected.length} selecionado(s)`}
        </span>
        {selected.length > 0 && (
           <X size={14} className="hover:text-red-500 shrink-0" onClick={clear} />
        )}
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-xl max-h-60 overflow-y-auto flex flex-col p-2 z-50">
          {options.map((opt: string) => (
            <label key={opt} className="flex items-center gap-2 px-2 py-2 hover:bg-slate-50 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggleOption(opt)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
              />
              <span className="text-xs font-bold text-slate-700 uppercase">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};


// --- 1. CONFIGURAÇÕES E MAPAS ---

const STORE_REGIONS: Record<string, string> = {
  "ARAGUAIA SHOPPING": "GOIÁS", "BOULEVARD SHOPPING": "DF", "BRASILIA SHOPPING": "DF",
  "CONJUNTO NACIONAL": "DF", "CONJUNTO NACIONAL QUIOSQUE": "DF", "GOIANIA SHOPPING": "GOIÁS",
  "IGUATEMI SHOPPING": "DF", "JK SHOPPING": "DF", "PARK SHOPPING": "DF",
  "PATIO BRASIL": "DF", "TAGUATINGA SHOPPING": "DF", "TERRAÇO SHOPPING": "DF",
  "TAGUATINGA SHOPPING QQ": "DF", "UBERLÂNDIA SHOPPING": "MINAS GERAIS",
  "UBERABA SHOPPING": "MINAS GERAIS", "FLAMBOYANT SHOPPING": "GOIÁS",
  "BURITI SHOPPING": "GOIÁS", "PASSEIO DAS AGUAS": "GOIÁS", "PORTAL SHOPPING": "GOIÁS",
  "SHOPPING SUL": "GOIÁS", "BURITI RIO VERDE": "GOIÁS", "PARK ANAPOLIS": "GOIÁS",
  "SHOPPING RECIFE": "NORDESTE", "MANAIRA SHOPPING": "NORDESTE", "IGUATEMI FORTALEZA": "NORDESTE",
  "CD TAGUATINGA": "CD"
};

const CNPJ_MAP: Record<string, string> = {
  "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING",
  "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL",
  "12309173001228": "CONJUNTO NACIONAL QUIOSQUE", "12309173000507": "GOIANIA SHOPPING",
  "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING",
  "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
  "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING",
  "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING",
  "12309173001813": "UBERABA SHOPPING", "12309173001570": "FLAMBOYANT SHOPPING",
  "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS",
  "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
  "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS",
  "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING",
  "12309173002976": "IGUATEMI FORTALEZA", "12309173001066": "CD TAGUATINGA"
};

const normalizeStr = (str: string) => String(str || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const getStoreNameFromCNPJ = (raw: string) => {
  if (!raw) return "";
  const clean = raw.replace(/\D/g, '');
  return CNPJ_MAP[clean] || CNPJ_MAP[raw] || raw.toUpperCase();
};

const normalizeDate = (value: any) => {
  const s = String(value || '').trim();
  if (!s) return '';

  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  if (s.includes('-')) {
    return s.substring(0, 10);
  }

  return s;
};

const getLineValue = (item: any) =>
  String(item.emLinha || item.em_linha || item.linha || 'SEM LINHA')
    .trim()
    .toUpperCase();

const getClusterValue = (item: any) =>
  String(item.cluster || 'SEM CLUSTER')
    .trim()
    .toUpperCase();

const CD_STORE_NAME = "CD TAGUATINGA";

const LOGISTICALLY_EXCLUDED_STORES = [
  "IGUATEMI FORTALEZA",
  "MANAIRA SHOPPING",
  "SHOPPING RECIFE",
  "UBERABA SHOPPING",
  "UBERLÂNDIA SHOPPING",
  "BURITI RIO VERDE"
];

const LOGISTICALLY_EXCLUDED_STORE_KEYS = LOGISTICALLY_EXCLUDED_STORES.map(normalizeStr);
const CD_STORE_KEY = normalizeStr(CD_STORE_NAME);

const isCdStore = (storeName: string) => normalizeStr(storeName) === CD_STORE_KEY;
const isLogisticallyExcludedStore = (storeName: string) =>
  LOGISTICALLY_EXCLUDED_STORE_KEYS.includes(normalizeStr(storeName));

const toNumericValue = (value: any) => {
  if (typeof value === 'number') return value;

  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  if (raw.includes(',')) {
    return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
  }

  return Number(raw) || 0;
};

const firstFilledValue = (...values: any[]) =>
  values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '';

const getSaleStoreName = (sale: any) => {
  const rawStore = firstFilledValue(
    sale.cnpj_empresa,
    sale.CNPJ_EMPRESA,
    sale.loja,
    sale.LOJA,
    sale.storeName,
    sale.store
  );

  return getStoreNameFromCNPJ(String(rawStore)).trim().toUpperCase();
};

const getSaleDescription = (sale: any) =>
  String(firstFilledValue(
    sale.descricao,
    sale.DESCRICAO,
    sale.produto,
    sale.PRODUTO,
    sale.description
  )).trim();

const getSaleQuantity = (sale: any) => {
  const rawQuantity = firstFilledValue(
    sale.quantidade,
    sale.QUANTIDADE,
    sale.qtd_real,
    sale.QTD_REAL,
    sale.qtd,
    sale.QTD
  );

  if (rawQuantity === '') return 1;
  return Math.max(0, toNumericValue(rawQuantity));
};

const getSaleCategory = (sale: any) =>
  String(firstFilledValue(
    sale.categoria_real,
    sale.CATEGORIA_REAL,
    sale.categoria,
    sale.CATEGORIA,
    sale.familia,
    sale.FAMILIA,
    'GERAL'
  )).trim().toUpperCase() || 'GERAL';

const getSaleProductCode = (sale: any) =>
  String(firstFilledValue(
    sale.codigo_produto,
    sale.CODIGO_PRODUTO,
    sale.referencia,
    sale.REFERENCIA,
    sale.productCode
  )).trim();

export default function StockModule() {
  const [stockData, setStockData] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [purchaseData, setPurchaseData] = useState<any[]>([]);
  const [moduleMode, setModuleMode] = useState<'stock' | 'malote' | 'redistribution' | 'purchases' | 'analysis' | 'predictive'>('stock');
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [filter, setFilter] = useState('');
  
  // Modificado: Estados para Multi-select
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [lineFilter, setLineFilter] = useState<string[]>([]);
  const [clusterFilter, setClusterFilter] = useState<string[]>([]);
  const [maloteCategoryFilter, setMaloteCategoryFilter] = useState<string[]>([]);
  
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [storeViewMode, setStoreViewMode] = useState<'grid' | 'list'>('grid'); // Novo: toggle de lojas
  const [storeDetailSearch, setStoreDetailSearch] = useState('');
  const [storeDetailSort, setStoreDetailSort] = useState<'ESTOQUE' | 'GIRO' | 'VALOR' | 'NOME'>('ESTOQUE');

  const [maloteSearch, setMaloteSearch] = useState('');
  const [analysisData, setAnalysisData] = useState<any[]>([]);
  const [analysisSearch, setAnalysisSearch] = useState('');
  const [analysisStatusFilter, setAnalysisStatusFilter] = useState('TODOS');
  const [maloteViewMode, setMaloteViewMode] = useState<'table' | 'cards'>('table');
  const [stockViewFilter, setStockViewFilter] = useState<'TODOS' | 'COM_GIRO' | 'SEM_GIRO' | 'ESTOQUE_BAIXO'>('TODOS');
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const [insightCategory, setInsightCategory] = useState('TODAS');

  // NOVO: calendário de período
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstDayOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  // Regra blindada que sabe diferenciar IP local de Vercel
  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  const API_URL = isLocal
    ? `http://${window.location.hostname}:3000`
    : 'https://telefluxo-aplicacao.onrender.com';

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Estoque (AGORA COM REAGRUPAMENTO AUTOMÁTICO PARA VISÃO GERAL)
      const resStock = await fetch(`${API_URL}/stock`);
      const jsonStock = await resStock.json();

      if (Array.isArray(jsonStock)) {
        const groupedStock: Record<string, any> = {};

        jsonStock.forEach((item: any) => {
          const key = `${item.storeName}|${item.productCode}`;

          if (!groupedStock[key]) {
            groupedStock[key] = { ...item, quantity: 0 };
          }
          groupedStock[key].quantity += Number(item.quantity) || 0;
        });

        setStockData(Object.values(groupedStock));
      }

      // 2. Compras
      try {
        const resPurchases = await fetch(`${API_URL}/purchases`);
        const jsonPurchases = await resPurchases.json();
        if (Array.isArray(jsonPurchases)) setPurchaseData(jsonPurchases);
      } catch (e) {
        console.warn("Erro ao carregar compras", e);
      }

      // 3. Descobre usuário
      let userId = '';
      try {
        const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          userId = parsed.id || parsed.userId || parsed._id || '';
        }
      } catch (e) {}

      // 4. Análise de Estoque (O FILME DO IMEI)
      try {
        const resAnalysis = await fetch(`${API_URL}/stock/analysis`);
        const jsonAnalysis = await resAnalysis.json();
        if (Array.isArray(jsonAnalysis)) setAnalysisData(jsonAnalysis);
      } catch (e) {
        console.warn("Erro ao carregar análise", e);
      }

      // 5. Vendas: junta histórico anual + mês atual, ambos respeitando o período escolhido
      const resSalesMes = await fetch(
        `${API_URL}/sales?userId=${userId}&startDate=${startDate}&endDate=${endDate}`
      );
      const resSalesAnual = await fetch(
        `${API_URL}/sales_anuais?userId=${userId}&startDate=${startDate}&endDate=${endDate}`
      );

      let vendasMes: any[] = [];
      let vendasAnual: any[] = [];

      if (resSalesMes.ok) {
        const jsonSalesMes = await resSalesMes.json();
        vendasMes = jsonSalesMes.sales || (Array.isArray(jsonSalesMes) ? jsonSalesMes : []);
      }

      if (resSalesAnual.ok) {
        const jsonSalesAnual = await resSalesAnual.json();
        vendasAnual = jsonSalesAnual.sales || (Array.isArray(jsonSalesAnual) ? jsonSalesAnual : []);
      }

      // Junta os dois bancos
      const vendasCombinadas = [...vendasAnual, ...vendasMes];

      // Blindagem extra: garante filtro final no frontend também
      const vendasFiltradasNoPeriodo = vendasCombinadas.filter((sale: any) => {
        const dataISO = normalizeDate(sale.data_emissao || sale.DATA_EMISSAO || '');
        if (!dataISO) return false;
        return dataISO >= startDate && dataISO <= endDate;
      });

      setSalesData(vendasFiltradasNoPeriodo);

    } catch (error) {
      console.error("Erro geral no loadData:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  useEffect(() => {
    if (expandedStore) {
      setShowInsightsPanel(false);
      setStoreDetailSearch('');
      setStoreDetailSort('ESTOQUE');
    }
  }, [expandedStore]);

  // --- MAPAS AUXILIARES ---
  const salesMap = useMemo(() => {
    const map: Record<string, number> = {};

    salesData.forEach(sale => {
      const storeName = getSaleStoreName(sale);
      const desc = normalizeStr(getSaleDescription(sale));
      const quantity = getSaleQuantity(sale);

      if (!storeName || !desc || quantity <= 0) return;

      const key = `${storeName}|${desc}`;
      if (!map[key]) map[key] = 0;
      map[key] += quantity;
    });

    return map;
  }, [salesData]);

  const purchasesMap = useMemo(() => {
    const map: Record<string, any> = {};
    purchaseData.forEach(p => {
      const rawRegiao = (p.regiao || "OUTROS").toUpperCase();
      const key = `${rawRegiao}|${normalizeStr(p.descricao)}`;

      if (!map[key]) map[key] = { total: 0, details: [] };
      map[key].total += p.qtd_total;

      let prev = {};
      try { prev = JSON.parse(p.previsao_info); } catch (e) {}
      map[key].details.push(prev);
    });
    return map;
  }, [purchaseData]);

  const getProductSales = (storeName: string, description: string) => {
    const key = `${storeName.trim().toUpperCase()}|${normalizeStr(description)}`;
    return salesMap[key] || 0;
  };

  const getIncomingStock = (region: string, description: string) => {
    const key = `${region.toUpperCase()}|${normalizeStr(description)}`;
    return purchasesMap[key] || null;
  };

  const periodDays = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
    end.setMinutes(end.getMinutes() + end.getTimezoneOffset());

    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, diff);
  }, [startDate, endDate]);

  const stockCatalogByDescription = useMemo(() => {
    const catalog: Record<string, any> = {};

    stockData.forEach(item => {
      const descKey = normalizeStr(item.description);
      if (!descKey) return;

      const current = catalog[descKey];
      const currentIsCd = current && isCdStore(current.storeName || '');
      const itemIsCd = isCdStore(item.storeName || '');

      if (!current || itemIsCd || (!currentIsCd && !current.productCode && item.productCode)) {
        catalog[descKey] = {
          description: item.description || 'SEM DESCRIÇÃO',
          productCode: item.productCode || '',
          category: item.category || 'GERAL',
          line: getLineValue(item),
          cluster: getClusterValue(item),
          storeName: item.storeName || ''
        };
      }
    });

    return catalog;
  }, [stockData]);

  // --- ALGORITMOS ---
  
  const redistributionSuggestions = useMemo(() => {
    if (stockData.length === 0 && salesData.length === 0) return { moves: [] };

    const suggestions: any[] = [];
    const productGroups: Record<string, any> = {};
    const groupStoreIndex: Record<string, any> = {};

    const addStoreProduct = (params: any) => {
      const rawDescription = String(params.description || '').trim();
      const descKey = normalizeStr(rawDescription);
      if (!descKey) return;

      const catalogItem = stockCatalogByDescription[descKey] || {};
      const storeName = String(params.storeName || '').trim().toUpperCase();
      if (!storeName || isCdStore(storeName) || isLogisticallyExcludedStore(storeName)) return;

      const region = (STORE_REGIONS[storeName] || params.region || 'OUTROS').toUpperCase();
      if (regionFilter.length > 0 && !regionFilter.includes(region)) return;

      const category = String(catalogItem.category || params.category || 'GERAL').trim().toUpperCase() || 'GERAL';
      if (categoryFilter.length > 0 && !categoryFilter.includes(category)) return;

      const line = String(params.line || catalogItem.line || 'SEM LINHA').trim().toUpperCase();
      if (lineFilter.length > 0 && !lineFilter.includes(line)) return;

      const cluster = String(params.cluster || catalogItem.cluster || 'SEM CLUSTER').trim().toUpperCase();
      if (clusterFilter.length > 0 && !clusterFilter.includes(cluster)) return;

      const groupKey = `${region}|${descKey}`;

      if (!productGroups[groupKey]) {
        productGroups[groupKey] = {
          description: catalogItem.description || rawDescription || 'SEM DESCRIÇÃO',
          productCode: params.productCode || catalogItem.productCode || '',
          region,
          category,
          totalStock: 0,
          totalSales: 0,
          stores: []
        };
      }

      const storeKey = `${groupKey}|${storeName}`;

      if (!groupStoreIndex[storeKey]) {
        groupStoreIndex[storeKey] = {
          storeName,
          qty: 0,
          sales: 0,
          dailySales: 0,
          coverageDays: 0,
          cluster
        };
        productGroups[groupKey].stores.push(groupStoreIndex[storeKey]);
      }

      const storeItem = groupStoreIndex[storeKey];
      const stockToAdd = Math.max(0, toNumericValue(params.stock || 0));
      const salesToAdd = Math.max(0, toNumericValue(params.sales || 0));

      if (stockToAdd > 0) {
        storeItem.qty += stockToAdd;
        productGroups[groupKey].totalStock += stockToAdd;
      }

      if (salesToAdd > 0) {
        storeItem.sales += salesToAdd;
        productGroups[groupKey].totalSales += salesToAdd;
      }
    };

    stockData.forEach(item => {
      addStoreProduct({
        storeName: item.storeName,
        description: item.description || 'SEM DESCRIÇÃO',
        productCode: item.productCode || '',
        category: item.category || 'GERAL',
        line: getLineValue(item),
        cluster: getClusterValue(item),
        region: STORE_REGIONS[item.storeName] || 'OUTROS',
        stock: item.quantity,
        sales: 0
      });
    });

    salesData.forEach(sale => {
      const sales = getSaleQuantity(sale);
      const description = getSaleDescription(sale);
      const storeName = getSaleStoreName(sale);

      if (sales <= 0 || !description || !storeName) return;

      addStoreProduct({
        storeName,
        description,
        productCode: getSaleProductCode(sale),
        category: getSaleCategory(sale),
        region: String(sale.regiao || sale.REGIAO || 'OUTROS').toUpperCase(),
        stock: 0,
        sales
      });
    });

    Object.values(productGroups).forEach((prod: any) => {
      const stores = prod.stores.filter((store: any) => !isCdStore(store.storeName));
      if (stores.length < 2 || prod.totalStock <= 0 || prod.totalSales <= 0) return;

      stores.forEach((store: any) => {
        store.dailySales = store.sales / Math.max(periodDays, 1);
        store.coverageDays = store.dailySales > 0 ? store.qty / store.dailySales : (store.qty > 0 ? 999 : 0);
      });

      const donors = stores
        .map((store: any) => {
          const minSafetyStock = Math.max(2, Math.ceil(store.dailySales * 15));
          const hasNoRotationSurplus = store.sales === 0 && store.qty > 2;
          const hasHighCoverageSurplus = store.dailySales > 0 && store.coverageDays > 45 && store.qty > minSafetyStock;
          const surplus = hasNoRotationSurplus ? store.qty - 2 : hasHighCoverageSurplus ? store.qty - minSafetyStock : 0;
          return { ...store, surplus: Math.max(0, Math.floor(surplus)), minSafetyStock };
        })
        .filter((store: any) => store.surplus > 0)
        .sort((a: any, b: any) => b.surplus - a.surplus || b.coverageDays - a.coverageDays);

      const receivers = stores
        .map((store: any) => {
          const targetStock = Math.max(2, Math.ceil(store.dailySales * 15));
          const criticalByStock = store.qty <= 1 && store.sales > 0;
          const criticalByCoverage = store.dailySales > 0 && store.coverageDays < 10;
          const need = (criticalByStock || criticalByCoverage) ? Math.max(0, targetStock - store.qty) : 0;
          return { ...store, need: Math.max(0, Math.ceil(need)), targetStock };
        })
        .filter((store: any) => store.need > 0)
        .sort((a: any, b: any) => {
          const aEmpty = a.qty <= 0 ? 1 : 0;
          const bEmpty = b.qty <= 0 ? 1 : 0;
          return bEmpty - aEmpty || b.sales - a.sales || a.coverageDays - b.coverageDays;
        });

      if (donors.length === 0 || receivers.length === 0) return;

      let safetyCounter = 0;

      while (donors.some((donor: any) => donor.surplus > 0) && receivers.some((receiver: any) => receiver.need > 0) && safetyCounter < 1000) {
        safetyCounter += 1;
        let movedInRound = false;

        for (const receiver of receivers) {
          if (receiver.need <= 0) continue;

          const donor = donors.find((candidate: any) => candidate.surplus > 0 && candidate.storeName !== receiver.storeName);
          if (!donor) break;

          const moveQty = Math.min(donor.surplus, receiver.need, receiver.qty <= 0 ? 2 : 1);
          if (moveQty <= 0) continue;

          const donorCoverage = donor.coverageDays >= 999 ? 'sem giro' : `${Math.round(donor.coverageDays)} dias`;
          const receiverCoverage = receiver.coverageDays > 0 ? `${Math.round(receiver.coverageDays)} dias` : 'sem cobertura';

          suggestions.push({
            type: 'move',
            product: prod.description,
            productCode: prod.productCode,
            category: prod.category,
            from: donor.storeName,
            to: receiver.storeName,
            qty: moveQty,
            region: prod.region,
            donorStock: donor.qty,
            donorSales: donor.sales,
            receiverStock: receiver.qty,
            receiverSales: receiver.sales,
            priority: receiver.qty === 0 ? 'CRÍTICA' : receiver.coverageDays < 7 ? 'ALTA' : 'MÉDIA',
            reason: receiver.qty === 0
              ? `Destino vendeu ${receiver.sales} un. no período, mas está sem estoque. Origem com cobertura ${donorCoverage}.`
              : `Origem com cobertura ${donorCoverage} e destino com ${receiverCoverage}.`,
          });

          donor.surplus -= moveQty;
          receiver.need -= moveQty;
          receiver.qty += moveQty;
          movedInRound = true;
        }

        if (!movedInRound) break;
      }
    });

    return {
      moves: suggestions.sort((a, b) => {
        const priorityScore: Record<string, number> = { 'CRÍTICA': 3, 'ALTA': 2, 'MÉDIA': 1 };
        return (priorityScore[b.priority] || 0) - (priorityScore[a.priority] || 0) || b.receiverSales - a.receiverSales || b.qty - a.qty;
      }),
    };
  }, [stockData, salesData, regionFilter, categoryFilter, lineFilter, clusterFilter, periodDays, stockCatalogByDescription]);

  const redistributionMetrics = useMemo(() => {
    const moves = redistributionSuggestions.moves || [];
    const totalUnits = moves.reduce((acc: number, move: any) => acc + (Number(move.qty) || 0), 0);
    const criticalMoves = moves.filter((move: any) => move.priority === 'CRÍTICA').length;
    const originStores = new Set(moves.map((move: any) => move.from));
    const destinationStores = new Set(moves.map((move: any) => move.to));

    return {
      totalMoves: moves.length,
      totalUnits,
      criticalMoves,
      originStores: originStores.size,
      destinationStores: destinationStores.size,
    };
  }, [redistributionSuggestions]);

  // --- ALGORITMO: PREVISÃO DE RUPTURA (PREDICTIVE STOCKOUT) ---
  
  // --- TIPAGEM DO ALGORITMO ---
  type PredictiveRisk = {
    store: string;
    product: string;
    category: string;
    cluster: string;
    stock: number;
    sales: number;
    dailySales: number;
    coverageDays: number;
    financialRisk: number;
  };

  // --- ALGORITMO: PREVISÃO DE RUPTURA (PREDICTIVE STOCKOUT) ---
  // Note o <PredictiveRisk[]> forçando a tipagem do retorno
  const predictiveStockout = useMemo<PredictiveRisk[]>(() => {
    if (stockData.length === 0) return [];

    const risks: PredictiveRisk[] = [];

    stockData.forEach(item => {
      const region = STORE_REGIONS[item.storeName] || "OUTROS";
      if (regionFilter.length > 0 && !regionFilter.includes(region)) return;
      if (categoryFilter.length > 0 && !categoryFilter.includes(item.category || 'GERAL')) return;

      const sales = getProductSales(item.storeName, item.description);
      const stock = Number(item.quantity) || 0;
      
      if (sales === 0 && stock === 0) return;

      const dailySales = sales / Math.max(periodDays, 1);
      
      let coverageDays = 0;
      if (stock === 0 && sales > 0) {
        coverageDays = 0; 
      } else if (dailySales > 0) {
        coverageDays = stock / dailySales;
      } else {
        coverageDays = 999;
      }

      if (coverageDays <= 15) {
        risks.push({
          store: item.storeName,
          product: item.description,
          category: item.category || 'GERAL',
          cluster: getClusterValue(item),
          stock: stock,
          sales: sales,
          dailySales: dailySales,
          coverageDays: coverageDays,
          financialRisk: dailySales * 15 * (Number(item.salePrice) || 0)
        });
      }
    });

    return risks.sort((a, b) => a.coverageDays - b.coverageDays || b.financialRisk - a.financialRisk);
  }, [stockData, salesData, regionFilter, categoryFilter, periodDays]);

   // --- ALGORITMO MALOTE (FRONT-END) ---
  const calculatedMalote = useMemo(() => {
    if (stockData.length === 0 && salesData.length === 0) return [];

    const suggestions: any[] = [];
    const cdStockByProduct: Record<string, any> = {};
    const productGroups: Record<string, any> = {};
    const groupStoreIndex: Record<string, any> = {};

    stockData.forEach(item => {
      if (!isCdStore(item.storeName || '')) return;

      const descKey = normalizeStr(item.description);
      if (!descKey) return;

      if (!cdStockByProduct[descKey]) {
        cdStockByProduct[descKey] = {
          quantity: 0,
          modelo: item.description || 'SEM DESCRIÇÃO',
          category: item.category || 'GERAL'
        };
      }

      cdStockByProduct[descKey].quantity += Math.max(0, toNumericValue(item.quantity || 0));
    });

    const addDestination = (params: any) => {
      const rawDescription = String(params.description || '').trim();
      const descKey = normalizeStr(rawDescription);
      if (!descKey) return;

      const storeName = String(params.storeName || '').trim().toUpperCase();
      if (!storeName || isCdStore(storeName) || isLogisticallyExcludedStore(storeName)) return;

      const catalogItem = stockCatalogByDescription[descKey] || {};
      const cdItem = cdStockByProduct[descKey] || {};
      const category = String(catalogItem.category || cdItem.category || params.category || 'GERAL').trim().toUpperCase() || 'GERAL';

      if (!productGroups[descKey]) {
        productGroups[descKey] = {
          modelo: cdItem.modelo || catalogItem.description || rawDescription || 'SEM DESCRIÇÃO',
          category,
          lojas: []
        };
      }

      const storeKey = `${descKey}|${storeName}`;

      if (!groupStoreIndex[storeKey]) {
        groupStoreIndex[storeKey] = {
          loja: storeName,
          estoqueAtual: 0,
          vendaPeriodo: 0,
          mediaDia: 0,
          sugestaoEnvio: 0,
          necessidade: 0
        };

        productGroups[descKey].lojas.push(groupStoreIndex[storeKey]);
      }

      const storeItem = groupStoreIndex[storeKey];
      const stockToAdd = Math.max(0, toNumericValue(params.stock || 0));
      const salesToAdd = Math.max(0, toNumericValue(params.sales || 0));

      if (stockToAdd > 0) storeItem.estoqueAtual += stockToAdd;
      if (salesToAdd > 0) storeItem.vendaPeriodo += salesToAdd;
    };

    stockData.forEach(item => {
      addDestination({
        storeName: item.storeName,
        description: item.description || 'SEM DESCRIÇÃO',
        category: item.category || 'GERAL',
        stock: item.quantity,
        sales: 0
      });
    });

    salesData.forEach(sale => {
      const sales = getSaleQuantity(sale);
      const description = getSaleDescription(sale);
      const storeName = getSaleStoreName(sale);

      if (sales <= 0 || !description || !storeName) return;

      addDestination({
        storeName,
        description,
        category: getSaleCategory(sale),
        stock: 0,
        sales
      });
    });

    Object.entries(productGroups).forEach(([descKey, prod]: any) => {
      const saldoInicialCd = Math.floor(cdStockByProduct[descKey]?.quantity || 0);
      let saldoCd = saldoInicialCd;

      if (saldoCd <= 0 || prod.lojas.length === 0) return;

      const lojasComNecessidade = prod.lojas
        .map((loja: any) => {
          const mediaDia = loja.vendaPeriodo / Math.max(periodDays, 1);
          const coberturaAlvo = Math.max(1, Math.ceil(mediaDia * 15));
          const necessidade = loja.vendaPeriodo > 0 ? Math.max(0, coberturaAlvo - loja.estoqueAtual) : 0;

          return {
            ...loja,
            mediaDia,
            necessidade: Math.ceil(necessidade),
            sugestaoEnvio: 0
          };
        })
        .filter((loja: any) => loja.necessidade > 0)
        .sort((a: any, b: any) => {
          const aEmpty = a.estoqueAtual <= 0 ? 1 : 0;
          const bEmpty = b.estoqueAtual <= 0 ? 1 : 0;
          return bEmpty - aEmpty || b.vendaPeriodo - a.vendaPeriodo || a.estoqueAtual - b.estoqueAtual;
        });

      if (lojasComNecessidade.length === 0) return;

      let safetyCounter = 0;

      while (saldoCd > 0 && lojasComNecessidade.some((loja: any) => loja.necessidade > 0) && safetyCounter < 1000) {
        safetyCounter += 1;
        let movedInRound = false;

        for (const loja of lojasComNecessidade) {
          if (saldoCd <= 0) break;
          if (loja.necessidade <= 0) continue;

          loja.sugestaoEnvio += 1;
          loja.necessidade -= 1;
          saldoCd -= 1;
          movedInRound = true;
        }

        if (!movedInRound) break;
      }

      const lojasComAtendimento = lojasComNecessidade
        .filter((loja: any) => loja.sugestaoEnvio > 0)
        .map((loja: any) => ({
          loja: loja.loja,
          estoqueAtual: loja.estoqueAtual,
          vendaPeriodo: loja.vendaPeriodo,
          mediaDia: loja.mediaDia,
          sugestaoEnvio: loja.sugestaoEnvio
        }));

      if (lojasComAtendimento.length > 0) {
        suggestions.push({
          ...prod,
          lojas: lojasComAtendimento,
          saldoRestanteCd: saldoCd
        });
      }
    });

    return suggestions;
  }, [stockData, salesData, periodDays, stockCatalogByDescription]); 


    
  

  // --- AGRUPAMENTO DE COMPRAS ---
  const groupedPurchases = useMemo(() => {
    const groups: Record<string, any[]> = {};
    purchaseData.forEach(p => {
      const regiao = (p.regiao || "OUTROS").toUpperCase();
      if (regionFilter.length > 0 && !regionFilter.includes(regiao)) return;
      if (!groups[regiao]) groups[regiao] = [];
      groups[regiao].push(p);
    });
    return groups;
  }, [purchaseData, regionFilter]);

  const filteredData = useMemo(() => {
    return stockData.filter(item => {
      const itemRegion = STORE_REGIONS[item.storeName] || "OUTROS";

      const matchesSearch =
        ((item.description || '').toLowerCase().includes(filter.toLowerCase()) ||
        (item.productCode || '').toString().includes(filter));

      // Lógica atualizada para Arrays de Multi-select
      const matchesCategory = categoryFilter.length === 0 || categoryFilter.includes(item.category || 'GERAL');
      const matchesRegion = regionFilter.length === 0 || regionFilter.includes(itemRegion);
      const matchesLine = lineFilter.length === 0 || lineFilter.includes(getLineValue(item));
      const matchesCluster = clusterFilter.length === 0 || clusterFilter.includes(getClusterValue(item));

      const productSales = getProductSales(item.storeName, item.description);
      const stockQty = Number(item.quantity) || 0;

      let matchesViewFilter = true;
      if (stockViewFilter === 'COM_GIRO') matchesViewFilter = productSales > 0;
      if (stockViewFilter === 'SEM_GIRO') matchesViewFilter = productSales === 0;
      if (stockViewFilter === 'ESTOQUE_BAIXO') matchesViewFilter = stockQty > 0 && stockQty < 3;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesRegion &&
        matchesLine &&
        matchesCluster &&
        matchesViewFilter
      );
    });
  }, [
    stockData,
    filter,
    categoryFilter,
    regionFilter,
    lineFilter,
    clusterFilter,
    stockViewFilter,
    salesMap
  ]);

  const currentStoreProducts = useMemo(() => {
    if (!expandedStore) return [];
    return filteredData.filter(i => i.storeName === expandedStore);
  }, [filteredData, expandedStore]);

  const storeDetailProducts = useMemo(() => {
    const search = storeDetailSearch.trim().toLowerCase();

    return currentStoreProducts
      .filter(item => {
        if (!search) return true;
        return (
          String(item.description || '').toLowerCase().includes(search) ||
          String(item.productCode || '').toLowerCase().includes(search) ||
          String(item.category || '').toLowerCase().includes(search) ||
          getLineValue(item).toLowerCase().includes(search) ||
          getClusterValue(item).toLowerCase().includes(search)
        );
      })
      .sort((a, b) => {
        if (storeDetailSort === 'GIRO') return getProductSales(b.storeName, b.description) - getProductSales(a.storeName, a.description);
        if (storeDetailSort === 'VALOR') return ((Number(b.costPrice) || 0) * (Number(b.quantity) || 0)) - ((Number(a.costPrice) || 0) * (Number(a.quantity) || 0));
        if (storeDetailSort === 'NOME') return String(a.description || '').localeCompare(String(b.description || ''));
        return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
      });
  }, [currentStoreProducts, storeDetailSearch, storeDetailSort, salesMap]);

  const stockSummary = useMemo(() => {
    const base = expandedStore ? currentStoreProducts : filteredData;

    const totalItems = base.length;
    const totalStockQty = base.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
    const totalStockValue = base.reduce((acc, item) => {
      return acc + ((Number(item.quantity) || 0) * (Number(item.costPrice) || 0));
    }, 0);

    const totalSalesQty = base.reduce((acc, item) => {
      return acc + getProductSales(item.storeName, item.description);
    }, 0);

    const lowStockCount = base.filter(item => {
      const q = Number(item.quantity) || 0;
      return q > 0 && q < 3;
    }).length;

    const noSalesCount = base.filter(item => {
      return getProductSales(item.storeName, item.description) === 0;
    }).length;

    return {
      totalItems,
      totalStockQty,
      totalStockValue,
      totalSalesQty,
      lowStockCount,
      noSalesCount
    };
  }, [expandedStore, currentStoreProducts, filteredData, salesMap]);

  const groupedStores = useMemo(() => {
    const groups: Record<string, any[]> = {};
    const storeStats: Record<string, any> = {};

    filteredData.forEach(item => {
      const store = item.storeName || 'LOJA DESCONHECIDA';
      const region = STORE_REGIONS[store] || 'OUTROS';
      if (!storeStats[store]) {
        storeStats[store] = {
          name: store,
          region: region,
          qty: 0,
          value: 0,
          lowStockCount: 0,
          cluster: getClusterValue(item)
        };
      }

      const q = Number(item.quantity) || 0;
      storeStats[store].qty += q;
      storeStats[store].value += (Number(item.costPrice) || 0) * q;
      if (q > 0 && q < 3) storeStats[store].lowStockCount += 1;
    });

    Object.values(storeStats).forEach((store: any) => {
      if (!groups[store.region]) groups[store.region] = [];
      groups[store.region].push(store);
    });

    const sortedGroups: Record<string, any[]> = {};
    Object.keys(groups).sort().forEach(region => {
      sortedGroups[region] = groups[region].sort((a, b) => b.value - a.value);
    });

    return sortedGroups;
  }, [filteredData]);

  const uniqueCategories = useMemo(() => Array.from(new Set(stockData.map(i => i.category || 'GERAL'))).sort(), [stockData]);
  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);

  const uniqueLines = useMemo(() => {
    const values = stockData
      .map(item => getLineValue(item))
      .filter(Boolean);

    return Array.from(new Set(values)).sort();
  }, [stockData]);

  const uniqueClusters = useMemo(() => {
    const values = stockData
      .map(item => getClusterValue(item))
      .filter(Boolean);

    return Array.from(new Set(values)).sort();
  }, [stockData]);

  const getStoreTotalSales = (storeName: string) => {
    const sales = salesData.filter(s => getStoreNameFromCNPJ(s.cnpj_empresa || s.loja) === storeName);
    return sales.reduce((acc, s) => acc + Number(s.quantidade || 0), 0);
  };

  const purchaseRegions = useMemo(() => {
    const regs = new Set(purchaseData.map(p => (p.regiao || "OUTROS").toUpperCase()));
    return Array.from(regs).sort();
  }, [purchaseData]);

  const categorySalesRanking = useMemo(() => {
    const rankingMap: Record<string, number> = {};

    filteredData.forEach(item => {
      const category = item.category || 'GERAL';
      const sold = getProductSales(item.storeName, item.description);

      if (!rankingMap[category]) rankingMap[category] = 0;
      rankingMap[category] += sold;
    });

    return Object.entries(rankingMap)
      .map(([category, sales]) => ({ category, sales }))
      .sort((a, b) => b.sales - a.sales);
  }, [filteredData, salesMap]);

  const topProductsRanking = useMemo(() => {
    const rankingMap: Record<string, { product: string; category: string; sales: number; stock: number }> = {};

    filteredData.forEach(item => {
      const product = item.description || 'SEM NOME';
      const category = item.category || 'GERAL';
      const sold = getProductSales(item.storeName, item.description);
      const stock = Number(item.quantity) || 0;
      const key = `${category}|||${product}`;

      if (!rankingMap[key]) {
        rankingMap[key] = {
          product,
          category,
          sales: 0,
          stock: 0
        };
      }

      rankingMap[key].sales += sold;
      rankingMap[key].stock += stock;
    });

    let list = Object.values(rankingMap);

    if (insightCategory !== 'TODAS') {
      list = list.filter(item => item.category === insightCategory);
    }

    return list.sort((a, b) => b.sales - a.sales).slice(0, 8);
  }, [filteredData, salesMap, insightCategory]);

  const topCategoriesOptions = useMemo(() => {
    const cats = Array.from(new Set(filteredData.map(item => item.category || 'GERAL'))).sort();
    return ['TODAS', ...cats];
  }, [filteredData]);

  // --- EXPORTADOR INTELIGENTE (DOWNLOAD SELETIVO) ---
  const handleExport = () => {
    let headers: string[] = [];
    let csvRows: string[] = [];
    let fileName = "Relatorio.csv";

    if (moduleMode === 'stock') {
      const dataToExport = expandedStore ? currentStoreProducts : filteredData;
      headers = ["Loja", "Cluster", "Linha", "Região", "Código", "Produto", "Categoria", "Qtd Estoque", "Qtd Vendida Período", "Custo Unit", "Preço Venda", "Custo Total"];
      csvRows = dataToExport.map(item => {
        const sold = getProductSales(item.storeName, item.description);
        return [
          `"${item.storeName}"`,
          `"${getClusterValue(item)}"`,
          `"${getLineValue(item)}"`,
          `"${STORE_REGIONS[item.storeName] || 'OUTROS'}"`,
          `"${item.productCode}"`,
          `"${item.description}"`,
          `"${item.category || 'GERAL'}"`,
          String(item.quantity).replace('.', ','),
          String(sold).replace('.', ','),
          Number(item.costPrice || 0).toFixed(2).replace('.', ','),
          Number(item.salePrice || 0).toFixed(2).replace('.', ','),
          (item.quantity * (item.costPrice || 0)).toFixed(2).replace('.', ',')
        ].join(';');
      });
      fileName = expandedStore ? `Estoque_${expandedStore}.csv` : `Estoque_Geral.csv`;
    }

    else if (moduleMode === 'malote') {
      headers = ["Produto", "Categoria", "Destino", "Estoque Atual (Loja)", "Vendas no Período", "Qtd a Enviar (Malote)"];
      const filteredMalote = calculatedMalote.filter(item =>
        (maloteCategoryFilter.length === 0 || maloteCategoryFilter.includes(item.category)) &&
        item.modelo.toLowerCase().includes(maloteSearch.toLowerCase())
      );
      filteredMalote.forEach((prod: any) => {
        prod.lojas.forEach((loja: any) => {
          if (loja.sugestaoEnvio > 0) {
            csvRows.push([`"${prod.modelo}"`, `"${prod.category}"`, `"${loja.loja}"`, loja.estoqueAtual, Math.round(loja.vendaPeriodo), loja.sugestaoEnvio].join(';'));
          }
        });
      });
      fileName = `Malote_CD_Taguatinga.csv`;
    }

    else if (moduleMode === 'redistribution') {
      headers = ["Prioridade", "Produto", "Categoria", "Região", "Origem", "Estoque Origem", "Vendas Origem", "Destino", "Estoque Destino", "Vendas Destino", "Quantidade", "Motivo"];
      redistributionSuggestions.moves.forEach((move: any) => {
        csvRows.push([
          `"${move.priority}"`,
          `"${move.product}"`,
          `"${move.category || ''}"`,
          `"${move.region}"`,
          `"${move.from}"`,
          move.donorStock,
          move.donorSales,
          `"${move.to}"`,
          move.receiverStock,
          move.receiverSales,
          move.qty,
          `"${move.reason}"`
        ].join(';'));
      });
      fileName = `Remanejamento_Inteligente.csv`;
    }

    else if (moduleMode === 'purchases') {
      headers = ["Produto", "Região", "Total a Receber", "Previsão / Detalhes"];
      Object.entries(groupedPurchases).forEach(([region, items]) => {
        items.forEach((item: any) => {
          let prevInfo = "";
          try {
            const prev = JSON.parse(item.previsao_info || '{}');
            prevInfo = Object.entries(prev).map(([week, qty]) => `${week}: ${qty}`).join(' | ');
          } catch (e) {}
          csvRows.push([`"${item.descricao}"`, `"${region}"`, item.qtd_total, `"${prevInfo}"`].join(';'));
        });
      });
      fileName = `Pedidos_Compras_Abertos.csv`;
    }

    if (csvRows.length === 0) {
      alert("Não há dados para exportar com os filtros atuais.");
      return;
    }

    const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen">
      <div className="max-w-[1600px] mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
              {expandedStore ? (
                <button
                  onClick={() => {
                    setExpandedStore(null);
                    setStockViewFilter('TODOS');
                  }}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
                >
                  <ArrowLeft size={24} />
                </button>
              ) : (
                <div className={`p-2.5 rounded-xl text-white shadow-md ${moduleMode === 'analysis' ? 'bg-purple-600 shadow-purple-200' : 'bg-indigo-600 shadow-indigo-200'}`}>
                  {moduleMode === 'stock' ? <Box size={20} /> :
                    moduleMode === 'redistribution' ? <Truck size={20} /> :
                    moduleMode === 'purchases' ? <ShoppingCart size={20} /> :
                    moduleMode === 'analysis' ? <Activity size={20} /> : <ShoppingCart size={20} />}
                </div>
              )}
              <div>
                <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                  {moduleMode === 'stock' ? (expandedStore || "Visão Estratégica de Estoque") :
                    moduleMode === 'redistribution' ? "Central de Remanejamento" :
                    moduleMode === 'analysis' ? "Análise de Estoque" :
                    "Controle de Compras"}
                </h1>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {moduleMode === 'stock' ? "Físico & Giro por Período" :
                      moduleMode === 'redistribution' ? "Inteligência de Distribuição" :
                      moduleMode === 'analysis' ? "Rastreabilidade por IMEI" :
                      "Gestão de Pedidos em Aberto"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto">
                <button onClick={() => setModuleMode('stock')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'stock' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Estoque</button>
                <button onClick={() => setModuleMode('malote')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'malote' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Malote</button>
                <button onClick={() => setModuleMode('redistribution')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'redistribution' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Remanejamento</button>
                <button onClick={() => setModuleMode('purchases')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'purchases' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Compras</button>
                {/* 👇 BOTÃO NOVO AQUI 👇 */}
                <button onClick={() => setModuleMode('predictive')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'predictive' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Ruptura</button>
              </div>

              <button
                onClick={() => setModuleMode('analysis')}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 ${moduleMode === 'analysis' ? 'bg-purple-700 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              >
                <Activity size={14} /> Análise
              </button>

              <button onClick={handleExport} className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl transition-all" title="Exportar Excel">
                <Download size={18} />
              </button>
            </div>
          </div>

          {/* NOVO: calendário global do módulo */}
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 border-t border-slate-100 pt-4">
            <div className="flex flex-col md:flex-row gap-3 w-full xl:w-auto">
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-sm">
                <div className="flex items-center px-2 border-r border-slate-200">
                  <Calendar size={14} className="text-slate-400 mr-2" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-28"
                  />
                </div>
                <div className="flex items-center px-2">
                  <span className="text-slate-300 font-bold mr-2 text-[10px]">ATÉ</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="bg-transparent border-none text-[10px] font-bold text-slate-600 uppercase focus:outline-none w-28"
                  />
                </div>
              </div>

              <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-2">
                <Clock size={14} />
                Período: {periodDays} dias
              </div>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </div>
        </div>

        {/* ================= MÓDULO DE ANÁLISE DE ESTOQUE (AGING) ================= */}
        {moduleMode === 'analysis' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-gradient-to-r from-purple-900 to-indigo-900 p-6 rounded-2xl text-white shadow-lg flex justify-between items-center relative overflow-hidden">
              <div className="absolute right-0 top-0 opacity-10">
                <Clock size={120} />
              </div>
              <div className="relative z-10 max-w-2xl">
                <h2 className="text-xl font-black uppercase mb-2 flex items-center gap-2"><Clock size={24} /> Aging de Estoque</h2>
                <p className="text-xs text-purple-100 opacity-90 leading-relaxed">
                  Acompanhe a idade de cada aparelho e o histórico de transferências entre as lojas.
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="BUSCAR POR IMEI, PRODUTO OU LOJA..."
                  value={analysisSearch}
                  onChange={e => setAnalysisSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                />
              </div>
              <select
                value={analysisStatusFilter}
                onChange={e => setAnalysisStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold uppercase px-4 py-2.5 rounded-xl outline-none cursor-pointer"
              >
                <option value="TODOS">Status: Todos</option>
                <option value="CRITICO">Status: Crítico (+90 dias)</option>
                <option value="ATENCAO">Status: Atenção (30 a 90 dias)</option>
                <option value="NOVO">Status: Novo (Até 30 dias)</option>
              </select>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-4 whitespace-nowrap">Produto</th>
                      <th className="p-4 whitespace-nowrap">IMEI / Série</th>
                      <th className="p-4 whitespace-nowrap">Loja Atual</th>
                      <th className="p-4 text-center whitespace-nowrap">Dias na Empresa</th>
                      <th className="p-4 text-center whitespace-nowrap">Dias nesta Loja</th>
                      <th className="p-4 text-center whitespace-nowrap">Giro do Produto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                    {analysisData
                      .filter(item => {
                        const matchSearch =
                          item.description.toLowerCase().includes(analysisSearch.toLowerCase()) ||
                          String(item.serial).includes(analysisSearch) ||
                          item.storeName.toLowerCase().includes(analysisSearch.toLowerCase());
                        if (!matchSearch) return false;

                        if (analysisStatusFilter === 'CRITICO') return item.daysInStore > 90;
                        if (analysisStatusFilter === 'ATENCAO') return item.daysInStore >= 30 && item.daysInStore <= 90;
                        if (analysisStatusFilter === 'NOVO') return item.daysInStore < 30;
                        return true;
                      })
                      .sort((a, b) => b.daysInStore - a.daysInStore)
                      .map((item, idx) => {
                        const isCritico = item.daysInStore > 90;
                        const isAtencao = item.daysInStore >= 30 && item.daysInStore <= 90;

                        const sales = getProductSales(item.storeName, item.description);
                        let giroLabel = "Sem Giro";
                        let giroColor = "text-slate-400";
                        if (sales > 10) { giroLabel = `Alto (${sales}/período)`; giroColor = "text-emerald-600"; }
                        else if (sales > 3) { giroLabel = `Médio (${sales}/período)`; giroColor = "text-amber-600"; }
                        else if (sales > 0) { giroLabel = `Baixo (${sales}/período)`; giroColor = "text-red-500"; }

                        return (
                          <tr key={idx} className="hover:bg-purple-50/30 transition-colors">
                            <td className="p-4">
                              <p className="font-bold text-slate-800 text-xs uppercase line-clamp-2 max-w-[250px]">{item.description}</p>
                              <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded uppercase mt-1 inline-block">{item.category}</span>
                            </td>
                            <td className="p-4 font-mono text-xs font-bold text-slate-500">{item.serial}</td>
                            <td className="p-4 font-bold text-slate-700 text-xs uppercase whitespace-nowrap">{item.storeName}</td>
                            <td className="p-4 text-center">
                              <span className="text-slate-500 font-bold bg-slate-100 px-3 py-1 rounded-lg text-xs">{item.daysInCompany} dias</span>
                            </td>
                            <td className="p-4 text-center min-w-[120px]">
                              <span className={`px-3 py-1 rounded-lg font-black text-xs inline-block ${isCritico ? 'bg-red-50 text-red-600 border border-red-100' : isAtencao ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                                {item.daysInStore} dias
                              </span>
                              {item.transferCount > 0 && (
                                <p className="text-[9px] font-bold text-purple-600 uppercase mt-1.5 flex items-center justify-center gap-1 bg-purple-50 py-0.5 rounded">
                                  <ArrowLeftRight size={10} /> {item.transferCount} mov.
                                </p>
                              )}
                            </td>
                            <td className="p-4 text-center">
                              <span className={`text-[10px] font-black uppercase tracking-wider ${giroColor}`}>
                                {giroLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    }
                    {analysisData.length === 0 && !loading && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-slate-400 text-xs uppercase font-bold tracking-widest bg-slate-50/50">
                          Nenhum histórico de IMEI encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= MÓDULO DE COMPRAS ================= */}
        {moduleMode === 'purchases' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 z-20 relative">
              <div className="flex items-center gap-2">
                <MapPin className="text-indigo-600" size={20} />
                <span className="text-sm font-bold text-slate-700 uppercase">Filtrar Região:</span>
                <MultiSelectDropdown
                  options={purchaseRegions}
                  selected={regionFilter}
                  onChange={setRegionFilter}
                  placeholder="Todas as Regiões"
                />
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-slate-800">{purchaseData.filter(p => regionFilter.length === 0 || regionFilter.includes((p.regiao || 'OUTROS').toUpperCase())).reduce((acc, curr) => acc + curr.qtd_total, 0)}</span>
                <span className="block text-[9px] font-bold text-slate-400 uppercase">Peças a receber</span>
              </div>
            </div>

            {purchaseData.length === 0 && (
              <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-center">
                <p className="text-red-800 font-bold mb-2">⚠️ LISTA VAZIA - DIAGNÓSTICO</p>
                <button onClick={() => setShowDebug(!showDebug)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 mx-auto">
                  <Bug size={16} /> VER DADOS DO SERVIDOR
                </button>
                {showDebug && (
                  <div className="mt-4 text-left bg-slate-900 text-green-400 p-4 rounded-xl text-xs overflow-auto max-h-60">
                    <p className="mb-2 text-white border-b border-white/20 pb-1">DADOS RECEBIDOS DO BACKEND:</p>
                    <pre>{JSON.stringify(purchaseData, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}

            {Object.keys(groupedPurchases).length > 0 ? Object.entries(groupedPurchases).map(([region, items]) => (
              <div key={region} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden z-10">
                <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-black text-slate-700 uppercase flex items-center gap-2"><MapPin size={16} /> {region}</h3>
                  <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full">{items.reduce((acc, i) => acc + i.qtd_total, 0)} un</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((item: any, idx: number) => {
                    let prev = {};
                    try { prev = JSON.parse(item.previsao_info || '{}'); } catch (e) {}

                    return (
                      <div key={idx} className="p-4 flex flex-col md:flex-row justify-between items-center gap-4 hover:bg-slate-50 transition-colors">
                        <div className="flex-1">
                          <h4 className="text-sm font-bold text-slate-800 uppercase">{item.descricao}</h4>
                          {Object.keys(prev).length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {Object.entries(prev).map(([week, qty]) => (
                                <span key={week} className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-100 px-2 py-1 rounded uppercase flex items-center gap-1">
                                  <Calendar size={10} /> {week}: {String(qty)} un
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right min-w-[80px]">
                          <span className="block text-2xl font-black text-slate-700">{item.qtd_total}</span>
                          <span className="text-[8px] font-bold text-slate-400 uppercase">Total Geral</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )) : (
              purchaseData.length > 0 && (
                <div className="p-20 text-center text-slate-400 font-bold uppercase text-sm bg-white rounded-2xl border border-dashed z-10 relative">
                  Filtro atual ocultou todos os {purchaseData.length} itens. Tente mudar a região.
                </div>
              )
            )}
          </div>
        )}

        {/* ================= MÓDULO REMANEJAMENTO ================= */}
        {moduleMode === 'redistribution' && (
          <div className="space-y-5 animate-fadeIn">
            <div className="bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-5 md:p-6 rounded-2xl text-white shadow-lg overflow-hidden relative">
              <div className="absolute -right-12 -top-12 w-40 h-40 bg-indigo-500/20 rounded-full blur-2xl"></div>
              <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
                <div>
                  <div className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-3 py-1 mb-3">
                    <Truck size={13} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Remanejamento Inteligente</span>
                  </div>
                  <h2 className="text-2xl font-black uppercase tracking-tight">Central de Transferências</h2>
                  <p className="text-xs text-white/60 mt-1 max-w-2xl">
                    Sugestões baseadas em sobra real de estoque, venda no período e cobertura por loja. A sugestão de compra foi removida desta tela.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]">
                    <p className="text-[9px] font-black uppercase text-white/50">Transferências</p>
                    <p className="text-2xl font-black">{redistributionMetrics.totalMoves}</p>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]">
                    <p className="text-[9px] font-black uppercase text-white/50">Peças</p>
                    <p className="text-2xl font-black text-indigo-200">{redistributionMetrics.totalUnits}</p>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]">
                    <p className="text-[9px] font-black uppercase text-white/50">Críticas</p>
                    <p className="text-2xl font-black text-red-200">{redistributionMetrics.criticalMoves}</p>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]">
                    <p className="text-[9px] font-black uppercase text-white/50">Destinos</p>
                    <p className="text-2xl font-black text-emerald-200">{redistributionMetrics.destinationStores}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2">
                    <ArrowLeftRight size={16} className="text-indigo-600" />
                    Lista de remanejamentos recomendados
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                    Mantém estoque de segurança na origem e prioriza lojas zeradas ou com baixa cobertura.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
                  <span className="bg-red-50 text-red-600 border border-red-100 px-3 py-1 rounded-full">Crítica: loja zerada</span>
                  <span className="bg-amber-50 text-amber-600 border border-amber-100 px-3 py-1 rounded-full">Alta: baixa cobertura</span>
                  <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-3 py-1 rounded-full">Máx. 5 un por sugestão</span>
                </div>
              </div>
            </div>

            {redistributionSuggestions.moves.length > 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-auto max-h-[calc(100vh-310px)] min-h-[380px]">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 shadow-sm">
                      <tr className="text-[10px] font-black uppercase text-slate-400">
                        <th className="px-4 py-3 whitespace-nowrap">Prioridade</th>
                        <th className="px-4 py-3 min-w-[320px]">Produto</th>
                        <th className="px-4 py-3 whitespace-nowrap">Origem</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">Origem</th>
                        <th className="px-4 py-3 whitespace-nowrap">Destino</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">Destino</th>
                        <th className="px-4 py-3 text-center whitespace-nowrap">Enviar</th>
                        <th className="px-4 py-3 min-w-[240px]">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {redistributionSuggestions.moves.map((move: any, idx: number) => {
                        const priorityClass =
                          move.priority === 'CRÍTICA'
                            ? 'bg-red-50 text-red-600 border-red-100'
                            : move.priority === 'ALTA'
                              ? 'bg-amber-50 text-amber-600 border-amber-100'
                              : 'bg-indigo-50 text-indigo-600 border-indigo-100';

                        return (
                          <tr key={`${move.product}-${move.from}-${move.to}-${idx}`} className="hover:bg-indigo-50/30 transition-colors">
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2.5 py-1 rounded-full border text-[9px] font-black uppercase ${priorityClass}`}>
                                {move.priority}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-black text-slate-800 uppercase leading-tight">{move.product}</p>
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
                                  {move.category || 'GERAL'}
                                </span>
                                <span className="text-[9px] font-black bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded uppercase border border-indigo-100">
                                  {move.region}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-black text-slate-700 uppercase">{move.from}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Loja com sobra</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <p className="text-sm font-black text-slate-800">{move.donorStock} est.</p>
                              <p className="text-[9px] font-bold text-slate-400">{move.donorSales} vend.</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-black text-slate-700 uppercase">{move.to}</p>
                              <p className="text-[9px] font-bold text-emerald-500 uppercase mt-1">Loja com necessidade</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <p className="text-sm font-black text-red-600">{move.receiverStock} est.</p>
                              <p className="text-[9px] font-bold text-slate-400">{move.receiverSales} vend.</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center justify-center min-w-12 rounded-xl bg-indigo-600 text-white px-3 py-2 text-sm font-black shadow-sm">
                                {move.qty}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-[11px] font-bold text-slate-500 leading-relaxed">{move.reason}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
                  <Truck size={26} />
                </div>
                <h3 className="text-sm font-black text-slate-700 uppercase">Nenhum remanejamento necessário</h3>
                <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
                  Com os filtros e período atuais, não encontrei uma combinação segura de loja com sobra e loja com necessidade.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ================= MÓDULO MALOTE ================= */}
        {moduleMode === 'malote' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">

              <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
                <div className="flex flex-col md:flex-row flex-1 gap-3 w-full">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Pesquisar modelo no malote..."
                      value={maloteSearch}
                      onChange={(e) => setMaloteSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <MultiSelectDropdown
                    options={uniqueCategories}
                    selected={maloteCategoryFilter}
                    onChange={setMaloteCategoryFilter}
                    placeholder="Todas as Categorias"
                  />
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setMaloteViewMode('table')}
                    className={`p-2 rounded-lg transition-all ${maloteViewMode === 'table' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}
                  >
                    <ListIcon size={18} />
                  </button>
                  <button
                    onClick={() => setMaloteViewMode('cards')}
                    className={`p-2 rounded-lg transition-all ${maloteViewMode === 'cards' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}
                  >
                    <LayoutGrid size={18} />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-end mb-6 border-b border-slate-50 pb-6">
                <div>
                  <h2 className="text-lg font-black uppercase text-slate-800">Abastecimento CD Taguatinga</h2>
                  <p className="text-xs text-slate-400">Saída Centralizada | Objetivo: 15 dias de cobertura | Base: {periodDays} dias selecionados</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Total a Despachar</p>
                  <p className="text-3xl font-black text-indigo-600">
                    {calculatedMalote
                      .filter(item => (maloteCategoryFilter.length === 0 || maloteCategoryFilter.includes(item.category)) && item.modelo.toLowerCase().includes(maloteSearch.toLowerCase()))
                      .reduce((acc, item) => acc + (item.lojas?.reduce((sum: number, l: any) => sum + (l.sugestaoEnvio || 0), 0) || 0), 0)} un
                  </p>
                </div>
              </div>

              {maloteViewMode === 'table' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Modelo</th>
                        <th className="px-4 py-3">Total Envio</th>
                        <th className="px-4 py-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {calculatedMalote
                        .filter(item => (maloteCategoryFilter.length === 0 || maloteCategoryFilter.includes(item.category)) && item.modelo.toLowerCase().includes(maloteSearch.toLowerCase()))
                        .map((item, idx) => {
                          const totalEnvio = item.lojas?.reduce((acc: number, l: any) => acc + (l.sugestaoEnvio || 0), 0) || 0;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase">
                                {item.modelo}
                                <div className="flex gap-2 mt-1">
                                  {item.lojas.slice(0, 3).map((l: any, i: number) => (
                                    <span key={i} className="text-[9px] bg-slate-100 text-slate-500 px-1 rounded">{l.loja}: {l.sugestaoEnvio}</span>
                                  ))}
                                  {item.lojas.length > 3 && <span className="text-[9px] text-slate-400">+{item.lojas.length - 3}</span>}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md text-[10px] font-black">
                                  {totalEnvio} un
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button className="text-slate-400 hover:text-indigo-600 transition-colors">
                                  <ChevronRight size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {calculatedMalote
                    .filter(item => (maloteCategoryFilter.length === 0 || maloteCategoryFilter.includes(item.category)) && item.modelo.toLowerCase().includes(maloteSearch.toLowerCase()))
                    .map((item, idx) => (
                      item.lojas?.filter((l: any) => l.sugestaoEnvio > 0).map((loja: any, lidx: number) => (
                        <div key={`${idx}-${lidx}`} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
                          <div className="absolute top-0 right-0 bg-indigo-50 text-indigo-600 text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter">
                            CD Taguatinga
                          </div>
                          <h4 className="text-xs font-black text-slate-800 uppercase mb-3 pr-20">{item.modelo}</h4>

                          <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <div className="text-center flex-1">
                              <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Origem</p>
                              <p className="text-[10px] font-black text-slate-700 uppercase">CD TAGUATINGA</p>
                            </div>

                            <div className="flex flex-col items-center px-4">
                              <span className="text-xs font-black text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full mb-1">
                                {loja.sugestaoEnvio} un
                              </span>
                              <ArrowRight size={14} className="text-indigo-300 animate-pulse" />
                            </div>

                            <div className="text-center flex-1">
                              <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Destino</p>
                              <p className="text-[10px] font-black text-green-600 uppercase">{loja.loja}</p>
                            </div>
                          </div>
                          <div className="mt-2 flex justify-between text-[9px] text-slate-400 font-bold uppercase">
                            <span>Vendas Período: {loja.vendaPeriodo}</span>
                            <span>Estoque Atual: {loja.estoqueAtual}</span>
                          </div>
                        </div>
                      ))
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        )}

        
        {/* ================= MÓDULO PREVISÃO DE RUPTURA ================= */}
        {moduleMode === 'predictive' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-gradient-to-r from-red-900 to-rose-900 p-6 rounded-2xl text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center relative overflow-hidden gap-4">
              <div className="relative z-10">
                <h2 className="text-xl font-black uppercase mb-1 flex items-center gap-2"><AlertCircle size={24} /> Radar de Ruptura (Stockout)</h2>
                <p className="text-xs text-red-100 opacity-90">
                  Projeção matemática baseada no ritmo de vendas dos últimos {periodDays} dias. Mostrando itens que vão zerar em até 15 dias.
                </p>
              </div>
              <div className="relative z-10 flex gap-4">
                <div className="bg-white/10 p-3 rounded-xl border border-white/10 text-center">
                  <p className="text-2xl font-black text-red-300">{predictiveStockout.filter(i => i.coverageDays === 0).length}</p>
                  <p className="text-[9px] uppercase font-bold text-white/70 tracking-widest mt-1">Já Zerados</p>
                </div>
                <div className="bg-white/10 p-3 rounded-xl border border-white/10 text-center">
                  <p className="text-2xl font-black text-amber-300">{predictiveStockout.filter(i => i.coverageDays > 0 && i.coverageDays <= 7).length}</p>
                  <p className="text-[9px] uppercase font-bold text-white/70 tracking-widest mt-1">Zeram na Semana</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 sticky top-0 shadow-sm">
                    <tr>
                      <th className="p-4">Prioridade</th>
                      <th className="p-4">Loja</th>
                      <th className="p-4 min-w-[250px]">Produto</th>
                      <th className="p-4 text-center">Estoque Atual</th>
                      <th className="p-4 text-center">Média/Dia</th>
                      <th className="p-4 text-center">Dias Restantes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {predictiveStockout.map((item, idx) => {
                      const isZero = item.coverageDays === 0;
                      const isCritical = item.coverageDays > 0 && item.coverageDays <= 7;
                      
                      return (
                        <tr key={idx} className="hover:bg-red-50/20 transition-colors">
                          <td className="p-4">
                            {isZero ? (
                              <span className="bg-red-50 text-red-600 border border-red-100 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider">Ruptura Ativa</span>
                            ) : isCritical ? (
                              <span className="bg-amber-50 text-amber-600 border border-amber-100 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider">Zera na Semana</span>
                            ) : (
                              <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider">Atenção</span>
                            )}
                          </td>
                          <td className="p-4 font-bold text-slate-700 text-xs uppercase">{item.store}</td>
                          <td className="p-4">
                            <p className="font-black text-slate-800 text-xs uppercase">{item.product}</p>
                            <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded uppercase mt-1 inline-block">{item.category}</span>
                          </td>
                          <td className="p-4 text-center font-black text-slate-700">{item.stock} un</td>
                          <td className="p-4 text-center font-bold text-slate-500">{item.dailySales.toFixed(1)}/dia</td>
                          <td className="p-4 text-center">
                            <span className={`text-xl font-black ${isZero ? 'text-red-600' : isCritical ? 'text-amber-500' : 'text-slate-600'}`}>
                              {isZero ? '-' : Math.ceil(item.coverageDays)}
                            </span>
                            {!isZero && <span className="text-[10px] text-slate-400 font-bold ml-1 uppercase">dias</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {predictiveStockout.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-slate-400 text-xs uppercase font-bold bg-slate-50/50">
                          Nenhum risco de ruptura encontrado nos próximos 15 dias.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= MÓDULO ESTOQUE ================= */}
        {moduleMode === 'stock' && (
          <>
            {!expandedStore && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                  <button
                    onClick={() => setStockViewFilter('TODOS')}
                    className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      stockViewFilter === 'TODOS' ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">Produtos Visíveis</span>
                      <Package size={16} className="text-slate-400" />
                    </div>
                    <div className="text-2xl font-black text-slate-800">{stockSummary.totalItems}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Clique para ver todos</div>
                  </button>

                  <button
                    onClick={() => setStockViewFilter('TODOS')}
                    className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      stockViewFilter === 'TODOS' ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">Peças em Estoque</span>
                      <Box size={16} className="text-indigo-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-800">
                      {stockSummary.totalStockQty.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Base atual filtrada</div>
                  </button>

                  <button
                    onClick={() => setStockViewFilter('COM_GIRO')}
                    className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      stockViewFilter === 'COM_GIRO' ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">Vendas no Período</span>
                      <TrendingUp size={16} className="text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-emerald-600">
                      {stockSummary.totalSalesQty.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Clique para ver com giro</div>
                  </button>

                  <button
                    onClick={() => setStockViewFilter('ESTOQUE_BAIXO')}
                    className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      stockViewFilter === 'ESTOQUE_BAIXO' ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">Estoque Baixo</span>
                      <AlertCircle size={16} className="text-red-500" />
                    </div>
                    <div className="text-2xl font-black text-red-600">{stockSummary.lowStockCount}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Clique para filtrar</div>
                  </button>

                  <button
                    onClick={() => setStockViewFilter('SEM_GIRO')}
                    className={`bg-white rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 ${
                      stockViewFilter === 'SEM_GIRO' ? 'border-amber-500 ring-2 ring-amber-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black uppercase text-slate-400">Sem Giro</span>
                      <Tag size={16} className="text-amber-500" />
                    </div>
                    <div className="text-2xl font-black text-amber-600">{stockSummary.noSalesCount}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">Clique para filtrar</div>
                  </button>
                </div>

                <div className="bg-gradient-to-r from-slate-900 to-indigo-900 rounded-2xl p-5 text-white shadow-lg flex flex-col md:flex-row justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Valor Total em Estoque</p>
                    <h3 className="text-3xl font-black mt-2">
                      R$ {stockSummary.totalStockValue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                    </h3>
                    <p className="text-[11px] text-white/70 mt-1">
                      Totais calculados com os filtros e pesquisa atuais
                    </p>
                  </div>

                  <div className="flex items-center">
                    <button
                      onClick={() => setShowInsightsPanel(prev => !prev)}
                      className="bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all"
                    >
                      <BarChart3 size={14} />
                      {showInsightsPanel ? 'Ocultar Insights' : 'Ver Insights'}
                      {showInsightsPanel ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {showInsightsPanel && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5 animate-fadeIn">
                    <div className="flex flex-col lg:flex-row justify-between gap-3 lg:items-center">
                      <div>
                        <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-2">
                          <Layers size={16} className="text-indigo-600" />
                          Insights de Giro
                        </h3>
                        <p className="text-[10px] font-bold uppercase text-slate-400 mt-1">
                          Ranking baseado no período, busca e filtros aplicados
                        </p>
                      </div>

                      <select
                        value={insightCategory}
                        onChange={e => setInsightCategory(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold uppercase px-4 py-2.5 rounded-xl outline-none cursor-pointer"
                      >
                        {topCategoriesOptions.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <h4 className="text-[11px] font-black uppercase text-slate-700 mb-3">Top Categorias</h4>
                        <div className="space-y-2">
                          {categorySalesRanking.slice(0, 5).map((item, idx) => (
                            <div key={item.category} className="flex justify-between items-center text-xs">
                              <span className="font-bold text-slate-700 uppercase">
                                {idx + 1}. {item.category}
                              </span>
                              <span className="font-black text-indigo-600">{item.sales}</span>
                            </div>
                          ))}
                          {categorySalesRanking.length === 0 && (
                            <p className="text-xs text-slate-400 font-bold uppercase">Sem dados</p>
                          )}
                        </div>
                      </div>

                      <div className="xl:col-span-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <h4 className="text-[11px] font-black uppercase text-slate-700 mb-3">
                          Top Produtos {insightCategory !== 'TODAS' ? `- ${insightCategory}` : ''}
                        </h4>

                        <div className="space-y-2">
                          {topProductsRanking.map((item, idx) => (
                            <div
                              key={`${item.category}-${item.product}-${idx}`}
                              className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white rounded-xl border border-slate-100 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-800 uppercase truncate">
                                  {idx + 1}. {item.product}
                                </p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                                  {item.category}
                                </p>
                              </div>

                              <div className="flex gap-4 text-right">
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase">Vendas</p>
                                  <p className="text-sm font-black text-emerald-600">{item.sales}</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase">Estoque</p>
                                  <p className="text-sm font-black text-indigo-600">{item.stock}</p>
                                </div>
                              </div>
                            </div>
                          ))}

                          {topProductsRanking.length === 0 && (
                            <p className="text-xs text-slate-400 font-bold uppercase">Nenhum produto encontrado</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!expandedStore && (
              <div className="flex flex-col md:flex-row gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[250px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="BUSCAR POR PRODUTO OU CÓDIGO..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-[10px] md:text-xs font-bold uppercase rounded-xl outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50/50 transition-all shadow-sm h-full"
                  />
                </div>
                <div className="flex gap-2 flex-wrap md:flex-nowrap pb-2 md:pb-0 z-10 w-full md:w-auto">
                  <MultiSelectDropdown
                    options={uniqueRegions}
                    selected={regionFilter}
                    onChange={setRegionFilter}
                    placeholder="Todas Regiões"
                  />
                  <MultiSelectDropdown
                    options={uniqueCategories}
                    selected={categoryFilter}
                    onChange={setCategoryFilter}
                    placeholder="Todas Categorias"
                  />
                  <MultiSelectDropdown
                    options={uniqueLines}
                    selected={lineFilter}
                    onChange={setLineFilter}
                    placeholder="Todas Linhas"
                  />
                  <MultiSelectDropdown
                    options={uniqueClusters}
                    selected={clusterFilter}
                    onChange={setClusterFilter}
                    placeholder="Todos Clusters"
                  />

                  <select 
                    value={stockViewFilter} 
                    onChange={e => setStockViewFilter(e.target.value as any)} 
                    className="bg-white border border-slate-200 text-slate-600 text-[10px] md:text-xs font-bold uppercase px-3 md:px-4 py-2 md:py-2.5 rounded-xl outline-none cursor-pointer hover:border-indigo-300 shadow-sm shrink-0"
                  >
                    <option value="TODOS">Todos (Giro)</option>
                    <option value="COM_GIRO">Com Giro</option>
                    <option value="SEM_GIRO">Sem Giro</option>
                    <option value="ESTOQUE_BAIXO">Estoque Baixo</option>
                  </select>

                  <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 h-full">
                    <button
                      onClick={() => setStoreViewMode('list')}
                      className={`p-2 rounded-lg transition-all ${storeViewMode === 'list' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}
                    >
                      <ListIcon size={16} />
                    </button>
                    <button
                      onClick={() => setStoreViewMode('grid')}
                      className={`p-2 rounded-lg transition-all ${storeViewMode === 'grid' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>

                  {(
                    regionFilter.length > 0 ||
                    categoryFilter.length > 0 ||
                    lineFilter.length > 0 ||
                    clusterFilter.length > 0 ||
                    filter !== '' ||
                    stockViewFilter !== 'TODOS'
                  ) && (
                    <button
                      onClick={() => {
                        setRegionFilter([]);
                        setCategoryFilter([]);
                        setLineFilter([]);
                        setClusterFilter([]);
                        setFilter('');
                        setStockViewFilter('TODOS');
                      }}
                      className="bg-red-50 border border-red-100 text-red-600 hover:bg-red-100 text-[10px] md:text-xs font-bold px-3 py-2 md:py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-1 shrink-0"
                    >
                      <X size={14} /> LIMPAR
                    </button>
                  )}
                </div>
              </div>
            )}

            {expandedStore ? (
              <div className="space-y-4 animate-fadeIn">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-900 to-indigo-900 p-5 text-white">
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="bg-white/10 border border-white/10 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">Detalhe da Loja</span>
                          <span className="bg-indigo-400/20 border border-indigo-300/20 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">{STORE_REGIONS[expandedStore] || 'OUTROS'}</span>
                          <span className="bg-purple-400/20 border border-purple-300/20 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">Cluster: {currentStoreProducts[0] ? getClusterValue(currentStoreProducts[0]) : 'SEM CLUSTER'}</span>
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight truncate">{expandedStore}</h2>
                        <p className="text-[11px] text-white/60 font-bold uppercase mt-1">Produtos, estoque, giro e valor financeiro no período selecionado.</p>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full xl:w-auto">
                        <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]"><p className="text-[9px] font-black uppercase text-white/50">Itens</p><p className="text-xl font-black">{storeDetailProducts.length}</p></div>
                        <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]"><p className="text-[9px] font-black uppercase text-white/50">Peças</p><p className="text-xl font-black">{storeDetailProducts.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0).toLocaleString('pt-BR')}</p></div>
                        <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]"><p className="text-[9px] font-black uppercase text-white/50">Vendas</p><p className="text-xl font-black text-emerald-300">{storeDetailProducts.reduce((acc, i) => acc + getProductSales(i.storeName, i.description), 0).toLocaleString('pt-BR')}</p></div>
                        <div className="bg-white/10 border border-white/10 rounded-2xl p-3 min-w-[120px]"><p className="text-[9px] font-black uppercase text-white/50">Custo</p><p className="text-xl font-black">R$ {storeDetailProducts.reduce((acc, i) => acc + ((Number(i.costPrice) || 0) * (Number(i.quantity) || 0)), 0).toLocaleString('pt-BR', { notation: "compact", maximumFractionDigits: 1 })}</p></div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 border-b border-slate-100 bg-slate-50/80">
                    <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="text"
                          placeholder="BUSCAR MODELO, CÓDIGO, CATEGORIA, LINHA OU CLUSTER..."
                          value={storeDetailSearch}
                          onChange={(e) => setStoreDetailSearch(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 text-slate-700 text-xs font-bold uppercase rounded-xl outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all"
                        />
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select value={storeDetailSort} onChange={e => setStoreDetailSort(e.target.value as any)} className="bg-white border border-slate-200 text-slate-600 text-xs font-black uppercase px-4 py-3 rounded-xl outline-none cursor-pointer">
                          <option value="ESTOQUE">Ordenar: Maior Estoque</option>
                          <option value="GIRO">Ordenar: Maior Giro</option>
                          <option value="VALOR">Ordenar: Maior Valor</option>
                          <option value="NOME">Ordenar: Nome</option>
                        </select>
                        <div className="flex bg-white border border-slate-200 p-1 rounded-xl shrink-0">
                          <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-indigo-600'}`} title="Lista"><ListIcon size={16} /></button>
                          <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-indigo-600'}`} title="Cards"><LayoutGrid size={16} /></button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {viewMode === 'list' ? (
                    <div className="overflow-auto max-h-[calc(100vh-360px)] min-h-[360px]">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
                          <tr className="text-[10px] font-black uppercase text-slate-400">
                            <th className="px-4 py-3 min-w-[340px]">Produto</th>
                            <th className="px-4 py-3 whitespace-nowrap">Linha / Cluster</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Estoque</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Vendas</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Custo Unit.</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Preço Venda</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">Custo Total</th>
                            <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {storeDetailProducts.map((item, idx) => {
                            const stockQty = Number(item.quantity) || 0;
                            const soldQty = getProductSales(item.storeName, item.description);
                            const totalCost = (Number(item.costPrice) || 0) * stockQty;
                            const isLowStock = stockQty > 0 && stockQty < 3;
                            const isNoStock = stockQty === 0;

                            return (
                              <tr key={`${item.productCode}-${item.description}-${idx}`} className="hover:bg-indigo-50/30 transition-colors">
                                <td className="px-4 py-3">
                                  <p className="text-xs font-black text-slate-800 uppercase leading-tight">{item.description}</p>
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{item.category || 'GERAL'}</span>
                                    {item.productCode && <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded uppercase border border-blue-100">{item.productCode}</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase border border-blue-100 w-fit">{getLineValue(item)}</span>
                                    <span className="text-[9px] font-black bg-purple-50 text-purple-700 px-2 py-1 rounded uppercase border border-purple-100 w-fit">{getClusterValue(item)}</span>
                                  </div>
                                </td>
                                <td className={`px-4 py-3 text-right text-base font-black ${isNoStock ? 'text-red-500' : isLowStock ? 'text-amber-600' : 'text-slate-800'}`}>{stockQty.toLocaleString('pt-BR')}</td>
                                <td className="px-4 py-3 text-right"><span className={`text-sm font-black ${soldQty > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{soldQty.toLocaleString('pt-BR')}</span></td>
                                <td className="px-4 py-3 text-right text-xs font-bold text-slate-600 whitespace-nowrap">R$ {Number(item.costPrice || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-xs font-black text-emerald-600 whitespace-nowrap">R$ {Number(item.salePrice || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-right text-xs font-black text-indigo-700 whitespace-nowrap">R$ {totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                <td className="px-4 py-3 text-center">
                                  {isNoStock ? <span className="inline-flex rounded-full bg-red-50 text-red-600 border border-red-100 px-2 py-1 text-[9px] font-black uppercase">Zerado</span> :
                                    isLowStock ? <span className="inline-flex rounded-full bg-amber-50 text-amber-600 border border-amber-100 px-2 py-1 text-[9px] font-black uppercase">Baixo</span> :
                                      soldQty > 0 ? <span className="inline-flex rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-1 text-[9px] font-black uppercase">Com Giro</span> :
                                        <span className="inline-flex rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 py-1 text-[9px] font-black uppercase">Sem Giro</span>}
                                </td>
                              </tr>
                            );
                          })}

                          {storeDetailProducts.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-4 py-16 text-center">
                                <p className="text-sm font-black text-slate-400 uppercase">Nenhum produto encontrado nesta loja.</p>
                                <p className="text-xs text-slate-400 mt-1">Ajuste a busca ou volte para a visão geral.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 overflow-auto max-h-[calc(100vh-360px)] min-h-[360px]">
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {storeDetailProducts.map((item, idx) => {
                          const stockQty = Number(item.quantity) || 0;
                          const soldQty = getProductSales(item.storeName, item.description);
                          const isLowStock = stockQty > 0 && stockQty < 3;
                          const isNoStock = stockQty === 0;
                          return (
                            <div key={`${item.productCode}-${item.description}-${idx}`} className={`bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all ${isNoStock ? 'border-red-200 bg-red-50/30' : isLowStock ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="text-xs font-black text-slate-800 uppercase line-clamp-2 leading-tight">{item.description}</h4>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{item.category || 'GERAL'}</span>
                                    <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded uppercase border border-blue-100">{getLineValue(item)}</span>
                                  </div>
                                </div>
                                <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 ${isNoStock ? 'bg-red-100 text-red-600' : isLowStock ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>
                                  <span className="text-lg font-black">{stockQty}</span>
                                  <span className="text-[8px] font-black uppercase">Est.</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 mt-4">
                                <div className="bg-slate-50 rounded-xl p-2"><p className="text-[8px] font-black text-slate-400 uppercase">Vendas</p><p className={`text-sm font-black ${soldQty > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{soldQty}</p></div>
                                <div className="bg-slate-50 rounded-xl p-2"><p className="text-[8px] font-black text-slate-400 uppercase">Custo</p><p className="text-xs font-black text-slate-700">R$ {Number(item.costPrice || 0).toLocaleString('pt-BR', { notation: "compact", maximumFractionDigits: 1 })}</p></div>
                                <div className="bg-slate-50 rounded-xl p-2"><p className="text-[8px] font-black text-slate-400 uppercase">Total</p><p className="text-xs font-black text-indigo-700">R$ {((Number(item.costPrice) || 0) * stockQty).toLocaleString('pt-BR', { notation: "compact", maximumFractionDigits: 1 })}</p></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-10 animate-fadeIn pb-10">
                {Object.entries(groupedStores).length > 0 ? Object.entries(groupedStores).map(([region, stores]) => (
                  <div key={region} className="space-y-4">
                    <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                      <MapPin className="text-indigo-600" size={20} />
                      <h2 className="text-lg font-black text-slate-700 uppercase tracking-wide">{region}</h2>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{stores.length} Lojas</span>
                      <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        {stores.reduce((acc, s) => acc + s.qty, 0).toLocaleString('pt-BR')} un
                      </span>
                    </div>

                    {storeViewMode === 'grid' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {stores.map((store) => {
                          const hasLowStockAlert = store.lowStockCount > 0 && filter !== '';
                          return (
                            <div
                              key={store.name}
                              onClick={() => setExpandedStore(store.name)}
                              className={`group bg-white p-5 rounded-2xl border shadow-sm cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg relative overflow-hidden ${hasLowStockAlert ? 'border-red-300 ring-4 ring-red-50' : 'border-slate-100 hover:border-indigo-200'}`}
                            >
                              {hasLowStockAlert && <div className="absolute top-3 right-3 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-lg"></div>}
                              <h3 className="text-sm font-black text-slate-800 uppercase leading-tight mb-2 truncate pr-4">{store.name}</h3>
                              <div className="mb-3">
                                <span className="text-[9px] font-bold bg-purple-50 text-purple-700 px-2 py-1 rounded uppercase border border-purple-100">
                                  {store.cluster || 'SEM CLUSTER'}
                                </span>
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">Estoque</span>
                                  <span className={`text-lg font-black ${store.qty === 0 ? 'text-slate-300' : (hasLowStockAlert ? 'text-red-600' : 'text-slate-700')}`}>{store.qty.toLocaleString('pt-BR')}</span>
                                </div>
                                <div className="flex justify-between items-end">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">Financeiro</span>
                                  <span className="text-sm font-bold text-indigo-600">R$ {store.value.toLocaleString('pt-BR', { notation: "compact", maximumFractionDigits: 1 })}</span>
                                </div>
                              </div>
                              <div className="absolute bottom-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0"><ChevronRight className="text-indigo-600" size={20} /></div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 border-b border-slate-200">
                            <tr>
                              <th className="p-4">Loja</th>
                              <th className="p-4">Cluster</th>
                              <th className="p-4 text-right">Estoque Geral</th>
                              <th className="p-4 text-right">Financeiro Geral</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {stores.map(store => {
                               const hasLowStockAlert = store.lowStockCount > 0 && filter !== '';
                               return (
                                 <tr
                                   key={store.name}
                                   onClick={() => setExpandedStore(store.name)}
                                   className={`hover:bg-slate-50 cursor-pointer transition-colors group ${hasLowStockAlert ? 'bg-red-50/20' : ''}`}
                                 >
                                   <td className="p-4 text-xs font-black text-slate-800 uppercase flex items-center gap-3">
                                     {hasLowStockAlert && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0"></div>}
                                     {store.name}
                                     <ChevronRight className="text-slate-300 group-hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all ml-2" size={16} />
                                   </td>
                                   <td className="p-4">
                                     <span className="text-[9px] font-bold bg-purple-50 text-purple-700 px-2 py-1 rounded uppercase border border-purple-100 whitespace-nowrap">
                                       {store.cluster || 'SEM CLUSTER'}
                                     </span>
                                   </td>
                                   <td className={`p-4 text-right text-sm font-black whitespace-nowrap ${store.qty === 0 ? 'text-slate-300' : (hasLowStockAlert ? 'text-red-600' : 'text-slate-700')}`}>
                                     {store.qty.toLocaleString('pt-BR')} un
                                   </td>
                                   <td className="p-4 text-right text-sm font-bold text-indigo-600 whitespace-nowrap">
                                     R$ {store.value.toLocaleString('pt-BR', { notation: "compact", maximumFractionDigits: 1 })}
                                   </td>
                                 </tr>
                               )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="col-span-full py-20 text-center">
                    <div className="inline-block p-4 bg-slate-100 rounded-full mb-4 text-slate-300"><Package size={40} /></div>
                    <p className="text-slate-400 font-bold uppercase text-sm">Nenhum estoque encontrado.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}