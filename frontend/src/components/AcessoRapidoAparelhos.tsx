import { useEffect, useMemo, useState } from 'react';
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
  Palette,
} from 'lucide-react';

type CorAparelho = {
  cor: string;
  modeloCompleto: string;
  referencia: string;
  categoria: string;
  quantidade: number;
  estoque?: number;
  vendasMes: number;
  vendasAno: number;
  seriais?: string[];
};

type LojaAparelho = {
  loja: string;
  cnpj?: string;
  regiao?: string;
  quantidade: number;
  estoque?: number;
  vendasMes: number;
  vendasAno: number;
  cores?: CorAparelho[];
  variacoes?: CorAparelho[];
  variations?: CorAparelho[];
  detalhes?: CorAparelho[];
  items?: CorAparelho[];
};

type ProdutoAparelho = {
  id: string;
  modelo: string;
  modeloBusca?: string;
  referencia: string;
  categoria: string;
  quantidade: number;
  estoqueTotal?: number;
  vendasMes: number;
  vendasAno: number;
  lojasComEstoque: number;
  variacoes?: number | CorAparelho[];
  status?: string;
  lojas: LojaAparelho[];
};

type AcessoRapidoResponse = {
  success: boolean;
  generatedAt?: string;
  periodo?: {
    mesInicio: string;
    anoInicio: string;
    hoje: string;
  };
  resumo?: {
    modelos: number;
    modelosComEstoque: number;
    modelosVendidosMes: number;
    quantidade: number;
    vendasMes: number;
    vendasAno: number;
    lojas: number;
    variacoes?: number;
  };
  filtros?: {
    categorias: string[];
    lojas: string[];
  };
  produtos?: ProdutoAparelho[];
  products?: ProdutoAparelho[];
  filters?: {
    categorias?: string[];
    lojas?: string[];
  };
  error?: string;
};

type Props = {
  currentUser?: any;
};

