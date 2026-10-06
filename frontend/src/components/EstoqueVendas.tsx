import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  EyeOff,
  Info,
  Package,
  Pencil,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  Trash2,
} from 'lucide-react';

type SheetTab = {
  id: string;
  label: string;
  category: string;
  state: string;
  stateLabel: string;
};

type WeekColumn = {
  key: string;
  label: string;
  displayLabel?: string;
  startDate?: string;
  endDate?: string;
  year: number;
  week: number;
};

type PontoPedidoRow = {
  rowKey: string;
  sourceRow: number;
  modelo: string;
  modeloComCor: string;
  precoSamsung: number;
  precoTelecel: number;
  desc: number;
  precoFinal: number;
  sellIn: number;
  alteracao: string;
  status: string;
  pedidoFaturado: number;
  vendas60: number;
  vendas45: number;
  vendas30: number;
  vendas15: number;
  estoque: number;
  pendente: number;
  backlogTotal: number;
  weeks: Record<string, number>;
  vendasMediaDia: number;
  coberturaAtualDias: number | null;
  coberturaAtualData: string;
  previsao15: number;
  previsao30: number;
  previsao45: number;
  previsao60: number;
  incoming60: number;
  sugestaoEstoqueDobrado?: number;
  sugestaoFaturarBacklog: number;
  sugestaoNovoPedido: number;
  sugestaoPedido: number;
  pedidoControladoria: number;
  pedidoRufino: number;
  sobra: number;
  previsaoEstoque: string;
  coberturaPosPedidoDias: number | null;
};

type PontoPedidoResponse = {
  ok: boolean;
  error?: string;
  sourceUrl: string;
  loadedAt: string;
  today: string;
  sheetName: string;
  currentWeek: string;
  tabs: SheetTab[];
  weeks: WeekColumn[];
  summary: {
    modelos: number;
    estoque: number;
    pendente: number;
    backlogTotal: number;
    sugestaoFaturarBacklog: number;
    sugestaoNovosPedidos: number;
    pedidoControladoria: number;
    pedidoRufino: number;
    sobra: number;
    vendas60: number;
  };
  formula?: {
    salesFocus?: string;
    backlogBilling?: string;
    newOrder?: string;
    pending?: string;
  };
  rows: PontoPedidoRow[];
};

type PageMode = 'planejamento' | 'resumo' | 'sugestoes' | 'sobras' | 'ia' | 'prontos';

type StateSurplusRow = {
  id: string;
  label: string;
  category: string;
  state: string;
  stateLabel: string;
  estoque: number;
  backlogTotal: number;
  vendas60: number;
  sobra: number;
  sugestaoNovosPedidos: number;
};

type AiTransferSuggestion = {
  modelo: string;
  origem: string;
  destino: string;
  quantidade: number;
  sobraOrigemAntes?: number;
  necessidadeDestinoAntes?: number;
};

type AiAnalysisContext = {
  escopo?: string;
  statesAnalyzed?: string[];
  stateSummary?: Array<{
    estado: string;
    vendas60: number;
    estoque: number;
    backlog: number;
    sobra: number;
    novosPedidos: number;
    faturarBacklog: number;
  }>;
  transferencias?: AiTransferSuggestion[];
};

type ReadyOrder = {
  id: string;
  nome: string;
  categoria: string;
  criadoEm: string;
  atualizadoEm: string;
  totalModelos: number;
  totalUnidades: number;
};

type AiAction = '' | 'AUTO_PLAN';

const getApiUrl = () => {
  const envUrl = String(import.meta.env.VITE_API_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/$/, '');

  if (typeof window === 'undefined') {
    return 'https://telefluxo-aplicacao.onrender.com';
  }

  const hostname = window.location.hostname;
  const isLocalNetwork =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.local');

  return isLocalNetwork
    ? `http://${hostname}:3000`
    : 'https://telefluxo-aplicacao.onrender.com';
};

const API_URL = getApiUrl();

async function fetchJsonWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 35000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const json = await response.json().catch(() => null);
    return { response, json };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'O backend demorou mais de 35 segundos para responder. Verifique a rota /api/ponto-pedido e a leitura do Google Sheets.',
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

const money = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const number = (value: number | null | undefined, decimals = 0) =>
  Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const shortDate = (iso: string) => {
  if (!iso) return '—';
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const addDays = (iso: string, days: number) => {
  if (!iso || !Number.isFinite(days)) return '';
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.floor(days)));
  return date.toISOString().slice(0, 10);
};

const metricTone = (value: number) => {
  if (value < 0) return 'bg-red-50 text-red-700';
  if (value <= 5) return 'bg-amber-50 text-amber-700';
  return 'text-slate-700';
};

const isBlockedOrderStatus = (status: string) => {
  const normalized = String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  return (
    normalized.includes('NAO HA COMO PEDIR') ||
    normalized.includes('OBSOLETO')
  );
};

function GroupButton({
  open,
  onClick,
  children,
  help,
}: {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={help}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
    >
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      {children}
    </button>
  );
}

