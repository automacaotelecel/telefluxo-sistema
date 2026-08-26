import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  XCircle,
} from 'lucide-react';
import './InventoryAuditDashboard.css';

type CurrentUser = {
  id?: string;
  name?: string;
  role?: string;
  isAdmin?: boolean | number;
};

type DashboardSummary = {
  storesTotal: number;
  storesAudited: number;
  storesPendingAudit: number;
  sessions: number;
  completed: number;
  active: number;
  expected: number;
  checked: number;
  missing: number;
  unexpected: number;
  adherence: number;
};

type StoreRow = {
  storeName: string;
  sessionId: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NOT_AUDITED';
  operatorName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expected: number;
  checked: number;
  missing: number;
  unexpected: number;
  duplicates: number;
  invalid: number;
  adherence: number;
};

type SessionRow = {
  id: string;
  storeName: string;
  operatorName: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startedAt: string;
  completedAt?: string | null;
  expected: number;
  checked: number;
  missing: number;
  unexpected: number;
  duplicates: number;
  invalid: number;
  adherence: number;
};

type MissingProduct = {
  productCode: string;
  reference: string;
  description: string;
  missing: number;
  stores: string[];
};

type DashboardPayload = {
  success: boolean;
  generatedAt: string;
  period: { from: string; to: string; days: number };
  summary: DashboardSummary;
  stores: StoreRow[];
  recentSessions: SessionRow[];
  topMissingProducts: MissingProduct[];
  storeOptions: string[];
  error?: string;
};

type SessionDetail = {
  success: boolean;
  session: {
    id: string;
    storeName: string;
    operatorName: string;
    status: string;
    startedAt: string;
    completedAt?: string | null;
  };
  stats: {
    expected: number;
    checked: number;
    pending: number;
    unexpected: number;
    duplicates: number;
    invalid: number;
    progress: number;
  };
  productSummary: Array<{
    productCode: string;
    reference: string;
    description: string;
    expected: number;
    checked: number;
    missing: number;
    progress: number;
  }>;
  missingItems: Array<{
    id: string;
    imei: string;
    productCode: string;
    reference: string;
    description: string;
  }>;
  unexpectedScans: Array<{
    id: string;
    imei: string;
    description?: string | null;
    foundStore?: string | null;
    createdAt: string;
  }>;
  error?: string;
};

