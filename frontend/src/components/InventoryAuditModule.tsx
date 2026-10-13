import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ChevronRight,
  AlertCircle,
  Clock3,
  Download,
  History,
  Keyboard,
  Laptop,
  Loader2,
  Package,
  Play,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
  Volume2,
  Watch,
  XCircle,
  Zap,
} from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import './InventoryAuditModule.css';

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
  missingIdentifierUnits?: number;
  missingIdentifierProducts?: number;
};

type AuditSession = {
  id: string;
  userId: string;
  operatorName: string;
  storeName: string;
  auditType: AuditType;
  auditLabel?: string;
  identifierMode?: 'IMEI' | 'BARCODE' | 'SERIAL' | 'AUTO';
  identifierLabel?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  expectedCount: number;
  sourceUpdatedAt?: string | null;
  startedAt: string;
  completedAt?: string | null;
  updatedAt: string;
};

type AuditStats = {
  expected: number;
  checked: number;
  pending: number;
  unexpected: number;
  duplicates: number;
  excess: number;
  invalid: number;
  progress: number;
};

type ProductSummary = {
  productCode: string;
  reference: string;
  description: string;
  expected: number;
  checked: number;
  missing: number;
  progress: number;
  auditType?: string;
  stockType?: string;
};

type MissingItem = {
  id: string;
  imei: string;
  identifier?: string;
  quantity?: number;
  productCode: string;
  reference: string;
  description: string;
  auditType?: string;
  stockType?: string;
};

type ScanItem = {
  id: string;
  imei: string;
  identifier?: string;
  rawValue?: string;
  result: 'FOUND' | 'UNEXPECTED' | 'DUPLICATE' | 'EXCESS' | 'INVALID' | 'AMBIGUOUS';
  source?: string;
  productCode?: string | null;
  reference?: string | null;
  description?: string | null;
  foundStore?: string | null;
  createdAt: string;
  auditType?: string;
  stockType?: string | null;
};

type ReadFeedback = {
  imei: string;
  identifier?: string;
  result: ScanItem['result'];
  title: string;
  message: string;
  description?: string | null;
  foundStore?: string | null;
  createdAt: string;
  auditType?: string;
  stockType?: string | null;
};

type SessionPayload = {
  success: boolean;
  reused?: boolean;
  session: AuditSession;
  stats: AuditStats;
  breakdown?: Record<string, AuditStats>;
  productSummary: ProductSummary[];
  missingItems: MissingItem[];
  unexpectedScans: ScanItem[];
  recentScans: ScanItem[];
  read?: ReadFeedback;
  warning?: string | null;
  audit?: { auditType: AuditType; label: string; identifierMode: 'IMEI' | 'BARCODE' | 'SERIAL' | 'AUTO'; identifierLabel: string };
  error?: string;
};

type AuditType = 'TODOS' | 'GERAL' | 'APARELHOS' | 'ACESSORIOS' | 'WEARABLES' | 'TABLETS' | 'NOTEBOOKS' | 'OUTROS';

type AuditTypeOption = {
  key: AuditType;
  label: string;
  singular: string;
  plural: string;
  identifierMode: 'IMEI' | 'BARCODE' | 'SERIAL' | 'AUTO';
  identifierLabel: string;
  icon: typeof Smartphone;
};

const AUDIT_TYPE_OPTIONS: AuditTypeOption[] = [
  { key: 'TODOS', label: 'Todos', singular: 'produto', plural: 'produtos', identifierMode: 'AUTO', identifierLabel: 'IMEI / serial / código', icon: Boxes },
  { key: 'APARELHOS', label: 'Aparelhos', singular: 'aparelho', plural: 'aparelhos', identifierMode: 'IMEI', identifierLabel: 'IMEI', icon: Smartphone },
  { key: 'ACESSORIOS', label: 'Acessórios', singular: 'acessório', plural: 'acessórios', identifierMode: 'BARCODE', identifierLabel: 'Código de barras', icon: Boxes },
  { key: 'WEARABLES', label: 'Wearables', singular: 'wearable', plural: 'wearables', identifierMode: 'SERIAL', identifierLabel: 'IMEI / serial', icon: Watch },
  { key: 'TABLETS', label: 'Tablets', singular: 'tablet', plural: 'tablets', identifierMode: 'BARCODE', identifierLabel: 'Código de barras', icon: Tablet },
  { key: 'NOTEBOOKS', label: 'Notebooks', singular: 'notebook', plural: 'notebooks', identifierMode: 'BARCODE', identifierLabel: 'Código de barras', icon: Laptop },
  { key: 'OUTROS', label: 'Outros', singular: 'produto', plural: 'produtos', identifierMode: 'AUTO', identifierLabel: 'Identificador', icon: Package },
];

type TabKey = 'conference' | 'pending' | 'history';

type CameraControls = { stop: () => void };

type NativeBarcodeResult = { rawValue: string; format?: string };
type NativeBarcodeDetector = { detect: (source: CanvasImageSource) => Promise<NativeBarcodeResult[]> };
type NativeBarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;
type WindowWithBarcodeDetector = Window & { BarcodeDetector?: NativeBarcodeDetectorConstructor };

