import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Eye, Mail, RefreshCw, RotateCcw, Search, Send, Trash2, X } from 'lucide-react';
import FluxoComparativoTabela, { analysisReviewKey, type AnalysisDisplayRow, type MarketSnapshot } from './FluxoComparativoTabela';
import OnlinePricesAgent from './OnlinePricesAgent';

type FluxoStatus = 'EM_ANALISE' | 'RESPONDIDO' | 'DEVOLVIDO';
type AnalysisTab = 'COM_OFERTAS' | 'SEM_OFERTAS' | 'ONLINE_COM_OFERTAS' | 'ONLINE_SEM_OFERTAS' | 'ONLINE_TOTAL';

type FluxoComparativo = {
  id: string;
  titulo: string;
  tipoComparativo: string;
  status: FluxoStatus;
  criadoPorId: string;
  criadoPorNome: string;
  motivoDevolucao?: string;
  emailEnviadoPara?: string;
  createdAt: string;
  updatedAt: string;
  enviadoEm?: string;
  respondidoEm?: string;
  devolvidoEm?: string;
  payload?: any;
};

type FinalTableRow = {
  descricao: string;
  referencia: string;
  precoSamsung: number;
  descTelecel: number;
  descRebate: number;
  descTradeIn: number;
  descBogo: number;
  descSip: number;
  precoFinal: number;
  preco18x: number;
  changed: boolean;
};

const API_BASE_URL = 'https://telefluxo-aplicacao.onrender.com';

const isLocalFrontend = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
};

const getApiCandidates = (path: string) => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (isLocalFrontend()) {
    return [`http://localhost:3000${cleanPath}`, `${API_BASE_URL}${cleanPath}`];
  }

  return [`${API_BASE_URL}${cleanPath}`];
};

const requestJson = async (path: string, options?: RequestInit) => {
  const candidates = getApiCandidates(path);
  let lastError = `Erro ao acessar ${path}`;

  for (const url of candidates) {
    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        lastError = data?.error || `Falha ao acessar ${url} (${response.status})`;
        continue;
      }

      return data;
    } catch (error: any) {
      lastError = error?.message || `Erro ao acessar ${url}`;
    }
  }

  throw new Error(lastError);
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
};

const statusLabel = (status: FluxoStatus) => {
  if (status === 'EM_ANALISE') return 'Em análise';
  if (status === 'RESPONDIDO') return 'Respondido';
  if (status === 'DEVOLVIDO') return 'Devolvido';
  return status;
};

const statusClasses = (status: FluxoStatus) => {
  if (status === 'EM_ANALISE') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'RESPONDIDO') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'DEVOLVIDO') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
};

const getRowCounts = (item: FluxoComparativo) => {
  const comOfertas = Array.isArray(item.payload?.comOfertas) ? item.payload.comOfertas.length : 0;
  const semOfertas = Array.isArray(item.payload?.semOfertas) ? item.payload.semOfertas.length : 0;
  return { comOfertas, semOfertas, total: comOfertas + semOfertas };
};

const normalizeFluxoItem = (raw: any): FluxoComparativo => {
  const comOfertas = Array.isArray(raw?.comOfertas)
    ? raw.comOfertas
    : Array.isArray(raw?.payload?.comOfertas)
      ? raw.payload.comOfertas
      : [];

  const semOfertas = Array.isArray(raw?.semOfertas)
    ? raw.semOfertas
    : Array.isArray(raw?.payload?.semOfertas)
      ? raw.payload.semOfertas
      : [];

  return {
    id: String(raw?.id || ''),
    titulo: String(raw?.titulo || raw?.title || 'Comparativo'),
    tipoComparativo: String(raw?.tipoComparativo || raw?.tipo_comparativo || ''),
    status: String(raw?.status || 'EM_ANALISE') as FluxoStatus,
    criadoPorId: String(raw?.criadoPorId || raw?.criado_por_id || ''),
    criadoPorNome: String(raw?.criadoPorNome || raw?.criado_por_nome || ''),
    motivoDevolucao: raw?.motivoDevolucao || raw?.motivo_devolucao || '',
    emailEnviadoPara: raw?.emailEnviadoPara || raw?.email_enviado_para || '',
    createdAt: raw?.createdAt || raw?.created_at || '',
    updatedAt: raw?.updatedAt || raw?.updated_at || '',
    enviadoEm: raw?.enviadoEm || raw?.enviado_em || '',
    respondidoEm: raw?.respondidoEm || raw?.respondido_em || '',
    devolvidoEm: raw?.devolvidoEm || raw?.devolvido_em || '',
    payload: {
      ...(raw?.payload || {}),
      comOfertas,
      semOfertas,
    },
  };
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

const downloadBase64File = (
  base64: string,
  fileName: string,
  mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
) => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

const pickValue = (row: any, keys: string[], fallback: any = '') => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return fallback;
};

