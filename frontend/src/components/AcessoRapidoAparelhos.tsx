import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Store,
  TrendingUp,
  Warehouse,
  Smartphone,
  Headphones
} from 'lucide-react';

type CorAparelho = {
  cor: string;
  modeloCompleto: string;
  categoria: string;
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
  seriais?: string[];
};

type LojaAparelho = {
  loja: string;
  cnpj?: string;
  regiao?: string;
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
  cores?: any[];
  variacoes?: any[];
  variations?: any[];
  detalhes?: any[];
  items?: any[];
};

type ProdutoAparelho = {
  id: string;
  modelo: string;
  modeloBusca?: string;
  categoria: string;
  quantidade: number;
  estoqueTotal?: number;
  vendasMes: number;
  vendasAno: number;
  lojasComEstoque: number;
  lojas: LojaAparelho[];
  _searchIndex?: string; // Cache de busca otimizado
};

type AcessoRapidoResponse = {
  success: boolean;
  produtos?: ProdutoAparelho[];
  products?: ProdutoAparelho[];
  filtros?: { categorias: string[]; lojas: string[]; };
  filters?: { categorias?: string[]; lojas?: string[]; };
  error?: string;
};

type Props = {
  currentUser?: any;
};

const SORT_OPTIONS = [
  { value: 'vendas_mes_desc', label: 'Mais vendidos no mês' },
  { value: 'vendas_ano_desc', label: 'Mais vendidos no ano' },
  { value: 'modelo_asc', label: 'Modelo A-Z' },
];

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');

  const isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    /^[0-9.]+$/.test(window.location.hostname);

  return isLocal
    ? `http://${window.location.hostname}:3000`
    : 'https://telefluxo-aplicacao.onrender.com';
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeSearchKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function removerCoresModelo(texto: string) {
  if (!texto) return '';

  return String(texto)
    .toUpperCase()

    // Samsung
    .replace(/\bMARINHO\b/g, '')
    .replace(/\bAZUL CLARO\b/g, '')
    .replace(/\bAZUL\b/g, '')
    .replace(/\bPRETO\b/g, '')
    .replace(/\bBRANCO\b/g, '')
    .replace(/\bVERDE\b/g, '')
    .replace(/\bROSA\b/g, '')
    .replace(/\bGRAFITE\b/g, '')
    .replace(/\bPRATA\b/g, '')
    .replace(/\bVIOLETA\b/g, '')
    .replace(/\bLILAS\b/g, '')
    .replace(/\bLILÁS\b/g, '')
    .replace(/\bTITANIO\b/g, '')
    .replace(/\bTITÂNIO\b/g, '')
    .replace(/\bCINZA\b/g, '')
    .replace(/\bBEGE\b/g, '')

    // Motorola
    .replace(/\bPANTONE\b/g, '')

    // Apple
    .replace(/\bNATURAL\b/g, '')
    .replace(/\bDESERT\b/g, '')
    .replace(/\bULTRAMARINO\b/g, '')

    .replace(/\s+/g, ' ')
    .trim();
}