function ColumnLabel({
  label,
  help,
}: {
  label: React.ReactNode;
  help: string;
}) {
  return (
    <span
      title={help}
      className="inline-flex cursor-help items-center justify-center gap-1"
    >
      <span className="whitespace-pre-line leading-tight">{label}</span>
      <Info size={9} className="shrink-0 opacity-45" />
    </span>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-wide transition ${
        active
          ? 'bg-slate-950 text-white shadow-sm'
          : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon size={12} />
      {children}
    </button>
  );
}

export function EstoqueVendas({ initialMode = 'planejamento' }: { initialMode?: PageMode }) {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [pageMode, setPageMode] = useState<PageMode>(initialMode);
  const [data, setData] = useState<PontoPedidoResponse | null>(null);
  const [rows, setRows] = useState<PontoPedidoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('Lendo abas do Google Sheets...');
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSales, setShowSales] = useState(false);
  const [showFutureWeeks, setShowFutureWeeks] = useState(false);
  const [showForecasts, setShowForecasts] = useState(false);
  const [hideBlockedRows, setHideBlockedRows] = useState(true);
  const [stateSummaries, setStateSummaries] = useState<StateSurplusRow[]>([]);
  const [stateSummaryLoading, setStateSummaryLoading] = useState(false);
  const [savingRowKey, setSavingRowKey] = useState('');
  const [savingControladoriaKey, setSavingControladoriaKey] = useState('');
  const [aiQuestion, setAiQuestion] = useState('Fazer ponto de pedido');
  const [aiAction, setAiAction] = useState<AiAction>('AUTO_PLAN');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiContext, setAiContext] = useState<AiAnalysisContext | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [readyOrders, setReadyOrders] = useState<ReadyOrder[]>([]);
  const [readyOrdersLoading, setReadyOrdersLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingScrollRef = useRef(false);

  const loadMeta = useCallback(async (force = false) => {
    setLoadingStage('Lendo abas do Google Sheets...');

    const { response, json } = await fetchJsonWithTimeout(
      `${API_URL}/api/ponto-pedido/meta${force ? '?refresh=1' : ''}`,
      { cache: 'no-store' },
      35000,
    );

    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || 'Não foi possível ler as abas do Google Sheets.');
    }

    const nextTabs = Array.isArray(json.tabs) ? json.tabs : [];

    if (!nextTabs.length) {
      throw new Error(
        'O backend respondeu, mas não encontrou nenhuma aba de Ponto de Pedido. Confira as abas APA*, API-CABEDELO e AP - FORTALEZA.',
      );
    }

    setTabs(nextTabs);

    setActiveTab((current) => {
      if (current && nextTabs.some((tab: SheetTab) => tab.id === current)) {
        return current;
      }
      return nextTabs[0]?.id || '';
    });

    return nextTabs;
  }, []);

  const loadData = useCallback(async (tab: string, force = false) => {
    if (!tab) return;

    setLoading(true);
    setErrorMsg('');

    try {
      const params = new URLSearchParams({ aba: tab });
      if (force) params.set('refresh', '1');

      setLoadingStage(`Montando Ponto de Pedido${tab ? ` · ${tab}` : ''}...`);

      const { response, json: rawJson } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido?${params.toString()}`,
        { cache: 'no-store' },
        45000,
      );
      const json = rawJson as PontoPedidoResponse | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Falha ao montar o Ponto de Pedido.');
      }

      setData(json);
      setRows(Array.isArray(json.rows) ? json.rows : []);
      if (Array.isArray(json.tabs)) setTabs(json.tabs);
      setAiAnswer('');
      setAiContext(null);
    } catch (error: any) {
      console.error('Ponto de Pedido:', error);
      setErrorMsg(error?.message || 'Falha ao carregar dados.');
      setData(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStateSummaries = useCallback(async (category: string, force = false) => {
    if (!category) {
      setStateSummaries([]);
      return;
    }

    setStateSummaryLoading(true);
    try {
      const params = new URLSearchParams({ categoria: category });
      if (force) params.set('refresh', '1');

      const { response, json } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido/resumo-estados?${params.toString()}`,
        { cache: 'no-store' },
        60000,
      );

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível calcular a sobra por estado.');
      }

      setStateSummaries(Array.isArray(json.rows) ? json.rows : []);
    } catch (error) {
      console.error('Resumo por estado:', error);
      setStateSummaries([]);
    } finally {
      setStateSummaryLoading(false);
    }
  }, []);

  const loadReadyOrders = useCallback(async (category: string) => {
    if (!category) {
      setReadyOrders([]);
      return;
    }

    setReadyOrdersLoading(true);
    try {
      const params = new URLSearchParams({ categoria: category });
      const { response, json } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido/pedidos-prontos?${params.toString()}`,
        { cache: 'no-store' },
        35000,
      );

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível carregar os pedidos prontos.');
      }

      setReadyOrders(Array.isArray(json.rows) ? json.rows : []);
    } catch (error: any) {
      console.error('Pedidos prontos:', error);
      setErrorMsg(error?.message || 'Falha ao carregar pedidos prontos.');
      setReadyOrders([]);
    } finally {
      setReadyOrdersLoading(false);
    }
  }, []);


  useEffect(() => {
    let alive = true;

    const boot = async () => {
      setLoading(true);
      setErrorMsg('');
      try {
        const nextTabs = await loadMeta(false);
        if (!alive) return;

        const first = nextTabs[0]?.id || '';
        if (!first) {
          throw new Error('Nenhuma aba disponível para carregar o Ponto de Pedido.');
        }

        await loadData(first, false);
        const firstCategory = String(nextTabs[0]?.category || 'APARELHOS');
        loadStateSummaries(firstCategory, false);
      } catch (error: any) {
        if (!alive) return;
        setErrorMsg(error?.message || 'Falha ao iniciar o Ponto de Pedido.');
      } finally {
        if (alive) setLoading(false);
      }
    };

    boot();
    return () => {
      alive = false;
    };
  }, [loadData, loadMeta, loadStateSummaries]);

  const handleTabChange = (tab: string) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSearchTerm('');
    loadData(tab, false);
  };

  const searchedRows = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();

    return rows.filter((row) => {
      if (hideBlockedRows && isBlockedOrderStatus(row.status)) return false;
      if (!term) return true;
      return `${row.modelo} ${row.modeloComCor}`.toUpperCase().includes(term);
    });
  }, [rows, searchTerm, hideBlockedRows]);

  const categories = useMemo(
    () => Array.from(new Set(tabs.map((tab) => tab.category || 'APARELHOS'))),
    [tabs],
  );

  const activeTabMeta = useMemo(
    () => tabs.find((tab) => tab.id === activeTab) || tabs[0] || null,
    [tabs, activeTab],
  );

  const activeCategory = activeTabMeta?.category || categories[0] || 'APARELHOS';

  useEffect(() => {
    if (pageMode === 'prontos' && activeCategory) {
      loadReadyOrders(activeCategory);
    }
  }, [pageMode, activeCategory, loadReadyOrders]);

  useEffect(() => {
    const updateWidth = () => {
      const width = tableRef.current?.scrollWidth || 0;
      setTableScrollWidth(width);
    };

    updateWidth();
    const observer = typeof ResizeObserver !== 'undefined' && tableRef.current
      ? new ResizeObserver(updateWidth)
      : null;

    if (observer && tableRef.current) observer.observe(tableRef.current);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [showSales, showFutureWeeks, showForecasts, hideBlockedRows, searchedRows.length]);

  const syncHorizontalScroll = (
    source: HTMLDivElement | null,
    target: HTMLDivElement | null,
  ) => {
    if (!source || !target || syncingScrollRef.current) return;
    syncingScrollRef.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  const stateTabs = useMemo(
    () => tabs.filter((tab) => (tab.category || 'APARELHOS') === activeCategory),
    [tabs, activeCategory],
  );

  const handleCategoryChange = (category: string) => {
    if (!category || category === activeCategory) return;
    const firstTab = tabs.find((tab) => tab.category === category);
    if (!firstTab) return;
    setActiveTab(firstTab.id);
    setSearchTerm('');
    loadData(firstTab.id, false);
    loadStateSummaries(category, false);
  };

  const finalizePointOrder = async () => {
    if (finalizing || !activeCategory) return;

    setFinalizing(true);
    setErrorMsg('');
    try {
      const { response, json } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido/finalizar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoria: activeCategory }),
        },
        90000,
      );

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível finalizar o ponto de pedido.');
      }

      await loadReadyOrders(activeCategory);
      setPageMode('prontos');
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao finalizar o ponto de pedido.');
    } finally {
      setFinalizing(false);
    }
  };

  const editReadyOrder = async (order: ReadyOrder) => {
    setErrorMsg('');
    try {
      const { response, json } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido/pedidos-prontos/${encodeURIComponent(order.id)}/restaurar`,
        { method: 'POST' },
        90000,
      );

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível reabrir o pedido.');
      }

      const targetTab = String(json.firstTab || activeTab || '');
      if (targetTab) {
        setActiveTab(targetTab);
        await loadData(targetTab, false);
      }
      setPageMode('planejamento');
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao reabrir o pedido pronto.');
    }
  };

  const deleteReadyOrder = async (order: ReadyOrder) => {
    const confirmed = window.confirm(`Excluir definitivamente \"${order.nome}\"?`);
    if (!confirmed) return;

    setErrorMsg('');
    try {
      const { response, json } = await fetchJsonWithTimeout(
        `${API_URL}/api/ponto-pedido/pedidos-prontos/${encodeURIComponent(order.id)}`,
        { method: 'DELETE' },
        35000,
      );

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível excluir o pedido pronto.');
      }

      await loadReadyOrders(activeCategory);
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao excluir o pedido pronto.');
    }
  };


  const orderedRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          Number(row.pedidoRufino || 0) > 0 ||
          Number(row.pedidoControladoria || 0) > 0 ||
          Number(row.sugestaoFaturarBacklog || 0) > 0 ||
          Number(row.sugestaoNovoPedido || 0) > 0,
      ),
    [rows],
  );

  const suggestionRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          Number(row.sugestaoFaturarBacklog || 0) > 0 ||
          Number(row.sugestaoNovoPedido || 0) > 0 ||
          Number(row.sobra || 0) > 0,
      ),
    [rows],
  );

  const surplusRows = useMemo(
    () =>
      rows
        .filter((row) => Number(row.sobra || 0) > 0)
        .sort((a, b) => Number(b.sobra || 0) - Number(a.sobra || 0)),
    [rows],
  );

  const orderSummary = useMemo(() => {
    return orderedRows.reduce(
      (acc, row) => {
        const rufino = Number(row.pedidoRufino || 0);
        const controladoria = Number(row.pedidoControladoria || 0);
        const sugestao = Number(row.sugestaoNovoPedido || 0);
        acc.modelos += 1;
        acc.vendas60 += Number(row.vendas60 || 0);
        acc.estoque += Number(row.estoque || 0);
        acc.backlog += Number(row.backlogTotal || 0);
        acc.faturarBacklog += Number(row.sugestaoFaturarBacklog || 0);
        acc.rufino += rufino;
        acc.controladoria += controladoria;
        acc.sugestao += sugestao;
        if (rufino < sugestao) acc.abaixo += 1;
        if (rufino > sugestao) acc.acima += 1;
        return acc;
      },
      {
        modelos: 0,
        vendas60: 0,
        estoque: 0,
        backlog: 0,
        faturarBacklog: 0,
        rufino: 0,
        controladoria: 0,
        sugestao: 0,
        abaixo: 0,
        acima: 0,
      },
    );
  }, [orderedRows]);

  const manualOrderSummary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const rufino = Number(row.pedidoRufino || 0);
        const controladoria = Number(row.pedidoControladoria || 0);
        if (rufino > 0 || controladoria > 0) acc.modelos += 1;
        acc.rufino += rufino;
        acc.controladoria += controladoria;
        return acc;
      },
      { modelos: 0, rufino: 0, controladoria: 0 },
    );
  }, [rows]);

  const updatePedidoRufino = (rowKey: string, value: number) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setRows((current) =>
      current.map((row) =>
        row.rowKey === rowKey ? { ...row, pedidoRufino: safeValue } : row,
      ),
    );
  };

  const updatePedidoControladoria = (rowKey: string, value: number) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setRows((current) =>
      current.map((row) =>
        row.rowKey === rowKey ? { ...row, pedidoControladoria: safeValue } : row,
      ),
    );
  };

  const savePedidoRufino = async (row: PontoPedidoRow) => {
    if (!activeTab) return;
    setSavingRowKey(row.rowKey);

    try {
      const response = await fetch(`${API_URL}/api/ponto-pedido/pedido-rufino`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aba: activeTab,
          modelo: row.modelo,
          modeloComCor: row.modeloComCor,
          valor: Number(row.pedidoRufino || 0),
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível salvar o Pedido Rufino.');
      }
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao salvar Pedido Rufino.');
    } finally {
      setSavingRowKey('');
    }
  };

  const savePedidoControladoria = async (row: PontoPedidoRow) => {
    if (!activeTab) return;
    setSavingControladoriaKey(row.rowKey);

    try {
      const response = await fetch(`${API_URL}/api/ponto-pedido/pedido-controladoria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aba: activeTab,
          modelo: row.modelo,
          modeloComCor: row.modeloComCor,
          valor: Number(row.pedidoControladoria || 0),
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível salvar a sugestão da Controladoria.');
      }
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao salvar sugestão da Controladoria.');
    } finally {
      setSavingControladoriaKey('');
    }
  };

  const finalForecast = (row: PontoPedidoRow) => {
    const daily = Number(row.vendasMediaDia || 0);
    if (daily <= 0) return { date: '', days: null as number | null };

    const supply =
      Number(row.estoque || 0) +
      Number(row.incoming60 || 0) +
      Number(row.pedidoRufino || 0);
    const days = Math.max(0, supply / daily);
    const date = addDays(data?.today || '', Math.floor(days));
    return { date, days };
  };


  const doubleStockSuggestion = (row: PontoPedidoRow) => {
    if (isBlockedOrderStatus(row.status)) return 0;

    const backendValue = Number(row.sugestaoEstoqueDobrado);
    if (Number.isFinite(backendValue)) {
      return Math.max(0, Math.ceil(backendValue));
    }

    return Math.max(0, Math.ceil(Number(row.vendas60 || 0) * 2));
  };

  const totalVisibleColumns =
    16 +
    (showSales ? 4 : 1) +
    (showFutureWeeks ? 6 : 0) +
    (showForecasts ? 4 : 0);

  const runAiAnalysis = async () => {
    if (!activeTab || aiLoading) return;
    setAiLoading(true);
    setErrorMsg('');

    try {
      let automationSummary = '';
      const normalizedQuestion = aiQuestion
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();

      const shouldAutoPlan =
        aiAction === 'AUTO_PLAN' || normalizedQuestion === 'FAZER PONTO DE PEDIDO';

      if (shouldAutoPlan) {
        const { response: autoResponse, json: autoJson } = await fetchJsonWithTimeout(
          `${API_URL}/api/ponto-pedido/auto-planejar`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria: activeCategory }),
          },
          90000,
        );

        if (!autoResponse.ok || !autoJson?.ok) {
          throw new Error(autoJson?.error || 'Não foi possível preencher automaticamente o ponto de pedido.');
        }

        automationSummary =
          `Ponto de pedido preenchido automaticamente: ${number(autoJson.modelosComPedido)} modelos, ` +
          `${number(autoJson.totalUnidades)} unidades em Sugestão Rufino. ` +
          `${number(Array.isArray(autoJson.transferencias) ? autoJson.transferencias.length : 0)} transferência(s) consideradas.`;

        // Recarrega a aba para refletir imediatamente os valores gravados pelo planejamento automático.
        await loadData(activeTab, false);
      }

      const compactRows = rows.map((row) => ({
        modelo: row.modeloComCor || row.modelo,
        status: row.status,
        pedidoFaturado: row.pedidoFaturado,
        sugestaoEstoqueDobrado: doubleStockSuggestion(row),
        vendas15: row.vendas15,
        vendas30: row.vendas30,
        vendas45: row.vendas45,
        vendas60: row.vendas60,
        estoque: row.estoque,
        pendente: row.pendente,
        backlogTotal: row.backlogTotal,
        semanas: row.weeks,
        vmd: row.vendasMediaDia,
        coberturaDias: row.coberturaAtualDias,
        saldo15: row.previsao15,
        saldo30: row.previsao30,
        saldo45: row.previsao45,
        saldo60: row.previsao60,
        sugestaoFaturarBacklog: row.sugestaoFaturarBacklog,
        sugestao: row.sugestaoNovoPedido,
        pedidoControladoria: row.pedidoControladoria,
        pedidoRufino: row.pedidoRufino,
        sobra: row.sobra,
      }));

      const response = await fetch(`${API_URL}/api/ponto-pedido/analise-ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aba: activeTab,
          categoria: activeCategory,
          escopo: 'REDE',
          pergunta: shouldAutoPlan
            ? 'Explique e audite o ponto de pedido automático que acabou de ser preenchido, incluindo transferências, backlog, riscos e quantidades finais por estado.'
            : aiQuestion,
          rows: compactRows,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível gerar a análise de compras.');
      }

      const report = String(json.answer || '').trim();
      setAiAnswer(automationSummary ? `${automationSummary}\n\n${report}` : report);
      setAiContext((json.context || null) as AiAnalysisContext | null);
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao consultar a IA de compras.');
    } finally {
      setAiLoading(false);
    }
  };

  const exportAiReportExcel = () => {
    if (!aiAnswer.trim()) {
      setErrorMsg('Gere o relatório da IA antes de exportar o Excel.');
      return;
    }

    try {
      const workbook = XLSX.utils.book_new();
      const generatedAt = new Date().toLocaleString('pt-BR');
      const tabLabel = activeTabMeta?.label || activeTab || 'Ponto de Pedido';
      const regionLabel = activeTabMeta?.stateLabel || activeTabMeta?.state || '';
      const statesLabel = aiContext?.statesAnalyzed?.join(', ') || regionLabel || tabLabel;

      const summaryData: (string | number)[][] = [
        ['TELEFLUXO - RELATÓRIO DA IA - PONTO DE PEDIDO'],
        [],
        ['Escopo', aiContext?.escopo === 'REDE' ? 'Rede completa' : 'Aba atual'],
        ['Categoria', activeCategory],
        ['Estados analisados', statesLabel],
        ['Gerado em', generatedAt],
        ['Pergunta utilizada', aiQuestion],
        [],
        ['ANÁLISE DA IA'],
        ...aiAnswer.split(/\r?\n/).map((line) => [line]),
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      summarySheet['!cols'] = [{ wch: 30 }, { wch: 120 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Relatório IA');

      if (aiContext?.stateSummary?.length) {
        const statesSheet = XLSX.utils.json_to_sheet(
          aiContext.stateSummary.map((item) => ({
            Estado: item.estado,
            'Vendas 60': Number(item.vendas60 || 0),
            Estoque: Number(item.estoque || 0),
            Backlog: Number(item.backlog || 0),
            'Sobra > 4 semanas': Number(item.sobra || 0),
            'Faturar backlog': Number(item.faturarBacklog || 0),
            'Novos pedidos': Number(item.novosPedidos || 0),
          })),
        );

        statesSheet['!cols'] = [
          { wch: 24 },
          { wch: 14 },
          { wch: 14 },
          { wch: 14 },
          { wch: 20 },
          { wch: 18 },
          { wch: 18 },
        ];

        XLSX.utils.book_append_sheet(workbook, statesSheet, 'Resumo por Estado');
      }

      if (aiContext?.transferencias?.length) {
        const transferSheet = XLSX.utils.json_to_sheet(
          aiContext.transferencias.map((item) => ({
            Modelo: item.modelo,
            Origem: item.origem,
            Destino: item.destino,
            Quantidade: Number(item.quantidade || 0),
            'Sobra origem antes': Number(item.sobraOrigemAntes || 0),
            'Necessidade destino antes': Number(item.necessidadeDestinoAntes || 0),
          })),
        );

        transferSheet['!cols'] = [
          { wch: 38 },
          { wch: 22 },
          { wch: 22 },
          { wch: 14 },
          { wch: 20 },
          { wch: 24 },
        ];

        XLSX.utils.book_append_sheet(workbook, transferSheet, 'Transferências');
      }

      const safeName = `REDE-${activeCategory}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 70);

      XLSX.writeFile(
        workbook,
        `Ponto_de_Pedido_IA_${safeName || 'TeleFluxo'}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error: any) {
      console.error('Exportação Excel - IA Ponto de Pedido:', error);
      setErrorMsg(error?.message || 'Não foi possível gerar o Excel da análise da IA.');
    }
  };

  const exportSystemSummaryExcel = () => {
    try {
      const workbook = XLSX.utils.book_new();
      const generatedAt = new Date().toLocaleString('pt-BR');
      const tabLabel = activeTabMeta?.label || activeTab || 'Ponto de Pedido';
      const regionLabel = activeTabMeta?.stateLabel || activeTabMeta?.state || '';

      const total = (field: keyof PontoPedidoRow) =>
        rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);

      const summaryData: (string | number)[][] = [
        ['TELEFLUXO - RESUMO DO PONTO DE PEDIDO'],
        [],
        ['Aba', tabLabel],
        ['Região', regionLabel],
        ['Categoria', activeCategory],
        ['Gerado em', generatedAt],
        [],
        ['INDICADORES'],
        ['Vendas 60 dias', total('vendas60')],
        ['Estoque atual', total('estoque')],
        ['Pedido faturado', total('pedidoFaturado')],
        ['Total em backlog', total('backlogTotal')],
        ['Sug. faturar backlog', total('sugestaoFaturarBacklog')],
        ['Sug. novos pedidos', total('sugestaoNovoPedido')],
        ['Pedido Controladoria', total('pedidoControladoria')],
        ['Sugestão Rufino', total('pedidoRufino')],
        ['Sobra > 4 semanas', total('sobra')],
        ['Modelos com sobra > 4 semanas', surplusRows.length],
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      summarySheet['!cols'] = [{ wch: 34 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');

      const actionsData = suggestionRows.map((row) => ({
        'Modelo com cor': row.modeloComCor || row.modelo,
        Status: row.status || '',
        'Vendas 60': Number(row.vendas60 || 0),
        Estoque: Number(row.estoque || 0),
        'Cobertura atual (dias)':
          row.coberturaAtualDias == null ? '' : Number(row.coberturaAtualDias),
        'Pedido faturado': Number(row.pedidoFaturado || 0),
        'Total em backlog': Number(row.backlogTotal || 0),
        'Sug. faturar backlog': Number(row.sugestaoFaturarBacklog || 0),
        'Sug. novos pedidos': Number(row.sugestaoNovoPedido || 0),
        'Sobra > 4 semanas': Number(row.sobra || 0),
        'Pedido Controladoria': Number(row.pedidoControladoria || 0),
        'Sugestão Rufino': Number(row.pedidoRufino || 0),
      }));

      const actionsSheet = XLSX.utils.json_to_sheet(actionsData);
      actionsSheet['!cols'] = [
        { wch: 40 },
        { wch: 20 },
        { wch: 12 },
        { wch: 12 },
        { wch: 22 },
        { wch: 18 },
        { wch: 18 },
        { wch: 22 },
        { wch: 20 },
        { wch: 20 },
        { wch: 22 },
        { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(workbook, actionsSheet, 'Ações do Sistema');

      const surplusData = surplusRows.map((row) => ({
        'Modelo com cor': row.modeloComCor || row.modelo,
        Status: row.status || '',
        'Vendas 60': Number(row.vendas60 || 0),
        Estoque: Number(row.estoque || 0),
        'Cobertura atual (dias)':
          row.coberturaAtualDias == null ? '' : Number(row.coberturaAtualDias),
        'Sobra > 4 semanas': Number(row.sobra || 0),
        Backlog: Number(row.backlogTotal || 0),
        'Pedido faturado': Number(row.pedidoFaturado || 0),
      }));

      const surplusSheet = XLSX.utils.json_to_sheet(surplusData);
      surplusSheet['!cols'] = [
        { wch: 40 },
        { wch: 20 },
        { wch: 12 },
        { wch: 12 },
        { wch: 22 },
        { wch: 20 },
        { wch: 14 },
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(workbook, surplusSheet, 'Sobras 4 semanas');

      if (stateSummaries.length) {
        const stateSheet = XLSX.utils.json_to_sheet(
          stateSummaries.map((item) => ({
            Estado: item.stateLabel || item.state,
            Estoque: Number(item.estoque || 0),
            'Vendas 60': Number(item.vendas60 || 0),
            Backlog: Number(item.backlogTotal || 0),
            'Sobra > 4 semanas': Number(item.sobra || 0),
            'Sug. novos pedidos': Number(item.sugestaoNovosPedidos || 0),
          })),
        );

        stateSheet['!cols'] = [
          { wch: 24 },
          { wch: 14 },
          { wch: 14 },
          { wch: 14 },
          { wch: 20 },
          { wch: 20 },
        ];

        XLSX.utils.book_append_sheet(workbook, stateSheet, 'Sobra por Estado');
      }

      const safeName = `${tabLabel}-${regionLabel || 'rede'}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 70);

      XLSX.writeFile(
        workbook,
        `Resumo_Ponto_de_Pedido_${safeName || 'TeleFluxo'}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error: any) {
      console.error('Exportação Excel - Resumo Ponto de Pedido:', error);
      setErrorMsg(error?.message || 'Não foi possível gerar o Excel do Resumo.');
    }
  };

  const weekParts = (week?: WeekColumn) => {
    if (!week) {
      return {
        title: 'Semana',
        range: '—',
      };
    }

    return {
      title: `Semana ${week.label}`,
      range:
        week.startDate && week.endDate
          ? `${shortDate(week.startDate)} a ${shortDate(week.endDate)}`
          : '—',
    };
  };

  const renderWeekHeaderContent = (week?: WeekColumn) => {
    const info = weekParts(week);

    return (
      <div className="flex flex-col items-center leading-tight">
        <span className="text-[8px] font-black uppercase tracking-[0.12em]">
          {info.title}
        </span>
        <span className="mt-1 text-[7px] font-bold normal-case tracking-normal opacity-70">
          {info.range}
        </span>
      </div>
    );
  };

  const renderPedidoInput = (row: PontoPedidoRow) => {
    const pedidoCompleto =
      Number(row.pedidoRufino || 0) >= Number(row.sugestaoNovoPedido || 0) &&
      Number(row.sugestaoNovoPedido || 0) > 0;

    return (
      <div className="relative">
        <input
          type="number"
          min="0"
          step="1"
          value={Number(row.pedidoRufino || 0)}
          onChange={(event) =>
            updatePedidoRufino(row.rowKey, Number(event.target.value || 0))
          }
          onBlur={() => savePedidoRufino(row)}
          className={`w-full rounded-lg border px-2 py-1.5 text-center text-[11px] font-black outline-none transition focus:ring-2 focus:ring-indigo-300 ${
            pedidoCompleto
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-indigo-200 bg-white text-indigo-800'
          }`}
        />
        {savingRowKey === row.rowKey && (
          <RefreshCw
            size={10}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin text-indigo-500"
          />
        )}
      </div>
    );
  };

  const renderControladoriaInput = (row: PontoPedidoRow) => (
    <div className="relative">
      <input
        type="number"
        min="0"
        step="1"
        value={Number(row.pedidoControladoria || 0)}
        onChange={(event) =>
          updatePedidoControladoria(row.rowKey, Number(event.target.value || 0))
        }
        onBlur={() => savePedidoControladoria(row)}
        className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-center text-[11px] font-black text-violet-800 outline-none transition focus:ring-2 focus:ring-violet-300"
      />
      {savingControladoriaKey === row.rowKey && (
        <RefreshCw
          size={10}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin text-violet-500"
        />
      )}
    </div>
  );

  const normalizedStatus = (value: string) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();

  const statusRowClass = (status: string, index: number) => {
    const normalized = normalizedStatus(status);

    if (normalized.includes('NAO HA COMO PEDIR')) {
      return '[&>td]:!bg-red-50 [&>td]:!border-red-100';
    }
    if (normalized.includes('LANCAMENTO')) {
      return '[&>td]:!bg-emerald-50 [&>td]:!border-emerald-100';
    }
    if (normalized.includes('OBSOLETO')) {
      return '[&>td]:!bg-red-900 [&>td]:!border-red-800 [&>td]:!text-white [&>td_span]:!text-white [&>td_div]:!text-white';
    }

    return index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
  };

  const statusBadge = (status: string) => {
    const normalized = normalizedStatus(status);
    if (!normalized || normalized.includes('EM LINHA')) return null;

    const className = normalized.includes('LANCAMENTO')
      ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
      : normalized.includes('OBSOLETO')
        ? 'border-red-300 bg-red-800 text-white'
        : normalized.includes('NAO HA COMO PEDIR')
          ? 'border-red-200 bg-red-100 text-red-700'
          : 'border-slate-200 bg-slate-100 text-slate-600';

    return (
      <span className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wide ${className}`}>
        {status}
      </span>
    );
  };

  const renderMainTable = () => (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-26px_rgba(15,23,42,0.35)]">
      <div
        ref={topScrollRef}
        onScroll={() => syncHorizontalScroll(topScrollRef.current, tableScrollRef.current)}
        className="h-3 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-slate-50"
        aria-label="Rolagem horizontal superior da tabela"
      >
        <div style={{ width: Math.max(tableScrollWidth, 1), height: 1 }} />
      </div>

      <div
        ref={tableScrollRef}
        onScroll={() => syncHorizontalScroll(tableScrollRef.current, topScrollRef.current)}
        className="max-h-[76vh] overflow-auto"
      >
        <table ref={tableRef} className="min-w-max border-separate border-spacing-0 text-left text-[10px]">
          <thead className="sticky top-0 z-30 bg-slate-100/95 backdrop-blur">
            <tr className="text-[8px] font-black uppercase tracking-[0.10em] text-slate-500">
              <th className="sticky left-0 z-40 w-[260px] min-w-[260px] max-w-[260px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2">
                <ColumnLabel
                  label="Modelo com cor"
                  help="Modelo exatamente como está na planilha de Ponto de Pedido, preservando a variação de cor."
                />
              </th>

              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                <ColumnLabel label="Preço Samsung" help="Preço Samsung informado na aba atual do Google Sheets." />
              </th>

              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                <ColumnLabel label="Preço Telecel" help="Preço Telecel informado na aba atual do Google Sheets." />
              </th>

              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                <ColumnLabel label="Preço final" help="Preço final considerado na planilha para este modelo." />
              </th>

              {showSales ? (
                <>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-100 px-2 py-2 text-center text-blue-800">
                    <ColumnLabel label="Vendas 60" help="Quantidade total vendida deste modelo/cor nos últimos 60 dias. É a principal referência do planejamento." />
                  </th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">
                    <ColumnLabel label="Vendas 45" help="Quantidade vendida nos últimos 45 dias. Usada como tendência complementar." />
                  </th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">
                    <ColumnLabel label="Vendas 30" help="Quantidade vendida nos últimos 30 dias. Usada como tendência complementar." />
                  </th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">
                    <ColumnLabel label="Vendas 15" help="Quantidade vendida nos últimos 15 dias. Ajuda a identificar aceleração ou desaceleração recente." />
                  </th>
                </>
              ) : (
                <th className="min-w-[105px] border-b border-r border-blue-200 bg-blue-100 px-2 py-2 text-center text-blue-800">
                  <ColumnLabel label="Vendas 60d ▸" help="Foco principal do relatório: vendas acumuladas dos últimos 60 dias. Clique em Vendas para abrir 15/30/45/60 dias." />
                </th>
              )}

              <th className="min-w-[88px] border-b border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-slate-700">
                <ColumnLabel label="Estoque" help="Estoque atual encontrado para este modelo/cor na região da aba selecionada." />
              </th>

              <th className="min-w-[104px] border-b border-r border-violet-200 bg-violet-100 px-2 py-2 text-center text-violet-800">
                <ColumnLabel label={<>Total em<br />backlog</>} help="Backlog total considerado no planejamento: pendente/atrasado + semana atual + próximas quatro semanas." />
              </th>

              {showFutureWeeks && (
                <>
                  <th className="min-w-[90px] border-b border-r border-red-100 bg-red-50 px-2 py-2 text-center text-red-700">
                    <ColumnLabel label="Pendente" help="Parte do backlog sem semana válida ou com semana anterior à atual. Já está incluída no Total em backlog." />
                  </th>

                  {(data?.weeks || []).slice(0, 5).map((week) => (
                    <th
                      key={week.key}
                      title="Quantidade de backlog prevista especificamente para esta semana."
                      className="min-w-[165px] border-b border-r border-violet-100 bg-violet-50 px-2 py-2 text-center text-violet-700"
                    >
                      {renderWeekHeaderContent(week)}
                    </th>
                  ))}
                </>
              )}

              <th className="min-w-[92px] border-b border-r border-sky-200 bg-sky-50 px-2 py-2 text-center text-sky-800">
                <ColumnLabel label={<>Pedido<br />faturado</>} help="Quantidade informada na coluna K — PEDIDO FATURADO — da planilha oficial. Representa pedido já faturado." />
              </th>

              <th className="min-w-[110px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                <ColumnLabel label={<>Cobertura<br />atual</>} help="Cobertura calculada somente com o estoque físico atual dividido pela média diária das Vendas 60. Backlog e pedidos futuros não entram nesta conta." />
              </th>

              {showForecasts && (
                <>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                    <ColumnLabel label="Saldo 15d" help="Saldo projetado para 15 dias considerando estoque, demanda e pedidos com chegada dentro do horizonte." />
                  </th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                    <ColumnLabel label="Saldo 30d" help="Saldo projetado para 30 dias considerando estoque, demanda e pedidos com chegada dentro do horizonte." />
                  </th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                    <ColumnLabel label="Saldo 45d" help="Saldo projetado para 45 dias considerando estoque, demanda e pedidos com chegada dentro do horizonte." />
                  </th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                    <ColumnLabel label="Saldo 60d" help="Saldo projetado para 60 dias. Valor negativo indica necessidade de reposição dentro do horizonte." />
                  </th>
                </>
              )}

              <th className="min-w-[126px] border-b border-r border-teal-200 bg-teal-100 px-2 py-2 text-center text-teal-900">
                <ColumnLabel
                  label={<>Sug. estoque<br />dobrado</>}
                  help="Referência gerencial simples: Vendas 60 dias × 2. Fica zerada para itens com status Não há como pedir ou Obsoleto."
                />
              </th>

              <th className="min-w-[110px] border-b border-r border-orange-200 bg-orange-100 px-2 py-2 text-center text-orange-800">
                <ColumnLabel label={<>Sug. faturar<br />backlog</>} help="Quanto do backlog existente deve ser priorizado para faturamento, limitado pela necessidade calculada." />
              </th>

              <th className="min-w-[108px] border-b border-r border-amber-200 bg-amber-100 px-2 py-2 text-center text-amber-900">
                <ColumnLabel label={<>Sug. novos<br />pedidos</>} help="Necessidade adicional após considerar vendas de 60 dias, estoque e total em backlog." />
              </th>

              <th className="min-w-[122px] border-b border-r border-violet-200 bg-violet-600 px-2 py-2 text-center text-white">
                <ColumnLabel label={<>Sug. pedido<br />Controladoria</>} help="Quantidade manual definida pela Controladoria. Campo editável e salvo no sistema." />
              </th>

              <th className="min-w-[102px] border-b border-r border-indigo-200 bg-indigo-600 px-2 py-2 text-center text-white">
                <ColumnLabel label={<>Sugestão<br />Rufino</>} help="Quantidade final sugerida para Rufino. Pode ser preenchida pela IA ou editada manualmente e fica sincronizada com o Resumo dos Pedidos." />
              </th>

              <th className="min-w-[120px] border-b border-r border-slate-200 bg-slate-950 px-2 py-2 text-center text-white">
                <ColumnLabel label={<>Previsão de<br />estoque</>} help="Cobertura estimada após considerar estoque, entradas previstas e Sugestão Rufino." />
              </th>

              <th className="min-w-[110px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                <ColumnLabel label="Sell in" help="Valor de Sell In informado na planilha original." />
              </th>

              <th className="min-w-[105px] border-b border-slate-200 bg-slate-100 px-3 py-2 text-center">
                <ColumnLabel label="Alteração" help="Observação de alteração trazida diretamente da planilha original." />
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={totalVisibleColumns} className="px-4 py-20 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                  {loadingStage}
                </td>
              </tr>
            ) : searchedRows.length === 0 ? (
              <tr>
                <td colSpan={totalVisibleColumns} className="px-4 py-20 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                  Nenhum modelo encontrado nesta aba.
                </td>
              </tr>
            ) : (
              searchedRows.map((row, index) => {
                const forecast = finalForecast(row);
                const coverageDays = row.coberturaAtualDias;
                const rowTone = statusRowClass(row.status, index);
                const estoqueDobrado = doubleStockSuggestion(row);

                return (
                  <tr key={row.rowKey} className={`${rowTone} transition hover:brightness-[0.99]`}>
                    <td className="sticky left-0 z-20 w-[260px] min-w-[260px] max-w-[260px] border-b border-r border-slate-100 px-3 py-2 font-black text-slate-950">
                      <span className="block truncate uppercase tracking-[0.02em]" title={row.modeloComCor}>{row.modeloComCor}</span>
                      {statusBadge(row.status)}
                    </td>

                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-bold text-slate-700">{money(row.precoSamsung)}</td>
                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-bold text-slate-700">{money(row.precoTelecel)}</td>
                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-black text-slate-950">{money(row.precoFinal)}</td>

                    {showSales ? (
                      <>
                        <td className="border-b border-r border-blue-100 bg-blue-100/60 px-2 py-2 text-center font-black text-blue-900">{number(row.vendas60)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas45)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas30)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas15)}</td>
                      </>
                    ) : (
                      <td className="border-b border-r border-blue-100 bg-blue-100/60 px-2 py-2 text-center font-black text-blue-900">{number(row.vendas60)}</td>
                    )}

                    <td className="border-b border-r border-slate-100 px-2 py-2 text-center font-black text-slate-900">{number(row.estoque)}</td>

                    <td className="border-b border-r border-violet-200 bg-violet-100/70 px-2 py-2 text-center font-black text-violet-900">
                      {number(row.backlogTotal)}
                    </td>

                    {showFutureWeeks && (
                      <>
                        <td className={`border-b border-r border-red-100 px-2 py-2 text-center font-black ${row.pendente > 0 ? 'bg-red-100 text-red-700' : 'bg-red-50/20 text-slate-400'}`}>
                          {number(row.pendente)}
                        </td>

                        {(data?.weeks || []).slice(0, 5).map((week) => (
                          <td
                            key={`${row.rowKey}-${week.key}`}
                            className="border-b border-r border-violet-100 bg-violet-50/40 px-2 py-2 text-center font-black text-violet-800"
                          >
                            {number(row.weeks?.[week.key] || 0)}
                          </td>
                        ))}
                      </>
                    )}

                    <td className="border-b border-r border-sky-100 bg-sky-50/60 px-2 py-2 text-center font-black text-sky-900">
                      {number(row.pedidoFaturado)}
                    </td>

                    <td className="border-b border-r border-cyan-100 bg-cyan-50/30 px-2 py-2 text-center">
                      {coverageDays === null ? (
                        <span className="font-black text-slate-400">Sem giro</span>
                      ) : (
                        <div className="leading-tight">
                          <div className="font-black text-slate-900">{number(coverageDays)} dias</div>
                          <div className="mt-0.5 text-[8px] font-bold text-slate-400">até {shortDate(row.coberturaAtualData)}</div>
                        </div>
                      )}
                    </td>

                    {showForecasts && (
                      <>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao15)}`}>{number(row.previsao15)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao30)}`}>{number(row.previsao30)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao45)}`}>{number(row.previsao45)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao60)}`}>{number(row.previsao60)}</td>
                      </>
                    )}

                    <td className={`border-b border-r border-teal-200 px-2 py-2 text-center font-black ${estoqueDobrado > 0 ? 'bg-teal-100 text-teal-900' : 'bg-teal-50/30 text-slate-400'}`}>
                      {number(estoqueDobrado)}
                    </td>

                    <td className={`border-b border-r border-orange-200 px-2 py-2 text-center font-black ${row.sugestaoFaturarBacklog > 0 ? 'bg-orange-100 text-orange-900' : 'bg-orange-50/40 text-slate-400'}`}>
                      {number(row.sugestaoFaturarBacklog)}
                    </td>

                    <td className={`border-b border-r border-amber-200 px-2 py-2 text-center font-black ${row.sugestaoNovoPedido > 0 ? 'bg-amber-100 text-amber-900' : 'bg-amber-50/40 text-slate-400'}`}>
                      {number(row.sugestaoNovoPedido)}
                    </td>

                    <td className="border-b border-r border-violet-100 bg-violet-50 px-1.5 py-1.5">{renderControladoriaInput(row)}</td>
                    <td className="border-b border-r border-indigo-100 bg-indigo-50 px-1.5 py-1.5">{renderPedidoInput(row)}</td>

                    <td className="border-b border-r border-slate-100 bg-slate-950 px-2 py-2 text-center text-white">
                      {forecast.days === null ? (
                        <span className="font-black text-slate-400">Sem giro</span>
                      ) : (
                        <div className="leading-tight">
                          <div className="font-black">{shortDate(forecast.date)}</div>
                          <div className="mt-0.5 text-[8px] font-bold text-slate-400">{number(forecast.days)} dias</div>
                        </div>
                      )}
                    </td>

                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-bold text-slate-700">{money(row.sellIn)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-center font-bold text-slate-500">{row.alteracao || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-bold text-slate-500 lg:flex-row lg:items-center lg:justify-between">
        <span className="text-teal-700">Estoque dobrado = Vendas 60 × 2 para itens que ainda podem ser pedidos.</span>
        <span className="text-amber-700">Novo pedido = V60 - estoque - total em backlog.</span>
      </div>
    </div>
  );

  const renderOrderSummary = () => (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-900">Resumo dos pedidos</h3>
            <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
              Sugestão Rufino e Controladoria são editáveis aqui. A alteração atualiza imediatamente a mesma linha no Planejamento e é salva ao sair do campo.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 text-[8px] font-black uppercase tracking-wide">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{number(manualOrderSummary.modelos)} modelos com pedido</span>
            <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">Controladoria {number(manualOrderSummary.controladoria)}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Rufino {number(manualOrderSummary.rufino)}</span>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-[10px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[8px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-2 py-2 text-center">Vendas 60</th>
                <th className="px-2 py-2 text-center">Estoque</th>
                <th className="px-2 py-2 text-center">Backlog</th>
                <th className="px-2 py-2 text-center">Sug. faturar backlog</th>
                <th className="px-2 py-2 text-center">Sug. novo pedido</th>
                <th className="px-2 py-2 text-center">Controladoria</th>
                <th className="px-2 py-2 text-center">Sugestão Rufino</th>
                <th className="px-2 py-2 text-center">Previsão</th>
              </tr>
            </thead>
            <tbody>
              {orderedRows.length ? (
                orderedRows.map((row, index) => {
                  const forecast = finalForecast(row);
                  return (
                    <tr key={`summary-${row.rowKey}`} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="border-t border-slate-100 px-3 py-2 font-black uppercase text-slate-900">{row.modeloComCor}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas60)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold">{number(row.estoque)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold text-violet-800">{number(row.backlogTotal)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-orange-800">{number(row.sugestaoFaturarBacklog)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-amber-800">{number(row.sugestaoNovoPedido)}</td>
                      <td className="border-t border-slate-100 px-2 py-1.5">{renderControladoriaInput(row)}</td>
                      <td className="border-t border-slate-100 px-2 py-1.5">{renderPedidoInput(row)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold text-slate-700">
                        {forecast.days === null ? 'Sem giro' : `${number(forecast.days)} dias · ${shortDate(forecast.date)}`}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                    Nenhuma sugestão ou ajuste manual nesta aba.
                  </td>
                </tr>
              )}
            </tbody>
            {orderedRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-slate-300 bg-slate-950 text-white">
                <tr>
                  <td className="px-3 py-2.5 text-left font-black uppercase tracking-wide">
                    Total geral · {number(orderSummary.modelos)} modelos
                  </td>
                  <td className="px-2 py-2.5 text-center font-black">{number(orderSummary.vendas60)}</td>
                  <td className="px-2 py-2.5 text-center font-black">{number(orderSummary.estoque)}</td>
                  <td className="px-2 py-2.5 text-center font-black text-violet-200">{number(orderSummary.backlog)}</td>
                  <td className="px-2 py-2.5 text-center font-black text-orange-200">{number(orderSummary.faturarBacklog)}</td>
                  <td className="px-2 py-2.5 text-center font-black text-amber-200">{number(orderSummary.sugestao)}</td>
                  <td className="px-2 py-2.5 text-center font-black text-violet-200">{number(orderSummary.controladoria)}</td>
                  <td className="px-2 py-2.5 text-center font-black text-emerald-300">{number(orderSummary.rufino)}</td>
                  <td className="px-2 py-2.5 text-center text-[8px] font-bold text-slate-400">TOTAL DA ABA</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );

  const renderSystemSummary = () => (
    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-3 py-2.5">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-amber-700">Resumo</p>
          <h3 className="mt-0.5 text-[12px] font-black text-slate-900">
            Sugestões do sistema e sobras acima de 4 semanas
          </h3>
          <p className="mt-0.5 text-[9px] font-semibold text-slate-500">
            “Sobra” significa estoque físico acima de quatro semanas de cobertura. Backlog não entra nesse cálculo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-amber-800 shadow-sm">
            {number(suggestionRows.length)} modelos
          </span>

          <button
            type="button"
            onClick={exportSystemSummaryExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-[8px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-emerald-700"
          >
            <FileSpreadsheet size={12} />
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1160px] border-collapse text-[10px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[8px] font-black uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Modelo</th>
              <th className="px-2 py-2 text-center">Vendas 60</th>
              <th className="px-2 py-2 text-center">Estoque</th>
              <th className="px-2 py-2 text-center">Cobertura</th>
              <th className="px-2 py-2 text-center">Total backlog</th>
              <th className="px-2 py-2 text-center">Faturar backlog</th>
              <th className="px-2 py-2 text-center">Novo pedido</th>
              <th className="px-2 py-2 text-center">Sobra &gt; 4 semanas</th>
            </tr>
          </thead>

          <tbody>
            {suggestionRows.length ? (
              suggestionRows.map((row, index) => (
                <tr
                  key={`system-${row.rowKey}`}
                  className={index % 2 === 0 ? 'bg-white' : 'bg-amber-50/20'}
                >
                  <td className="border-t border-slate-100 px-3 py-2 font-black uppercase text-slate-900">
                    {row.modeloComCor}
                  </td>

                  <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-blue-800">
                    {number(row.vendas60)}
                  </td>

                  <td className="border-t border-slate-100 px-2 py-2 text-center font-bold">
                    {number(row.estoque)}
                  </td>

                  <td className="border-t border-slate-100 px-2 py-2 text-center font-bold text-cyan-800">
                    {row.coberturaAtualDias == null
                      ? 'Sem giro'
                      : `${number(row.coberturaAtualDias)} dias`}
                  </td>

                  <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-violet-800">
                    {number(row.backlogTotal)}
                  </td>

                  <td className="border-t border-slate-100 bg-orange-50 px-2 py-2 text-center font-black text-orange-900">
                    {number(row.sugestaoFaturarBacklog)}
                  </td>

                  <td className="border-t border-slate-100 bg-amber-50 px-2 py-2 text-center font-black text-amber-900">
                    {number(row.sugestaoNovoPedido)}
                  </td>

                  <td
                    className={`border-t border-slate-100 px-2 py-2 text-center font-black ${
                      Number(row.sobra || 0) > 0
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-slate-400'
                    }`}
                    title="Unidades do estoque físico que excedem quatro semanas de cobertura calculadas pelas vendas de 60 dias."
                  >
                    {number(row.sobra)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400"
                >
                  Nenhuma sugestão de compra ou sobra acima de quatro semanas nesta aba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSurplusByState = () => {
    const orderedStates = [...stateSummaries].sort((a, b) => Number(b.sobra || 0) - Number(a.sobra || 0));

    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-700">Resumo regional</p>
              <h3 className="mt-0.5 text-[12px] font-black text-slate-900">Sobras por estado</h3>
              <p className="mt-0.5 text-[9px] font-semibold text-slate-500">
                Mostra, por região, o volume de aparelhos com sobra acima de 4 semanas. Clique em um estado para abrir a aba correspondente.
              </p>
            </div>

            <button
              type="button"
              onClick={() => loadStateSummaries(activeCategory, true)}
              disabled={stateSummaryLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[8px] font-black uppercase tracking-wide text-slate-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40"
            >
              <RefreshCw size={12} className={stateSummaryLoading ? 'animate-spin' : ''} />
              Atualizar resumo
            </button>
          </div>

          <div className="border-b border-slate-100 px-3 py-3">
            <div className="flex flex-wrap gap-2">
              {orderedStates.length ? orderedStates.map((item) => (
                <button
                  key={`surplus-chip-${item.category}-${item.state}-${item.id}`}
                  type="button"
                  onClick={() => {
                    handleTabChange(item.id);
                    setPageMode('planejamento');
                  }}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    item.id === activeTab
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50'
                  }`}
                >
                  <div className="text-[8px] font-black uppercase tracking-wide text-slate-400">{item.label}</div>
                  <div className="mt-1 text-[11px] font-black">{item.stateLabel || item.state}</div>
                  <div className="mt-1 text-[11px] font-black text-emerald-700">+{number(item.sobra)} sobra</div>
                </button>
              )) : (
                <span className="text-[9px] font-bold text-slate-400">Sem sobras regionais para exibir.</span>
              )}
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[920px] border-collapse text-[10px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[8px] font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-2 py-2 text-center">Vendas 60</th>
                  <th className="px-2 py-2 text-center">Estoque</th>
                  <th className="px-2 py-2 text-center">Total backlog</th>
                  <th className="px-2 py-2 text-center">Sug. novos pedidos</th>
                  <th className="px-2 py-2 text-center">Sobra &gt; 4 semanas</th>
                  <th className="px-2 py-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {stateSummaryLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                      Calculando sobras por estado...
                    </td>
                  </tr>
                ) : orderedStates.length ? (
                  orderedStates.map((item, index) => (
                    <tr key={`surplus-row-${item.id}`} className={index % 2 === 0 ? 'bg-white' : 'bg-emerald-50/20'}>
                      <td className="border-t border-slate-100 px-3 py-2">
                        <div className="font-black uppercase text-slate-900">{item.stateLabel || item.state}</div>
                        <div className="text-[8px] font-bold uppercase text-slate-400">{item.label}</div>
                      </td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-blue-800">{number(item.vendas60)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold">{number(item.estoque)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-violet-800">{number(item.backlogTotal)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-amber-900">{number(item.sugestaoNovosPedidos)}</td>
                      <td className="border-t border-slate-100 bg-emerald-50 px-2 py-2 text-center font-black text-emerald-800">{number(item.sobra)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            handleTabChange(item.id);
                            setPageMode('planejamento');
                          }}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wide text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700"
                        >
                          Abrir estado
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                      Nenhuma sobra acima de 4 semanas foi encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderReadyOrders = () => (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-400">Histórico operacional</p>
            <h3 className="mt-0.5 text-base font-black text-slate-950">Pedidos prontos</h3>
            <p className="mt-1 max-w-3xl text-[10px] font-semibold leading-5 text-slate-500">
              Cada finalização salva uma fotografia do ponto de pedido da categoria. Em “Editar”, o sistema restaura as quantidades salvas para o Planejamento, onde você pode ajustar e finalizar novamente.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadReadyOrders(activeCategory)}
            disabled={readyOrdersLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-wide text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-40"
          >
            <RefreshCw size={13} className={readyOrdersLoading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {readyOrdersLoading ? (
        <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-400">
          <RefreshCw size={15} className="animate-spin" />
          Carregando pedidos prontos...
        </div>
      ) : readyOrders.length ? (
        <div className="grid gap-2 xl:grid-cols-2">
          {readyOrders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Archive size={15} className="shrink-0 text-indigo-600" />
                    <h4 className="truncate text-sm font-black text-slate-950" title={order.nome}>{order.nome}</h4>
                  </div>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    {order.categoria} · {new Date(order.criadoEm).toLocaleString('pt-BR')}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-black uppercase text-emerald-700">
                  Finalizado
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[7px] font-black uppercase tracking-wide text-slate-400">Modelos pedidos</p>
                  <p className="mt-1 text-lg font-black text-slate-950">{number(order.totalModelos)}</p>
                </div>
                <div className="rounded-xl bg-indigo-50 px-3 py-2">
                  <p className="text-[7px] font-black uppercase tracking-wide text-indigo-400">Unidades</p>
                  <p className="mt-1 text-lg font-black text-indigo-900">{number(order.totalUnidades)}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => editReadyOrder(order)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[8px] font-black uppercase tracking-wide text-indigo-700 transition hover:bg-indigo-100"
                >
                  <Pencil size={12} />
                  Editar
                </button>

                <button
                  type="button"
                  onClick={() => deleteReadyOrder(order)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[8px] font-black uppercase tracking-wide text-red-700 transition hover:bg-red-100"
                >
                  <Trash2 size={12} />
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center">
          <Archive size={28} className="text-slate-300" />
          <h4 className="mt-3 text-sm font-black text-slate-700">Nenhum pedido finalizado</h4>
          <p className="mt-1 max-w-xl text-[10px] font-semibold leading-5 text-slate-400">
            Quando o usuário clicar em “Finalizar ponto de pedido”, a fotografia completa do pedido ficará armazenada aqui.
          </p>
        </div>
      )}
    </div>
  );

  const renderAiPanel = () => {
    const quickQuestions: Array<{ label: string; prompt: string; action: AiAction }> = [
      {
        label: 'Fazer ponto de pedido',
        prompt: 'Fazer ponto de pedido',
        action: 'AUTO_PLAN',
      },
      {
        label: 'Planejar transferências',
        prompt: 'Monte um plano de transferências entre os estados. Use apenas sobras acima de 4 semanas, procure o mesmo modelo/cor em estados com necessidade e diga origem, destino, quantidade e quanto de compra nova pode ser evitado.',
        action: '',
      },
      {
        label: 'Faturar backlog e novos pedidos',
        prompt: 'Monte o plano completo de faturamento de backlog e novos pedidos da rede. Considere Vendas 60, estoque atual, pedido faturado, backlog e transferências; nunca recomende itens Não há como pedir ou Obsoletos.',
        action: '',
      },
      {
        label: 'Auditar sugestões atuais',
        prompt: 'Audite Sistema x Controladoria x Sugestão Rufino em todos os estados. Diga objetivamente o que deve aumentar, reduzir, manter ou zerar e explique as maiores divergências.',
        action: '',
      },
      {
        label: 'Revisão executiva final',
        prompt: 'Faça a revisão executiva final da rede: riscos de ruptura, sobras acima de 4 semanas, transferências possíveis, lançamentos, pedidos excessivos e pedido final recomendado. Itens bloqueados/obsoletos devem aparecer somente como alerta, nunca como sugestão de compra.',
        action: '',
      },
    ];
    return (
      <div className="grid gap-3 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-950 to-slate-950 p-4 text-white shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <BrainCircuit size={18} />
            </div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-300">Inteligência de compra</p>
              <h3 className="mt-1 text-lg font-black">Assistente de Ponto de Pedido</h3>
              <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-300">
                A IA analisa a rede inteira, cruza todos os estados e procura transferências de sobras antes de recomendar novas compras.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[7px] font-black uppercase tracking-[0.16em] text-violet-300">
              Ações principais
            </p>

            <div className="grid gap-2">
              {quickQuestions.map((question, index) => (
                <button
                  key={question.label}
                  type="button"
                  onClick={() => {
                    setAiQuestion(question.prompt);
                    setAiAction(question.action);
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left text-[9px] font-bold leading-4 transition ${
                    index === 0
                      ? 'border-violet-400/50 bg-violet-500/20 text-white hover:bg-violet-500/30'
                      : 'border-white/10 bg-white/5 text-slate-200 hover:border-violet-400/40 hover:bg-white/10'
                  }`}
                >
                  <span className="mr-2 text-violet-300">{String(index + 1).padStart(2, '0')}</span>
                  {question.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[9px] font-semibold leading-5 text-slate-300">
            Escopo padrão: <strong className="text-white">todos os estados da categoria</strong>. O foco é Vendas 60,
            estoque, pedido faturado, backlog, sobra acima de 4 semanas e redistribuição entre estados.
            <br />
            <span className="text-violet-200">
              Itens “Não há como pedir” e “Obsoletos” nunca entram em recomendação de compra.
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-violet-600" />
              <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-900">Análise da IA</h3>
            </div>

            {aiAnswer && (
              <button
                type="button"
                onClick={exportAiReportExcel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[8px] font-black uppercase tracking-wide text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
              >
                <FileSpreadsheet size={12} />
                Exportar Excel
              </button>
            )}
          </div>

          {aiContext?.statesAnalyzed?.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[8px] font-black uppercase tracking-wide text-slate-400">
                Estados analisados
              </span>
              {aiContext.statesAnalyzed.map((state) => (
                <span
                  key={state}
                  className="rounded-full border border-violet-100 bg-violet-50 px-2 py-1 text-[8px] font-black text-violet-700"
                >
                  {state}
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            value={aiQuestion}
            onChange={(event) => {
              setAiQuestion(event.target.value);
              setAiAction('');
            }}
            rows={3}
            placeholder="Escreva o que deseja analisar..."
            className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-violet-400 focus:bg-white"
          />

          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={runAiAnalysis}
              disabled={aiLoading || !aiQuestion.trim() || !rows.length}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-[9px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-40"
            >
              {aiLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
              Gerar relatório
            </button>
          </div>

          <div className="mt-3 min-h-[320px] rounded-xl border border-slate-200 bg-slate-50 p-3">
            {aiLoading ? (
              <div className="flex min-h-[280px] items-center justify-center gap-2 text-xs font-bold text-slate-400">
                <RefreshCw size={15} className="animate-spin" />
                Analisando vendas, estoque, pedido faturado, backlog e pedidos...
              </div>
            ) : aiAnswer ? (
              <div className="whitespace-pre-wrap text-[11px] font-semibold leading-6 text-slate-700">{aiAnswer}</div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center px-8 text-center text-[11px] font-semibold leading-5 text-slate-400">
                Use “Gerar relatório completo” para receber uma recomendação pronta ou escolha uma das análises específicas ao lado.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f5f7fb]">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Package size={18} />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-slate-950 md:text-2xl">
                Ponto de Pedido
              </h2>              
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 xl:w-[310px] xl:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar modelo ou cor..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white"
              />
            </div>


            <button
              type="button"
              onClick={finalizePointOrder}
              disabled={finalizing || loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-50"
              title="Salva uma fotografia completa do ponto de pedido atual da categoria em Pedidos prontos."
            >
              {finalizing ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Finalizar ponto de pedido
            </button>

          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 md:px-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">Categorias</span>
            <div className="flex gap-1">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => handleCategoryChange(category)}
                  className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-[9px] font-black uppercase tracking-wide transition ${
                    activeCategory === category
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">Estados</span>
            <div className="flex gap-1">
              {stateTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex min-w-[82px] flex-col rounded-xl px-3 py-1.5 text-left transition ${
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="text-[10px] font-black uppercase">{tab.stateLabel || tab.state}</span>
                  <span className={`mt-0.5 max-w-[150px] truncate text-[7px] font-bold uppercase ${activeTab === tab.id ? 'text-indigo-100' : 'text-slate-400'}`}>
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
        {errorMsg && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {errorMsg}
          </div>
        )}

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <ModeButton active={pageMode === 'planejamento'} onClick={() => setPageMode('planejamento')} icon={Package}>
            Planejamento
          </ModeButton>
          <ModeButton active={pageMode === 'sugestoes'} onClick={() => setPageMode('sugestoes')} icon={TrendingUp}>
            Resumo
          </ModeButton>
          <ModeButton active={pageMode === 'resumo'} onClick={() => setPageMode('resumo')} icon={BarChart3}>
            Resumo dos pedidos
          </ModeButton>
          <ModeButton active={pageMode === 'sobras'} onClick={() => setPageMode('sobras')} icon={TrendingUp}>
            Sobras por estado
          </ModeButton>
          <ModeButton active={pageMode === 'ia'} onClick={() => setPageMode('ia')} icon={BrainCircuit}>
            Assistente IA
          </ModeButton>
          <ModeButton active={pageMode === 'prontos'} onClick={() => setPageMode('prontos')} icon={Archive}>
            Pedidos prontos
          </ModeButton>
        </div>


        {pageMode === 'planejamento' && (
          <>
            <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                    <Clock3 size={14} />
                  </div>
                  <div className="leading-tight">
                    <p className="text-[7px] font-black uppercase tracking-[0.14em] text-slate-400">Semana atual</p>
                    <p className="text-[10px] font-black text-slate-900">{weekParts(data?.weeks?.[0]).title}</p>
                    <p className="text-[8px] font-bold text-slate-400">{weekParts(data?.weeks?.[0]).range}</p>
                  </div>
                </div>

                {data?.loadedAt && (
                  <div className="leading-tight">
                    <p className="text-[7px] font-black uppercase tracking-[0.14em] text-slate-400">Atualizado</p>
                    <p className="mt-0.5 text-[9px] font-black text-slate-700">
                      {new Date(data.loadedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <GroupButton
                  open={showSales}
                  onClick={() => setShowSales((value) => !value)}
                  help="Abre ou recolhe o detalhamento de vendas em 15, 30, 45 e 60 dias."
                >
                  Vendas
                </GroupButton>

                <GroupButton
                  open={showFutureWeeks}
                  onClick={() => setShowFutureWeeks((value) => !value)}
                  help="Abre ou recolhe Pendente, semana atual e as próximas quatro semanas do backlog."
                >
                  Semanas backlog
                </GroupButton>

                <GroupButton
                  open={showForecasts}
                  onClick={() => setShowForecasts((value) => !value)}
                  help="Abre ou recolhe os saldos projetados de 15, 30, 45 e 60 dias."
                >
                  Saldos
                </GroupButton>


                <button
                  type="button"
                  onClick={() => setHideBlockedRows((value) => !value)}
                  title="Oculta ou mostra os itens com status Obsoleto e Não há como pedir."
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[8px] font-black uppercase tracking-wide shadow-sm transition ${
                    hideBlockedRows
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300'
                  }`}
                >
                  <EyeOff size={11} />
                  Obsoletos / Fora pedido
                </button>
              </div>
            </div>

            {renderMainTable()}
          </>
        )}

        {pageMode === 'sugestoes' && renderSystemSummary()}
        {pageMode === 'resumo' && renderOrderSummary()}
        {pageMode === 'sobras' && renderSurplusByState()}
        {pageMode === 'ia' && renderAiPanel()}
        {pageMode === 'prontos' && renderReadyOrders()}
      </div>
    </div>
  );
}
