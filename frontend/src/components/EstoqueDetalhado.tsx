import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FilterX,
  Layers,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';

type StoreAgg = {
  loja: string;
  regiao: string;
  estoque: number;
  vendasMes: number;
  vendas60: number;
  vendas90: number;
  giroDiario: number;
  coberturaDias: number | null;
};

type ProductAgg = {
  modelo: string;
  referencia: string;
  categoria: string;
  estoque: number;
  vendasMes: number;
  vendas60: number;
  vendas90: number;
  giroDiario: number;
  coberturaDias: number | null;
  stores: StoreAgg[];
};

type ApiResponse = {
  success: boolean;
  generatedAt?: string;
  periodo?: {
    mesAtualInicio: string;
    ultimos60Inicio: string;
    ultimos90Inicio: string;
    hoje: string;
  };
  sources?: Record<string, string>;
  total?: number;
  products?: ProductAgg[];
  error?: string;
};

type SortKey = 'modelo' | 'vendasMes' | 'vendas60' | 'vendas90' | 'estoque' | 'giroDiario' | 'coberturaDias';
type SortDirection = 'asc' | 'desc';

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const normalizeSearch = (value: unknown) => normalizeText(value).replace(/[^A-Z0-9]/g, '');

const formatNumber = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0));

const formatDecimal = (value: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const formatDateBr = (dateStr?: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');

  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  return isLocal ? `http://${window.location.hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';
}

function getUserId() {
  try {
    const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
    if (!rawUser) return '';

    const parsed = JSON.parse(rawUser);
    return String(parsed.id || parsed.userId || parsed._id || '');
  } catch {
    return '';
  }
}

function getStatus(product: Pick<ProductAgg, 'coberturaDias'>) {
  if (product.coberturaDias === null) return 'SEM_GIRO';
  if (product.coberturaDias <= 30) return 'FALTAR';
  if (product.coberturaDias > 120) return 'EXCESSO';
  return 'SAUDAVEL';
}

function renderStatus(coberturaDias: number | null) {
  if (coberturaDias === null) {
    return (
      <div className="inline-flex flex-col items-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-2xs">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Sem Giro
        </span>
      </div>
    );
  }

  const dias = Math.round(coberturaDias);
  const progressPercent = Math.min(100, Math.max(5, (dias / 120) * 100));

  if (dias <= 15) {
    return (
      <div className="inline-flex flex-col items-center gap-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 shadow-2xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
          {dias}d • Crítico
        </span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-red-100">
          <div className="h-full bg-red-500" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    );
  }

  if (dias <= 30) {
    return (
      <div className="inline-flex flex-col items-center gap-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 shadow-2xs">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {dias}d • Atenção
        </span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-amber-100">
          <div className="h-full bg-amber-500" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    );
  }

  if (dias > 120) {
    return (
      <div className="inline-flex flex-col items-center gap-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 shadow-2xs">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
          {dias}d • Excesso
        </span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-purple-100">
          <div className="h-full bg-purple-500" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 shadow-2xs">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {dias} dias
      </span>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-emerald-100">
        <div className="h-full bg-emerald-500" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

export default function EstoqueDetalhado() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<ProductAgg[]>([]);
  const [periodo, setPeriodo] = useState<ApiResponse['periodo']>();

  // Filtros Principais
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState('TODOS');

  // Ordenação da Tabela Principal
  const [sortKey, setSortKey] = useState<SortKey>('estoque');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Produto Selecionado (Drill-down Loja a Loja)
  const [selectedProduct, setSelectedProduct] = useState<ProductAgg | null>(null);
  const [storeSearchDetail, setStoreSearchDetail] = useState('');

  const API_URL = useMemo(() => getApiUrl(), []);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const userId = getUserId();
      const url = `${API_URL}/api/estoque-visao-detalhada?userId=${encodeURIComponent(userId)}`;
      const response = await fetch(url);
      const json = (await response.json()) as ApiResponse;

      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Erro ao carregar visão detalhada de estoque.');
      }

      setProducts(Array.isArray(json.products) ? json.products : []);
      setPeriodo(json.periodo);
    } catch (err: any) {
      console.error('Erro ao carregar Visão Detalhada:', err);
      setError(err?.message || 'Erro ao carregar visão detalhada.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={12} className="text-slate-300 opacity-70 group-hover:opacity-100" />;
    return sortDir === 'asc' ? (
      <ArrowUp size={12} className="text-indigo-600" />
    ) : (
      <ArrowDown size={12} className="text-indigo-600" />
    );
  };

  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(products.map((item) => item.categoria || 'GERAL'))).sort();
  }, [products]);

  const uniqueRegions = useMemo(() => {
    const regions = new Set<string>();
    products.forEach((product) => product.stores.forEach((store) => regions.add(store.regiao || 'OUTROS')));
    return Array.from(regions).sort();
  }, [products]);

  const uniqueStores = useMemo(() => {
    const stores = new Set<string>();

    products.forEach((product) => {
      product.stores.forEach((store) => {
        if (regionFilter !== 'TODAS' && store.regiao !== regionFilter) return;
        stores.add(store.loja);
      });
    });

    return Array.from(stores).sort();
  }, [products, regionFilter]);

  // Base filtrada sem o filtro de Status (para calcular os contadores das abas com precisão)
  const baseFilteredData = useMemo(() => {
    const searchKey = normalizeSearch(search);

    return products
      .map((product) => {
        const stores = product.stores.filter((store) => {
          if (regionFilter !== 'TODAS' && store.regiao !== regionFilter) return false;
          if (storeFilter !== 'TODAS' && store.loja !== storeFilter) return false;
          return true;
        });

        const estoque = stores.reduce((sum, store) => sum + Number(store.estoque || 0), 0);
        const vendasMes = stores.reduce((sum, store) => sum + Number(store.vendasMes || 0), 0);
        const vendas60 = stores.reduce((sum, store) => sum + Number(store.vendas60 || 0), 0);
        const vendas90 = stores.reduce((sum, store) => sum + Number(store.vendas90 || 0), 0);
        const giroDiario = vendas90 > 0 ? vendas90 / 90 : 0;
        const coberturaDias = giroDiario > 0 ? estoque / giroDiario : null;

        return {
          ...product,
          estoque,
          vendasMes,
          vendas60,
          vendas90,
          giroDiario,
          coberturaDias,
          stores,
        };
      })
      .filter((product) => {
        if (categoryFilter !== 'TODAS' && product.categoria !== categoryFilter) return false;
        if (searchKey) {
          const haystack = normalizeSearch(`${product.modelo} ${product.referencia} ${product.categoria}`);
          if (!haystack.includes(searchKey)) return false;
        }
        if (regionFilter !== 'TODAS' || storeFilter !== 'TODAS') {
          if (product.stores.length === 0) return false;
        }
        return true;
      });
  }, [products, search, regionFilter, storeFilter, categoryFilter]);

  // Contadores de Status
  const statusCounts = useMemo(() => {
    const counts = { TODOS: baseFilteredData.length, FALTAR: 0, SAUDAVEL: 0, EXCESSO: 0, SEM_GIRO: 0 };
    baseFilteredData.forEach((item) => {
      const st = getStatus(item) as keyof typeof counts;
      if (counts[st] !== undefined) counts[st]++;
    });
    return counts;
  }, [baseFilteredData]);

  // Lista final com filtro de Status e Ordenação escolhida pelo usuário
  const filteredData = useMemo(() => {
    return baseFilteredData
      .filter((product) => {
        if (statusFilter !== 'TODOS' && getStatus(product) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortKey];
        let valB: any = b[sortKey];

        if (sortKey === 'modelo') {
          return sortDir === 'asc'
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        }

        if (sortKey === 'coberturaDias') {
          valA = valA === null ? 999999 : valA;
          valB = valB === null ? 999999 : valB;
        }

        if (valA !== valB) {
          return sortDir === 'asc' ? valA - valB : valB - valA;
        }

        return b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.modelo.localeCompare(b.modelo);
      });
  }, [baseFilteredData, statusFilter, sortKey, sortDir]);

  // KPIs Executivos da Visão Atual
  const kpiMetrics = useMemo(() => {
    let totalEstoque = 0;
    let totalVendasMes = 0;
    let totalVendas90 = 0;
    let criticos = 0;
    let semGiroOuExcesso = 0;

    filteredData.forEach((item) => {
      totalEstoque += item.estoque;
      totalVendasMes += item.vendasMes;
      totalVendas90 += item.vendas90;
      const st = getStatus(item);
      if (st === 'FALTAR') criticos++;
      if (st === 'SEM_GIRO' || st === 'EXCESSO') semGiroOuExcesso++;
    });

    return {
      totalSkus: filteredData.length,
      totalEstoque,
      totalVendasMes,
      totalVendas90,
      criticos,
      semGiroOuExcesso,
    };
  }, [filteredData]);

  const selectedProductDetails = useMemo(() => {
    if (!selectedProduct) return [];

    const current = filteredData.find(
      (product) =>
        normalizeSearch(product.referencia || product.modelo) ===
        normalizeSearch(selectedProduct.referencia || selectedProduct.modelo)
    );

    const storeSearchKey = normalizeSearch(storeSearchDetail);

    return (current?.stores || selectedProduct.stores || [])
      .filter((store) => {
        if (!storeSearchKey) return true;
        return normalizeSearch(`${store.loja} ${store.regiao}`).includes(storeSearchKey);
      })
      .map((store) => ({
        ...store,
        giroDiario: store.vendas90 > 0 ? store.vendas90 / 90 : 0,
        coberturaDias: store.vendas90 > 0 ? store.estoque / (store.vendas90 / 90) : null,
      }))
      .sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.loja.localeCompare(b.loja));
  }, [selectedProduct, filteredData, storeSearchDetail]);

  const hasActiveFilters =
    search !== '' ||
    regionFilter !== 'TODAS' ||
    storeFilter !== 'TODAS' ||
    categoryFilter !== 'TODAS' ||
    statusFilter !== 'TODOS';

  const clearFilters = () => {
    setSearch('');
    setRegionFilter('TODAS');
    setStoreFilter('TODAS');
    setCategoryFilter('TODAS');
    setStatusFilter('TODOS');
  };

  const exportToExcel = () => {
    const resumo = filteredData.map((item) => ({
      Produto: item.modelo,
      Referência: item.referencia,
      Categoria: item.categoria,
      'Estoque Atual': item.estoque,
      'Vendas Mês Atual': item.vendasMes,
      'Vendas Últimos 60 Dias': item.vendas60,
      'Vendas Últimos 90 Dias': item.vendas90,
      'Giro Diário': Number(item.giroDiario.toFixed(4)),
      'Cobertura em Dias': item.coberturaDias === null ? 'Sem Giro' : Math.round(item.coberturaDias),
      Status: getStatus(item),
    }));

    const lojas = filteredData.flatMap((product) =>
      product.stores.map((store) => ({
        Produto: product.modelo,
        Referência: product.referencia,
        Categoria: product.categoria,
        Loja: store.loja,
        Região: store.regiao,
        Estoque: store.estoque,
        'Vendas Mês Atual': store.vendasMes,
        'Vendas Últimos 60 Dias': store.vendas60,
        'Vendas Últimos 90 Dias': store.vendas90,
        'Giro Diário': Number((store.vendas90 / 90).toFixed(4)),
        'Cobertura em Dias': store.vendas90 > 0 ? Math.round(store.estoque / (store.vendas90 / 90)) : 'Sem Giro',
      }))
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lojas), 'Lojas por Produto');
    XLSX.writeFile(wb, 'Estoque_Visao_Detalhada.xlsx');
  };

  // ============================================================================
  // VISÃO DE DETALHES DO PRODUTO (DRILL-DOWN LOJA A LOJA)
  // ============================================================================
  if (selectedProduct) {
    const totalEstoqueSku = selectedProductDetails.reduce((acc, s) => acc + s.estoque, 0);
    const totalVendas90Sku = selectedProductDetails.reduce((acc, s) => acc + s.vendas90, 0);
    const lojasComEstoque = selectedProductDetails.filter((s) => s.estoque > 0).length;
    const lojasZeradas = selectedProductDetails.filter((s) => s.estoque === 0).length;

    return (
      <div className="min-h-screen flex-1 overflow-y-auto bg-[#F8FAFC] p-4 font-sans md:p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          {/* Top Bar / Breadcrumb Header */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs lg:flex-row lg:items-center">
            <div className="flex items-start gap-4">
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setStoreSearchDetail('');
                }}
                className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                title="Voltar para visão geral"
              >
                <ChevronLeft size={22} className="transition-transform group-hover:-translate-x-0.5" />
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">
                    <Store size={11} /> Análise Loja a Loja
                  </span>
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                    {selectedProduct.categoria || 'GERAL'}
                  </span>
                  {selectedProduct.referencia && (
                    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                      REF: {selectedProduct.referencia}
                    </span>
                  )}
                </div>
                <h1 className="mt-1.5 text-xl font-black tracking-tight text-slate-900 md:text-2xl">
                  {selectedProduct.modelo}
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px]">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={storeSearchDetail}
                  onChange={(e) => setStoreSearchDetail(e.target.value)}
                  placeholder="Filtrar loja ou região..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-3 focus:ring-indigo-500/10"
                />
              </div>
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setStoreSearchDetail('');
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Voltar à Lista
              </button>
            </div>
          </div>

          {/* Mini KPIs do Produto Selecionado */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Estoque Total do SKU</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{formatNumber(totalEstoqueSku)} un.</p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Distribuído em <strong className="text-slate-700">{lojasComEstoque}</strong> lojas
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Saída Acumulada (90D)</p>
              <p className="mt-2 text-2xl font-black text-indigo-600">{formatNumber(totalVendas90Sku)} un.</p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Giro médio de <strong className="text-slate-700">{formatDecimal(totalVendas90Sku / 90)}</strong> un/dia
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lojas em Ruptura (Zero)</p>
              <p className={`mt-2 text-2xl font-black ${lojasZeradas > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {lojasZeradas} {lojasZeradas === 1 ? 'loja' : 'lojas'}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                De um total de {selectedProductDetails.length} unidades listadas
              </p>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cobertura Consolidada</p>
              <div className="my-auto pt-2">
                {renderStatus(totalVendas90Sku > 0 ? totalEstoqueSku / (totalVendas90Sku / 90) : null)}
              </div>
            </div>
          </div>

          {/* Tabela Loja a Loja */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Desempenho por Filial ({selectedProductDetails.length})
              </h2>
            </div>

            <div className="max-h-[620px] overflow-x-auto">
              <table className="w-full min-w-[950px] border-collapse text-left">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs">
                  <tr>
                    <th className="py-3.5 pl-6 pr-4 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      Filial / Região
                    </th>
                    <th className="border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      Vendas <span className="block text-[10px] text-indigo-600">Mês Atual</span>
                    </th>
                    <th className="border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      Vendas <span className="block text-[10px] text-sky-600">Últimos 60D</span>
                    </th>
                    <th className="border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      Vendas <span className="block text-[10px] text-blue-600">Últimos 90D</span>
                    </th>
                    <th className="border-l border-slate-200/60 bg-slate-100/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                      Estoque <span className="block text-[10px] text-slate-500">Físico Atual</span>
                    </th>
                    <th className="border-l border-slate-200/60 bg-indigo-50/30 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                      Giro Médio <span className="block text-[10px] text-indigo-600">Peças / Dia</span>
                    </th>
                    <th className="border-l border-slate-200/60 bg-indigo-50/30 py-3.5 pl-4 pr-6 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                      Cobertura <span className="block text-[10px] text-indigo-600">Previsão</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {selectedProductDetails.map((item) => (
                    <tr key={item.loja} className="transition-colors hover:bg-slate-50/80">
                      <td className="py-3.5 pl-6 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <Store size={15} />
                          </div>
                          <div>
                            <p className="text-xs font-extrabold uppercase text-slate-900">{item.loja}</p>
                            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-400">
                              <MapPin size={10} /> {item.regiao}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-indigo-600">
                        {formatNumber(item.vendasMes)}
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-sky-600">
                        {formatNumber(item.vendas60)}
                      </td>
                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-blue-600">
                        {formatNumber(item.vendas90)}
                      </td>
                      <td className="border-l border-slate-100 bg-slate-50/40 px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex min-w-[48px] items-center justify-center rounded-lg px-2.5 py-1 text-xs font-black ${
                            item.estoque === 0
                              ? 'border border-red-200 bg-red-50 text-red-600'
                              : 'border border-slate-200/80 bg-white text-slate-900 shadow-2xs'
                          }`}
                        >
                          {formatNumber(item.estoque)}
                        </span>
                      </td>
                      <td className="border-l border-slate-100 bg-indigo-50/10 px-4 py-3.5 text-center font-mono text-xs font-semibold text-slate-600">
                        {item.giroDiario > 0 ? `${formatDecimal(item.giroDiario)} /dia` : '—'}
                      </td>
                      <td className="border-l border-slate-100 bg-indigo-50/10 py-3.5 pl-4 pr-6 text-center">
                        {renderStatus(item.coberturaDias)}
                      </td>
                    </tr>
                  ))}

                  {selectedProductDetails.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center">
                        <Store size={32} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-sm font-bold text-slate-600">Nenhuma filial encontrada</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Tente ajustar o termo de busca ou os filtros selecionados.
                        </p>
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

  // ============================================================================
  // VISÃO PRINCIPAL (DASHBOARD DE PREVISÃO DE ESTOQUE)
  // ============================================================================
  return (
    <div className="min-h-screen flex-1 overflow-y-auto bg-[#F8FAFC] p-4 font-sans md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* HEADER EXECUTIVO */}
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
              <Package size={24} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">
                  Inteligência & Previsão de Estoque
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">
                  <Sparkles size={11} /> Supply Chain
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <TrendingUp size={14} className="text-indigo-500" />
                Análise de cobertura e giro diário real por SKU e filial
              </p>

              {periodo && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                    <Calendar size={11} className="text-indigo-500" />
                    Mês Atual: <strong className="text-slate-800">{formatDateBr(periodo.mesAtualInicio)}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                    <Clock size={11} className="text-sky-500" />
                    60 Dias: <strong className="text-slate-800">{formatDateBr(periodo.ultimos60Inicio)}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                    <Clock size={11} className="text-blue-500" />
                    90 Dias: <strong className="text-slate-800">{formatDateBr(periodo.ultimos90Inicio)}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : 'text-slate-500'} />
              {loading ? 'Sincronizando...' : 'Atualizar Dados'}
            </button>
            <button
              onClick={exportToExcel}
              disabled={loading || filteredData.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm shadow-emerald-600/20 transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50"
            >
              <Download size={14} />
              Exportar Planilha
            </button>
          </div>
        </div>

        {/* CARDS EXECUTIVOS (KPIs) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Estoque Físico Total</p>
              <p className="mt-1.5 text-2xl font-black tracking-tight text-slate-900">
                {formatNumber(kpiMetrics.totalEstoque)}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Em <strong className="text-slate-700">{formatNumber(kpiMetrics.totalSkus)}</strong> modelos listados
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Box size={22} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vendas Acumuladas (90D)</p>
              <p className="mt-1.5 text-2xl font-black tracking-tight text-indigo-600">
                {formatNumber(kpiMetrics.totalVendas90)}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Mês atual: <strong className="text-indigo-600">{formatNumber(kpiMetrics.totalVendasMes)}</strong> un.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingBag size={22} />
            </div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'FALTAR' ? 'TODOS' : 'FALTAR')}
            className={`cursor-pointer flex items-center justify-between rounded-2xl border p-5 transition-all ${
              statusFilter === 'FALTAR'
                ? 'border-red-300 bg-red-50/40 ring-2 ring-red-500/10'
                : 'border-slate-200/80 bg-white hover:border-red-200'
            } shadow-2xs`}
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-red-600/80">Risco de Ruptura (≤30d)</p>
              <p className="mt-1.5 text-2xl font-black tracking-tight text-red-600">
                {formatNumber(statusCounts.FALTAR)} <span className="text-sm font-bold">SKUs</span>
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">Requer atenção de reposição</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertTriangle size={22} />
            </div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'SAUDAVEL' ? 'TODOS' : 'SAUDAVEL')}
            className={`cursor-pointer flex items-center justify-between rounded-2xl border p-5 transition-all ${
              statusFilter === 'SAUDAVEL'
                ? 'border-emerald-300 bg-emerald-50/40 ring-2 ring-emerald-500/10'
                : 'border-slate-200/80 bg-white hover:border-emerald-200'
            } shadow-2xs`}
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600/80">
                Cobertura Saudável (31-120d)
              </p>
              <p className="mt-1.5 text-2xl font-black tracking-tight text-emerald-600">
                {formatNumber(statusCounts.SAUDAVEL)} <span className="text-sm font-bold">SKUs</span>
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Sem giro/Excesso: <strong className="text-slate-700">{statusCounts.SEM_GIRO + statusCounts.EXCESSO}</strong>
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={22} />
            </div>
          </div>
        </div>

        {/* BARRA DE FILTROS E SEGMENTAÇÃO */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            {/* Busca Textual */}
            <div className="relative md:col-span-4">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar modelo, referência ou categoria..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-3 text-xs font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-3 focus:ring-indigo-500/10"
              />
            </div>

            {/* Filtro de Região */}
            <div className="relative md:col-span-2">
              <MapPin size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  setStoreFilter('TODAS');
                }}
                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-7 text-xs font-bold text-slate-700 outline-none transition-all hover:bg-slate-100/70 focus:border-indigo-500 focus:bg-white"
              >
                <option value="TODAS">Região: Todas</option>
                {uniqueRegions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro de Loja */}
            <div className="relative md:col-span-3">
              <Store size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-7 text-xs font-bold text-slate-700 outline-none transition-all hover:bg-slate-100/70 focus:border-indigo-500 focus:bg-white"
              >
                <option value="TODAS">Filial: Todas ({uniqueStores.length})</option>
                {uniqueStores.map((store) => (
                  <option key={store} value={store}>
                    {store}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro de Categoria */}
            <div className="relative md:col-span-3">
              <Layers size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-7 text-xs font-bold text-slate-700 outline-none transition-all hover:bg-slate-100/70 focus:border-indigo-500 focus:bg-white"
              >
                <option value="TODAS">Categoria: Todas</option>
                {uniqueCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Status Pills + Botão Limpar Filtros */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'TODOS', label: 'Todos os Itens', count: statusCounts.TODOS, activeClass: 'bg-slate-900 text-white border-slate-900' },
                { id: 'FALTAR', label: 'Crítico / Vai Faltar', count: statusCounts.FALTAR, activeClass: 'bg-red-600 text-white border-red-600' },
                { id: 'SAUDAVEL', label: 'Saudável', count: statusCounts.SAUDAVEL, activeClass: 'bg-emerald-600 text-white border-emerald-600' },
                { id: 'EXCESSO', label: 'Excesso (>120d)', count: statusCounts.EXCESSO, activeClass: 'bg-purple-600 text-white border-purple-600' },
                { id: 'SEM_GIRO', label: 'Sem Giro', count: statusCounts.SEM_GIRO, activeClass: 'bg-slate-600 text-white border-slate-600' },
              ].map((tab) => {
                const isActive = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                      isActive
                        ? `${tab.activeClass} shadow-xs`
                        : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-700'
                      }`}
                    >
                      {formatNumber(tab.count)}
                    </span>
                  </button>
                );
              })}
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-100/70"
              >
                <FilterX size={14} />
                Limpar Filtros
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
              <AlertTriangle size={16} className="shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* TABELA PRINCIPAL DE PRODUTOS */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-6 py-3.5 bg-slate-50/40">
            <span className="text-xs font-bold text-slate-500">
              Exibindo <strong className="text-slate-800">{formatNumber(filteredData.length)}</strong> modelos • Clique
              em qualquer linha para abrir o detalhamento por filial
            </span>
          </div>

          <div className="max-h-[680px] overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs">
                <tr>
                  <th
                    onClick={() => handleSort('modelo')}
                    className="group cursor-pointer select-none py-3.5 pl-6 pr-4 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100/80"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Produto / Especificação</span>
                      {renderSortIcon('modelo')}
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('vendasMes')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100/80"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Vendas</span>
                      {renderSortIcon('vendasMes')}
                    </div>
                    <span className="block text-[10px] text-indigo-600">Mês Atual</span>
                  </th>

                  <th
                    onClick={() => handleSort('vendas60')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100/80"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Vendas</span>
                      {renderSortIcon('vendas60')}
                    </div>
                    <span className="block text-[10px] text-sky-600">Últimos 60D</span>
                  </th>

                  <th
                    onClick={() => handleSort('vendas90')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100/80"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Vendas</span>
                      {renderSortIcon('vendas90')}
                    </div>
                    <span className="block text-[10px] text-blue-600">Últimos 90D</span>
                  </th>

                  <th
                    onClick={() => handleSort('estoque')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 bg-slate-100/60 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-700 transition-colors hover:bg-slate-200/50"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Estoque</span>
                      {renderSortIcon('estoque')}
                    </div>
                    <span className="block text-[10px] text-slate-500">Físico Atual</span>
                  </th>

                  <th
                    onClick={() => handleSort('giroDiario')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 bg-indigo-50/30 px-4 py-3.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-600 transition-colors hover:bg-indigo-50/60"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Giro Médio</span>
                      {renderSortIcon('giroDiario')}
                    </div>
                    <span className="block text-[10px] text-indigo-600">Peças / Dia</span>
                  </th>

                  <th
                    onClick={() => handleSort('coberturaDias')}
                    className="group cursor-pointer select-none border-l border-slate-200/60 bg-indigo-50/30 py-3.5 pl-4 pr-6 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-600 transition-colors hover:bg-indigo-50/60"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Previsão</span>
                      {renderSortIcon('coberturaDias')}
                    </div>
                    <span className="block text-[10px] text-indigo-600">Cobertura</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {/* Skeleton Loader durante o carregamento */}
                {loading &&
                  Array.from({ length: 8 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="py-4 pl-6 pr-4">
                        <div className="h-4 w-64 rounded bg-slate-200" />
                        <div className="mt-2 flex gap-2">
                          <div className="h-3.5 w-16 rounded bg-slate-100" />
                          <div className="h-3.5 w-20 rounded bg-slate-100" />
                        </div>
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center">
                        <div className="mx-auto h-4 w-10 rounded bg-slate-100" />
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center">
                        <div className="mx-auto h-4 w-10 rounded bg-slate-100" />
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center">
                        <div className="mx-auto h-4 w-10 rounded bg-slate-100" />
                      </td>
                      <td className="border-l border-slate-100 bg-slate-50/50 p-4 text-center">
                        <div className="mx-auto h-6 w-14 rounded-lg bg-slate-200" />
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center">
                        <div className="mx-auto h-4 w-16 rounded bg-slate-100" />
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center">
                        <div className="mx-auto h-6 w-20 rounded-full bg-slate-200" />
                      </td>
                    </tr>
                  ))}

                {/* Estado Vazio */}
                {!loading && filteredData.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-16 text-center">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <Package size={24} />
                      </div>
                      <p className="text-sm font-bold text-slate-700">Nenhum produto encontrado</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Não há itens correspondentes aos filtros aplicados no momento.
                      </p>
                      {hasActiveFilters && (
                        <button
                          onClick={clearFilters}
                          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-100"
                        >
                          <FilterX size={14} /> Resetar filtros
                        </button>
                      )}
                    </td>
                  </tr>
                )}

                {/* Linhas de Produtos */}
                {!loading &&
                  filteredData.map((item) => (
                    <tr
                      key={`${item.referencia || item.modelo}`}
                      onClick={() => setSelectedProduct(item)}
                      className="group cursor-pointer transition-colors hover:bg-indigo-50/40"
                    >
                      <td className="py-3.5 pl-6 pr-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-extrabold uppercase text-slate-900 transition-colors group-hover:text-indigo-600">
                              {item.modelo}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                                {item.categoria || 'GERAL'}
                              </span>
                              {item.referencia && (
                                <span className="inline-flex items-center rounded-md border border-indigo-100 bg-indigo-50/70 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-indigo-600">
                                  {item.referencia}
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
                                • {item.stores.length} {item.stores.length === 1 ? 'filial' : 'filiais'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight
                            size={16}
                            className="shrink-0 text-slate-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-indigo-500 group-hover:opacity-100"
                          />
                        </div>
                      </td>

                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-indigo-600">
                        {formatNumber(item.vendasMes)}
                      </td>

                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-sky-600">
                        {formatNumber(item.vendas60)}
                      </td>

                      <td className="border-l border-slate-100 px-4 py-3.5 text-center font-bold text-blue-600">
                        {formatNumber(item.vendas90)}
                      </td>

                      <td className="border-l border-slate-100 bg-slate-50/50 px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex min-w-[54px] items-center justify-center rounded-lg px-2.5 py-1 text-xs font-black ${
                            item.estoque === 0
                              ? 'border border-red-200 bg-red-50 text-red-600'
                              : 'border border-slate-200/80 bg-white text-slate-900 shadow-2xs'
                          }`}
                        >
                          {formatNumber(item.estoque)}
                        </span>
                      </td>

                      <td className="border-l border-slate-100 bg-indigo-50/10 px-4 py-3.5 text-center font-mono text-xs font-semibold text-slate-600">
                        {item.giroDiario > 0 ? `${formatDecimal(item.giroDiario)} /dia` : '—'}
                      </td>

                      <td className="border-l border-slate-100 bg-indigo-50/10 py-3.5 pl-4 pr-6 text-center">
                        {renderStatus(item.coberturaDias)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}