function gerarChaveBuscaInteligente(texto: string) {
  return normalizeSearchKey(
    removerCoresModelo(texto)
  );
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function getQuantidadeProduto(item: ProdutoAparelho) {
  return Number(item.quantidade ?? item.estoqueTotal ?? 0);
}

function getQuantidadeLoja(item: LojaAparelho) {
  return Number(item.quantidade ?? 0);
}

function getQuantidadeCor(item: CorAparelho) {
  return Number(item.quantidade ?? 0);
}

// Lógica para separar Aparelhos de Acessórios
function isAparelho(categoria: string) {
  const cat = normalizeText(categoria);
  const termosAcessorios = ['ACESSORIO', 'PELICULA', 'CAPA', 'FONE', 'CABO', 'CARREGADOR', 'RELOGIO', 'WATCH', 'BUDS', 'FIT', 'PULSEIRA', 'CAIXA DE SOM', 'SPEAKER', 'MOCHILA'];
  return !termosAcessorios.some(termo => cat.includes(termosAcessorios[termo as any] || termo));
}

function normalizeCorAparelho(cor: any): CorAparelho {
  const quantidade = Number(cor?.quantidade ?? cor?.estoque ?? cor?.quantity ?? cor?.qtd ?? 0);
  const vendasMes = Number(cor?.vendasMes ?? cor?.vendas_mes ?? cor?.mes ?? cor?.salesMonth ?? 0);
  const vendasAno = Number(cor?.vendasAno ?? cor?.vendas_ano ?? cor?.ano ?? cor?.salesYear ?? 0);
  
  return {
    cor: String(cor?.cor ?? cor?.color ?? cor?.colour ?? 'Não identificada').trim(),
    modeloCompleto: String(cor?.modeloCompleto ?? cor?.modelo_completo ?? cor?.description ?? cor?.descricao ?? cor?.modelo ?? 'Variação').trim(),
    categoria: String(cor?.categoria ?? cor?.category ?? '').trim(),
    quantidade,
    vendasMes,
    vendasAno,
    seriais: Array.isArray(cor?.seriais) ? cor.seriais : Array.isArray(cor?.serials) ? cor.serials : [],
  };
}

function getLojaCores(loja: LojaAparelho): CorAparelho[] {
  const rawCores = loja?.cores || loja?.variacoes || loja?.variations || loja?.detalhes || loja?.items || [];
  const lista = Array.isArray(rawCores) ? rawCores : [];

  const normalizadas = lista
    .map((cor) => normalizeCorAparelho(cor))
    .filter((cor) => getQuantidadeCor(cor) > 0 || cor.vendasMes > 0 || cor.vendasAno > 0);

  if (normalizadas.length > 0) return normalizadas;

  const quantidadeLoja = getQuantidadeLoja(loja);
  if (quantidadeLoja > 0 || loja.vendasMes > 0 || loja.vendasAno > 0) {
    return [{
      cor: 'Padrão',
      modeloCompleto: 'Sem detalhamento',
      categoria: '',
      quantidade: quantidadeLoja,
      vendasMes: Number(loja?.vendasMes ?? 0),
      vendasAno: Number(loja?.vendasAno ?? 0),
      seriais: [],
    }];
  }

  return [];
}

function KpiCard({ icon: Icon, label, value, helper }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className="mt-1 text-xl font-black text-slate-900 tracking-tight">{value}</p>
        {helper && <p className="text-[10px] font-bold text-slate-500">{helper}</p>}
      </div>
      <div className="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
        <Icon size={20} />
      </div>
    </div>
  );
}

// --- SISTEMA DE CACHE EM MEMÓRIA ---
let cacheGlobalData: AcessoRapidoResponse | null = null;
let cacheGlobalTime: number = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos de cache (ajuste como quiser)