const EMPTY_SUMMARY: DashboardSummary = {
  storesTotal: 0,
  storesAudited: 0,
  storesPendingAudit: 0,
  sessions: 0,
  completed: 0,
  active: 0,
  expected: 0,
  checked: 0,
  missing: 0,
  unexpected: 0,
  adherence: 0,
};

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');
  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  return isLocal ? `http://${window.location.hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusLabel(status: StoreRow['status'] | SessionRow['status']) {
  if (status === 'ACTIVE') return 'EM ANDAMENTO';
  if (status === 'COMPLETED') return 'FINALIZADA';
  if (status === 'CANCELLED') return 'CANCELADA';
  return 'NÃO CONFERIDA';
}

function adherenceClass(value: number, hasSession = true) {
  if (!hasSession) return 'neutral';
  if (value >= 98) return 'excellent';
  if (value >= 90) return 'warning';
  return 'critical';
}

export default function InventoryAuditDashboard({ currentUser }: { currentUser: CurrentUser }) {
  const API_URL = useMemo(() => getApiUrl(), []);
  const userId = String(currentUser?.id || '');
  const [days, setDays] = useState('7');
  const [storeFilter, setStoreFilter] = useState('');
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const loadDashboard = useCallback(async (silent = false) => {
    if (!userId) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ userId, days });
      if (storeFilter) params.set('store', storeFilter);
      const response = await fetch(`${API_URL}/api/inventory-audit/dashboard?${params.toString()}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar o BI de conferências.');
      setPayload(json as DashboardPayload);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar o BI de conferências.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [API_URL, days, storeFilter, userId]);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  const openSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId || !userId) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sessions/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível abrir os detalhes da conferência.');
      setDetail(json as SessionDetail);
    } catch (err: any) {
      setDetailError(err?.message || 'Erro ao abrir a conferência.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [API_URL, userId]);

  const summary = payload?.summary || EMPTY_SUMMARY;
  const filteredStores = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return payload?.stores || [];
    return (payload?.stores || []).filter((item) => item.storeName.toUpperCase().includes(q));
  }, [payload?.stores, search]);

  const coverage = summary.storesTotal > 0 ? (summary.storesAudited / summary.storesTotal) * 100 : 0;
  const missingProducts = detail?.productSummary.filter((item) => item.missing > 0) || [];

  if (loading) {
    return (
      <div className="audit-bi-shell">
        <div className="audit-bi-loading"><RefreshCw className="audit-bi-spin" size={24} /> Carregando BI de conferências...</div>
      </div>
    );
  }

  return (
    <div className="audit-bi-shell">
      <div className="audit-bi-page">
        <section className="audit-bi-hero">
          <div>
            <span className="audit-bi-eyebrow"><ShieldCheck size={14} /> TELEFLUXO • AUDITORIA CORPORATIVA</span>
            <h1>BI de Conferências</h1>
            <p>Visão administrativa das contagens físicas de aparelhos, aderência por loja, faltas e divergências registradas no bipador.</p>
          </div>
          <div className="audit-bi-filters">
            <label>
              <Calendar size={15} /> Período
              <select value={days} onChange={(event) => setDays(event.target.value)}>
                <option value="1">Hoje</option>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
              </select>
            </label>
            <label>
              <Store size={15} /> Loja
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
                <option value="">Todas as lojas</option>
                {(payload?.storeOptions || []).map((store) => <option key={store} value={store}>{store}</option>)}
              </select>
            </label>
            <button onClick={() => void loadDashboard(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'audit-bi-spin' : ''} size={16} /> Atualizar
            </button>
          </div>
        </section>

        {error && <div className="audit-bi-error"><AlertTriangle size={18} /> {error}</div>}

        <section className="audit-bi-kpis">
          <div className="audit-bi-kpi blue"><span><Store size={18} /></span><div><small>LOJAS CONFERIDAS</small><strong>{summary.storesAudited}<em>/ {summary.storesTotal}</em></strong><p>{summary.storesPendingAudit} sem conferência no período</p></div></div>
          <div className="audit-bi-kpi green"><span><CheckCircle2 size={18} /></span><div><small>ADERÊNCIA GERAL</small><strong>{summary.adherence.toFixed(1)}%</strong><p>{formatNumber(summary.checked)} de {formatNumber(summary.expected)} aparelhos</p></div></div>
          <div className="audit-bi-kpi orange"><span><Clock3 size={18} /></span><div><small>FALTAS ATUAIS</small><strong>{formatNumber(summary.missing)}</strong><p>Na última conferência de cada loja</p></div></div>
          <div className="audit-bi-kpi red"><span><AlertTriangle size={18} /></span><div><small>DIVERGÊNCIAS</small><strong>{formatNumber(summary.unexpected)}</strong><p>Aparelhos fora da base esperada</p></div></div>
          <div className="audit-bi-kpi navy"><span><BarChart3 size={18} /></span><div><small>CONFERÊNCIAS</small><strong>{formatNumber(summary.sessions)}</strong><p>{summary.completed} finalizadas • {summary.active} em andamento</p></div></div>
        </section>

        <section className="audit-bi-coverage-card">
          <div><span>COBERTURA DE CONFERÊNCIA NO PERÍODO</span><strong>{coverage.toFixed(1)}%</strong></div>
          <div className="audit-bi-coverage-track"><i style={{ width: `${Math.min(coverage, 100)}%` }} /></div>
          <small>{summary.storesAudited} loja(s) com conferência registrada • {summary.storesPendingAudit} aguardando contagem</small>
        </section>

        <div className="audit-bi-grid">
          <section className="audit-bi-panel audit-bi-stores-panel">
            <header>
              <div><span>VISÃO POR LOJA</span><h2>Última conferência do período</h2></div>
              <div className="audit-bi-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar loja" /></div>
            </header>

            <div className="audit-bi-store-table-wrap">
              <table className="audit-bi-store-table">
                <thead><tr><th>Loja</th><th>Última conferência</th><th>Status</th><th>Base</th><th>Bipados</th><th>Faltas</th><th>Div.</th><th>Aderência</th><th /></tr></thead>
                <tbody>
                  {filteredStores.map((item) => {
                    const hasSession = Boolean(item.sessionId);
                    const tone = adherenceClass(item.adherence, hasSession);
                    return (
                      <tr key={item.storeName} className={hasSession ? 'clickable' : ''} onClick={() => hasSession && void openSession(item.sessionId)}>
                        <td><strong>{item.storeName}</strong><small>{item.operatorName ? `Por ${item.operatorName}` : 'Sem conferência registrada'}</small></td>
                        <td>{formatDateTime(item.startedAt)}</td>
                        <td><span className={`audit-bi-status ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td>
                        <td>{hasSession ? formatNumber(item.expected) : '—'}</td>
                        <td>{hasSession ? formatNumber(item.checked) : '—'}</td>
                        <td><b className={item.missing > 0 ? 'audit-bi-value-danger' : ''}>{hasSession ? formatNumber(item.missing) : '—'}</b></td>
                        <td><b className={item.unexpected > 0 ? 'audit-bi-value-danger' : ''}>{hasSession ? formatNumber(item.unexpected) : '—'}</b></td>
                        <td><div className={`audit-bi-adherence ${tone}`}><strong>{hasSession ? `${item.adherence.toFixed(1)}%` : '—'}</strong><i><em style={{ width: `${hasSession ? Math.min(item.adherence, 100) : 0}%` }} /></i></div></td>
                        <td>{hasSession && <ChevronRight size={17} />}</td>
                      </tr>
                    );
                  })}
                  {filteredStores.length === 0 && <tr><td colSpan={9} className="audit-bi-empty-row">Nenhuma loja encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="audit-bi-panel audit-bi-ranking">
            <header><div><span>RANKING DE ATENÇÃO</span><h2>Produtos mais faltantes</h2></div><Package size={20} /></header>
            <div className="audit-bi-ranking-list">
              {(payload?.topMissingProducts || []).map((item, index) => (
                <div key={`${item.productCode}-${item.reference}-${item.description}`}>
                  <span className="audit-bi-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{item.description}</strong><small>{item.reference || `Cód. ${item.productCode}`} • {item.stores.length} loja(s)</small></div>
                  <b>{item.missing}<small> faltando</small></b>
                </div>
              ))}
              {(payload?.topMissingProducts || []).length === 0 && <div className="audit-bi-all-ok"><CheckCircle2 size={28} /><strong>Sem faltas atuais</strong><span>Nenhuma falta encontrada nas últimas conferências do período.</span></div>}
            </div>
          </aside>
        </div>

        <section className="audit-bi-panel audit-bi-history">
          <header><div><span>LINHA DO TEMPO</span><h2>Conferências recentes</h2></div><Clock3 size={20} /></header>
          <div className="audit-bi-history-list">
            {(payload?.recentSessions || []).slice(0, 20).map((item) => (
              <button key={item.id} onClick={() => void openSession(item.id)}>
                <span className={`audit-bi-history-icon ${item.status.toLowerCase()}`}>{item.status === 'COMPLETED' ? <CheckCircle2 size={17} /> : item.status === 'ACTIVE' ? <Clock3 size={17} /> : <XCircle size={17} />}</span>
                <div className="audit-bi-history-main"><strong>{item.storeName}</strong><small>{formatDateTime(item.startedAt)} • {item.operatorName}</small></div>
                <div><small>BASE</small><strong>{item.expected}</strong></div>
                <div><small>FALTAS</small><strong className={item.missing > 0 ? 'audit-bi-value-danger' : ''}>{item.missing}</strong></div>
                <div><small>ADERÊNCIA</small><strong>{item.adherence.toFixed(1)}%</strong></div>
                <ChevronRight size={17} />
              </button>
            ))}
            {(payload?.recentSessions || []).length === 0 && <div className="audit-bi-empty-history">Nenhuma conferência registrada neste período.</div>}
          </div>
        </section>
      </div>

      {(detailLoading || detail || detailError) && (
        <div className="audit-bi-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDetail(null); setDetailError(''); } }}>
          <div className="audit-bi-modal">
            <div className="audit-bi-modal-head">
              <div><span>DETALHE DA CONFERÊNCIA</span><h2>{detail?.session.storeName || 'Carregando...'}</h2>{detail && <small>{formatDateTime(detail.session.startedAt)} • {detail.session.operatorName}</small>}</div>
              <button onClick={() => { setDetail(null); setDetailError(''); }}><XCircle size={22} /></button>
            </div>

            {detailLoading ? <div className="audit-bi-modal-loading"><RefreshCw className="audit-bi-spin" size={22} /> Abrindo conferência...</div> : detailError ? <div className="audit-bi-error"><AlertTriangle size={18} /> {detailError}</div> : detail && (
              <>
                <div className="audit-bi-modal-kpis">
                  <div><small>Base</small><strong>{detail.stats.expected}</strong></div>
                  <div><small>Bipados</small><strong>{detail.stats.checked}</strong></div>
                  <div><small>Faltando</small><strong className={detail.stats.pending > 0 ? 'audit-bi-value-danger' : ''}>{detail.stats.pending}</strong></div>
                  <div><small>Divergências</small><strong className={detail.stats.unexpected > 0 ? 'audit-bi-value-danger' : ''}>{detail.stats.unexpected}</strong></div>
                  <div><small>Aderência</small><strong>{detail.stats.progress.toFixed(1)}%</strong></div>
                </div>

                <div className="audit-bi-modal-columns">
                  <section>
                    <div className="audit-bi-modal-section-title"><span>FALTAS POR PRODUTO</span><b>{missingProducts.length} produto(s)</b></div>
                    <div className="audit-bi-modal-products">
                      {missingProducts.map((product) => (
                        <div key={`${product.productCode}-${product.reference}`}>
                          <div><strong>{product.description}</strong><small>{product.reference || product.productCode} • {product.checked}/{product.expected} conferidos</small></div>
                          <b>{product.missing}<small> faltando</small></b>
                        </div>
                      ))}
                      {missingProducts.length === 0 && <div className="audit-bi-all-ok"><CheckCircle2 size={28} /><strong>Conferência sem faltas</strong></div>}
                    </div>
                  </section>

                  <section>
                    <div className="audit-bi-modal-section-title"><span>IMEIS FALTANTES</span><b>{detail.missingItems.length}</b></div>
                    <div className="audit-bi-imei-list">
                      {detail.missingItems.slice(0, 100).map((item) => <div key={item.id}><code>{item.imei}</code><span>{item.description}</span></div>)}
                      {detail.missingItems.length > 100 && <small className="audit-bi-more">Exibindo os primeiros 100 de {detail.missingItems.length} IMEIs.</small>}
                      {detail.missingItems.length === 0 && <div className="audit-bi-all-ok compact"><CheckCircle2 size={24} /><strong>Nenhum IMEI faltante</strong></div>}
                    </div>
                  </section>
                </div>

                {detail.unexpectedScans.length > 0 && (
                  <section className="audit-bi-modal-divergences">
                    <div className="audit-bi-modal-section-title"><span>DIVERGÊNCIAS ENCONTRADAS</span><b>{detail.unexpectedScans.length}</b></div>
                    {detail.unexpectedScans.map((item) => <div key={item.id}><AlertTriangle size={16} /><code>{item.imei}</code><span>{item.description || 'IMEI não localizado'}{item.foundStore ? ` • Base: ${item.foundStore}` : ''}</span></div>)}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
