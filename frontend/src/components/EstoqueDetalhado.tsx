import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Download,
  Layers,
  MapPin,
  Package,
  RefreshCw,
  Search,
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
      <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
        Sem Giro
      </span>
    );
  }

  const dias = Math.round(coberturaDias);

  if (dias <= 15) {
    return (
      <span className="rounded-md border border-red-200 bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">
        {dias} dias (Crítico)
      </span>
    );
  }

  if (dias <= 30) {
    return (
      <span className="rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">
        {dias} dias (Atenção)
      </span>
    );
  }

  if (dias > 120) {
    return (
      <span className="rounded-md border border-purple-200 bg-purple-100 px-2 py-1 text-[10px] font-black text-purple-700">
        {dias} dias (Excesso)
      </span>
    );
  }

  return (
    <span className="rounded-md border border-emerald-200 bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">
      {dias} dias
    </span>
  );
}

export default function EstoqueDetalhado() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<ProductAgg[]>([]);
  const [periodo, setPeriodo] = useState<ApiResponse['periodo']>();

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [selectedProduct, setSelectedProduct] = useState<ProductAgg | null>(null);

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

  const filteredData = useMemo(() => {
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
        if (statusFilter !== 'TODOS' && getStatus(product) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.modelo.localeCompare(b.modelo));
  }, [products, search, regionFilter, storeFilter, categoryFilter, statusFilter]);

  const selectedProductDetails = useMemo(() => {
    if (!selectedProduct) return [];

    const current = filteredData.find(
      (product) => normalizeSearch(product.referencia || product.modelo) === normalizeSearch(selectedProduct.referencia || selectedProduct.modelo)
    );

    return (current?.stores || selectedProduct.stores || [])
      .map((store) => ({
        ...store,
        giroDiario: store.vendas90 > 0 ? store.vendas90 / 90 : 0,
        coberturaDias: store.vendas90 > 0 ? store.estoque / (store.vendas90 / 90) : null,
      }))
      .sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.loja.localeCompare(b.loja));
  }, [selectedProduct, filteredData]);

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

  if (selectedProduct) {
    return (
      <div className="min-h-screen flex-1 overflow-y-auto bg-[#F0F2F5] p-6 font-sans md:p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedProduct(null)}
                className="rounded-xl bg-slate-100 p-3 text-slate-600 transition-colors hover:bg-slate-200"
              >
                <ChevronLeft size={24} />
              </button>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-600">
                  <Store size={12} /> Análise loja a loja
                </p>
                <h1 className="text-xl font-black uppercase tracking-tight text-slate-800 md:text-2xl">
                  {selectedProduct.modelo}
                </h1>
                {selectedProduct.referencia ? (
                  <p className="mt-1 text-xs font-bold uppercase text-slate-400">Referência: {selectedProduct.referencia}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[650px] overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-left">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="p-4 text-[10px] font-black uppercase text-slate-500">Loja / Região</th>
                    <th className="border-l border-slate-200 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Vendas <br /> <span className="text-indigo-500">Mês Atual</span>
                    </th>
                    <th className="border-l border-slate-100 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Vendas <br /> <span className="text-sky-500">Últimos 60D</span>
                    </th>
                    <th className="border-l border-slate-100 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Vendas <br /> <span className="text-blue-500">Últimos 90D</span>
                    </th>
                    <th className="border-l border-slate-200 bg-slate-100/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Estoque <br /> <span className="text-slate-800">Físico Atual</span>
                    </th>
                    <th className="border-l border-slate-200 bg-indigo-50/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Giro Médio <br /> <span className="text-indigo-600">Peças/Dia</span>
                    </th>
                    <th className="border-l border-slate-200 bg-indigo-50/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                      Cobertura <br /> <span className="text-indigo-600">Previsão</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {selectedProductDetails.map((item) => (
                    <tr key={item.loja} className="transition-colors hover:bg-slate-50">
                      <td className="p-4">
                        <p className="text-xs font-black uppercase text-slate-800">{item.loja}</p>
                        <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                          {item.regiao}
                        </span>
                      </td>
                      <td className="border-l border-slate-100 p-4 text-center font-black text-indigo-600">{formatNumber(item.vendasMes)}</td>
                      <td className="border-l border-slate-50 p-4 text-center font-black text-sky-600">{formatNumber(item.vendas60)}</td>
                      <td className="border-l border-slate-50 p-4 text-center font-black text-blue-600">{formatNumber(item.vendas90)}</td>
                      <td className="border-l border-slate-100 bg-slate-50/50 p-4 text-center">
                        <span className={`rounded-lg px-3 py-1 text-sm font-black ${item.estoque === 0 ? 'text-red-500' : 'text-slate-800'}`}>
                          {formatNumber(item.estoque)}
                        </span>
                      </td>
                      <td className="border-l border-slate-100 bg-indigo-50/10 p-4 text-center font-mono text-xs font-bold text-slate-600">
                        {item.giroDiario > 0 ? `${formatDecimal(item.giroDiario)} un/dia` : '-'}
                      </td>
                      <td className="border-l border-slate-100 bg-indigo-50/10 p-4 text-center">{renderStatus(item.coberturaDias)}</td>
                    </tr>
                  ))}

                  {selectedProductDetails.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-sm font-bold text-slate-400">
                        Nenhuma loja encontrada para os filtros atuais.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex-1 overflow-y-auto bg-[#F0F2F5] p-6 font-sans md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-indigo-600 p-3 text-white shadow-md">
                <Package size={24} />
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-tight text-slate-800 md:text-2xl">
                  Visão Detalhada de Estoque
                </h1>
                <p className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <TrendingUp size={12} /> Cobertura baseada em venda real por modelo
                </p>
                {periodo ? (
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Mês atual desde {periodo.mesAtualInicio} • 60D desde {periodo.ultimos60Inicio} • 90D desde {periodo.ultimos90Inicio}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold uppercase text-slate-700 transition-all hover:bg-slate-200 disabled:opacity-60"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
              </button>
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold uppercase text-white shadow-md transition-all hover:bg-emerald-700"
              >
                <Download size={14} /> Exportar
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-5">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo, referência..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs font-bold outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  setStoreFilter('TODAS');
                }}
                className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs font-black uppercase text-slate-700 outline-none focus:border-indigo-400"
              >
                <option value="TODAS">Região: Todas</option>
                {uniqueRegions.map((region) => (
                  <option key={region} value={region}>Região: {region}</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Store size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs font-black uppercase text-slate-700 outline-none focus:border-indigo-400"
              >
                <option value="TODAS">Loja: Todas</option>
                {uniqueStores.map((store) => (
                  <option key={store} value={store}>Loja: {store}</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Layers size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs font-black uppercase text-slate-700 outline-none focus:border-indigo-400"
              >
                <option value="TODAS">Categoria: Todas</option>
                {uniqueCategories.map((category) => (
                  <option key={category} value={category}>Categoria: {category}</option>
                ))}
              </select>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black uppercase text-indigo-700 outline-none focus:border-indigo-400"
            >
              <option value="TODOS">Status: Todos</option>
              <option value="FALTAR">Vai faltar / crítico</option>
              <option value="EXCESSO">Excesso</option>
              <option value="SEM_GIRO">Sem giro</option>
              <option value="SAUDAVEL">Saudável</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[650px] overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-sm">
                <tr>
                  <th className="p-4 text-[10px] font-black uppercase text-slate-500">Produto / Categoria</th>
                  <th className="border-l border-slate-200 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Vendas <br /> <span className="text-indigo-500">Mês Atual</span>
                  </th>
                  <th className="border-l border-slate-100 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Vendas <br /> <span className="text-sky-500">Últimos 60D</span>
                  </th>
                  <th className="border-l border-slate-100 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Vendas <br /> <span className="text-blue-500">Últimos 90D</span>
                  </th>
                  <th className="border-l border-slate-200 bg-slate-100/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Estoque <br /> <span className="text-slate-800">Físico Atual</span>
                  </th>
                  <th className="border-l border-slate-200 bg-indigo-50/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Giro Médio <br /> <span className="text-indigo-600">Peças/Dia</span>
                  </th>
                  <th className="border-l border-slate-200 bg-indigo-50/50 p-4 text-center text-[10px] font-black uppercase text-slate-500">
                    Previsão <br /> <span className="text-indigo-600">Automática</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-sm font-black uppercase text-slate-400">
                      Carregando dados reais de estoque e vendas...
                    </td>
                  </tr>
                ) : null}

                {!loading && filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-sm font-black uppercase text-slate-400">
                      Nenhum produto encontrado para os filtros atuais.
                    </td>
                  </tr>
                ) : null}

                {!loading && filteredData.map((item) => (
                  <tr
                    key={`${item.referencia || item.modelo}`}
                    onClick={() => setSelectedProduct(item)}
                    className="cursor-pointer transition-colors hover:bg-indigo-50/40"
                    title="Clique para ver loja a loja"
                  >
                    <td className="p-4">
                      <p className="text-xs font-black uppercase text-slate-900">{item.modelo}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500">
                          {item.categoria || 'GERAL'}
                        </span>
                        {item.referencia ? (
                          <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-indigo-500">
                            {item.referencia}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-l border-slate-100 p-4 text-center font-black text-indigo-600">{formatNumber(item.vendasMes)}</td>
                    <td className="border-l border-slate-50 p-4 text-center font-black text-sky-600">{formatNumber(item.vendas60)}</td>
                    <td className="border-l border-slate-50 p-4 text-center font-black text-blue-600">{formatNumber(item.vendas90)}</td>
                    <td className="border-l border-slate-100 bg-slate-50/50 p-4 text-center">
                      <span className={`rounded-lg px-3 py-1 text-sm font-black ${item.estoque === 0 ? 'text-red-500' : 'text-slate-900'}`}>
                        {formatNumber(item.estoque)}
                      </span>
                    </td>
                    <td className="border-l border-slate-100 bg-indigo-50/10 p-4 text-center font-mono text-xs font-bold text-slate-600">
                      {item.giroDiario > 0 ? `${formatDecimal(item.giroDiario)} un/dia` : '-'}
                    </td>
                    <td className="border-l border-slate-100 bg-indigo-50/10 p-4 text-center">{renderStatus(item.coberturaDias)}</td>
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