const SORT_OPTIONS = [
  { value: 'quantidade_desc', label: 'Maior estoque' },
  { value: 'vendas_mes_desc', label: 'Mais vendidos no mês' },
  { value: 'vendas_ano_desc', label: 'Mais vendidos no ano' },
  { value: 'modelo_asc', label: 'Modelo A-Z' },
  { value: 'variacoes_desc', label: 'Mais variações' },
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

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function getQuantidadeProduto(item: ProdutoAparelho) {
  return Number(item.quantidade ?? item.estoqueTotal ?? 0);
}

function getQuantidadeLoja(item: LojaAparelho) {
  return Number(item.quantidade ?? item.estoque ?? 0);
}

function getQuantidadeCor(item: CorAparelho) {
  return Number(item.quantidade ?? item.estoque ?? 0);
}

function normalizeCorAparelho(cor: any, index: number): CorAparelho {
  const quantidade = Number(
    cor?.quantidade ??
      cor?.estoque ??
      cor?.quantity ??
      cor?.qtd ??
      0
  );

  const vendasMes = Number(
    cor?.vendasMes ??
      cor?.vendas_mes ??
      cor?.mes ??
      cor?.salesMonth ??
      0
  );

  const vendasAno = Number(
    cor?.vendasAno ??
      cor?.vendas_ano ??
      cor?.ano ??
      cor?.salesYear ??
      0
  );

  const modeloCompleto = String(
    cor?.modeloCompleto ??
      cor?.modelo_completo ??
      cor?.description ??
      cor?.descricao ??
      cor?.modelo ??
      ''
  ).trim();

  const referencia = String(
    cor?.referencia ??
      cor?.reference ??
      cor?.ref ??
      ''
  ).trim();

  const categoria = String(
    cor?.categoria ??
      cor?.category ??
      ''
  ).trim();

  const corNome = String(
    cor?.cor ??
      cor?.color ??
      cor?.colour ??
      ''
  ).trim();

  const seriais = Array.isArray(cor?.seriais)
    ? cor.seriais
    : Array.isArray(cor?.serials)
      ? cor.serials
      : [];

  return {
    cor: corNome || 'Cor não identificada',
    modeloCompleto: modeloCompleto || 'Variação não identificada',
    referencia,
    categoria,
    quantidade,
    estoque: quantidade,
    vendasMes,
    vendasAno,
    seriais,
  };
}

function getLojaCores(loja: LojaAparelho): CorAparelho[] {
  const rawCores =
    loja?.cores ||
    loja?.variacoes ||
    loja?.variations ||
    loja?.detalhes ||
    loja?.items ||
    [];

  const lista = Array.isArray(rawCores) ? rawCores : [];

  const normalizadas = lista
    .map((cor, index) => normalizeCorAparelho(cor, index))
    .filter((cor) => getQuantidadeCor(cor) > 0 || cor.vendasMes > 0 || cor.vendasAno > 0);

  if (normalizadas.length > 0) {
    return normalizadas;
  }

  const quantidadeLoja = getQuantidadeLoja(loja);
  const vendasMesLoja = Number(loja?.vendasMes ?? 0);
  const vendasAnoLoja = Number(loja?.vendasAno ?? 0);

  if (quantidadeLoja > 0 || vendasMesLoja > 0 || vendasAnoLoja > 0) {
    return [
      {
        cor: 'Não informado',
        modeloCompleto: 'Sem abertura de cor na base',
        referencia: '',
        categoria: '',
        quantidade: quantidadeLoja,
        estoque: quantidadeLoja,
        vendasMes: vendasMesLoja,
        vendasAno: vendasAnoLoja,
        seriais: [],
      },
    ];
  }

  return [];
}

function getProdutoVariacoesDiretas(item: ProdutoAparelho): CorAparelho[] {
  if (!Array.isArray(item.variacoes)) {
    return [];
  }

  return item.variacoes
    .map((cor, index) => normalizeCorAparelho(cor, index))
    .filter((cor) => getQuantidadeCor(cor) > 0 || cor.vendasMes > 0 || cor.vendasAno > 0);
}

function getVariacoesProduto(item: ProdutoAparelho) {
  if (typeof item.variacoes === 'number') return item.variacoes;

  const set = new Set<string>();

  getProdutoVariacoesDiretas(item).forEach((cor) => {
    set.add(normalizeSearchKey(`${cor.modeloCompleto} ${cor.cor} ${cor.referencia}`));
  });

  item.lojas.forEach((loja) => {
    getLojaCores(loja).forEach((cor) => {
      set.add(normalizeSearchKey(`${cor.modeloCompleto} ${cor.cor} ${cor.referencia}`));
    });
  });

  return set.size;
}

function KpiCard({ icon: Icon, label, value, helper }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{value}</p>
          {helper && <p className="mt-1 text-xs font-bold text-slate-500">{helper}</p>}
        </div>
        <div className="w-11 h-11 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

export default function AcessoRapidoAparelhos({ currentUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<AcessoRapidoResponse | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [store, setStore] = useState('TODAS');
  const [status, setStatus] = useState('TODOS');
  const [sortBy, setSortBy] = useState('quantidade_desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStoreKey, setExpandedStoreKey] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const apiUrl = getApiUrl();
      const params = new URLSearchParams();
      if (currentUser?.id) params.set('userId', String(currentUser.id));

      const response = await fetch(`${apiUrl}/api/diretoria/acesso-rapido-aparelhos?${params.toString()}`);
      const json: AcessoRapidoResponse = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Erro ao carregar acesso rápido de aparelhos.');
      }

      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar acesso rápido de aparelhos.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUser?.id]);

  const produtos = data?.produtos || data?.products || [];
  const categorias = data?.filtros?.categorias || data?.filters?.categorias || [];
  const lojas = data?.filtros?.lojas || data?.filters?.lojas || [];

  const filteredProducts = useMemo(() => {
    const searchKey = normalizeSearchKey(search);

    const filtered = produtos.filter((item) => {
      const modelKey = normalizeSearchKey(
        `${item.modelo} ${item.modeloBusca || ''} ${item.referencia} ${item.categoria} ${item.lojas
          .flatMap((loja) => getLojaCores(loja).map((cor) => `${cor.modeloCompleto} ${cor.cor} ${cor.referencia}`))
          .join(' ')}`
      );

      if (searchKey && !modelKey.includes(searchKey)) return false;
      if (category !== 'TODAS' && normalizeText(item.categoria) !== normalizeText(category)) return false;

      if (store !== 'TODAS') {
        const hasStore = item.lojas.some((loja) => normalizeText(loja.loja) === normalizeText(store));
        if (!hasStore) return false;
      }

      const quantidade = getQuantidadeProduto(item);
      if (status === 'COM_ESTOQUE' && quantidade <= 0) return false;
      if (status === 'SEM_ESTOQUE' && quantidade > 0) return false;
      if (status === 'VENDEU_MES' && item.vendasMes <= 0) return false;
      if (status === 'VENDEU_ANO' && item.vendasAno <= 0) return false;

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'vendas_mes_desc') return b.vendasMes - a.vendasMes || getQuantidadeProduto(b) - getQuantidadeProduto(a);
      if (sortBy === 'vendas_ano_desc') return b.vendasAno - a.vendasAno || getQuantidadeProduto(b) - getQuantidadeProduto(a);
      if (sortBy === 'modelo_asc') return a.modelo.localeCompare(b.modelo);
      if (sortBy === 'variacoes_desc') return getVariacoesProduto(b) - getVariacoesProduto(a) || getQuantidadeProduto(b) - getQuantidadeProduto(a);
      return getQuantidadeProduto(b) - getQuantidadeProduto(a) || b.vendasMes - a.vendasMes;
    });
  }, [produtos, search, category, store, status, sortBy]);

  const filteredSummary = useMemo(() => {
    const storesSet = new Set<string>();

    return filteredProducts.reduce(
      (acc, item) => {
        const quantidade = getQuantidadeProduto(item);

        acc.modelos += 1;
        acc.quantidade += quantidade;
        acc.vendasMes += item.vendasMes;
        acc.vendasAno += item.vendasAno;
        acc.variacoes += getVariacoesProduto(item);
        if (quantidade > 0) acc.modelosComEstoque += 1;
        if (item.vendasMes > 0) acc.modelosVendidosMes += 1;
        item.lojas.forEach((loja) => {
          if (getQuantidadeLoja(loja) > 0) storesSet.add(loja.loja);
        });
        acc.lojas = storesSet.size;
        return acc;
      },
      {
        modelos: 0,
        modelosComEstoque: 0,
        modelosVendidosMes: 0,
        quantidade: 0,
        vendasMes: 0,
        vendasAno: 0,
        lojas: 0,
        variacoes: 0,
      }
    );
  }, [filteredProducts]);

  const handleDownload = () => {
    const resumoRows = filteredProducts.map((item) => ({
      Modelo_Agrupado: item.modelo,
      Referencia_Principal: item.referencia,
      Categoria: item.categoria,
      Estoque_Total: getQuantidadeProduto(item),
      Vendas_Mes: item.vendasMes,
      Vendas_Ano: item.vendasAno,
      Lojas_Com_Estoque: item.lojasComEstoque,
      Variacoes_Cores: getVariacoesProduto(item),
    }));

    const lojasRows = filteredProducts.flatMap((item) =>
      item.lojas.map((loja) => ({
        Modelo_Agrupado: item.modelo,
        Categoria: item.categoria,
        Loja: loja.loja,
        CNPJ: loja.cnpj || '',
        Regiao: loja.regiao || '',
        Quantidade: getQuantidadeLoja(loja),
        Vendas_Mes: loja.vendasMes,
        Vendas_Ano: loja.vendasAno,
        Variacoes_Cores: getLojaCores(loja).length,
      }))
    );

    const coresRows = filteredProducts.flatMap((item) =>
      item.lojas.flatMap((loja) =>
        getLojaCores(loja).map((cor) => ({
          Modelo_Agrupado: item.modelo,
          Modelo_Completo: cor.modeloCompleto,
          Cor: cor.cor,
          Referencia: cor.referencia,
          Categoria: cor.categoria || item.categoria,
          Loja: loja.loja,
          CNPJ: loja.cnpj || '',
          Quantidade: getQuantidadeCor(cor),
          Vendas_Mes: cor.vendasMes,
          Vendas_Ano: cor.vendasAno,
          Seriais: (cor.seriais || []).join(', '),
        }))
      )
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), 'Resumo Modelos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lojasRows), 'Lojas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coresRows), 'Cores e Variacoes');
    XLSX.writeFile(wb, `acesso_rapido_aparelhos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) {
    return (
      <div className="h-full bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-3xl px-8 py-6 shadow-sm flex items-center gap-3 text-slate-700 font-black uppercase text-sm">
          <Loader2 className="animate-spin text-orange-600" size={22} />
          Carregando acesso rápido de aparelhos...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-xl bg-white border border-red-100 rounded-3xl p-8 shadow-sm text-center">
          <AlertCircle className="mx-auto text-red-500" size={44} />
          <h2 className="mt-4 text-xl font-black text-slate-900 uppercase">Erro ao carregar</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">{error}</p>
          <button
            onClick={fetchData}
            className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-orange-600 text-white text-xs font-black uppercase hover:bg-orange-700 transition-colors"
          >
            <RefreshCw size={16} />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 overflow-y-auto custom-scrollbar">
      <div className="p-4 md:p-8 space-y-6">
        <div className="bg-slate-950 text-white rounded-[2rem] p-6 md:p-8 shadow-xl overflow-hidden relative">
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 bg-orange-500/10 text-orange-300 border border-orange-500/20 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                <Package size={14} />
                Painel Diretoria
              </div>
              <h1 className="mt-4 text-2xl md:text-4xl font-black tracking-tight uppercase">
                Acesso rápido de aparelhos
              </h1>
              <p className="mt-2 text-sm text-slate-300 font-semibold max-w-3xl">
                Modelos agrupados por capacidade, com abertura por loja e detalhamento de cores no terceiro nível.
              </p>
              <p className="mt-2 text-xs text-slate-500 font-bold">
                Período: mês desde {formatDate(data?.periodo?.mesInicio)} • ano desde {formatDate(data?.periodo?.anoInicio)} • atualizado em {formatDate(data?.periodo?.hoje)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={fetchData}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-black uppercase transition-colors"
              >
                <RefreshCw size={16} />
                Atualizar
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-black uppercase transition-colors"
              >
                <Download size={16} />
                Baixar Excel
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <KpiCard icon={Package} label="Modelos agrupados" value={formatNumber(filteredSummary.modelos)} helper={`${formatNumber(filteredSummary.modelosComEstoque)} com estoque`} />
          <KpiCard icon={Warehouse} label="Quantidade total" value={formatNumber(filteredSummary.quantidade)} helper="peças em estoque" />
          <KpiCard icon={TrendingUp} label="Vendas no mês" value={formatNumber(filteredSummary.vendasMes)} helper={`${formatNumber(filteredSummary.modelosVendidosMes)} modelos vendidos`} />
          <KpiCard icon={TrendingUp} label="Vendas no ano" value={formatNumber(filteredSummary.vendasAno)} helper="acumulado do ano" />
          <KpiCard icon={Store} label="Lojas com estoque" value={formatNumber(filteredSummary.lojas)} helper={`${formatNumber(filteredSummary.variacoes)} cores/variações`} />
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-4 md:p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 text-slate-900 font-black uppercase tracking-tight">
            <Filter size={18} className="text-orange-600" />
            Pesquisa rápida
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar modelo, ex: ZFold, Z Fold, A56..."
                className="w-full h-12 pl-11 pr-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
              />
            </div>

            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-12 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              <option value="TODAS">Todas as categorias</option>
              {categorias.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>

            <select
              value={store}
              onChange={(event) => setStore(event.target.value)}
              className="h-12 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              <option value="TODAS">Todas as lojas</option>
              {lojas.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>

            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-12 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              <option value="TODOS">Todos os status</option>
              <option value="COM_ESTOQUE">Com estoque</option>
              <option value="SEM_ESTOQUE">Sem estoque</option>
              <option value="VENDEU_MES">Vendeu no mês</option>
              <option value="VENDEU_ANO">Vendeu no ano</option>
            </select>
          </div>

          <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <p className="text-xs font-bold text-slate-500">
              Mostrando <span className="text-slate-900 font-black">{formatNumber(filteredProducts.length)}</span> de {formatNumber(produtos.length)} modelos agrupados.
            </p>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-11 px-4 rounded-2xl border border-slate-200 bg-white text-xs font-black uppercase outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Modelo agrupado</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Categoria</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Estoque</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Vendas mês</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Vendas ano</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Lojas</th>
                  <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Variações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((item) => {
                  const isOpen = expandedId === item.id;
                  const quantidade = getQuantidadeProduto(item);

                  return (
                    <>
                      <tr
                        key={item.id}
                        onClick={() => {
                          setExpandedId(isOpen ? null : item.id);
                          setExpandedStoreKey(null);
                        }}
                        className="hover:bg-orange-50/40 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500">
                              {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-900 uppercase">{item.modelo}</p>
                              <p className="text-[11px] font-bold text-slate-400">Ref. principal: {item.referencia || '-'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-xs font-black text-slate-600 uppercase">{item.categoria || 'GERAL'}</td>
                        <td className="px-5 py-4 text-right text-sm font-black text-slate-900">{formatNumber(quantidade)}</td>
                        <td className="px-5 py-4 text-right text-sm font-black text-slate-900">{formatNumber(item.vendasMes)}</td>
                        <td className="px-5 py-4 text-right text-sm font-black text-slate-900">{formatNumber(item.vendasAno)}</td>
                        <td className="px-5 py-4 text-right text-sm font-black text-slate-900">{formatNumber(item.lojasComEstoque)}</td>
                        <td className="px-5 py-4 text-right text-sm font-black text-slate-900">{formatNumber(getVariacoesProduto(item))}</td>
                      </tr>

                      {isOpen && (
                        <tr key={`${item.id}-details`}>
                          <td colSpan={7} className="bg-slate-50 px-5 py-5">
                            <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
                              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                                <Store size={17} className="text-orange-600" />
                                <p className="text-xs font-black uppercase tracking-widest text-slate-700">Drill down por loja</p>
                              </div>

                              <div className="divide-y divide-slate-100">
                                {item.lojas.map((loja) => {
                                  const storeKey = `${item.id}-${loja.loja}`;
                                  const storeOpen = expandedStoreKey === storeKey;

                                  return (
                                    <div key={storeKey}>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedStoreKey(storeOpen ? null : storeKey)}
                                        className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                                      >
                                        <div className="flex items-center gap-3 text-left">
                                          <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                                            {storeOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                          </div>
                                          <div>
                                            <p className="text-sm font-black text-slate-900 uppercase">{loja.loja}</p>
                                            <p className="text-[11px] font-bold text-slate-400">{loja.regiao || 'REGIÃO NÃO INFORMADA'} • {getLojaCores(loja).length} cores/variações</p>
                                          </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-6 text-right">
                                          <div>
                                            <p className="text-[10px] font-black uppercase text-slate-400">Estoque</p>
                                            <p className="text-sm font-black text-slate-900">{formatNumber(getQuantidadeLoja(loja))}</p>
                                          </div>
                                          <div>
                                            <p className="text-[10px] font-black uppercase text-slate-400">Mês</p>
                                            <p className="text-sm font-black text-slate-900">{formatNumber(loja.vendasMes)}</p>
                                          </div>
                                          <div>
                                            <p className="text-[10px] font-black uppercase text-slate-400">Ano</p>
                                            <p className="text-sm font-black text-slate-900">{formatNumber(loja.vendasAno)}</p>
                                          </div>
                                        </div>
                                      </button>

                                      {storeOpen && (
                                        <div className="bg-slate-50 px-5 pb-5">
                                          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                                            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                                              <Palette size={15} className="text-orange-600" />
                                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Drill down por cor / variação</p>
                                            </div>

                                            <table className="w-full text-left">
                                              <thead className="bg-slate-50">
                                                <tr>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Modelo completo</th>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Cor</th>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Referência</th>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-right">Estoque</th>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-right">Mês</th>
                                                  <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-right">Ano</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-slate-100">
                                                {getLojaCores(loja).map((cor) => (
                                                  <tr key={`${storeKey}-${cor.modeloCompleto}-${cor.cor}-${cor.referencia}`}>
                                                    <td className="px-4 py-3 text-xs font-black text-slate-800 uppercase">{cor.modeloCompleto}</td>
                                                    <td className="px-4 py-3 text-xs font-bold text-slate-600">{cor.cor || 'Sem cor informada'}</td>
                                                    <td className="px-4 py-3 text-xs font-bold text-slate-500">{cor.referencia || '-'}</td>
                                                    <td className="px-4 py-3 text-right text-xs font-black text-slate-900">{formatNumber(getQuantidadeCor(cor))}</td>
                                                    <td className="px-4 py-3 text-right text-xs font-black text-slate-900">{formatNumber(cor.vendasMes)}</td>
                                                    <td className="px-4 py-3 text-right text-xs font-black text-slate-900">{formatNumber(cor.vendasAno)}</td>
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
                    </>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center">
                      <Package className="mx-auto text-slate-300" size={38} />
                      <p className="mt-3 text-sm font-black text-slate-700 uppercase">Nenhum aparelho encontrado</p>
                      <p className="mt-1 text-xs font-bold text-slate-400">Tente limpar os filtros ou pesquisar por outro modelo.</p>
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
