import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ClipboardCheck,
  Download,
  History,
  Keyboard,
  Loader2,
  PackageCheck,
  Pencil,
  Play,
  Plus,
  Save,
  ScanLine,
  Smartphone,
  Store,
  Trash2,
  TriangleAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import './SampleConferenceModule.css';

type CurrentUser = {
  id?: string;
  name?: string;
  role?: string;
  allowedStores?: string;
  isAdmin?: boolean | number;
};

type StoreOption = {
  name: string;
  expected: number;
  products: number;
};

type SampleSession = {
  id: string;
  userId: string;
  operatorName: string;
  storeName: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startedAt: string;
  completedAt?: string | null;
  updatedAt: string;
};

type SampleItem = {
  id: string;
  sessionId: string;
  imei: string;
  source: string;
  productCode?: string | null;
  reference?: string | null;
  description?: string | null;
  stockStore?: string | null;
  stockStatus: 'CURRENT_STORE' | 'OTHER_STORE' | 'NOT_FOUND';
  hasDamage: boolean;
  damageType?: string | null;
  observation?: string | null;
  createdAt: string;
  updatedAt: string;
};

type SampleStats = {
  total: number;
  withDamage: number;
  withoutDamage: number;
  outsideStore: number;
  notFound: number;
};

type SampleRead = Partial<SampleItem> & {
  result: 'CURRENT_STORE' | 'OTHER_STORE' | 'NOT_FOUND' | 'DUPLICATE' | 'INVALID';
  title: string;
  message: string;
};

type SamplePayload = {
  success: boolean;
  reused?: boolean;
  session: SampleSession;
  stats: SampleStats;
  items: SampleItem[];
  read?: SampleRead;
  error?: string;
};

type CameraControls = { stop: () => void };

const EMPTY_STATS: SampleStats = {
  total: 0,
  withDamage: 0,
  withoutDamage: 0,
  outsideStore: 0,
  notFound: 0,
};

const CAMERA_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13,
  BarcodeFormat.QR_CODE,
];

function createCameraHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, CAMERA_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');

  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  return isLocal ? `http://${window.location.hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadReport(session: SampleSession, items: SampleItem[]) {
  const lines = [
    [
      'LOJA',
      'OPERADOR',
      'DATA',
      'IMEI',
      'CODIGO',
      'REFERENCIA',
      'APARELHO',
      'STATUS_ESTOQUE',
      'LOJA_NO_ESTOQUE',
      'AVARIA',
      'TIPO_DEFEITO',
      'OBSERVACAO',
    ].map(csvCell).join(';'),
    ...[...items].reverse().map((item) => [
      session.storeName,
      session.operatorName,
      formatDateTime(item.createdAt),
      item.imei,
      item.productCode || '',
      item.reference || '',
      item.description || 'Não identificado',
      item.stockStatus === 'CURRENT_STORE' ? 'LOJA_OK' : item.stockStatus === 'OTHER_STORE' ? 'OUTRA_LOJA' : 'FORA_DA_BASE',
      item.stockStore || '',
      item.hasDamage ? 'SIM' : 'NAO',
      item.damageType || '',
      item.observation || '',
    ].map(csvCell).join(';')),
  ];

  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `telefluxo_amostras_${session.storeName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${session.id.slice(0, 8)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stockStatusMeta(status: SampleItem['stockStatus']) {
  if (status === 'CURRENT_STORE') return { label: 'Loja OK', className: 'sample-status-ok' };
  if (status === 'OTHER_STORE') return { label: 'Outra loja', className: 'sample-status-warning' };
  return { label: 'Fora da base', className: 'sample-status-danger' };
}

export default function SampleConferenceModule({ currentUser }: { currentUser: CurrentUser }) {
  const API_URL = useMemo(() => getApiUrl(), []);
  const userId = String(currentUser?.id || '');

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [session, setSession] = useState<SampleSession | null>(null);
  const [stats, setStats] = useState<SampleStats>(EMPTY_STATS);
  const [items, setItems] = useState<SampleItem[]>([]);
  const [history, setHistory] = useState<SampleSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [lastRead, setLastRead] = useState<SampleRead | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasDamage, setHasDamage] = useState(false);
  const [damageType, setDamageType] = useState('');
  const [observation, setObservation] = useState('');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<CameraControls | null>(null);
  const scanInFlightRef = useRef(false);
  const recentReadsRef = useRef<Map<string, number>>(new Map());

  const applyPayload = useCallback((payload: SamplePayload | null) => {
    if (!payload) {
      setSession(null);
      setStats(EMPTY_STATS);
      setItems([]);
      setEditingId(null);
      return;
    }
    setSession(payload.session);
    setStats(payload.stats || EMPTY_STATS);
    setItems(payload.items || []);
  }, []);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar a conferência de amostras.');
    applyPayload(json as SamplePayload);
    if (json.session?.storeName) setSelectedStore(json.session.storeName);
  }, [API_URL, applyPayload, userId]);

  const loadHistory = useCallback(async (store = selectedStore) => {
    const params = new URLSearchParams({ userId, limit: '30' });
    if (store) params.set('store', store);
    const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions?${params.toString()}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar o histórico de amostras.');
    const list = Array.isArray(json.sessions) ? json.sessions : [];
    setHistory(list);
    return list as SampleSession[];
  }, [API_URL, selectedStore, userId]);

  useEffect(() => {
    let alive = true;
    async function boot() {
      if (!userId) {
        setError('Usuário do Telefluxo não identificado. Faça login novamente.');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(`${API_URL}/api/inventory-audit/stores?userId=${encodeURIComponent(userId)}`);
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar as lojas.');
        if (!alive) return;
        const list = Array.isArray(json.stores) ? json.stores : [];
        setStores(list);
        setSelectedStore(list[0]?.name || '');
      } catch (err: any) {
        if (alive) setError(err?.message || 'Erro ao carregar a conferência de amostras.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void boot();
    return () => { alive = false; };
  }, [API_URL, userId]);

  useEffect(() => {
    if (!selectedStore || !userId) {
      applyPayload(null);
      setHistory([]);
      return;
    }

    let alive = true;
    setError('');
    setLastRead(null);
    stopCamera();
    setCameraOpen(false);

    (async () => {
      try {
        const list = await loadHistory(selectedStore);
        if (!alive) return;
        const active = list.find((item) => item.status === 'ACTIVE');
        if (active) await loadSession(active.id);
        else applyPayload(null);
      } catch (err: any) {
        if (alive) setError(err?.message || 'Erro ao carregar a sessão de amostras.');
      }
    })();

    return () => { alive = false; };
  }, [applyPayload, loadHistory, loadSession, selectedStore, stopCamera, userId]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  function openEditor(item: SampleItem) {
    setEditingId(item.id);
    setHasDamage(Boolean(item.hasDamage));
    setDamageType(item.damageType || '');
    setObservation(item.observation || '');
  }

  const submitScan = useCallback(async (rawValue: string, source: 'CAMERA' | 'MANUAL') => {
    if (!session || session.status !== 'ACTIVE' || scanInFlightRef.current) return;
    const raw = String(rawValue || '').trim();
    if (!raw) return;

    const key = onlyDigits(raw) || raw;
    const now = Date.now();
    const last = recentReadsRef.current.get(key) || 0;
    if (source === 'CAMERA' && now - last < 2600) return;
    recentReadsRef.current.set(key, now);

    scanInFlightRef.current = true;
    setScanning(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions/${encodeURIComponent(session.id)}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, rawValue: raw, source }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível registrar a amostra.');
      applyPayload(json as SamplePayload);
      setLastRead(json.read || null);
      setManualValue('');
      if (json.read?.id) {
        const item = (json.items || []).find((row: SampleItem) => row.id === json.read.id);
        if (item) openEditor(item);
      }
      try { navigator.vibrate?.(json.read?.result === 'INVALID' ? [160, 60, 160] : [70]); } catch { /* optional */ }
    } catch (err: any) {
      setError(err?.message || 'Erro ao registrar a amostra.');
    } finally {
      scanInFlightRef.current = false;
      setScanning(false);
      if (source === 'MANUAL') window.setTimeout(() => manualInputRef.current?.focus(), 50);
    }
  }, [API_URL, applyPayload, session, userId]);

  async function startCamera() {
    if (!session || session.status !== 'ACTIVE') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador não permite acesso à câmera.');
      return;
    }

    stopCamera();
    setCameraOpen(true);
    setCameraStarting(true);
    setCameraError('');
    recentReadsRef.current.clear();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('Visor da câmera não encontrado.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const reader = new BrowserMultiFormatReader(createCameraHints(), {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 180,
      });
      controlsRef.current = await reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (result) void submitScan(result.getText(), 'CAMERA');
      });
      setCameraActive(true);
    } catch (err: any) {
      stopCamera();
      const name = String(err?.name || '');
      if (name === 'NotAllowedError') setCameraError('Permissão da câmera negada. Libere a câmera para o TeleFluxo.');
      else if (name === 'NotFoundError') setCameraError('Nenhuma câmera foi encontrada neste aparelho.');
      else setCameraError(err?.message || 'Não foi possível iniciar a câmera.');
    } finally {
      setCameraStarting(false);
    }
  }

  async function beginSession(forceNew = false) {
    if (!selectedStore || !userId) return;
    if (forceNew && session?.status === 'ACTIVE') {
      const ok = window.confirm('A conferência de amostras atual será cancelada e uma nova será iniciada. Continuar?');
      if (!ok) return;
    }

    setStarting(true);
    setError('');
    setLastRead(null);
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, store: selectedStore, forceNew }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível iniciar a conferência de amostras.');
      applyPayload(json as SamplePayload);
      await loadHistory(selectedStore);
      window.setTimeout(() => manualInputRef.current?.focus(), 80);
    } catch (err: any) {
      setError(err?.message || 'Erro ao iniciar conferência de amostras.');
    } finally {
      setStarting(false);
    }
  }

  async function saveItem() {
    if (!session || !editingId || session.status !== 'ACTIVE') return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, hasDamage, damageType, observation }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível salvar a observação.');
      applyPayload(json as SamplePayload);
      const updated = (json.items || []).find((item: SampleItem) => item.id === editingId);
      if (updated) openEditor(updated);
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar observação.');
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: SampleItem) {
    if (!session || session.status !== 'ACTIVE') return;
    if (!window.confirm(`Remover o IMEI ${item.imei} desta conferência?`)) return;
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível remover o aparelho.');
      applyPayload(json as SamplePayload);
      if (editingId === item.id) setEditingId(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao remover aparelho.');
    }
  }

  async function completeSession() {
    if (!session || session.status !== 'ACTIVE') return;
    if (items.length === 0) {
      setError('Bipe pelo menos um aparelho antes de finalizar a conferência.');
      return;
    }
    if (!window.confirm(`Finalizar a conferência com ${items.length} aparelho(s) e gerar o relatório para o estoque?`)) return;

    setCompleting(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sample-sessions/${encodeURIComponent(session.id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível finalizar a conferência.');
      applyPayload(json as SamplePayload);
      stopCamera();
      setCameraOpen(false);
      downloadReport(json.session, json.items || []);
      await loadHistory(selectedStore);
    } catch (err: any) {
      setError(err?.message || 'Erro ao finalizar conferência.');
    } finally {
      setCompleting(false);
    }
  }

  const selectedItem = items.find((item) => item.id === editingId) || null;

  if (loading) {
    return (
      <div className="sample-conference-shell">
        <div className="sample-conference-loading"><Loader2 className="animate-spin" size={22} /> Carregando conferência de amostras</div>
      </div>
    );
  }

  return (
    <div className="sample-conference-shell">
      <div className="sample-conference-page">
        <section className="sample-conference-hero">
          <div>
            <div className="sample-conference-eyebrow"><ClipboardCheck size={15} /> CONTROLE DE ESTOQUE • BIPADOR</div>
            <h1>Conferência de amostras</h1>
          </div>
          <div className="sample-conference-store-box">
            <label><Store size={15} /> Loja</label>
            <select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)} disabled={session?.status === 'ACTIVE'}>
              {stores.length === 0 && <option value="">Nenhuma loja disponível</option>}
              {stores.map((store) => <option key={store.name} value={store.name}>{store.name}</option>)}
            </select>
          </div>
        </section>

        {error && <div className="sample-conference-error"><AlertTriangle size={17} /> {error}</div>}

        {!session ? (
          <>
            <section className="sample-conference-start-card">
              <div className="sample-conference-start-icon"><ScanLine size={27} /></div>
              <div>
                <span>NOVA AMOSTRA</span>
                <h2>Começar conferência da mesa</h2>
                <p>Não há quantidade esperada. O relatório será formado apenas pelos aparelhos bipados nesta sessão.</p>
              </div>
              <button onClick={() => void beginSession()} disabled={!selectedStore || starting}>
                {starting ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} Iniciar
              </button>
            </section>

            {history.length > 0 && (
              <section className="sample-conference-card sample-history-card sample-start-history">
                <div className="sample-card-heading">
                  <div><History size={18} /><div><strong>Histórico recente</strong><span>Abra uma conferência para consultar ou baixar novamente o relatório.</span></div></div>
                </div>
                <div className="sample-history-list">
                  {history.slice(0, 8).map((entry) => (
                    <button key={entry.id} onClick={() => void loadSession(entry.id)}>
                      <div><strong>{formatDateTime(entry.startedAt)}</strong><span>{entry.operatorName}</span></div>
                      <small>{entry.status === 'COMPLETED' ? 'Finalizada' : entry.status === 'CANCELLED' ? 'Cancelada' : 'Aberta'}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="sample-conference-session-strip">
              <div>
                <strong>{session.storeName}</strong>
                <small>{session.operatorName} • iniciada em {formatDateTime(session.startedAt)}</small>
              </div>
              <div className={`sample-session-status ${session.status.toLowerCase()}`}>{session.status === 'ACTIVE' ? 'EM ANDAMENTO' : session.status === 'COMPLETED' ? 'FINALIZADA' : 'CANCELADA'}</div>
              <div className="sample-conference-session-actions">
                <button className="secondary" onClick={() => downloadReport(session, items)} disabled={items.length === 0}><Download size={15} /> Relatório</button>
                <button className="secondary" onClick={() => void beginSession(session.status === 'ACTIVE')}><Plus size={15} /> Nova</button>
                {session.status === 'ACTIVE' && <button className="primary" onClick={() => void completeSession()} disabled={completing || items.length === 0}>{completing ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Finalizar e gerar</button>}
              </div>
            </section>

            <section className="sample-conference-kpis">
              <div><PackageCheck size={19} /><span>Aparelhos bipados</span><strong>{stats.total}</strong></div>
              <div><Wrench size={19} /><span>Com avaria</span><strong>{stats.withDamage}</strong></div>
              <div><TriangleAlert size={19} /><span>Em outra loja</span><strong>{stats.outsideStore}</strong></div>
              <div><XCircle size={19} /><span>Fora da base</span><strong>{stats.notFound}</strong></div>
            </section>

            <div className="sample-conference-grid">
              <div className="sample-conference-main-column">
                {session.status === 'ACTIVE' && (
                  <section className="sample-conference-card sample-scanner-card">
                    <div className="sample-card-heading">
                      <div><ScanLine size={18} /><div><strong>Bipar aparelho</strong><span>Leitor físico, digitação ou câmera.</span></div></div>
                      <button className="camera-toggle" onClick={() => cameraActive ? (stopCamera(), setCameraOpen(false)) : void startCamera()}>
                        {cameraStarting ? <Loader2 className="animate-spin" size={15} /> : cameraActive ? <CameraOff size={15} /> : <Camera size={15} />}
                        {cameraActive ? 'Fechar câmera' : 'Usar câmera'}
                      </button>
                    </div>

                    {cameraOpen && (
                      <div className="sample-camera-box">
                        <video ref={videoRef} muted playsInline />
                        {cameraStarting && <div className="sample-camera-overlay"><Loader2 className="animate-spin" size={24} /> Abrindo câmera</div>}
                        {cameraActive && <div className="sample-camera-line" />}
                        {cameraError && <div className="sample-camera-error"><AlertTriangle size={15} /> {cameraError}</div>}
                      </div>
                    )}

                    <div className="sample-manual-box">
                      <div><Keyboard size={17} /><div><strong>IMEI</strong><span>O foco volta automaticamente para agilizar a sequência.</span></div></div>
                      <form onSubmit={(event) => { event.preventDefault(); void submitScan(manualValue, 'MANUAL'); }}>
                        <input ref={manualInputRef} value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder="Bipe ou digite o IMEI" inputMode="numeric" autoComplete="off" />
                        <button disabled={!manualValue.trim() || scanning}>{scanning ? <Loader2 className="animate-spin" size={16} /> : <ScanLine size={16} />} Bipar</button>
                      </form>
                    </div>

                    {lastRead && (
                      <div className={`sample-last-read ${lastRead.result === 'INVALID' ? 'danger' : lastRead.result === 'DUPLICATE' || lastRead.result === 'OTHER_STORE' ? 'warning' : 'success'}`}>
                        {lastRead.result === 'INVALID' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                        <div><strong>{lastRead.title}</strong><span>{lastRead.message}</span></div>
                      </div>
                    )}
                  </section>
                )}

                <section className="sample-conference-card sample-items-card">
                  <div className="sample-card-heading">
                    <div><Smartphone size={18} /><div><strong>Aparelhos da amostra</strong><span>{items.length} registro(s) nesta conferência.</span></div></div>
                  </div>

                  {items.length === 0 ? (
                    <div className="sample-empty-list"><ScanLine size={28} /><strong>Nenhum aparelho bipado</strong><span>O primeiro IMEI aparecerá aqui.</span></div>
                  ) : (
                    <div className="sample-items-list">
                      {items.map((item, index) => {
                        const meta = stockStatusMeta(item.stockStatus);
                        return (
                          <article key={item.id} className={`sample-item-row ${editingId === item.id ? 'selected' : ''}`}>
                            <div className="sample-item-number">{items.length - index}</div>
                            <div className="sample-item-main">
                              <div className="sample-item-title">
                                <strong>{item.description || 'Aparelho não identificado'}</strong>
                                <span className={meta.className}>{meta.label}</span>
                                {item.hasDamage && <span className="sample-status-damage"><Wrench size={11} /> Avaria</span>}
                              </div>
                              <code>{item.imei}</code>
                              <small>{item.reference || item.productCode || 'Sem referência'}{item.stockStore && item.stockStatus !== 'CURRENT_STORE' ? ` • estoque: ${item.stockStore}` : ''}</small>
                              {item.hasDamage && <p><b>{item.damageType || 'Avaria informada'}</b>{item.observation ? ` — ${item.observation}` : ''}</p>}
                            </div>
                            <div className="sample-item-actions">
                              <button title="Editar observação" onClick={() => openEditor(item)}><Pencil size={15} /></button>
                              {session.status === 'ACTIVE' && <button className="danger" title="Remover" onClick={() => void removeItem(item)}><Trash2 size={15} /></button>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              <aside className="sample-conference-side-column">
                <section className="sample-conference-card sample-editor-card">
                  <div className="sample-card-heading">
                    <div><Wrench size={18} /><div><strong>Observação / avaria</strong><span>Mapeie o estado do aparelho selecionado.</span></div></div>
                  </div>

                  {!selectedItem ? (
                    <div className="sample-editor-empty"><Pencil size={24} /><span>Selecione ou bipe um aparelho para registrar uma observação.</span></div>
                  ) : (
                    <div className="sample-editor-form">
                      <div className="sample-editor-device">
                        <strong>{selectedItem.description || 'Aparelho não identificado'}</strong>
                        <code>{selectedItem.imei}</code>
                      </div>

                      <label className="sample-damage-toggle">
                        <input type="checkbox" checked={hasDamage} onChange={(event) => {
                          setHasDamage(event.target.checked);
                          if (!event.target.checked) setDamageType('');
                        }} disabled={session.status !== 'ACTIVE'} />
                        <span><Wrench size={15} /> Aparelho com avaria</span>
                      </label>

                      {hasDamage && (
                        <label>
                          <span>Tipo de defeito</span>
                          <input value={damageType} onChange={(event) => setDamageType(event.target.value)} placeholder="Ex.: risco na tela, tampa trincada..." maxLength={160} disabled={session.status !== 'ACTIVE'} />
                        </label>
                      )}

                      <label>
                        <span>Observação</span>
                        <textarea value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Detalhes adicionais sobre o estado da amostra" rows={5} maxLength={1000} disabled={session.status !== 'ACTIVE'} />
                      </label>

                      {session.status === 'ACTIVE' && <button className="sample-save-button" onClick={() => void saveItem()} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Salvar observação</button>}
                    </div>
                  )}
                </section>

                <section className="sample-conference-card sample-history-card">
                  <div className="sample-card-heading">
                    <div><History size={18} /><div><strong>Histórico recente</strong><span>Conferências da loja selecionada.</span></div></div>
                  </div>
                  <div className="sample-history-list">
                    {history.length === 0 && <span className="sample-history-empty">Nenhuma conferência anterior.</span>}
                    {history.slice(0, 8).map((entry) => (
                      <button key={entry.id} onClick={() => void loadSession(entry.id)} className={session.id === entry.id ? 'active' : ''}>
                        <div><strong>{formatDateTime(entry.startedAt)}</strong><span>{entry.operatorName}</span></div>
                        <small>{entry.status === 'ACTIVE' ? 'Aberta' : entry.status === 'COMPLETED' ? 'Finalizada' : 'Cancelada'}</small>
                      </button>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
