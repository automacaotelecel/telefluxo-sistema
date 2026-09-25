import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  ExternalLink,
  Package,
  PackageX,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

type SheetTab = {
  id: string;
  label: string;
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
  vendas60: number;
  vendas45: number;
  vendas30: number;
  vendas15: number;
  estoque: number;
  pendente: number;
  weeks: Record<string, number>;
  vendasMediaDia: number;
  coberturaAtualDias: number | null;
  coberturaAtualData: string;
  previsao15: number;
  previsao30: number;
  previsao45: number;
  previsao60: number;
  incoming60: number;
  sugestaoPedido: number;
  pedidoRufino: number;
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
    sugestao: number;
    pedidoRufino: number;
  };
  formula?: {
    vmd?: string;
    suggestion?: string;
    pending?: string;
  };
  rows: PontoPedidoRow[];
};

type PageMode = 'planejamento' | 'resumo' | 'ia';

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

function GroupButton({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
    >
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      {children}
    </button>
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

function CompactSummaryCard({
  label,
  value,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: 'slate' | 'blue' | 'red' | 'amber' | 'emerald' | 'violet';
}) {
  const classes = {
    slate: 'border-slate-200 bg-white text-slate-950',
    blue: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white text-blue-900',
    red: 'border-red-200 bg-gradient-to-br from-red-50 to-white text-red-800',
    amber: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-900',
    emerald: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-900',
    violet: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white text-violet-900',
  }[tone];

  return (
    <div
      className={`rounded-2xl border px-3 py-2.5 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)] ${classes}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[8px] font-black uppercase tracking-[0.14em] opacity-60">
          {label}
        </span>
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/70 shadow-sm">
          <Icon size={12} className="shrink-0 opacity-80" />
        </div>
      </div>
      <p className="mt-1 text-[20px] font-black leading-none">{value}</p>
    </div>
  );
}

export function EstoqueVendas() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [pageMode, setPageMode] = useState<PageMode>('planejamento');
  const [data, setData] = useState<PontoPedidoResponse | null>(null);
  const [rows, setRows] = useState<PontoPedidoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('Lendo abas do Google Sheets...');
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSales, setShowSales] = useState(false);
  const [showFutureWeeks, setShowFutureWeeks] = useState(false);
  const [showForecasts, setShowForecasts] = useState(false);
  const [showBaseModel, setShowBaseModel] = useState(false);
  const [showNoStock, setShowNoStock] = useState(false);
  const [restoredNoStockKeys, setRestoredNoStockKeys] = useState<Set<string>>(() => new Set());
  const [savingRowKey, setSavingRowKey] = useState('');
  const [aiQuestion, setAiQuestion] = useState(
    'Analise o ponto de pedido e me diga onde devo comprar mais, reduzir ou manter o pedido.',
  );
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

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
    } catch (error: any) {
      console.error('Ponto de Pedido:', error);
      setErrorMsg(error?.message || 'Falha ao carregar dados.');
      setData(null);
      setRows([]);
    } finally {
      setLoading(false);
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
  }, [loadData, loadMeta]);

  const handleTabChange = (tab: string) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSearchTerm('');
    setShowNoStock(false);
    setRestoredNoStockKeys(new Set());
    loadData(tab, false);
  };

  const handleRefresh = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const nextTabs = await loadMeta(true);
      const target =
        (activeTab && nextTabs.some((tab: SheetTab) => tab.id === activeTab)
          ? activeTab
          : nextTabs[0]?.id) || '';

      if (!target) {
        throw new Error('Nenhuma aba disponível após atualizar o Google Sheets.');
      }

      setActiveTab(target);
      // loadMeta(true) já atualizou o workbook no backend.
      // Aqui usamos o cache recém-carregado para não baixar a planilha inteira duas vezes.
      await loadData(target, false);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Falha ao atualizar o Google Sheets.');
    } finally {
      setLoading(false);
    }
  };

  const searchedRows = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    if (!term) return rows;

    return rows.filter((row) =>
      `${row.modelo} ${row.modeloComCor}`.toUpperCase().includes(term),
    );
  }, [rows, searchTerm]);

  const availableRows = useMemo(
    () =>
      searchedRows.filter(
        (row) =>
          Number(row.estoque || 0) > 0 ||
          restoredNoStockKeys.has(row.rowKey),
      ),
    [searchedRows, restoredNoStockKeys],
  );

  const noStockRows = useMemo(
    () =>
      searchedRows.filter(
        (row) =>
          Number(row.estoque || 0) <= 0 &&
          !restoredNoStockKeys.has(row.rowKey),
      ),
    [searchedRows, restoredNoStockKeys],
  );

  const restoreNoStockRow = (rowKey: string) => {
    setRestoredNoStockKeys((current) => {
      const next = new Set(current);
      next.add(rowKey);
      return next;
    });
  };

  const liveSummary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.modelos += 1;
        acc.estoque += Number(row.estoque || 0);
        acc.pendente += Number(row.pendente || 0);
        acc.sugestao += Number(row.sugestaoPedido || 0);
        acc.pedidoRufino += Number(row.pedidoRufino || 0);
        if (Number(row.estoque || 0) <= 0) acc.semEstoque += 1;
        return acc;
      },
      {
        modelos: 0,
        estoque: 0,
        pendente: 0,
        sugestao: 0,
        pedidoRufino: 0,
        semEstoque: 0,
      },
    );
  }, [rows]);

  const orderedRows = useMemo(
    () =>
      rows
        .filter((row) => Number(row.pedidoRufino || 0) > 0)
        .sort(
          (a, b) =>
            Number(b.pedidoRufino || 0) - Number(a.pedidoRufino || 0) ||
            Number(b.sugestaoPedido || 0) - Number(a.sugestaoPedido || 0),
        ),
    [rows],
  );

  const orderSummary = useMemo(() => {
    return orderedRows.reduce(
      (acc, row) => {
        const pedido = Number(row.pedidoRufino || 0);
        const sugestao = Number(row.sugestaoPedido || 0);
        acc.modelos += 1;
        acc.unidades += pedido;
        acc.sugestao += sugestao;
        if (pedido < sugestao) acc.abaixo += 1;
        if (pedido > sugestao) acc.acima += 1;
        if (Math.abs(pedido - sugestao) < 0.0001) acc.alinhados += 1;
        return acc;
      },
      { modelos: 0, unidades: 0, sugestao: 0, abaixo: 0, acima: 0, alinhados: 0 },
    );
  }, [orderedRows]);

  const updatePedidoRufino = (rowKey: string, value: number) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setRows((current) =>
      current.map((row) =>
        row.rowKey === rowKey ? { ...row, pedidoRufino: safeValue } : row,
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

  const futureWeekTotal = (row: PontoPedidoRow) =>
    (data?.weeks || [])
      .slice(1, 5)
      .reduce((sum, week) => sum + Number(row.weeks?.[week.key] || 0), 0);

  const totalVisibleColumns =
    (showBaseModel ? 1 : 0) +
    1 +
    3 +
    (showSales ? 4 : 1) +
    1 +
    1 +
    1 +
    (showFutureWeeks ? 4 : 1) +
    1 +
    (showForecasts ? 4 : 1) +
    3 +
    2;

  const runAiAnalysis = async () => {
    if (!activeTab || aiLoading) return;
    setAiLoading(true);
    setErrorMsg('');

    try {
      const compactRows = rows.map((row) => ({
        modelo: row.modeloComCor || row.modelo,
        vendas15: row.vendas15,
        vendas30: row.vendas30,
        vendas45: row.vendas45,
        vendas60: row.vendas60,
        estoque: row.estoque,
        pendente: row.pendente,
        semanas: row.weeks,
        vmd: row.vendasMediaDia,
        coberturaDias: row.coberturaAtualDias,
        saldo15: row.previsao15,
        saldo30: row.previsao30,
        saldo45: row.previsao45,
        saldo60: row.previsao60,
        sugestao: row.sugestaoPedido,
        pedidoRufino: row.pedidoRufino,
      }));

      const response = await fetch(`${API_URL}/api/ponto-pedido/analise-ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aba: activeTab,
          pergunta: aiQuestion,
          rows: compactRows,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Não foi possível gerar a análise de compras.');
      }

      setAiAnswer(String(json.answer || '').trim());
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error?.message || 'Falha ao consultar a IA de compras.');
    } finally {
      setAiLoading(false);
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
      Number(row.pedidoRufino || 0) >= Number(row.sugestaoPedido || 0) &&
      Number(row.sugestaoPedido || 0) > 0;

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

  const renderMainTable = () => (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-26px_rgba(15,23,42,0.35)]">
      <div className="max-h-[72vh] overflow-auto">
        <table className="min-w-max border-separate border-spacing-0 text-left text-[10px]">
          <thead className="sticky top-0 z-30 bg-slate-100/95 backdrop-blur">
            <tr className="text-[8px] font-black uppercase tracking-[0.10em] text-slate-500">
              {showBaseModel && (
                <th className="sticky left-0 z-40 w-[180px] min-w-[180px] max-w-[180px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2">
                  Modelo
                </th>
              )}
              <th
                className={`sticky z-40 w-[260px] min-w-[260px] max-w-[260px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 ${
                  showBaseModel ? 'left-[180px]' : 'left-0'
                }`}
              >
                Modelo com cor
              </th>
              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                Preço Samsung
              </th>
              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                Preço Telecel
              </th>
              <th className="min-w-[118px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                Preço final
              </th>

              {showSales ? (
                <>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">Vendas 60</th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">Vendas 45</th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">Vendas 30</th>
                  <th className="min-w-[84px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">Vendas 15</th>
                </>
              ) : (
                <th className="min-w-[100px] border-b border-r border-blue-100 bg-blue-50 px-2 py-2 text-center text-blue-700">
                  Vendas 30d <span className="text-[7px] text-blue-400">▸</span>
                </th>
              )}

              <th className="min-w-[88px] border-b border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-slate-700">
                Estoque
              </th>
              <th className="min-w-[90px] border-b border-r border-red-100 bg-red-50 px-2 py-2 text-center text-red-700">
                Pendente
              </th>
              <th className="min-w-[165px] border-b border-r border-violet-100 bg-violet-50 px-2 py-2 text-center text-violet-700">
                {renderWeekHeaderContent(data?.weeks?.[0])}
              </th>

              {showFutureWeeks ? (
                (data?.weeks || []).slice(1, 5).map((week) => (
                  <th
                    key={week.key}
                    className="min-w-[165px] border-b border-r border-violet-100 bg-violet-50 px-2 py-2 text-center text-violet-700"
                  >
                    {renderWeekHeaderContent(week)}
                  </th>
                ))
              ) : (
                <th className="min-w-[104px] border-b border-r border-violet-100 bg-violet-50 px-2 py-2 text-center text-violet-700">
                  Próx. 4 sem. <span className="text-[7px] text-violet-400">▸</span>
                </th>
              )}

              <th className="min-w-[130px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                Cobertura atual
              </th>

              {showForecasts ? (
                <>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">Saldo 15d</th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">Saldo 30d</th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">Saldo 45d</th>
                  <th className="min-w-[88px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">Saldo 60d</th>
                </>
              ) : (
                <th className="min-w-[95px] border-b border-r border-cyan-100 bg-cyan-50 px-2 py-2 text-center text-cyan-700">
                  Saldo 60d <span className="text-[7px] text-cyan-400">▸</span>
                </th>
              )}

              <th className="min-w-[118px] border-b border-r border-amber-200 bg-amber-100 px-2 py-2 text-center text-amber-800">
                Sugestão pedido
              </th>
              <th className="min-w-[122px] border-b border-r border-indigo-200 bg-indigo-600 px-2 py-2 text-center text-white">
                Pedido Rufino
              </th>
              <th className="min-w-[150px] border-b border-r border-slate-200 bg-slate-950 px-2 py-2 text-center text-white">
                Previsão de estoque
              </th>
              <th className="min-w-[110px] border-b border-r border-emerald-100 bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                Sell in
              </th>
              <th className="min-w-[105px] border-b border-slate-200 bg-slate-100 px-3 py-2 text-center">
                Alteração
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
            ) : availableRows.length === 0 ? (
              <tr>
                <td colSpan={totalVisibleColumns} className="px-4 py-20 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                  Nenhum modelo com estoque encontrado nesta aba.
                </td>
              </tr>
            ) : (
              availableRows.map((row, index) => {
                const forecast = finalForecast(row);
                const currentWeek = data?.weeks?.[0];
                const currentWeekQty = currentWeek
                  ? Number(row.weeks?.[currentWeek.key] || 0)
                  : 0;
                const coverageDays = row.coberturaAtualDias;

                return (
                  <tr
                    key={row.rowKey}
                    className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} transition-colors hover:bg-indigo-50/50`}
                  >
                    {showBaseModel && (
                      <td className={`sticky left-0 z-20 w-[180px] min-w-[180px] max-w-[180px] border-b border-r border-slate-100 px-3 py-2 font-black text-slate-700 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                        <span className="block truncate uppercase tracking-[0.02em]" title={row.modelo}>{row.modelo}</span>
                      </td>
                    )}
                    <td className={`sticky z-20 w-[260px] min-w-[260px] max-w-[260px] border-b border-r border-slate-100 px-3 py-2 font-black text-slate-950 ${showBaseModel ? 'left-[180px]' : 'left-0'} ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="block min-w-0 flex-1 truncate uppercase tracking-[0.02em]" title={row.modeloComCor}>
                          {row.modeloComCor}
                        </span>
                        {Number(row.estoque || 0) <= 0 && restoredNoStockKeys.has(row.rowKey) && (
                          <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[6px] font-black uppercase tracking-wide text-orange-700">
                            Sem estoque
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-bold text-slate-700">{money(row.precoSamsung)}</td>
                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-bold text-slate-700">{money(row.precoTelecel)}</td>
                    <td className="border-b border-r border-emerald-50 bg-emerald-50/30 px-3 py-2 text-right font-black text-slate-950">{money(row.precoFinal)}</td>

                    {showSales ? (
                      <>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas60)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas45)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas30)}</td>
                        <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas15)}</td>
                      </>
                    ) : (
                      <td className="border-b border-r border-blue-50 bg-blue-50/20 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas30)}</td>
                    )}

                    <td className="border-b border-r border-slate-100 px-2 py-2 text-center font-black text-slate-900">{number(row.estoque)}</td>
                    <td className={`border-b border-r border-red-100 px-2 py-2 text-center font-black ${row.pendente > 0 ? 'bg-red-100 text-red-700' : 'bg-red-50/20 text-slate-400'}`}>
                      {number(row.pendente)}
                    </td>
                    <td className="border-b border-r border-violet-100 bg-violet-50/40 px-2 py-2 text-center font-black text-violet-800">{number(currentWeekQty)}</td>

                    {showFutureWeeks ? (
                      (data?.weeks || []).slice(1, 5).map((week) => (
                        <td
                          key={`${row.rowKey}-${week.key}`}
                          className="border-b border-r border-violet-100 bg-violet-50/40 px-2 py-2 text-center font-black text-violet-800"
                        >
                          {number(row.weeks?.[week.key] || 0)}
                        </td>
                      ))
                    ) : (
                      <td className="border-b border-r border-violet-100 bg-violet-50/40 px-2 py-2 text-center font-black text-violet-800">{number(futureWeekTotal(row))}</td>
                    )}

                    <td className="border-b border-r border-cyan-100 bg-cyan-50/30 px-2 py-2 text-center">
                      {coverageDays === null ? (
                        <span className="font-black text-slate-400">Sem giro</span>
                      ) : (
                        <div className="leading-tight">
                          <div className="font-black text-slate-900">{number(coverageDays, 0)} dias</div>
                          <div className="mt-0.5 text-[8px] font-bold text-slate-400">até {shortDate(row.coberturaAtualData)}</div>
                        </div>
                      )}
                    </td>

                    {showForecasts ? (
                      <>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao15)}`}>{number(row.previsao15)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao30)}`}>{number(row.previsao30)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao45)}`}>{number(row.previsao45)}</td>
                        <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao60)}`}>{number(row.previsao60)}</td>
                      </>
                    ) : (
                      <td className={`border-b border-r border-cyan-100 px-2 py-2 text-center font-black ${metricTone(row.previsao60)}`}>{number(row.previsao60)}</td>
                    )}

                    <td className={`border-b border-r border-amber-200 px-2 py-2 text-center font-black ${row.sugestaoPedido > 0 ? 'bg-amber-100 text-amber-900' : 'bg-amber-50/40 text-slate-400'}`}>
                      {number(row.sugestaoPedido)}
                    </td>
                    <td className="border-b border-r border-indigo-100 bg-indigo-50 px-1.5 py-1.5">
                      {renderPedidoInput(row)}
                    </td>
                    <td className="border-b border-r border-slate-100 bg-slate-950 px-2 py-2 text-center text-white">
                      {forecast.days === null ? (
                        <span className="font-black text-slate-400">Sem giro</span>
                      ) : (
                        <div className="leading-tight">
                          <div className="font-black">{shortDate(forecast.date)}</div>
                          <div className="mt-0.5 text-[8px] font-bold text-slate-400">{number(forecast.days, 0)} dias</div>
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
        <span>
          {data?.formula?.suggestion ||
            'Sugestão = demanda projetada de 60 dias - estoque - pedidos previstos para chegar em até 60 dias.'}
        </span>
        <span className="text-red-600">
          Pendente/atrasado não reduz a sugestão de compra.
        </span>
      </div>
    </div>
  );

  const renderNoStockBlock = () => {
    if (!noStockRows.length) return null;

    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-orange-200 bg-orange-50/60 shadow-sm">
        <button
          type="button"
          onClick={() => setShowNoStock((value) => !value)}
          className="flex w-full items-center justify-between gap-3 bg-orange-100/80 px-3 py-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <PackageX size={15} className="shrink-0 text-orange-600" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-orange-800">
                Modelos sem estoque
              </p>
              <p className="text-[8px] font-bold text-orange-600">
                Separados da grade principal. Use Restaurar para recolocar um modelo no planejamento.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-orange-700 shadow-sm">
              {noStockRows.length} itens
            </span>
            {showNoStock ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </div>
        </button>

        {showNoStock && (
          <div className="max-h-[46vh] overflow-auto bg-white">
            <table className="w-full min-w-[980px] border-collapse text-[10px]">
              <thead className="sticky top-0 z-10 bg-orange-50 text-[8px] font-black uppercase tracking-wide text-orange-800">
                <tr>
                  <th className="px-3 py-2 text-left">Modelo com cor</th>
                  <th className="px-2 py-2 text-center">Vendas 30</th>
                  <th className="px-2 py-2 text-center">Pendente</th>
                  <th className="px-2 py-2 text-center">Próx. 4 sem.</th>
                  <th className="px-2 py-2 text-center">Sugestão</th>
                  <th className="px-2 py-2 text-center">Pedido Rufino</th>
                  <th className="px-2 py-2 text-center">Previsão</th>
                  <th className="px-2 py-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {noStockRows.map((row, index) => {
                  const forecast = finalForecast(row);
                  return (
                    <tr key={`no-stock-${row.rowKey}`} className={index % 2 === 0 ? 'bg-white' : 'bg-orange-50/30'}>
                      <td className="border-t border-orange-100 px-3 py-2 font-black uppercase text-slate-900">{row.modeloComCor}</td>
                      <td className="border-t border-orange-100 px-2 py-2 text-center font-black text-blue-800">{number(row.vendas30)}</td>
                      <td className="border-t border-orange-100 px-2 py-2 text-center font-black text-red-700">{number(row.pendente)}</td>
                      <td className="border-t border-orange-100 px-2 py-2 text-center font-black text-violet-700">{number(futureWeekTotal(row))}</td>
                      <td className="border-t border-orange-100 px-2 py-2 text-center font-black text-amber-800">{number(row.sugestaoPedido)}</td>
                      <td className="border-t border-orange-100 px-2 py-1.5">{renderPedidoInput(row)}</td>
                      <td className="border-t border-orange-100 px-2 py-2 text-center font-black text-slate-700">
                        {forecast.days === null ? 'Sem giro' : `${shortDate(forecast.date)} · ${number(forecast.days)}d`}
                      </td>
                      <td className="border-t border-orange-100 px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => restoreNoStockRow(row.rowKey)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-[8px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-orange-700"
                          title="Recolocar este modelo na grade principal de planejamento"
                        >
                          <RotateCcw size={11} />
                          Restaurar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderOrderSummary = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <CompactSummaryCard label="Modelos no pedido" value={number(orderSummary.modelos)} icon={ShoppingCart} tone="slate" />
        <CompactSummaryCard label="Unidades Rufino" value={number(orderSummary.unidades)} icon={Boxes} tone="emerald" />
        <CompactSummaryCard label="Sugestão sistema" value={number(orderSummary.sugestao)} icon={TrendingUp} tone="amber" />
        <CompactSummaryCard label="Abaixo sugestão" value={number(orderSummary.abaixo)} icon={AlertTriangle} tone="red" />
        <CompactSummaryCard label="Acima sugestão" value={number(orderSummary.acima)} icon={BarChart3} tone="violet" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-900">Resumo do pedido</h3>
            <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
              Somente os modelos com quantidade preenchida em Pedido Rufino.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">
            {number(orderSummary.unidades)} un.
          </span>
        </div>

        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[920px] border-collapse text-[10px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[8px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-2 py-2 text-center">Estoque</th>
                <th className="px-2 py-2 text-center">Vendas 30</th>
                <th className="px-2 py-2 text-center">Pendente</th>
                <th className="px-2 py-2 text-center">Sugestão</th>
                <th className="px-2 py-2 text-center">Pedido Rufino</th>
                <th className="px-2 py-2 text-center">Diferença</th>
                <th className="px-2 py-2 text-center">Cobertura pós-pedido</th>
              </tr>
            </thead>
            <tbody>
              {orderedRows.length ? (
                orderedRows.map((row, index) => {
                  const diff = Number(row.pedidoRufino || 0) - Number(row.sugestaoPedido || 0);
                  const forecast = finalForecast(row);
                  return (
                    <tr key={`summary-${row.rowKey}`} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="border-t border-slate-100 px-3 py-2 font-black uppercase text-slate-900">{row.modeloComCor}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold">{number(row.estoque)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold">{number(row.vendas30)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold text-red-700">{number(row.pendente)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-amber-800">{number(row.sugestaoPedido)}</td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-black text-indigo-700">{number(row.pedidoRufino)}</td>
                      <td className={`border-t border-slate-100 px-2 py-2 text-center font-black ${diff < 0 ? 'text-red-700' : diff > 0 ? 'text-violet-700' : 'text-emerald-700'}`}>
                        {diff > 0 ? '+' : ''}{number(diff)}
                      </td>
                      <td className="border-t border-slate-100 px-2 py-2 text-center font-bold text-slate-700">
                        {forecast.days === null ? 'Sem giro' : `${number(forecast.days)} dias · ${shortDate(forecast.date)}`}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                    Nenhum Pedido Rufino preenchido nesta aba.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderAiPanel = () => (
    <div className="grid gap-3 xl:grid-cols-[0.78fr_1.22fr]">
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-950 to-slate-950 p-4 text-white shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <BrainCircuit size={18} />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-300">Inteligência de compra</p>
            <h3 className="mt-1 text-lg font-black">Assistente de Ponto de Pedido</h3>
            <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-300">
              A análise recebe vendas de 15/30/45/60 dias, estoque atual, pedidos pendentes, semanas de chegada, cobertura, sugestão do sistema e Pedido Rufino.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/5 p-2.5">
            <p className="text-[7px] font-black uppercase text-slate-400">Estoque crítico</p>
            <p className="mt-1 text-lg font-black">{number(rows.filter((row) => row.estoque <= 0 && row.vendas30 > 0).length)}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-2.5">
            <p className="text-[7px] font-black uppercase text-slate-400">Sugestão total</p>
            <p className="mt-1 text-lg font-black">{number(liveSummary.sugestao)}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {[
            'Quais modelos eu deveria priorizar neste pedido?',
            'Onde o Pedido Rufino está acima ou abaixo do necessário?',
            'Quais modelos têm maior risco de ruptura nas próximas semanas?',
          ].map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => setAiQuestion(question)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-[9px] font-bold text-slate-200 transition hover:bg-white/10"
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-violet-600" />
          <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-900">Análise da IA</h3>
        </div>

        <textarea
          value={aiQuestion}
          onChange={(event) => setAiQuestion(event.target.value)}
          rows={3}
          placeholder="Pergunte sobre o pedido..."
          className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-violet-400 focus:bg-white"
        />

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={runAiAnalysis}
            disabled={aiLoading || !aiQuestion.trim() || !rows.length}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-[9px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-40"
          >
            {aiLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            Analisar compra
          </button>
        </div>

        <div className="mt-3 min-h-[300px] rounded-xl border border-slate-200 bg-slate-50 p-3">
          {aiLoading ? (
            <div className="flex min-h-[260px] items-center justify-center gap-2 text-xs font-bold text-slate-400">
              <RefreshCw size={15} className="animate-spin" />
              Analisando vendas, estoque e pedidos...
            </div>
          ) : aiAnswer ? (
            <div className="whitespace-pre-wrap text-[11px] font-semibold leading-6 text-slate-700">{aiAnswer}</div>
          ) : (
            <div className="flex min-h-[260px] items-center justify-center px-8 text-center text-[11px] font-semibold leading-5 text-slate-400">
              Escolha uma pergunta ou escreva o que deseja analisar. A IA deve usar somente os números desta aba e sinalizar quando não houver dado suficiente.
            </div>
          )}
        </div>
      </div>
    </div>
  );

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
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                Google Sheets + vendas + estoque + pedidos em trânsito
              </p>
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

            {data?.sourceUrl && (
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-black uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
              >
                <ExternalLink size={13} />
                Sheets
              </a>
            )}

            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[9px] font-black uppercase tracking-wide text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-white px-3 pt-2 md:px-6">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-wide transition ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
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
          <ModeButton active={pageMode === 'resumo'} onClick={() => setPageMode('resumo')} icon={BarChart3}>
            Resumo dos pedidos
          </ModeButton>
          <ModeButton active={pageMode === 'ia'} onClick={() => setPageMode('ia')} icon={BrainCircuit}>
            Assistente IA
          </ModeButton>
        </div>

        <div className="mb-2.5 grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
          <CompactSummaryCard label="Modelos" value={number(liveSummary.modelos)} icon={Boxes} />
          <CompactSummaryCard label="Estoque" value={number(liveSummary.estoque)} icon={Package} tone="blue" />
          <CompactSummaryCard label="Sem estoque" value={number(liveSummary.semEstoque)} icon={PackageX} tone="red" />
          <CompactSummaryCard label="Pendente" value={number(liveSummary.pendente)} icon={Clock3} tone="red" />
          <CompactSummaryCard label="Sugestão" value={number(liveSummary.sugestao)} icon={TrendingUp} tone="amber" />
          <CompactSummaryCard label="Pedido Rufino" value={number(liveSummary.pedidoRufino)} icon={ShoppingCart} tone="emerald" />
        </div>

        {pageMode === 'planejamento' && (
          <>
            <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-white px-3 py-3 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.35)] lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-stretch gap-2">
                <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-violet-700">
                    Semana atual
                  </p>
                  <p className="mt-0.5 text-[11px] font-black text-slate-900">
                    {weekParts(data?.weeks?.[0]).title}
                  </p>
                  <p className="text-[9px] font-bold text-slate-500">
                    {weekParts(data?.weeks?.[0]).range}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">
                    Aba
                  </p>
                  <p className="mt-0.5 text-[11px] font-black text-slate-900">
                    {data?.sheetName || activeTab || '—'}
                  </p>
                </div>

                {data?.loadedAt && (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">
                      Atualizado
                    </p>
                    <p className="mt-0.5 text-[11px] font-black text-slate-900">
                      {new Date(data.loadedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowBaseModel((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-wide text-slate-600 shadow-sm transition hover:text-indigo-700"
                >
                  {showBaseModel ? <EyeOff size={11} /> : <Eye size={11} />}
                  Modelo sem cor
                </button>
                <GroupButton open={showSales} onClick={() => setShowSales((value) => !value)}>
                  Vendas
                </GroupButton>
                <GroupButton open={showFutureWeeks} onClick={() => setShowFutureWeeks((value) => !value)}>
                  Próximas semanas
                </GroupButton>
                <GroupButton open={showForecasts} onClick={() => setShowForecasts((value) => !value)}>
                  Previsões
                </GroupButton>
              </div>
            </div>

            {renderMainTable()}
            {renderNoStockBlock()}
          </>
        )}

        {pageMode === 'resumo' && renderOrderSummary()}
        {pageMode === 'ia' && renderAiPanel()}
      </div>
    </div>
  );
}
