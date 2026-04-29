import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, RefreshCw, RotateCcw, Search, Send, X } from 'lucide-react';

type FluxoStatus = 'EM_ANALISE' | 'RESPONDIDO' | 'DEVOLVIDO';
type AnalysisTab = 'COM_OFERTAS' | 'SEM_OFERTAS';

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

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const formatMoney = (value: any) => {
  const number = toNumber(value);
  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatPercent = (value: any) => {
  const number = toNumber(value);
  return `${number.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
};

const formatInteger = (value: any) => Math.round(toNumber(value)).toLocaleString('pt-BR');

const getRowsForTab = (item: FluxoComparativo | null, tab: AnalysisTab) => {
  if (!item) return [];
  return tab === 'COM_OFERTAS'
    ? Array.isArray(item.payload?.comOfertas) ? item.payload.comOfertas : []
    : Array.isArray(item.payload?.semOfertas) ? item.payload.semOfertas : [];
};

const getProductDescription = (row: any) => String(pickValue(row, ['descricao', 'DESCRICAO', 'DESCRIÇÃO', 'produto', 'PRODUTO'], '-'));
const getProductReference = (row: any) => String(pickValue(row, ['referencia', 'REFERENCIA', 'REFERÊNCIA'], ''));

const getComputedRow = (row: any) => {
  const precoSamsung = toNumber(pickValue(row, ['precoSamsung', 'PREÇO SAMSUNG', 'PRECO SAMSUNG']));
  const precoTelecel = toNumber(pickValue(row, ['precoTelecel', 'PREÇO TELECEL', 'PRECO TELECEL']));

  const descTelecel = toNumber(pickValue(row, ['descontoTelecel', 'totalDescontoTelecel', 'DESC. TELECEL', 'TOTAL DESCONTO TELECEL']));
  const descRebate = toNumber(pickValue(row, ['descontoRebate', 'DESC. REBATE']));
  const descTradeIn = toNumber(pickValue(row, ['descontoTradeIn', 'DESC. TRADE IN']));
  const descBogo = toNumber(pickValue(row, ['descontoBogo', 'DESC. BOGO']));
  const descSip = toNumber(pickValue(row, ['descontoSip', 'DESC. SIP']));

  const priceRebate = toNumber(pickValue(row, ['priceRebate', 'PRICE REBATE', 'Price Rebate']));
  const priceTradeIn = toNumber(pickValue(row, ['priceTradeIn', 'PRICE TRADE IN', 'Price Trade In']));
  const priceBogo = toNumber(pickValue(row, ['priceBogo', 'PRICE BOGO', 'Price Bogo']));
  const priceSip = toNumber(pickValue(row, ['priceSip', 'PRICE SIP', 'Price SIP']));

  const custoMedio = toNumber(pickValue(row, ['custoMedioEstoque', 'custoMedio', 'CUSTO MÉDIO', 'CUSTO MEDIO']));
  const ofertaAtualBase = toNumber(pickValue(row, ['ofertaAtual', 'OFERTA ATUAL'], precoTelecel));
  const qtdEstoque = toNumber(pickValue(row, ['qtdEstoque', 'QTD ESTOQUE', 'QTD EST.', 'QTD EST']));
  const qtdVendida = toNumber(pickValue(row, ['qtdVendida', 'QTD VENDIDA', 'QTD VEND.']));
  const status = String(pickValue(row, ['status', 'STATUS'], '-'));

  const totalDesconto = round2(descTelecel + descRebate + descTradeIn + descBogo + descSip);
  const precoPromocional = round2(Math.max(precoSamsung - totalDesconto, 0));
  const novoCustoMedio = round2(custoMedio - priceRebate - priceTradeIn - priceBogo - priceSip);
  const margemEstoque = ofertaAtualBase > 0 ? round2(((ofertaAtualBase - custoMedio) / ofertaAtualBase) * 100) : 0;
  const margemPrice = precoPromocional > 0 ? round2(((precoPromocional - novoCustoMedio) / precoPromocional) * 100) : 0;

  return {
    descricao: getProductDescription(row),
    referencia: getProductReference(row),
    precoSamsung,
    precoTelecel,
    descTelecel,
    descRebate,
    descTradeIn,
    descBogo,
    descSip,
    totalDesconto,
    precoPromocional,
    qtdEstoque,
    custoMedio,
    margemEstoque,
    novoCustoMedio,
    margemPrice,
    qtdVendida,
    priceRebate,
    priceTradeIn,
    priceBogo,
    priceSip,
    ofertaAtual: ofertaAtualBase,
    status,
  };
};

const getMarginClass = (value: number) => {
  if (value < 25) return 'text-red-600 font-black bg-red-50';
  return 'text-slate-800 font-black';
};

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
  const [showDiscountDetails, setShowDiscountDetails] = useState(true);
  const [showPriceDetails, setShowPriceDetails] = useState(true);

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
    const rows = getRowsForTab(analysisItem, analysisTab);
    const term = analysisSearch.trim().toLowerCase();

    if (!term) return rows;

    return rows.filter((row: any) => {
      return [
        getProductDescription(row),
        pickValue(row, ['referencia', 'REFERENCIA', 'REFERÊNCIA'], ''),
        pickValue(row, ['status', 'STATUS'], ''),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [analysisItem, analysisTab, analysisSearch]);

  const syncEditedPayload = (nextItem: FluxoComparativo) => {
    setAnalysisItem(nextItem);
    setItems((prev) => prev.map((item) => (item.id === nextItem.id ? nextItem : item)));
  };

  const updateDescTelecel = (tab: AnalysisTab, rowRef: any, value: string) => {
    if (!analysisItem) return;

    const numericValue = toNumber(value);
    const tabKey = tab === 'COM_OFERTAS' ? 'comOfertas' : 'semOfertas';
    const currentRows = Array.isArray(analysisItem.payload?.[tabKey]) ? analysisItem.payload[tabKey] : [];
    const refDesc = getProductDescription(rowRef);
    const refReference = getProductReference(rowRef);

    const updatedRows = currentRows.map((row: any) => {
      const sameRow = row === rowRef || (
        getProductDescription(row) === refDesc && getProductReference(row) === refReference
      );

      if (!sameRow) return row;

      const nextRow = {
        ...row,
        descTelecelInput: value,
        descontoTelecel: numericValue,
        'DESC. TELECEL': numericValue,
        totalDescontoTelecel: numericValue,
        'TOTAL DESCONTO TELECEL': numericValue,
      };

      const computed = getComputedRow(nextRow);
      return {
        ...nextRow,
        totalDesconto: computed.totalDesconto,
        'TOTAL DESCONTO': computed.totalDesconto,
        precoPromocional: computed.precoPromocional,
        precoFinal: computed.precoPromocional,
        'PREÇO PROMOCIONAL': computed.precoPromocional,
        'PRECO PROMOCIONAL': computed.precoPromocional,
        novoCustoMedio: computed.novoCustoMedio,
        'NOVO CUSTO MÉDIO': computed.novoCustoMedio,
        'NOVO CUSTO MEDIO': computed.novoCustoMedio,
        margemEstoque: computed.margemEstoque,
        'MARGEM ESTOQUE': computed.margemEstoque,
        'MARGEM EST.': computed.margemEstoque,
        margemPrice: computed.margemPrice,
        'MARGEM PRICE': computed.margemPrice,
      };
    });

    const nextItem: FluxoComparativo = {
      ...analysisItem,
      payload: {
        ...(analysisItem.payload || {}),
        [tabKey]: updatedRows,
      },
    };

    syncEditedPayload(nextItem);
  };

  const formatDescTelecelInput = (tab: AnalysisTab, rowRef: any) => {
    if (!analysisItem) return;

    const tabKey = tab === 'COM_OFERTAS' ? 'comOfertas' : 'semOfertas';
    const currentRows = Array.isArray(analysisItem.payload?.[tabKey]) ? analysisItem.payload[tabKey] : [];
    const refDesc = getProductDescription(rowRef);
    const refReference = getProductReference(rowRef);

    const updatedRows = currentRows.map((row: any) => {
      const sameRow = row === rowRef || (
        getProductDescription(row) === refDesc && getProductReference(row) === refReference
      );

      if (!sameRow) return row;

      const computed = getComputedRow(row);
      return {
        ...row,
        descTelecelInput: computed.descTelecel.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      };
    });

    syncEditedPayload({
      ...analysisItem,
      payload: {
        ...(analysisItem.payload || {}),
        [tabKey]: updatedRows,
      },
    });
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

  const sendTable = async (item: FluxoComparativo) => {
    setActionLoadingId(item.id);
    setErrorMsg('');
    setSuccessMsg('');

    const sourceItem = analysisItem?.id === item.id ? analysisItem : item;

    try {
      const data = await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(item.id)}/send-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id || '',
          to: 'analista.samsungtelecel@gmail.com',
          payload: sourceItem.payload,
        }),
      });

      if (data?.fileBase64 && data?.fileName) {
        downloadBase64File(data.fileBase64, data.fileName);
      }

      setSuccessMsg('Tabela gerada, baixada e enviada por e-mail para analista.samsungtelecel@gmail.com.');
      await loadItems();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao enviar tabela.');
    } finally {
      setActionLoadingId('');
    }
  };

  const openAnalysis = (item: FluxoComparativo) => {
    setAnalysisItem(JSON.parse(JSON.stringify(item)));
    setAnalysisTab('COM_OFERTAS');
    setAnalysisSearch('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const renderHeaderCell = (
    label: string,
    extraClass = '',
    options?: {
      toggle?: boolean;
      isOpen?: boolean;
      onClick?: () => void;
    }
  ) => (
    <th className={`border-b border-slate-200 px-2 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 ${extraClass}`}>
      <div className="flex items-center justify-center gap-1">
        {options?.toggle ? (
          <button
            type="button"
            onClick={options.onClick}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-1 text-[10px] font-black uppercase text-sky-700 shadow-sm hover:bg-sky-50"
            title={options.isOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-50 text-sky-700">
              {options.isOpen ? '−' : '+'}
            </span>
            {label}
          </button>
        ) : (
          <span>{label}</span>
        )}
      </div>
    </th>
  );

  const renderAnalysisTable = () => (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[11px]">
          <thead className="sticky top-0 z-30 bg-slate-100 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 w-[230px] border-b border-slate-200 bg-white px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Produto</th>
              {renderHeaderCell('Preço Samsung', 'w-[105px] bg-emerald-50')}
              {renderHeaderCell('Preço Telecel', 'w-[105px] bg-emerald-50')}
              {renderHeaderCell('Desc. Telecel', 'w-[135px] bg-orange-50')}
              {showDiscountDetails ? (
                <>
                  {renderHeaderCell('Descontos', 'w-[105px] bg-sky-50', {
                    toggle: true,
                    isOpen: showDiscountDetails,
                    onClick: () => setShowDiscountDetails(false),
                  })}
                  {renderHeaderCell('Desc. Trade In', 'w-[115px] bg-sky-50')}
                  {renderHeaderCell('Desc. Bogo', 'w-[105px] bg-sky-50')}
                  {renderHeaderCell('Desc. SIP', 'w-[100px] bg-sky-50')}
                </>
              ) : (
                renderHeaderCell('Descontos', 'w-[105px] bg-sky-50', {
                  toggle: true,
                  isOpen: showDiscountDetails,
                  onClick: () => setShowDiscountDetails(true),
                })
              )}
              {renderHeaderCell('Total Desconto', 'w-[120px] bg-amber-50')}
              {renderHeaderCell('Preço Promocional', 'w-[135px] bg-yellow-100')}
              {renderHeaderCell('Qtd Est.', 'w-[80px] bg-slate-50')}
              {renderHeaderCell('Custo Médio', 'w-[110px] bg-slate-50')}
              {renderHeaderCell('Novo Custo Médio', 'w-[135px] bg-slate-50')}
              {renderHeaderCell('Margem Price', 'w-[100px] bg-slate-50')}
              {renderHeaderCell('Qtd Vend.', 'w-[80px] bg-slate-50')}
              {showPriceDetails ? (
                <>
                  {renderHeaderCell('Price Rebate', 'w-[110px] bg-lime-50', {
                    toggle: true,
                    isOpen: showPriceDetails,
                    onClick: () => setShowPriceDetails(false),
                  })}
                  {renderHeaderCell('Price Trade In', 'w-[120px] bg-lime-50')}
                  {renderHeaderCell('Price Bogo', 'w-[105px] bg-lime-50')}
                  {renderHeaderCell('Price SIP', 'w-[100px] bg-lime-50')}
                </>
              ) : (
                renderHeaderCell('Prices', 'w-[100px] bg-lime-50', {
                  toggle: true,
                  isOpen: showPriceDetails,
                  onClick: () => setShowPriceDetails(true),
                })
              )}
              {renderHeaderCell('Oferta Atual', 'w-[115px] bg-green-50')}
              {renderHeaderCell('Status', 'min-w-[105px] bg-green-50')}
            </tr>
          </thead>
          <tbody>
            {analysisRows.map((row: any, index: number) => {
              const computed = getComputedRow(row);
              const descTelecelDisplay = String(
                pickValue(
                  row,
                  ['descTelecelInput'],
                  computed.descTelecel.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                )
              );
              const marginPriceClass = getMarginClass(computed.margemPrice);

              return (
                <tr key={`${computed.descricao}-${index}`} className="hover:bg-slate-50">
                  <td className="sticky left-0 z-20 border-b border-slate-100 bg-white px-3 py-2 align-middle font-black text-slate-900">
                    <div>{computed.descricao}</div>
                  </td>
                  <td className="border-b border-slate-100 bg-emerald-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.precoSamsung)}</td>
                  <td className="border-b border-slate-100 bg-emerald-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.precoTelecel)}</td>
                  <td className="border-b border-slate-100 bg-orange-50 px-2 py-2 text-right">
                    {isPresidencia ? (
                      <input
                        value={descTelecelDisplay}
                        onChange={(event) => updateDescTelecel(analysisTab, row, event.target.value)}
                        onBlur={() => formatDescTelecelInput(analysisTab, row)}
                        inputMode="decimal"
                        title="Desc. Telecel"
                        className="w-full rounded-xl border border-orange-200 bg-white px-2 py-2 text-right text-xs font-black text-orange-700 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                    ) : (
                      <span className="font-black text-orange-700">{formatMoney(computed.descTelecel)}</span>
                    )}
                  </td>
                  {showDiscountDetails ? (
                    <>
                      <td className="border-b border-slate-100 bg-sky-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.descRebate)}</td>
                      <td className="border-b border-slate-100 bg-sky-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.descTradeIn)}</td>
                      <td className="border-b border-slate-100 bg-sky-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.descBogo)}</td>
                      <td className="border-b border-slate-100 bg-sky-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.descSip)}</td>
                    </>
                  ) : (
                    <td className="border-b border-slate-100 bg-sky-50 px-2 py-3 text-center text-[10px] font-black uppercase tracking-widest text-sky-700">Oculto</td>
                  )}
                  <td className="border-b border-slate-100 bg-amber-50 px-2 py-3 text-right font-black text-slate-900">{formatMoney(computed.totalDesconto)}</td>
                  <td className="border-b border-slate-100 bg-yellow-100 px-2 py-3 text-right font-black text-slate-900">{formatMoney(computed.precoPromocional)}</td>
                  <td className="border-b border-slate-100 bg-slate-50 px-2 py-3 text-right font-bold text-slate-700">{formatInteger(computed.qtdEstoque)}</td>
                  <td className="border-b border-slate-100 bg-slate-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.custoMedio)}</td>
                  <td className="border-b border-slate-100 bg-slate-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.novoCustoMedio)}</td>
                  <td className={`border-b border-slate-100 px-2 py-3 text-right ${marginPriceClass}`}>{formatPercent(computed.margemPrice)}</td>
                  <td className="border-b border-slate-100 bg-slate-50 px-2 py-3 text-right font-bold text-slate-700">{formatInteger(computed.qtdVendida)}</td>
                  {showPriceDetails ? (
                    <>
                      <td className="border-b border-slate-100 bg-lime-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.priceRebate)}</td>
                      <td className="border-b border-slate-100 bg-lime-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.priceTradeIn)}</td>
                      <td className="border-b border-slate-100 bg-lime-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.priceBogo)}</td>
                      <td className="border-b border-slate-100 bg-lime-50 px-2 py-3 text-right text-slate-700">{formatMoney(computed.priceSip)}</td>
                    </>
                  ) : (
                    <td className="border-b border-slate-100 bg-lime-50 px-2 py-3 text-center text-[10px] font-black uppercase tracking-widest text-lime-700">Oculto</td>
                  )}
                  <td className="border-b border-slate-100 bg-green-50 px-2 py-3 text-right font-black text-slate-800">{formatMoney(computed.ofertaAtual)}</td>
                  <td className="border-b border-slate-100 bg-green-50 px-2 py-3 text-center font-black uppercase text-slate-700">{computed.status}</td>
                </tr>
              );
            })}

            {analysisRows.length === 0 && (
              <tr>
                <td colSpan={15 + (showDiscountDetails ? 3 : 0) + (showPriceDetails ? 3 : 0)} className="px-4 py-12 text-center text-slate-400">
                  Nenhum item encontrado nesta aba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

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
                  <tr key={item.id} className="hover:bg-slate-50">
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

                        {item.status === 'RESPONDIDO' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => sendTable(item)}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {busy ? <RefreshCw size={14} /> : <Send size={14} />} Enviar tabela
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
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

      {analysisItem && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="flex h-[92vh] w-full max-w-[98vw] flex-col rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-4 md:p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black uppercase tracking-tight text-slate-900">Análise do Comparativo</h2>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClasses(analysisItem.status)}`}>
                      {statusLabel(analysisItem.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {analysisItem.titulo} • {analysisItem.tipoComparativo} • Criado por {analysisItem.criadoPorNome || '-'} em {formatDate(analysisItem.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {isPresidencia && analysisItem.status === 'EM_ANALISE' && (
                    <>
                      <button
                        type="button"
                        disabled={actionLoadingId === analysisItem.id}
                        onClick={() => updateStatus(analysisItem, 'RESPONDIDO')}
                        className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle2 size={15} /> Marcar como respondido
                      </button>
                      <button
                        type="button"
                        disabled={actionLoadingId === analysisItem.id}
                        onClick={() => { setDevolverItem(analysisItem); setDevolverMotivo(''); }}
                        className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        <RotateCcw size={15} /> Devolver comparativo
                      </button>
                    </>
                  )}

                  {analysisItem.status === 'RESPONDIDO' && (
                    <button
                      type="button"
                      disabled={actionLoadingId === analysisItem.id}
                      onClick={() => sendTable(analysisItem)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {actionLoadingId === analysisItem.id ? <RefreshCw size={15} /> : <Send size={15} />} Enviar tabela
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setAnalysisItem(null)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase text-slate-700 hover:bg-slate-50"
                  >
                    <X size={15} /> Fechar
                  </button>
                </div>
              </div>

              {analysisItem.motivoDevolucao && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <strong>Motivo da devolução:</strong> {analysisItem.motivoDevolucao}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-hidden p-4 md:p-5">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAnalysisTab('COM_OFERTAS')}
                    className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-widest transition ${analysisTab === 'COM_OFERTAS' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Com ofertas ({getRowCounts(analysisItem).comOfertas})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalysisTab('SEM_OFERTAS')}
                    className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-widest transition ${analysisTab === 'SEM_OFERTAS' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Sem ofertas ({getRowCounts(analysisItem).semOfertas})
                  </button>
                  <div className="ml-0 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500 xl:ml-3">
                    <span className="rounded-full bg-slate-100 px-3 py-2">Total: {getRowCounts(analysisItem).total}</span>
                    <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-700">Status: {statusLabel(analysisItem.status)}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-2">Criado por: {analysisItem.criadoPorNome || '-'}</span>
                  </div>
                </div>

                <div className="relative w-full xl:w-[360px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={analysisSearch}
                    onChange={(event) => setAnalysisSearch(event.target.value)}
                    placeholder="Buscar produto, referência ou status"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <span className="font-black text-orange-700">Desc. Telecel</span> é editável pela presidência. Use os botões <strong>+ / −</strong> nos cabeçalhos para abrir ou ocultar os detalhes de descontos e prices. Margens abaixo de <strong>25%</strong> ficam em vermelho. <span className="font-black text-slate-900">Preço Promocional</span> representa o preço final do aparelho.
              </div>

              {renderAnalysisTable()}
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