const EMPTY_STATS: AuditStats = {
  expected: 0,
  checked: 0,
  pending: 0,
  unexpected: 0,
  duplicates: 0,
  excess: 0,
  invalid: 0,
  progress: 0,
};

const CAMERA_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
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

function resultMeta(result?: ScanItem['result']) {
  switch (result) {
    case 'FOUND':
      return { label: 'CONFERIDO', className: 'audit-result-success', icon: CheckCircle2 };
    case 'UNEXPECTED':
      return { label: 'FORA DA BASE', className: 'audit-result-danger', icon: XCircle };
    case 'DUPLICATE':
      return { label: 'JÁ BIPADO', className: 'audit-result-warning', icon: AlertCircle };
    case 'EXCESS':
      return { label: 'EXCEDENTE', className: 'audit-result-warning', icon: AlertTriangle };
    case 'AMBIGUOUS':
      return { label: 'IDENTIFICADOR AMBÍGUO', className: 'audit-result-danger', icon: AlertTriangle };
    case 'INVALID':
      return { label: 'INVÁLIDO', className: 'audit-result-danger', icon: AlertTriangle };
    default:
      return { label: 'AGUARDANDO', className: 'audit-result-idle', icon: ScanLine };
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function downloadCsv(session: AuditSession, missingItems: MissingItem[], unexpected: ScanItem[]) {
  const identifierLabel = 'IDENTIFICADOR';
  const lines = [
    ['TIPO', 'CONFERENCIA', 'LOJA', identifierLabel, 'QTD', 'CODIGO', 'REFERENCIA', 'PRODUTO', 'CATEGORIA', 'TIPO_ESTOQUE', 'LOJA_ENCONTRADA'].map(csvCell).join(';'),
    ...missingItems.map((item) => [
      'FALTANTE',
      session.auditLabel || session.auditType,
      session.storeName,
      item.identifier || item.imei,
      item.quantity || 1,
      item.productCode,
      item.reference,
      item.description,
      item.auditType || session.auditType,
      item.stockType || 'ESTOQUE',
      '',
    ].map(csvCell).join(';')),
    ...unexpected.map((item) => [
      item.result === 'EXCESS' ? 'EXCEDENTE' : 'FORA_DA_BASE',
      session.auditLabel || session.auditType,
      session.storeName,
      item.identifier || item.imei,
      1,
      item.productCode || '',
      item.reference || '',
      item.description || '',
      item.auditType || 'OUTROS',
      item.stockType || '',
      item.foundStore || '',
    ].map(csvCell).join(';')),
  ];

  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `telefluxo_conferencia_${session.auditType.toLowerCase()}_${session.storeName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${session.id.slice(0, 8)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function KpiCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: typeof Package;
  label: string;
  value: string | number;
  helper: string;
  tone: 'blue' | 'green' | 'orange' | 'red';
}) {
  return (
    <div className={`inventory-audit-kpi kpi-${tone}`}>
      <div className="inventory-audit-kpi-icon"><Icon size={18} /></div>
      <div className="min-w-0">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </div>
  );
}

export default function InventoryAuditModule({ currentUser, onOpenSampleConference }: { currentUser: CurrentUser; onOpenSampleConference?: () => void }) {
  const API_URL = useMemo(() => getApiUrl(), []);
  const userId = String(currentUser?.id || '');

  // Filtro de apresentação: não participa da criação/identidade da sessão.
  const [auditType, setAuditType] = useState<AuditType>('TODOS');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [session, setSession] = useState<AuditSession | null>(null);
  const [stats, setStats] = useState<AuditStats>(EMPTY_STATS);
  const [breakdown, setBreakdown] = useState<Record<string, AuditStats>>({});
  const [productSummary, setProductSummary] = useState<ProductSummary[]>([]);
  const [missingItems, setMissingItems] = useState<MissingItem[]>([]);
  const [unexpectedScans, setUnexpectedScans] = useState<ScanItem[]>([]);
  const [recentScans, setRecentScans] = useState<ScanItem[]>([]);
  const [history, setHistory] = useState<AuditSession[]>([]);
  const [tab, setTab] = useState<TabKey>('conference');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [lastRead, setLastRead] = useState<ReadFeedback | null>(null);
  const [searchMissing, setSearchMissing] = useState('');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<CameraControls | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const recentReadsRef = useRef<Map<string, number>>(new Map());
  const scanInFlightRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const precisionTimerRef = useRef<number | null>(null);
  const precisionReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const precisionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeDetectorRef = useRef<NativeBarcodeDetector | null>(null);

  const applyPayload = useCallback((payload: SessionPayload | null) => {
    if (!payload) {
      setSession(null);
      setStats(EMPTY_STATS);
      setBreakdown({});
      setProductSummary([]);
      setMissingItems([]);
      setUnexpectedScans([]);
      setRecentScans([]);
      return;
    }
    setSession(payload.session);
    setStats(payload.stats || EMPTY_STATS);
    setBreakdown(payload.breakdown || {});
    setProductSummary(payload.productSummary || []);
    setMissingItems(payload.missingItems || []);
    setUnexpectedScans(payload.unexpectedScans || []);
    setRecentScans(payload.recentScans || []);
    if (payload.read) setLastRead(payload.read);
  }, []);

  const stopCamera = useCallback(() => {
    if (precisionTimerRef.current) window.clearTimeout(precisionTimerRef.current);
    precisionTimerRef.current = null;
    precisionReaderRef.current = null;
    precisionCanvasRef.current = null;
    nativeDetectorRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    if (!userId) return;
    const response = await fetch(`${API_URL}/api/inventory-audit/sessions/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar a conferência.');
    applyPayload(json as SessionPayload);
    if (json.session?.storeName) setSelectedStore(json.session.storeName);
  }, [API_URL, applyPayload, userId]);

  const loadHistory = useCallback(async (store = selectedStore) => {
    if (!userId) return [];
    const params = new URLSearchParams({ userId, limit: '30' });
    if (store) params.set('store', store);
    const response = await fetch(`${API_URL}/api/inventory-audit/sessions?${params.toString()}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar o histórico.');
    const list = Array.isArray(json.sessions) ? json.sessions : [];
    setHistory(list);
    return list as AuditSession[];
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
      setError('');
      setNotice('');
      applyPayload(null);
      setHistory([]);
      stopCamera();
      setCameraOpen(false);
      setLastRead(null);

      try {
        const params = new URLSearchParams({ userId, auditType: 'GERAL' });
        const response = await fetch(`${API_URL}/api/inventory-audit/stores?${params.toString()}`);
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível carregar as lojas.');
        if (!alive) return;

        const list: StoreOption[] = Array.isArray(json.stores) ? json.stores : [];
        setStores(list);
        setSelectedStore((current) => {
          if (current && list.some((item) => item.name === current)) return current;
          return list[0]?.name || '';
        });
      } catch (err: any) {
        if (alive) {
          setStores([]);
          setSelectedStore('');
          setError(err?.message || 'Erro ao carregar o módulo de conferência.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void boot();
    return () => { alive = false; };
  }, [API_URL, applyPayload, stopCamera, userId]);

  useEffect(() => {
    if (!selectedStore || !userId) {
      applyPayload(null);
      setHistory([]);
      return;
    }

    let alive = true;
    setError('');
    setNotice('');
    stopCamera();
    setCameraOpen(false);
    setLastRead(null);

    (async () => {
      try {
        const list = await loadHistory(selectedStore);
        if (!alive) return;
        const active = list.find((item) => item.status === 'ACTIVE' && item.auditType === 'GERAL');
        if (active) await loadSession(active.id);
        else applyPayload(null);
      } catch (err: any) {
        if (alive) setError(err?.message || 'Erro ao carregar conferência da loja.');
      }
    })();

    return () => { alive = false; };
  }, [applyPayload, loadHistory, loadSession, selectedStore, stopCamera, userId]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((item) => item.kind === 'videoinput');
        setVideoDevices(cameras);
        if (!selectedDeviceId && cameras.length) {
          const back = cameras.find((item) => /back|rear|traseira|environment/i.test(item.label));
          setSelectedDeviceId((back || cameras[cameras.length - 1])?.deviceId || '');
        }
      } catch {
        // Device names may remain hidden until camera permission is granted.
      }
    };
    void refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, [selectedDeviceId]);

  const auditMeta = AUDIT_TYPE_OPTIONS.find((item) => item.key === auditType) || AUDIT_TYPE_OPTIONS[0]!;
  const AuditIcon = auditMeta.icon;
  // A detecção do tipo de identificador acontece no backend.
  function changeAuditType(nextType: AuditType) {
    // Filtrar não inicia nova conferência, não apaga a leitura e não fecha câmera.
    setAuditType(nextType);
    setSearchMissing('');
  }

  function feedbackSound(result: ScanItem['result']) {
    try {
      navigator.vibrate?.(result === 'FOUND' ? [90, 35, 60] : [180, 60, 160]);
    } catch { /* optional */ }

    try {
      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtor();
      }
      const context = audioContextRef.current;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = result === 'FOUND' ? 1040 : 330;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
    } catch { /* optional */ }
  }

  const submitScan = useCallback(async (rawValue: string, source: 'CAMERA' | 'MANUAL') => {
    if (!session || session.status !== 'ACTIVE' || scanInFlightRef.current) return;
    const raw = String(rawValue || '').trim();
    if (!raw) return;

    const dedupeKey = raw.toUpperCase().replace(/\s+/g, '');
    const now = Date.now();
    const last = recentReadsRef.current.get(dedupeKey) || 0;
    const cameraCooldown = 1800;
    if (source === 'CAMERA' && now - last < cameraCooldown) return;
    recentReadsRef.current.set(dedupeKey, now);

    scanInFlightRef.current = true;
    setScanning(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sessions/${encodeURIComponent(session.id)}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, rawValue: raw, source }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível registrar a leitura.');
      applyPayload(json as SessionPayload);
      if (json.read?.result) feedbackSound(json.read.result);
      setManualValue('');
    } catch (err: any) {
      setError(err?.message || 'Erro ao registrar leitura.');
    } finally {
      scanInFlightRef.current = false;
      setScanning(false);
      if (source === 'MANUAL') window.setTimeout(() => manualInputRef.current?.focus(), 50);
    }
  }, [API_URL, applyPayload, session, userId]);

  function startPrecisionScanner() {
    if (precisionTimerRef.current) window.clearTimeout(precisionTimerRef.current);

    const reader = new BrowserMultiFormatReader(createCameraHints());
    const canvas = document.createElement('canvas');
    precisionReaderRef.current = reader;
    precisionCanvasRef.current = canvas;

    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (Detector) {
      try {
        nativeDetectorRef.current = new Detector({ formats: ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      } catch {
        try { nativeDetectorRef.current = new Detector(); } catch { nativeDetectorRef.current = null; }
      }
    }

    const tick = async () => {
      const video = videoRef.current;
      if (!streamRef.current || precisionReaderRef.current !== reader) return;

      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        precisionTimerRef.current = window.setTimeout(() => void tick(), 180);
        return;
      }

      try {
        const cropWidth = Math.round(video.videoWidth * 0.96);
        const cropHeight = Math.round(video.videoHeight * 0.30);
        const sourceX = Math.round((video.videoWidth - cropWidth) / 2);
        const sourceY = Math.round((video.videoHeight - cropHeight) / 2);
        const outputWidth = Math.min(cropWidth, 1700);
        const outputHeight = Math.max(260, Math.round(outputWidth * (cropHeight / cropWidth)));
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });

        if (context) {
          context.imageSmoothingEnabled = true;
          context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);

          let nativeRead = false;
          if (nativeDetectorRef.current) {
            try {
              const detections = await nativeDetectorRef.current.detect(canvas);
              // Não antecipa a categoria: tudo segue para identificação no backend.
              const preferred = detections.find((item) => !!item.rawValue?.trim());
              if (preferred?.rawValue) {
                nativeRead = true;
                void submitScan(preferred.rawValue, 'CAMERA');
              }
            } catch { /* browser detector fallback below */ }
          }

          if (!nativeRead) {
            try {
              const result = reader.decodeFromCanvas(canvas);
              void submitScan(result.getText(), 'CAMERA');
            } catch { /* no barcode in this frame */ }
          }
        }
      } catch { /* a blurred frame must not stop the scanner */ }
      finally {
        if (streamRef.current && precisionReaderRef.current === reader) {
          precisionTimerRef.current = window.setTimeout(() => void tick(), 105);
        }
      }
    };

    precisionTimerRef.current = window.setTimeout(() => void tick(), 180);
  }

  async function startCamera(deviceIdOverride?: string) {
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
      const effectiveDeviceId = deviceIdOverride || selectedDeviceId;
      const constraints: MediaTrackConstraints = effectiveDeviceId
        ? { deviceId: { exact: effectiveDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('A câmera não disponibilizou uma faixa de vídeo.');
      try {
        track.contentHint = 'detail';
        const capabilities = track.getCapabilities?.() as any;
        const advanced: any[] = [];
        if (capabilities?.focusMode?.includes?.('continuous')) advanced.push({ focusMode: 'continuous' });
        if (capabilities?.zoom) {
          const desired = Math.min(Math.max(1.3, capabilities.zoom.min || 1), capabilities.zoom.max || 1.3);
          advanced.push({ zoom: desired });
        }
        if (advanced.length) await track.applyConstraints({ advanced });
      } catch { /* enhancement unsupported */ }

      if (!videoRef.current) throw new Error('Visor da câmera não encontrado.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const activeSettings = track.getSettings();
      if (activeSettings.deviceId) setSelectedDeviceId(activeSettings.deviceId);

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoDevices(devices.filter((item) => item.kind === 'videoinput'));
      } catch { /* optional */ }

      const reader = new BrowserMultiFormatReader(createCameraHints(), {
        delayBetweenScanAttempts: 90,
        delayBetweenScanSuccess: 160,
      });
      const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (result) void submitScan(result.getText(), 'CAMERA');
      });
      controlsRef.current = controls;
      startPrecisionScanner();
      setCameraActive(true);
    } catch (err: any) {
      stopCamera();
      const name = String(err?.name || '');
      if (name === 'NotAllowedError') setCameraError('Permissão da câmera negada. Libere a câmera para o Telefluxo nas configurações do navegador.');
      else if (name === 'NotFoundError') setCameraError('Nenhuma câmera foi encontrada neste aparelho.');
      else setCameraError(err?.message || 'Não foi possível iniciar a câmera.');
    } finally {
      setCameraStarting(false);
    }
  }

  async function switchCamera(deviceId: string) {
    setSelectedDeviceId(deviceId);
    if (cameraActive) {
      await startCamera(deviceId);
    }
  }

  async function beginAudit(forceNew = false) {
    if (!selectedStore || !userId) return;
    if (forceNew && session?.status === 'ACTIVE') {
      const ok = window.confirm('A conferência atual será encerrada como cancelada e uma nova foto do estoque será criada. Continuar?');
      if (!ok) return;
    }
    setStarting(true);
    setError('');
    setLastRead(null);
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, store: selectedStore, auditType: 'GERAL', forceNew }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível iniciar a conferência.');
      applyPayload(json as SessionPayload);
      setNotice(String(json.warning || ''));
      await loadHistory(selectedStore);
      setTab('conference');
      window.setTimeout(() => manualInputRef.current?.focus(), 100);
    } catch (err: any) {
      setError(err?.message || 'Erro ao iniciar conferência.');
    } finally {
      setStarting(false);
    }
  }

  async function completeAudit() {
    if (!session || session.status !== 'ACTIVE') return;
    const text = stats.pending > 0 || stats.unexpected > 0
      ? `Ainda existem ${stats.pending} item(ns) faltante(s) e ${stats.unexpected + stats.excess} divergência(s). Deseja encerrar mesmo assim?`
      : 'Conferência 100% concluída. Deseja finalizar e salvar o resultado?';
    if (!window.confirm(text)) return;

    setCompleting(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/inventory-audit/sessions/${encodeURIComponent(session.id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Não foi possível finalizar a conferência.');
      applyPayload(json as SessionPayload);
      stopCamera();
      setCameraOpen(false);
      await loadHistory(selectedStore);
    } catch (err: any) {
      setError(err?.message || 'Erro ao finalizar conferência.');
    } finally {
      setCompleting(false);
    }
  }

  const selectedStoreMeta = stores.find((item) => item.name === selectedStore);
  const identifierLabel = 'IMEI / serial / código de barras';
  const readMeta = resultMeta(lastRead?.result);
  const ReadIcon = readMeta.icon;
  const allTypes = auditType === 'TODOS' || auditType === 'GERAL';
  const visibleStats = allTypes ? stats : (breakdown[auditType] || EMPTY_STATS);
  const visibleProducts = useMemo(() => allTypes ? productSummary : productSummary.filter((item) => item.auditType === auditType), [allTypes, productSummary, auditType]);
  const missingProducts = useMemo(() => visibleProducts.filter((item) => item.missing > 0), [visibleProducts]);
  const visibleUnexpected = useMemo(() => allTypes ? unexpectedScans : unexpectedScans.filter((item) => item.auditType === auditType), [allTypes, unexpectedScans, auditType]);
  const visibleRecent = useMemo(() => allTypes ? recentScans : recentScans.filter((item) => item.auditType === auditType), [allTypes, recentScans, auditType]);
  const filteredMissingItems = useMemo(() => {
    const q = searchMissing.trim().toUpperCase();
    const rows = allTypes ? missingItems : missingItems.filter((item) => item.auditType === auditType);
    if (!q) return rows;
    return rows.filter((item) => [item.identifier || item.imei, item.productCode, item.reference, item.description, item.stockType].some((value) => String(value || '').toUpperCase().includes(q)));
  }, [missingItems, searchMissing, auditType, allTypes]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
        <div className="mx-auto flex min-h-[420px] max-w-7xl items-center justify-center rounded-3xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 text-sm font-black uppercase tracking-wider text-slate-500">
            <Loader2 className="animate-spin" size={20} /> Carregando base de {auditMeta.plural}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inventory-audit-shell">
      <div className="inventory-audit-page">
        <section className="inventory-audit-hero">
          <div className="inventory-audit-hero-copy">
            <div className="inventory-audit-eyebrow"><ShieldCheck size={14} /> TELEFLUXO • CONFERÊNCIA INTELIGENTE</div>
            <h1>Bipador de estoque</h1>

            <div className="inventory-audit-type-selector">
              <span>FILTRAR PENDÊNCIAS POR CATEGORIA</span>
              <div>
                {AUDIT_TYPE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={auditType === option.key ? 'active' : ''}
                      onClick={() => changeAuditType(option.key)}
                      title={`Mostrar pendências de ${option.label.toLowerCase()} sem interromper a bipagem`}
                    >
                      <Icon size={15} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {onOpenSampleConference && (
              <button type="button" className="inventory-audit-sample-link" onClick={onOpenSampleConference}>
                <ClipboardCheck size={16} />
                Conferência de amostras
                <ChevronRight size={15} />
              </button>
            )}
          </div>

          <div className="inventory-audit-store-box">
            <label><Store size={15} /> Loja da conferência</label>
            <select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}>
              {stores.length === 0 && <option value="">Nenhuma loja disponível</option>}
              {stores.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            <small>
              {selectedStoreMeta
                ? `${formatNumber(selectedStoreMeta.expected)} unidades • ${formatNumber(selectedStoreMeta.products)} produtos • leitura automática de IMEI, serial ou código`
                : 'O acesso respeita as lojas permitidas para o usuário logado.'}
            </small>
            {!!selectedStoreMeta?.missingIdentifierUnits && (
              <small className="inventory-audit-store-warning">
                <AlertTriangle size={12} /> {formatNumber(selectedStoreMeta.missingIdentifierUnits)} unidade(s) ainda sem identificador válido ou com identificação ambígua na base.
              </small>
            )}
          </div>
        </section>

        {error && (
          <div className="inventory-audit-error"><AlertTriangle size={18} /><span>{error}</span></div>
        )}
        {notice && (
          <div className="inventory-audit-warning"><AlertTriangle size={18} /><span>{notice}</span></div>
        )}

        {!selectedStore ? (
          <section className="inventory-audit-empty">
            <AuditIcon size={36} />
            <h2>Nenhuma loja disponível para conferência</h2>
            <p>
              Verifique as lojas permitidas e os identificadores cadastrados no estoque. AMOSTRA e DOA também são considerados.
            </p>
          </section>
        ) : !session ? (
          <section className="inventory-audit-start-card">
            <div className="inventory-audit-start-icon"><AuditIcon size={34} /></div>
            <div>
              <span>CONFERÊNCIA UNIFICADA • PRONTO PARA COMEÇAR</span>
              <h2>Criar conferência de {selectedStore}</h2>
              <p>
                Uma única foto de {formatNumber(selectedStoreMeta?.expected || 0)} unidades da loja, incluindo ESTOQUE, AMOSTRA e DOA. A categoria é identificada automaticamente ao bipar.
              </p>
            </div>
            <button onClick={() => void beginAudit(false)} disabled={starting || !selectedStoreMeta?.expected}>
              {starting ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
              Iniciar conferência
            </button>
          </section>
        ) : (
          <>
            <section className="inventory-audit-session-strip">
              <div>
                <span className={`inventory-audit-status ${session.status.toLowerCase()}`}>{session.status === 'ACTIVE' ? 'EM CONFERÊNCIA' : session.status === 'COMPLETED' ? 'FINALIZADA' : 'CANCELADA'}</span>
                <strong>{session.storeName}</strong>
                <small>{session.auditLabel || "Conferência unificada"} • identificação automática • iniciada por {session.operatorName} • {formatDateTime(session.startedAt)}</small>
              </div>
              <div className="inventory-audit-session-actions">
                <button className="secondary" onClick={() => void beginAudit(true)} disabled={starting}><RefreshCw size={15} /> Nova conferência</button>
                <button className="secondary" onClick={() => downloadCsv(session, missingItems, unexpectedScans)}><Download size={15} /> Baixar divergências</button>
                {session.status === 'ACTIVE' && <button className="primary" onClick={() => void completeAudit()} disabled={completing}>{completing ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Finalizar</button>}
              </div>
            </section>

            <section className="inventory-audit-kpi-grid">
              <KpiCard icon={Package} label="Base esperada" value={formatNumber(visibleStats.expected)} helper={`${allTypes ? "Todas as categorias" : auditMeta.label} • estoque + amostra + DOA`} tone="blue" />
              <KpiCard icon={CheckCircle2} label="Bipados" value={formatNumber(visibleStats.checked)} helper={`${visibleStats.progress.toFixed(1)}% da conferência`} tone="green" />
              <KpiCard icon={Clock3} label="Faltando bipar" value={formatNumber(visibleStats.pending)} helper={`${missingProducts.length} produto(s) com pendência`} tone="orange" />
              <KpiCard icon={AlertTriangle} label="Divergências" value={formatNumber(visibleStats.unexpected + visibleStats.excess)} helper={`${visibleStats.excess} excedentes • ${visibleStats.duplicates} repetidos • ${visibleStats.invalid} inválidos`} tone="red" />
            </section>

            <section className="inventory-audit-progress-card">
              <div className="inventory-audit-progress-copy">
                <span>PROGRESSO GERAL DA CONFERÊNCIA</span>
                <strong>{visibleStats.progress.toFixed(1)}%</strong>
                <small>{formatNumber(visibleStats.checked)} de {formatNumber(visibleStats.expected)} unidades conferidas</small>
              </div>
              <div className="inventory-audit-progress-track"><i style={{ width: `${Math.min(visibleStats.progress, 100)}%` }} /></div>
              <div className="inventory-audit-progress-legend">
                <span><i className="ok" /> Conferidos {visibleStats.checked}</span>
                <span><i className="pending" /> Pendentes {visibleStats.pending}</span>
                <span><i className="danger" /> Fora da base {visibleStats.unexpected}</span>
                {visibleStats.excess > 0 && <span><i className="danger" /> Excedentes {visibleStats.excess}</span>}
              </div>
            </section>

            <div className="inventory-audit-tabs">
              <button className={tab === 'conference' ? 'active' : ''} onClick={() => setTab('conference')}><ScanLine size={15} /> Conferência</button>
              <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}><BarChart3 size={15} /> Pendências <b>{visibleStats.pending}</b></button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={15} /> Histórico</button>
            </div>

            {tab === 'conference' && (
              <section className="inventory-audit-main-grid">
                <div className="inventory-audit-scanner-card">
                  <div className="inventory-audit-card-title">
                    <div><span>LEITURA EM TEMPO REAL</span><h2>Bipar produtos</h2></div>
                    <div className={`inventory-audit-live-dot ${cameraActive ? 'on' : ''}`}><i /> {cameraActive ? 'CÂMERA ATIVA' : 'LEITOR PRONTO'}</div>
                  </div>

                  {session.status !== 'ACTIVE' ? (
                    <div className="inventory-audit-finished"><CheckCircle2 size={38} /><strong>Conferência encerrada</strong><span>Abra uma nova conferência para continuar a bipagem.</span></div>
                  ) : (
                    <>
                      <div className={`inventory-audit-camera ${cameraOpen ? 'open' : ''} ${lastRead?.result ? `read-${lastRead.result.toLowerCase()}` : ''}`}>
                        <video ref={videoRef} muted playsInline />
                        {!cameraActive && (
                          <div className="inventory-audit-camera-placeholder">
                            {cameraStarting ? <Loader2 className="animate-spin" size={34} /> : <Camera size={38} />}
                            <strong>{cameraStarting ? 'Ativando câmera...' : 'Câmera pronta para iniciar'}</strong>
                            <span>Aponte a câmera para o IMEI, serial ou código de barras da unidade.</span>
                          </div>
                        )}
                        <div className="inventory-audit-scan-guide"><i /></div>
                      </div>

                      <div className="inventory-audit-camera-controls">
                        {!cameraActive ? (
                          <button className="primary" onClick={() => void startCamera()} disabled={cameraStarting}><Camera size={16} /> Abrir câmera</button>
                        ) : (
                          <button className="danger" onClick={() => { stopCamera(); setCameraOpen(false); }}><CameraOff size={16} /> Parar câmera</button>
                        )}
                        {videoDevices.length > 1 && (
                          <select value={selectedDeviceId} onChange={(event) => void switchCamera(event.target.value)}>
                            {videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Câmera ${index + 1}`}</option>)}
                          </select>
                        )}
                        <span><Zap size={14} /> foco contínuo • IMEI • serial • código de barras</span>
                      </div>

                      {cameraError && <div className="inventory-audit-camera-error"><AlertTriangle size={16} /> {cameraError}</div>}

                      <div className="inventory-audit-manual">
                        <div className="inventory-audit-manual-label"><Keyboard size={16} /><div><strong>Leitor físico ou digitação</strong><span>Leia qualquer categoria. Wearables aceitam serial com letras; códigos de barras contam uma unidade por leitura.</span></div></div>
                        <form onSubmit={(event) => { event.preventDefault(); void submitScan(manualValue, 'MANUAL'); }}>
                          <input
                            ref={manualInputRef}
                            value={manualValue}
                            onChange={(event) => setManualValue(event.target.value)}
                            placeholder="Bipe IMEI, serial ou código de barras"
                            inputMode="text"
                            autoComplete="off"
                          />
                          <button disabled={!manualValue.trim() || scanning}>{scanning ? <Loader2 className="animate-spin" size={16} /> : <ScanLine size={16} />} Conferir</button>
                        </form>
                      </div>
                    </>
                  )}

                  <div className={`inventory-audit-last-read ${readMeta.className}`}>
                    <div className="inventory-audit-last-read-icon"><ReadIcon size={25} /></div>
                    {lastRead ? (
                      <div className="min-w-0">
                        <span>ÚLTIMA LEITURA • {readMeta.label}</span>
                        <code>{lastRead.identifier || lastRead.imei || 'Código não identificado'}</code>
                        <strong>{lastRead.title}</strong>
                        {lastRead.description && <small>{lastRead.description}</small>}
                        {lastRead.stockType && <span className={`inventory-audit-stock-kind ${lastRead.stockType.toLowerCase()}`}>{lastRead.stockType}{lastRead.auditType ? ` • ${lastRead.auditType}` : ''}</span>}
                        <small>{lastRead.message}</small>
                      </div>
                    ) : (
                      <div><span>ÚLTIMA LEITURA</span><strong>Aguardando primeira leitura</strong><small>Quando o identificador for reconhecido, o resultado aparecerá aqui imediatamente.</small></div>
                    )}
                    {lastRead?.result === 'FOUND' && <Volume2 size={18} className="inventory-audit-sound" />}
                  </div>
                </div>

                <aside className="inventory-audit-bi-card">
                  <div className="inventory-audit-card-title compact">
                    <div><span>BI DE DIVERGÊNCIAS</span><h2>O que ainda falta?</h2></div>
                    <span className="inventory-audit-pill">{missingProducts.length} produtos</span>
                  </div>

                  {missingProducts.length === 0 ? (
                    <div className="inventory-audit-all-ok"><CheckCircle2 size={34} /><strong>Nenhum produto faltante</strong><span>Todas as unidades esperadas já foram conferidas.</span></div>
                  ) : (
                    <div className="inventory-audit-product-list">
                      {missingProducts.slice(0, 12).map((product, index) => (
                        <button key={`${product.productCode}-${product.reference}`} onClick={() => setTab('pending')}>
                          <span className="inventory-audit-rank">{String(index + 1).padStart(2, '0')}</span>
                          <div className="min-w-0">
                            <strong>{product.description}</strong>
                            <small>{product.auditType} • {product.stockType}</small>
                            <small>{product.reference || `Cód. ${product.productCode}`} • {product.checked}/{product.expected} conferidos</small>
                            <div className="inventory-audit-mini-progress"><i style={{ width: `${product.progress}%` }} /></div>
                          </div>
                          <b>{product.missing}<small> faltando</small></b>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="inventory-audit-divergence-box">
                    <div><XCircle size={18} /><span><strong>{visibleStats.unexpected}</strong> fora da base</span></div>
                    <div><AlertTriangle size={18} /><span><strong>{visibleStats.excess}</strong> excedentes</span></div>
                    <div><AlertCircle size={18} /><span><strong>{visibleStats.duplicates}</strong> leituras repetidas</span></div>
                  </div>

                  {visibleUnexpected.length > 0 && (
                    <div className="inventory-audit-unexpected-preview">
                      <span>ÚLTIMAS DIVERGÊNCIAS</span>
                      {visibleUnexpected.slice(0, 4).map((item) => (
                        <div key={item.id}><code>{item.identifier || item.imei}</code><small>{item.description || 'Código não localizado'}{item.foundStore ? ` • base: ${item.foundStore}` : ''}</small></div>
                      ))}
                    </div>
                  )}
                </aside>
              </section>
            )}

            {tab === 'pending' && (
              <section className="inventory-audit-pending-card">
                <div className="inventory-audit-card-title">
                  <div><span>DETALHAMENTO DA DIFERENÇA</span><h2>{auditMeta.label} que ainda não foram encontrados</h2></div>
                  <div className="inventory-audit-search"><Search size={15} /><input value={searchMissing} onChange={(event) => setSearchMissing(event.target.value)} placeholder={`Buscar produto, referência ou ${identifierLabel.toLowerCase()}`} /></div>
                </div>

                <div className="inventory-audit-pending-summary">
                  {missingProducts.slice(0, 8).map((product) => (
                    <div key={`${product.productCode}-${product.reference}`}><AuditIcon size={16} /><span><strong>{product.missing}x</strong>{product.description}<small>{product.reference || product.productCode}</small></span></div>
                  ))}
                  {missingProducts.length === 0 && <div className="inventory-audit-all-ok inline"><CheckCircle2 size={24} /><strong>Sem faltantes</strong></div>}
                </div>

                <div className="inventory-audit-table-wrap">
                  <table>
                    <thead><tr><th>Status</th><th>Produto</th><th>Categoria / tipo</th><th>Referência</th><th>Identificador esperado</th></tr></thead>
                    <tbody>
                      {filteredMissingItems.map((item) => (
                        <tr key={item.id}>
                          <td><span className="inventory-audit-badge pending">PENDENTE</span></td>
                          <td><strong>{item.description}</strong><small>Cód. {item.productCode}{Number(item.quantity || 1) > 1 ? ` • ${item.quantity} un. pendentes` : ''}</small></td>
                          <td>{item.auditType || '—'}<small>{item.stockType || 'ESTOQUE'}</small></td>
                          <td>{item.reference || '—'}</td>
                          <td><code>{item.identifier || item.imei}</code></td>
                        </tr>
                      ))}
                      {filteredMissingItems.length === 0 && <tr><td colSpan={5} className="inventory-audit-table-empty">Nenhum item pendente com este filtro.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {tab === 'history' && (
              <section className="inventory-audit-history-card">
                <div className="inventory-audit-card-title"><div><span>RASTREABILIDADE</span><h2>Histórico de {auditMeta.label.toLowerCase()}</h2></div></div>
                <div className="inventory-audit-history-list">
                  {history.map((item) => (
                    <button key={item.id} className={session.id === item.id ? 'selected' : ''} onClick={() => void loadSession(item.id)}>
                      <div className={`inventory-audit-history-icon ${item.status.toLowerCase()}`}>{item.status === 'COMPLETED' ? <CheckCircle2 size={18} /> : item.status === 'ACTIVE' ? <ScanLine size={18} /> : <XCircle size={18} />}</div>
                      <div><strong>{item.storeName}</strong><span>{item.auditLabel || item.auditType} • {item.operatorName} • {formatDateTime(item.startedAt)}</span></div>
                      <span className={`inventory-audit-status ${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? 'EM ANDAMENTO' : item.status === 'COMPLETED' ? 'FINALIZADA' : 'CANCELADA'}</span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                  {history.length === 0 && <div className="inventory-audit-empty-history"><History size={30} />Nenhuma conferência registrada para esta loja.</div>}
                </div>
              </section>
            )}

            <section className="inventory-audit-recent-card">
              <div className="inventory-audit-card-title compact"><div><span>LOG OPERACIONAL</span><h2>Últimas leituras</h2></div></div>
              <div className="inventory-audit-recent-list">
                {visibleRecent.slice(0, 12).map((item) => {
                  const meta = resultMeta(item.result);
                  return (
                    <div key={item.id}>
                      <span className={`inventory-audit-badge ${item.result.toLowerCase()}`}>{meta.label}</span>
                      <code>{item.identifier || item.imei || item.rawValue || '—'}</code>
                      <strong>{item.description || 'Código sem produto associado'}</strong>
                      <small>{item.foundStore && item.foundStore !== session.storeName ? `Base: ${item.foundStore} • ` : ''}{formatDateTime(item.createdAt)}</small>
                    </div>
                  );
                })}
                {visibleRecent.length === 0 && <div className="inventory-audit-empty-history">Nenhuma leitura registrada ainda.</div>}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