const toNumber = (value: any) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const normalized = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .trim();

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value: any) => {
  const number = toNumber(value);
  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const getRowsForTab = (item: FluxoComparativo | null, tab: AnalysisTab) => {
  if (!item) return [];
  return tab === 'COM_OFERTAS'
    ? Array.isArray(item.payload?.comOfertas) ? item.payload.comOfertas : []
    : Array.isArray(item.payload?.semOfertas) ? item.payload.semOfertas : [];
};

const getProductDescription = (row: any) => String(pickValue(row, ['descricao', 'DESCRICAO', 'DESCRIÇÃO', 'produto', 'PRODUTO'], '-'));
const getProductReference = (row: any) => String(pickValue(row, ['referencia', 'REFERENCIA', 'REFERÊNCIA'], ''));

// Exibe os valores que o Montar Comparativo já calculou e enviou. Apenas
// os campos editados na análise são recalculados pelas mesmas regras da montagem.
const getComputedRow = (row: any): AnalysisDisplayRow => {
  const n = (keys: string[], fallback = 0) => toNumber(pickValue(row, keys, fallback));
  const nullable = (keys: string[], fallback: number | null) => {
    const matchedKey = keys.find(key => row?.[key] !== undefined && row?.[key] !== null);
    return matchedKey === undefined ? fallback : toNumber(row[matchedKey]);
  };
  const precoSamsung = n(['precoSamsung', 'PREÇO SAMSUNG']);
  const descontoTelecel = n(['totalDescontoTelecel', 'descontoTelecel', 'DESC. TELECEL']);
  const descontoRebate = n(['descontoRebate', 'DESC. REBATE']);
  const descontoTradeIn = n(['descontoTradeIn', 'DESC. TRADE IN']);
  const descontoBogo = n(['descontoBogo', 'DESC. BOGO']);
  const descontoSip = n(['descontoSip', 'DESC. SIP']);
  const descontoGeral = n(['descontoGeral', 'DESCONTOS GERAIS']);
  const custoMedioEstoque = n(['custoMedioEstoque', 'custoMedio', 'CUSTO MÉDIO']);
  const priceRebate = n(['priceRebate', 'PRICE REBATE']);
  const priceTradeIn = n(['priceTradeIn', 'PRICE TRADE IN']);
  const priceBogo = n(['priceBogo', 'PRICE BOGO']);
  const priceSip = n(['priceSip', 'PRICE SIP']);
  const precoTelecel = n(['precoTelecel', 'PREÇO TELECEL'], Math.max(precoSamsung - descontoTelecel, 0));
  const totalDesconto = n(['totalDesconto', 'TOTAL DESCONTO'], Math.floor(descontoTelecel + descontoRebate + descontoTradeIn + descontoBogo + descontoSip + descontoGeral));
  const precoPromocional = n(['precoPromocional', 'precoFinal', 'PREÇO PROMOCIONAL'], Math.max(precoSamsung - totalDesconto, 0));
  const novoCustoMedio = nullable(['novoCustoMedio', 'NOVO CUSTO MÉDIO'], custoMedioEstoque - priceRebate - priceTradeIn - priceBogo - priceSip);
  const margemEstoque = nullable(['margemEstoque', 'MARGEM ESTOQUE'], precoTelecel > 0 ? 1 - custoMedioEstoque / precoTelecel : null);
  const margemPrice = nullable(['margemPrice', 'MARGEM PRICE'], precoPromocional > 0 && novoCustoMedio !== null ? 1 - novoCustoMedio / precoPromocional : null);
  return {
    rowKey: String(pickValue(row, ['rowKey'], '')),
    descricao: getProductDescription(row),
    referencia: getProductReference(row),
    precoSamsung, precoTelecel,
    totalDescontoTelecel: descontoTelecel,
    descontoRebate, descontoTradeIn, descontoBogo, descontoSip, descontoGeral,
    totalDesconto, precoPromocional,
    qtdEstoque: n(['qtdEstoque', 'QTD ESTOQUE']),
    custoMedioEstoque, margemEstoque, novoCustoMedio, margemPrice,
    qtdVendida: n(['qtdVendida', 'QTD VENDIDA']),
    priceRebate, priceTradeIn, priceBogo, priceSip,
    ofertaAtual: n(['ofertaAtual', 'OFERTA ATUAL']),
    status: String(pickValue(row, ['status', 'STATUS'], '-')),
    descTelecelInput: row.descTelecelInput,
  };
};

const recalcEditedTelecel = (row: any, inputValue: string) => {
  const before = getComputedRow(row);
  const value = Math.max(0, toNumber(inputValue));
  const precoTelecel = before.precoSamsung > 0 ? Math.max(0, before.precoSamsung - value) : before.precoTelecel;
  const totalDesconto = Math.floor(Math.max(0, value + before.descontoRebate + before.descontoTradeIn + before.descontoBogo + before.descontoSip + before.descontoGeral) + 1e-9);
  const precoPromocional = Math.max(0, before.precoSamsung - totalDesconto);
  const margemEstoque = precoTelecel > 0 ? 1 - before.custoMedioEstoque / precoTelecel : null;
  const margemPrice = precoPromocional > 0 && before.novoCustoMedio !== null ? 1 - before.novoCustoMedio / precoPromocional : null;
  let status = before.status;
  if (before.ofertaAtual > 0 && precoPromocional > 0) {
    status = precoPromocional < before.ofertaAtual ? 'MENOR' : precoPromocional > before.ofertaAtual ? 'MAIOR' : 'IGUAL';
  }
  return {
    ...row,
    descTelecelInput: inputValue,
    totalDescontoTelecel: value,
    descontoTelecel: value,
    precoTelecel,
    totalDesconto,
    precoPromocional,
    precoFinal: precoPromocional,
    margemEstoque,
    margemPrice,
    status,
  };
};

const normalizeFinalTableRow = (row: any): FinalTableRow => ({
  descricao: String(row?.descricao || row?.['DESCRIÇÃO'] || row?.DESCRICAO || ''),
  referencia: String(row?.referencia || row?.['REFERÊNCIA'] || row?.REFERENCIA || ''),
  precoSamsung: toNumber(row?.precoSamsung ?? row?.['PREÇO SAMSUNG']),
  descTelecel: toNumber(row?.descTelecel ?? row?.['TELECEL DESC. MANUAL']),
  descRebate: toNumber(row?.descRebate ?? row?.['REBATE DESC. AUTOMATICO']),
  descTradeIn: toNumber(row?.descTradeIn ?? row?.['TRADE IN DESC. AUTOMATICO']),
  descBogo: toNumber(row?.descBogo ?? row?.['BOGO / CASH BACK DESC. MANUAL']),
  descSip: toNumber(row?.descSip ?? row?.['SIP DESC. MANUAL']),
  precoFinal: toNumber(row?.precoFinal ?? row?.['PREÇO FINAL']),
  preco18x: toNumber(row?.preco18x ?? row?.['PREÇO PARCELAMENTO 18x']),
  changed: Boolean(row?.changed || row?.alterado || row?.ALTERADO),
});

const defaultEmailBody = (titulo: string) =>
  `Prezados, boa tarde!

Segue tabela atualizada referente ao comparativo ${titulo}.

Qualquer dúvida, fico à disposição.`;

export default function FluxoComparativoModule({ currentUser }: { currentUser?: any }) {
  const user = currentUser || getCurrentUserInfo();
  const userRole = String(user?.role || '').toUpperCase();
  const isAdmin = user?.isAdmin === true || Number(user?.isAdmin) === 1;
  const isPresidencia = userRole === 'CEO' || isAdmin;

  const [items, setItems] = useState<FluxoComparativo[]>([]);
  const [activeStatus, setActiveStatus] = useState<FluxoStatus>('EM_ANALISE');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [devolverItem, setDevolverItem] = useState<FluxoComparativo | null>(null);
  const [devolverMotivo, setDevolverMotivo] = useState('');
  const [analysisItem, setAnalysisItem] = useState<FluxoComparativo | null>(null);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('COM_OFERTAS');
  const [analysisSearch, setAnalysisSearch] = useState('');
  // Marcação de conferência local por usuário e comparativo. Não muda a aprovação.
  const [reviewedKeys, setReviewedKeys] = useState<ReadonlySet<string>>(new Set());
  const [onlineCurrent, setOnlineCurrent] = useState<Record<string, MarketSnapshot>>({});
  const handleOnlineChange = useCallback((next: Record<string, MarketSnapshot>) => {
    setOnlineCurrent(next);
  }, []);

  const reviewedStorageKey = analysisItem
    ? `telefluxo:fluxo-comparativo:revisados:v1:${String(user?.id || 'sem-id')}:${analysisItem.id}`
    : '';

  useEffect(() => {
    if (!reviewedStorageKey) {
      setReviewedKeys(new Set());
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(reviewedStorageKey) || '[]');
      setReviewedKeys(new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []));
    } catch {
      setReviewedKeys(new Set());
    }
  }, [reviewedStorageKey]);

  const toggleReviewed = (row: AnalysisDisplayRow) => {
    const key = analysisReviewKey(row);
    setReviewedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (reviewedStorageKey) {
        try { localStorage.setItem(reviewedStorageKey, JSON.stringify([...next])); }
        catch { /* Marcações continuam disponíveis nesta sessão. */ }
      }
      return next;
    });
  };
  const [deleteItem, setDeleteItem] = useState<FluxoComparativo | null>(null);
  const [sendTableItem, setSendTableItem] = useState<FluxoComparativo | null>(null);
  const [finalRows, setFinalRows] = useState<FinalTableRow[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [finalTableLoading, setFinalTableLoading] = useState(false);
  const [finalTableMsg, setFinalTableMsg] = useState('');

  const loadItems = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const params = new URLSearchParams();
      if (user?.id) params.set('userId', String(user.id));

      const data = await requestJson(`/api/comparativos/fluxo?${params.toString()}`);

      const rawItems = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.comparativos)
          ? data.comparativos
          : [];

      setItems(rawItems.map(normalizeFluxoItem));
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao carregar fluxo de comparativos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items
      .filter((item) => item.status === activeStatus)
      .filter((item) => {
        if (!term) return true;
        return [item.titulo, item.tipoComparativo, item.criadoPorNome, item.motivoDevolucao]
          .join(' ')
          .toLowerCase()
          .includes(term);
      });
  }, [items, activeStatus, searchTerm]);

  const counters = useMemo(() => ({
    EM_ANALISE: items.filter((item) => item.status === 'EM_ANALISE').length,
    RESPONDIDO: items.filter((item) => item.status === 'RESPONDIDO').length,
    DEVOLVIDO: items.filter((item) => item.status === 'DEVOLVIDO').length,
  }), [items]);

  const analysisRows = useMemo(() => {
    const rows = analysisTab === 'ONLINE_TOTAL'
      ? [...getRowsForTab(analysisItem, 'COM_OFERTAS'), ...getRowsForTab(analysisItem, 'SEM_OFERTAS')]
      : getRowsForTab(analysisItem, analysisTab.includes('SEM_OFERTAS') ? 'SEM_OFERTAS' : 'COM_OFERTAS');
    const term = analysisSearch.trim().toLowerCase();
    return (term ? rows.filter((row: any) => [getProductDescription(row), getProductReference(row), row.status].join(' ').toLowerCase().includes(term)) : rows)
      .map(getComputedRow);
  }, [analysisItem, analysisTab, analysisSearch]);

  // A grade Online e a diferença de mercado usam a consulta atual do Google Sheets.
  const analysisOnlineModels = useMemo(() => {
    const base = analysisTab === 'ONLINE_TOTAL'
      ? [...getRowsForTab(analysisItem, 'COM_OFERTAS'), ...getRowsForTab(analysisItem, 'SEM_OFERTAS')]
      : getRowsForTab(analysisItem, analysisTab.includes('SEM_OFERTAS') ? 'SEM_OFERTAS' : 'COM_OFERTAS');
    const used = new Set<string>();
    return base.map((r: any) => getComputedRow(r)).filter(row => {
      const key = row.rowKey || `${row.referencia}|${row.descricao}`;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    }).map(row => ({
      rowKey: row.rowKey,
      descricao: row.descricao,
      referencia: row.referencia,
      precoTelecel: row.precoPromocional,
    }));
  }, [analysisItem, analysisTab]);


  const syncEditedPayload = (nextItem: FluxoComparativo) => {
    setAnalysisItem(nextItem);
    setItems((prev) => prev.map((item) => (item.id === nextItem.id ? nextItem : item)));
  };

  const updateDescTelecel = (tab: AnalysisTab, displayRow: AnalysisDisplayRow, value: string) => {
    if (!analysisItem) return;
    const tabKey = tab.includes('SEM_OFERTAS') ? 'semOfertas' : 'comOfertas';
    const originalRows = Array.isArray(analysisItem.payload?.[tabKey]) ? analysisItem.payload[tabKey] : [];
    const updated = originalRows.map((row: any) => (
      String(row.rowKey || '') === String(displayRow.rowKey || '') && displayRow.rowKey
        ? recalcEditedTelecel(row, value)
        : !displayRow.rowKey && getProductDescription(row) === displayRow.descricao && getProductReference(row) === displayRow.referencia
          ? recalcEditedTelecel(row, value)
          : row
    ));
    syncEditedPayload({ ...analysisItem, payload: { ...analysisItem.payload, [tabKey]: updated } });
  };

  const formatDescTelecelInput = (tab: AnalysisTab, displayRow: AnalysisDisplayRow) => {
    if (!analysisItem) return;
    const tabKey = tab.includes('SEM_OFERTAS') ? 'semOfertas' : 'comOfertas';
    const originalRows = Array.isArray(analysisItem.payload?.[tabKey]) ? analysisItem.payload[tabKey] : [];
    const updated = originalRows.map((row: any) => {
      const same = displayRow.rowKey
        ? String(row.rowKey || '') === displayRow.rowKey
        : getProductDescription(row) === displayRow.descricao && getProductReference(row) === displayRow.referencia;
      return same ? { ...row, descTelecelInput: getComputedRow(row).totalDescontoTelecel.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) } : row;
    });
    syncEditedPayload({ ...analysisItem, payload: { ...analysisItem.payload, [tabKey]: updated } });
  };

  const updateStatus = async (item: FluxoComparativo, status: FluxoStatus, motivo = '') => {
    setActionLoadingId(item.id);
    setErrorMsg('');
    setSuccessMsg('');

    const sourceItem = analysisItem?.id === item.id ? analysisItem : item;

    try {
      await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(item.id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          motivoDevolucao: motivo,
          userId: user?.id || '',
          payload: sourceItem.payload,
        }),
      });

      setSuccessMsg(status === 'RESPONDIDO' ? 'Comparativo marcado como respondido.' : 'Comparativo devolvido com sucesso.');
      setDevolverItem(null);
      setDevolverMotivo('');
      setAnalysisItem(null);
      await loadItems();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao atualizar status.');
    } finally {
      setActionLoadingId('');
    }
  };

  const canDeleteComparativo = (item: FluxoComparativo) => {
    const currentUserId = String(user?.id || '');
    const isCreator = currentUserId && String(item.criadoPorId || '') === currentUserId;
    const isCeoOrMaster = userRole === 'CEO' || userRole === 'MASTER';

    if (item.status === 'EM_ANALISE') return isCreator || isCeoOrMaster;
    return isCeoOrMaster;
  };

  const deleteComparativo = async () => {
    if (!deleteItem) return;

    setActionLoadingId(deleteItem.id);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(deleteItem.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id || '' }),
      });

      setSuccessMsg('Comparativo excluído com sucesso.');
      setDeleteItem(null);
      await loadItems();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao excluir comparativo.');
    } finally {
      setActionLoadingId('');
    }
  };

  const openSendTableModal = async (item: FluxoComparativo) => {
    setSendTableItem(item);
    setFinalRows([]);
    setFinalTableMsg('');
    setEmailSubject(`Tabela Telecel - ${item.titulo}`);
    setEmailBody(defaultEmailBody(item.titulo));
    setFinalTableLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const data = await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(item.id)}/final-table-preview?userId=${encodeURIComponent(String(user?.id || ''))}`);
      const rows = Array.isArray(data?.rows) ? data.rows.map(normalizeFinalTableRow) : [];
      setFinalRows(rows);
      if (data?.defaultSubject) setEmailSubject(String(data.defaultSubject));
      if (data?.defaultBody) setEmailBody(String(data.defaultBody));
    } catch (error: any) {
      setFinalTableMsg(error?.message || 'Erro ao montar prévia da tabela final.');
    } finally {
      setFinalTableLoading(false);
    }
  };

  const sendFinalTable = async (downloadOnly = false) => {
    if (!sendTableItem) return;

    setActionLoadingId(sendTableItem.id);
    setFinalTableMsg('');
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const sourceItem = analysisItem?.id === sendTableItem.id ? analysisItem : sendTableItem;

      const data = await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(sendTableItem.id)}/send-final-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id || '',
          subject: emailSubject,
          body: emailBody,
          downloadOnly,
          payload: sourceItem.payload,
        }),
      });

      if (data?.fileBase64 && data?.fileName) {
        downloadBase64File(data.fileBase64, data.fileName);
      }

      if (downloadOnly) {
        setFinalTableMsg('Excel gerado e baixado com sucesso.');
      } else {
        setFinalTableMsg('Tabela enviada por e-mail e Excel baixado com sucesso.');
        setSuccessMsg('Tabela final enviada por e-mail com sucesso.');
        await loadItems();
      }
    } catch (error: any) {
      setFinalTableMsg(error?.message || 'Erro ao gerar/enviar tabela final.');
    } finally {
      setActionLoadingId('');
    }
  };

  const openAnalysis = (item: FluxoComparativo) => {
    if (analysisItem?.id === item.id) { setAnalysisItem(null); return; }
    setAnalysisItem(JSON.parse(JSON.stringify(item)));
    setAnalysisTab('COM_OFERTAS');
    setAnalysisSearch('');
    setOnlineCurrent({});
    setErrorMsg('');
    setSuccessMsg('');
  };

  // Abre logo abaixo do comparativo selecionado, dentro do próprio fluxo.
  const renderInlineAnalysis = () => analysisItem ? (
    <section className="min-w-0 space-y-3 border-t-2 border-orange-400 bg-slate-50 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black uppercase text-slate-900">Análise do Comparativo</h2>
            <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${statusClasses(analysisItem.status)}`}>{statusLabel(analysisItem.status)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{analysisItem.titulo} · Criado por {analysisItem.criadoPorNome || '-'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isPresidencia && analysisItem.status === 'EM_ANALISE' && <>
            <button type="button" disabled={actionLoadingId === analysisItem.id} onClick={() => updateStatus(analysisItem, 'RESPONDIDO')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"><CheckCircle2 size={14} /> Marcar como respondido</button>
            <button type="button" disabled={actionLoadingId === analysisItem.id} onClick={() => { setDevolverItem(analysisItem); setDevolverMotivo(''); }} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"><RotateCcw size={14} /> Devolver comparativo</button>
          </>}
          {analysisItem.status === 'RESPONDIDO' && <button type="button" onClick={() => openSendTableModal(analysisItem)} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase text-white"><Send size={14} /> Preparar envio</button>}
          <button type="button" onClick={() => setAnalysisItem(null)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700"><X size={14} /> Fechar</button>
        </div>
      </div>
      {analysisItem.motivoDevolucao && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><strong>Motivo de devolução:</strong> {analysisItem.motivoDevolucao}</p>}
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['COM_OFERTAS', `Com ofertas (${getRowCounts(analysisItem).comOfertas})`],
              ['SEM_OFERTAS', `Sem ofertas (${getRowCounts(analysisItem).semOfertas})`],
              ['ONLINE_COM_OFERTAS', 'Online com ofertas'],
              ['ONLINE_SEM_OFERTAS', 'Online sem ofertas'],
              ['ONLINE_TOTAL', 'Online total'],
            ] as Array<[AnalysisTab, string]>).map(([tab, label]) => <button key={tab} type="button" onClick={() => setAnalysisTab(tab)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase ${analysisTab === tab ? 'bg-slate-900 text-white' : tab.startsWith('ONLINE') ? 'bg-orange-50 text-orange-700 hover:bg-orange-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>)}
            <span className="rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-500">Total {getRowCounts(analysisItem).total}</span>
            {!analysisTab.startsWith('ONLINE') && (
              <span className="rounded-lg bg-orange-50 px-2 py-1.5 text-[10px] font-bold text-orange-700">
                {analysisRows.filter((row) => reviewedKeys.has(analysisReviewKey(row))).length} revisado(s)
              </span>
            )}
          </div>
          {!analysisTab.startsWith('ONLINE') && <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={analysisSearch} onChange={e => setAnalysisSearch(e.target.value)} placeholder="Buscar produto, referência ou status" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-[11px] outline-none focus:border-orange-300" />
          </div>}
        </div>
        {!analysisTab.startsWith('ONLINE') && (
          <FluxoComparativoTabela
            rows={analysisRows}
            online={onlineCurrent}
            reviewedKeys={reviewedKeys}
            onToggleReviewed={toggleReviewed}
            editable={isPresidencia && analysisItem.status === 'EM_ANALISE'}
            onEditTelecel={(row, value) => updateDescTelecel(analysisTab, row, value)}
            onBlurTelecel={row => formatDescTelecelInput(analysisTab, row)}
          />
        )}
        <div className={analysisTab.startsWith('ONLINE') ? 'block' : 'hidden'}>
          <p className="mb-2 text-[10px] font-semibold text-slate-500">
            Fonte: Google Sheets · atualização automática a cada 2 minutos enquanto a análise está aberta · Atualizar para consultar imediatamente.
          </p>
          <OnlinePricesAgent
            currentUser={currentUser}
            comparativoModels={analysisOnlineModels}
            embedded
            scopeLabel={analysisTab === 'ONLINE_TOTAL' ? 'Online total' : analysisTab.includes('SEM_OFERTAS') ? 'Online sem ofertas' : 'Online com ofertas'}
            onMarketComparisonChange={handleOnlineChange}
            forceRefreshOnMount
            autoRefreshMs={120_000}
          />
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mb-5 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">Fluxo Comparativo</h1>
            <p className="mt-1 text-sm text-slate-500">
              Banco de comparativos enviados para validação, resposta da presidência e envio da tabela final.
            </p>
          </div>

          <button
            type="button"
            onClick={loadItems}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>

        {!isPresidencia && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Comparativos em análise ficam disponíveis apenas para a presidência. Você verá itens respondidos ou devolvidos quando existirem.
          </div>
        )}
      </div>

      {(errorMsg || successMsg) && (
        <div className={`mb-4 rounded-2xl border p-3 text-sm font-semibold ${errorMsg ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {errorMsg || successMsg}
        </div>
      )}

      <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {([
              ['EM_ANALISE', 'Em análise'],
              ['RESPONDIDO', 'Respondido'],
              ['DEVOLVIDO', 'Devolvidos'],
            ] as Array<[FluxoStatus, string]>).map(([status, label]) => (
              <button
                key={status}
                type="button"
                onClick={() => setActiveStatus(status)}
                className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-widest transition ${activeStatus === status ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {label} ({counters[status]})
              </button>
            ))}
          </div>

          <div className="relative w-full xl:w-[420px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por título, tipo ou usuário"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 bg-white">
            <thead className="bg-slate-50">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Comparativo</th>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Status</th>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Criado por</th>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Itens</th>
                <th className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Datas</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const counts = getRowCounts(item);
                const busy = actionLoadingId === item.id;

                return (
                  <React.Fragment key={item.id}>
                  <tr className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-4 py-4 align-top">
                      <div className="font-black text-slate-900">{item.titulo}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{item.tipoComparativo}</div>
                      {item.motivoDevolucao && (
                        <div className="mt-2 rounded-xl border border-red-100 bg-red-50 p-2 text-xs text-red-700">
                          <strong>Motivo:</strong> {item.motivoDevolucao}
                        </div>
                      )}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-4 align-top">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClasses(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-4 align-top text-sm text-slate-600">
                      <div className="font-bold text-slate-800">{item.criadoPorNome || '-'}</div>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-4 align-top text-sm text-slate-600">
                      <div>Total: <strong>{counts.total}</strong></div>
                      <div>Com ofertas: <strong>{counts.comOfertas}</strong></div>
                      <div>Sem ofertas: <strong>{counts.semOfertas}</strong></div>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-4 align-top text-xs text-slate-500">
                      <div>Criado: {formatDate(item.createdAt)}</div>
                      {item.respondidoEm && <div>Respondido: {formatDate(item.respondidoEm)}</div>}
                      {item.devolvidoEm && <div>Devolvido: {formatDate(item.devolvidoEm)}</div>}
                      {item.emailEnviadoPara && <div>E-mail: {item.emailEnviadoPara}</div>}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-4 align-top">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openAnalysis(item)}
                          className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          <Eye size={14} /> Analisar
                        </button>

                        {canDeleteComparativo(item) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDeleteItem(item)}
                            className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-60"
                          >
                            <Trash2 size={14} /> Excluir
                          </button>
                        )}

                        {item.status === 'RESPONDIDO' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openSendTableModal(item)}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {busy ? <RefreshCw size={14} /> : <Send size={14} />} Preparar envio
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {analysisItem?.id === item.id && (
                    <tr><td colSpan={6} className="min-w-0 overflow-hidden p-0">{renderInlineAnalysis()}</td></tr>
                  )}
                  </React.Fragment>
                );
              })}

              {!loading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                    Nenhum comparativo encontrado nesta aba.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                    Carregando fluxo comparativo...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteItem && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[26px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-2xl bg-red-50 p-3 text-red-600">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">Excluir comparativo</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Essa ação vai apagar definitivamente o comparativo <strong>{deleteItem.titulo}</strong>.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteItem(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoadingId === deleteItem.id}
                onClick={deleteComparativo}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirmar exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {sendTableItem && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="flex h-[92vh] w-full max-w-[96vw] flex-col rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">Prévia da tabela final</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Revise a tabela, defina o assunto e escreva o corpo do e-mail antes do envio.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSendTableItem(null)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-700 hover:bg-slate-50"
                >
                  <X size={15} /> Fechar
                </button>
              </div>
            </div>

            <div className="grid flex-1 min-h-0 gap-4 overflow-hidden p-4 xl:grid-cols-[420px_1fr]">
              <div className="overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Assunto</label>
                <input
                  value={emailSubject}
                  onChange={(event) => setEmailSubject(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
                />

                <label className="mt-4 block text-[11px] font-black uppercase tracking-widest text-slate-500">Corpo do e-mail</label>
                <textarea
                  value={emailBody}
                  onChange={(event) => setEmailBody(event.target.value)}
                  rows={12}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 outline-none focus:border-slate-400"
                />

                <div className="mt-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                  As linhas alteradas em relação à tabela original aparecem em amarelo no e-mail e no Excel.
                </div>

                {finalTableMsg && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">
                    {finalTableMsg}
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={finalTableLoading || actionLoadingId === sendTableItem.id}
                    onClick={() => sendFinalTable(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    <Download size={15} /> Baixar Excel
                  </button>
                  <button
                    type="button"
                    disabled={finalTableLoading || actionLoadingId === sendTableItem.id || !emailSubject.trim()}
                    onClick={() => sendFinalTable(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Mail size={15} /> Enviar e-mail + anexo
                  </button>
                </div>
              </div>

              <div className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500">
                  Tabela final · {finalRows.length} produtos
                </div>
                <div className="h-full overflow-auto pb-10">
                  {finalTableLoading ? (
                    <div className="flex h-64 items-center justify-center text-slate-500">Montando prévia...</div>
                  ) : (
                    <table className="w-max min-w-[1150px] border-separate border-spacing-0 text-xs">
                      <thead className="sticky top-0 z-20 bg-slate-100">
                        <tr>
                          {['DESCRIÇÃO', 'REFERÊNCIA', 'PREÇO SAMSUNG', 'TELECEL DESC. MANUAL', 'REBATE DESC. AUTOMATICO', 'TRADE IN DESC. AUTOMATICO', 'BOGO / CASH BACK DESC. MANUAL', 'SIP DESC. MANUAL', 'PREÇO FINAL', 'PREÇO PARCELAMENTO 18x'].map((header) => (
                            <th key={header} className="border-b border-slate-200 px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {finalRows.map((row, index) => (
                          <tr key={`${row.descricao}-${row.referencia}-${index}`} className={row.changed ? 'bg-yellow-100' : 'bg-white'}>
                            <td className="border-b border-slate-100 px-3 py-2 font-black text-slate-900">{row.descricao}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.referencia}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.precoSamsung)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.descTelecel)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.descRebate)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.descTradeIn)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.descBogo)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right">{formatMoney(row.descSip)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right font-black">{formatMoney(row.precoFinal)}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-right font-black">{formatMoney(row.preco18x)}</td>
                          </tr>
                        ))}
                        {!finalRows.length && !finalTableLoading && (
                          <tr>
                            <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                              Nenhum item encontrado para a tabela final.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {devolverItem && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[26px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">Devolver comparativo</h3>
              <p className="mt-1 text-sm text-slate-500">Informe o motivo para que o responsável ajuste o comparativo.</p>
            </div>

            <textarea
              value={devolverMotivo}
              onChange={(event) => setDevolverMotivo(event.target.value)}
              rows={5}
              placeholder="Escreva o motivo da devolução..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-slate-400"
            />

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDevolverItem(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black uppercase text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!devolverMotivo.trim() || actionLoadingId === devolverItem.id}
                onClick={() => updateStatus(devolverItem, 'DEVOLVIDO', devolverMotivo)}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Confirmar devolução
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