export default function AcessoRapidoAparelhos({ currentUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<AcessoRapidoResponse | null>(null);
  
  // Filtros
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [store, setStore] = useState('TODAS');
  const [status, setStatus] = useState('TODOS');
  const [sortBy, setSortBy] = useState('vendas_mes_desc');
  const [tipoItem, setTipoItem] = useState<'APARELHOS' | 'ACESSORIOS' | 'TODOS'>('APARELHOS'); // Padrão: Só aparelhos

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStoreKey, setExpandedStoreKey] = useState<string | null>(null);

  // 🔥 OTIMIZAÇÃO MAXIMA: Renderiza apenas 15 itens por vez
  const [visibleCount, setVisibleCount] = useState(15);

  const fetchData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError('');

      // 1. VERIFICA O CACHE: Tem dado salvo e ainda está no prazo de validade?
      if (!forceRefresh && cacheGlobalData && (Date.now() - cacheGlobalTime < CACHE_DURATION_MS)) {
        setData(cacheGlobalData);
        setLoading(false);
        return;
      }

      // 2. SE NÃO TEM CACHE OU PASSOU O TEMPO, BUSCA NO BACKEND
      const apiUrl = getApiUrl();
      const params = new URLSearchParams();
      if (currentUser?.id) params.set('userId', String(currentUser.id));

      const response = await fetch(`${apiUrl}/api/diretoria/acesso-rapido-aparelhos?${params.toString()}`);
      const json: AcessoRapidoResponse = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Erro ao carregar acesso rápido.');
      }

      // 3. SALVA O RESULTADO NO CACHE PARA A PRÓXIMA VEZ
      cacheGlobalData = json;
      cacheGlobalTime = Date.now();

      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Erro de conexão.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUser?.id]);

  // MOTOR DE BUSCA INTELIGENTE //
  // Sempre que mudar um filtro ou digitar algo, reseta a lista para 10 (Mais leveza)
  useEffect(() => {
    setVisibleCount(10);
    setExpandedId(null);
  }, [search, category, store, status, sortBy, tipoItem]);

  const produtosOtimizados = useMemo(() => {
    const raw = data?.produtos || data?.products || [];
    return raw.map(item => {
      let coresString = '';
      item.lojas?.forEach(loja => {
        getLojaCores(loja).forEach(cor => {
          coresString += ` ${cor.modeloCompleto} ${cor.cor}`;
        });
      });
      return {
        ...item,
        _searchIndex: gerarChaveBuscaInteligente(
          `${item.modelo} ${item.categoria} ${coresString}`
        )
      };
    });
  }, [data]);

  const categorias = data?.filtros?.categorias || data?.filters?.categorias || [];
  const lojas = data?.filtros?.lojas || data?.filters?.lojas || [];

  const filteredProducts = useMemo(() => {
    const searchKey = gerarChaveBuscaInteligente(search);

    const filtered = produtosOtimizados.filter((item) => {
      // 1. Filtro Otimizado de Busca Rápida
      if (searchKey && !item._searchIndex?.includes(searchKey)) return false;
      
      // 2. Filtro de Tipo (Aparelhos x Acessórios)
      if (tipoItem === 'APARELHOS' && !isAparelho(item.categoria)) return false;
      if (tipoItem === 'ACESSORIOS' && isAparelho(item.categoria)) return false;

      // 3. Demais Filtros
      if (category !== 'TODAS' && normalizeText(item.categoria) !== normalizeText(category)) return false;
      if (store !== 'TODAS' && !item.lojas.some((loja) => normalizeText(loja.loja) === normalizeText(store))) return false;

      const quantidade = getQuantidadeProduto(item);
      if (status === 'COM_ESTOQUE' && quantidade <= 0) return false;
      if (status === 'SEM_ESTOQUE' && quantidade > 0) return false;
      if (status === 'VENDEU_MES' && item.vendasMes <= 0) return false;
      if (status === 'VENDEU_ANO' && item.vendasAno <= 0) return false;

      return true;
    });

    // Ordenação Padronizada
    return filtered.sort((a, b) => {
      if (sortBy === 'vendas_mes_desc') return b.vendasMes - a.vendasMes || getQuantidadeProduto(b) - getQuantidadeProduto(a);
      if (sortBy === 'vendas_ano_desc') return b.vendasAno - a.vendasAno || getQuantidadeProduto(b) - getQuantidadeProduto(a);
      if (sortBy === 'modelo_asc') return a.modelo.localeCompare(b.modelo);
      return b.vendasMes - a.vendasMes;
    });
  }, [produtosOtimizados, search, category, store, status, sortBy, tipoItem]);

  // 🔥 FATIAMENTO DO ARRAY: Pega os primeiros com base no visibleCount
  const displayedProducts = filteredProducts.slice(0, visibleCount);

  const filteredSummary = useMemo(() => {
    const storesSet = new Set<string>();
    return filteredProducts.reduce((acc, item) => {
      const quantidade = getQuantidadeProduto(item);
      acc.quantidade += quantidade;
      acc.vendasMes += item.vendasMes;
      acc.vendasAno += item.vendasAno;
      item.lojas.forEach(loja => { if (getQuantidadeLoja(loja) > 0) storesSet.add(loja.loja); });
      acc.lojas = storesSet.size;
      return acc;
    }, { quantidade: 0, vendasMes: 0, vendasAno: 0, lojas: 0 });
  }, [filteredProducts]);

  const handleDownload = () => {
    const resumoRows = filteredProducts.map((item) => ({
      Modelo_Agrupado: item.modelo,
      Categoria: item.categoria,
      Estoque_Total: getQuantidadeProduto(item),
      Vendas_Mes: item.vendasMes,
      Vendas_Ano: item.vendasAno,
    }));

    const coresRows = filteredProducts.flatMap((item) =>
      item.lojas.flatMap((loja) =>
        getLojaCores(loja).map((cor) => ({
          Modelo_Agrupado: item.modelo,
          Modelo_Completo: cor.modeloCompleto,
          Cor: cor.cor,
          Categoria: cor.categoria || item.categoria,
          Loja: loja.loja,
          Quantidade: getQuantidadeCor(cor),
          Vendas_Mes: cor.vendasMes,
          Vendas_Ano: cor.vendasAno,
        }))
      )
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), 'Resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coresRows), 'Cores e Estoque');
    XLSX.writeFile(wb, `Acesso_Rapido_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) {
    return (
      <div className="h-full bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-3xl px-8 py-6 shadow-sm flex items-center gap-3 text-slate-700 font-black uppercase text-sm">
          <Loader2 className="animate-spin text-orange-600" size={22} />
          Carregando informações...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-xl bg-white border border-red-100 rounded-3xl p-8 shadow-sm text-center">
          <AlertCircle className="mx-auto text-red-500" size={44} />
          <h2 className="mt-4 text-xl font-black text-slate-900 uppercase">Erro de Leitura</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">{error}</p>
          <button onClick={() => fetchData(true)} className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-orange-600 text-white text-xs font-black uppercase hover:bg-orange-700 transition-colors">
            <RefreshCw size={16} /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 overflow-y-auto custom-scrollbar">
      <div className="p-3 md:p-8 space-y-4">
        
        {/* Painel Hero Limpo para Mobile */}
        <div className="bg-slate-950 text-white rounded-3xl p-5 md:p-6 shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="absolute -right-16 -top-16 w-40 h-40 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-500/20 border border-orange-500/30 rounded-2xl flex items-center justify-center text-orange-400 shrink-0">
              <Package size={24} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight uppercase">Acesso Rápido</h1>
              <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Estoque e Vendas</p>
            </div>
          </div>
          <div className="relative z-10 flex gap-2 w-full md:w-auto">
            {/* 🔥 Passando 'true' para o fetchData() forçar ignorar o cache quando o usuário clica */}
            <button onClick={() => fetchData(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-black uppercase transition-colors">
              <RefreshCw size={16} /> Atualizar
            </button>
            <button onClick={handleDownload} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-black uppercase transition-colors">
              <Download size={16} /> Baixar
            </button>
          </div>
        </div>

        {/* KPIs Reduzidos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Warehouse} label="Estoque" value={formatNumber(filteredSummary.quantidade)} helper="Peças filtradas" />
          <KpiCard icon={TrendingUp} label="Mês" value={formatNumber(filteredSummary.vendasMes)} helper="Vendas no mês" />
          <KpiCard icon={TrendingUp} label="Ano" value={formatNumber(filteredSummary.vendasAno)} helper="Vendas no ano" />
          <KpiCard icon={Store} label="Lojas" value={formatNumber(filteredSummary.lojas)} helper="Com estoque atual" />
        </div>

        {/* Filtros Simplificados */}
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2 text-slate-900 font-black uppercase tracking-tight">
              <Filter size={18} className="text-orange-600" /> Filtros
            </div>
            
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button 
                onClick={() => setTipoItem('APARELHOS')} 
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${tipoItem === 'APARELHOS' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500'}`}
              >
                <Smartphone size={14} /> Aparelhos
              </button>
              <button 
                onClick={() => setTipoItem('ACESSORIOS')} 
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${tipoItem === 'ACESSORIOS' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500'}`}
              >
                <Headphones size={14} /> Acessórios
              </button>
              <button 
                onClick={() => setTipoItem('TODOS')} 
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${tipoItem === 'TODOS' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500'}`}
              >
                Todos
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            <div className="md:col-span-2 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ex: A55, Z Fold..."
                className="w-full h-11 pl-11 pr-4 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold outline-none focus:ring-2 focus:border-orange-400"
              />
            </div>
            <select value={store} onChange={(e) => setStore(e.target.value)} className="h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold outline-none">
              <option value="TODAS">Todas as lojas</option>
              {lojas.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold outline-none">
              <option value="TODOS">Todos status</option>
              <option value="COM_ESTOQUE">Com estoque</option>
              <option value="SEM_ESTOQUE">Sem estoque</option>
              <option value="VENDEU_MES">Vendeu no mês</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-11 px-3 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase outline-none">
              {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>

        {/* Tabela Simplificada */}
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="min-w-[600px] w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Modelo</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Estoque</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Vendas Mês</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Vendas Ano</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedProducts.map((item) => {
                  const isOpen = expandedId === item.id;
                  const quantidade = getQuantidadeProduto(item);

                  return (
                    <React.Fragment key={item.id}>
                      <tr onClick={() => { setExpandedId(isOpen ? null : item.id); setExpandedStoreKey(null); }} className="hover:bg-orange-50/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isOpen ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </div>
                            <div>
                              <p className="text-xs font-black text-slate-900 uppercase leading-tight">{item.modelo}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{item.categoria || 'GERAL'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-slate-900">{formatNumber(quantidade)}</td>
                        <td className="px-4 py-3 text-center text-sm font-black text-emerald-600">{formatNumber(item.vendasMes)}</td>
                        <td className="px-4 py-3 text-center text-sm font-black text-slate-500">{formatNumber(item.vendasAno)}</td>
                      </tr>

                      {isOpen && (
                        <tr key={`${item.id}-details`}>
                          <td colSpan={4} className="bg-slate-50 px-2 py-3 md:px-6 md:py-4">
                            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                              <div className="divide-y divide-slate-100">
                                {/* Otimização: Ordenar lojas com maior estoque primeiro */}
                                {[...item.lojas].sort((a, b) => getQuantidadeLoja(b) - getQuantidadeLoja(a)).map((loja) => {
                                  const storeKey = `${item.id}-${loja.loja}`;
                                  const storeOpen = expandedStoreKey === storeKey;

                                  return (
                                    <div key={storeKey}>
                                      <button type="button" onClick={() => setExpandedStoreKey(storeOpen ? null : storeKey)} className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50">
                                        <div className="flex items-center gap-1.5 text-left">
                                          <div className="text-orange-400">{storeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                                          <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{loja.loja}</p>
                                        </div>
                                        <div className="flex gap-4 text-right">
                                          <div className="flex flex-col items-center justify-center">
                                            <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-0.5">Est</p>
                                            <p className="text-[11px] font-black text-slate-900 leading-none">{formatNumber(getQuantidadeLoja(loja))}</p>
                                          </div>
                                          <div className="flex flex-col items-center justify-center">
                                            <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-0.5">Mês</p>
                                            <p className="text-[11px] font-black text-emerald-600 leading-none">{formatNumber(loja.vendasMes)}</p>
                                          </div>
                                        </div>
                                      </button>

                                      {storeOpen && (
                                        <div className="bg-slate-50 px-3 pb-3">
                                          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                                            <table className="w-full text-left">
                                              <thead className="bg-slate-50 border-b border-slate-100">
                                                <tr>
                                                  <th className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-400">Modelo Exato</th>
                                                  <th className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-400">Cor</th>
                                                  <th className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-400 text-center">Est</th>
                                                  <th className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-400 text-center">Mês</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-slate-100">
                                                {getLojaCores(loja).map((cor, idx) => (
                                                  <tr key={idx}>
                                                    <td className="px-3 py-1.5 text-[10px] font-black text-slate-700 uppercase leading-tight">{cor.modeloCompleto}</td>
                                                    <td className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase">{cor.cor}</td>
                                                    <td className="px-3 py-1.5 text-center text-[11px] font-black text-slate-900">{formatNumber(getQuantidadeCor(cor))}</td>
                                                    <td className="px-3 py-1.5 text-center text-[11px] font-black text-emerald-600">{formatNumber(cor.vendasMes)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* 🔥 BOTÃO DE CARREGAR MAIS AJUSTADO PARA 10 🔥 */}
                {visibleCount < filteredProducts.length && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center bg-slate-50">
                      <button
                        onClick={() => setVisibleCount((v) => v + 10)}
                        className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm transition-all"
                      >
                        Carregar mais aparelhos...
                      </button>
                      <p className="text-[9px] text-slate-400 mt-2 font-bold uppercase">
                        Exibindo {visibleCount} de {filteredProducts.length}
                      </p>
                    </td>
                  </tr>
                )}

                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center">
                      <Package className="mx-auto text-slate-300" size={32} />
                      <p className="mt-2 text-xs font-black text-slate-700 uppercase">Nenhum item encontrado</p>
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