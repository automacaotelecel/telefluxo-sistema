import {
  ArrowRight,
  Bell,
  Boxes,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  Clock3,
  Copy,
  Database,
  Download,
  FileBarChart,
  FileDown,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  Flashlight,
  History,
  Keyboard,
  LayoutDashboard,
  Menu,
  Minus,
  PackageCheck,
  PackageSearch,
  Play,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Store,
  TriangleAlert,
  UploadCloud,
  UserRound,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./BarcodeScannerPage.css";
import {
  checkedItemIds,
  formatDateLong,
  formatDateTime,
  getAuditStats,
  loadAudits,
  makeId,
  saveAudits,
  uniqueUnexpected,
} from "../lib/audit";
import { normalizeImei, onlyDigits } from "../lib/imei";
import { parseInventoryFile } from "../lib/spreadsheet";
import type { AuditSession, ScanEvent, ViewKey } from "../lib/types";

const NAV_ITEMS = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "new-audit", label: "Nova conferência", icon: FilePlus2 },
  { id: "scanner", label: "Bipar aparelhos", icon: ScanLine },
  { id: "inventory", label: "Controle de estoque", icon: Boxes },
  { id: "divergences", label: "Divergências", icon: TriangleAlert },
  { id: "history", label: "Histórico", icon: History },
  { id: "reports", label: "Relatórios", icon: FileBarChart },
] as const;

type Feedback = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  message: string;
  imei?: string;
};

type InventoryFilter = "all" | "checked" | "pending";
type DivergenceTab = "missing" | "unexpected" | "duplicates";
type CameraMode = "normal" | "small-code";
type ScanSource = "reader" | "camera";

type CameraRead = {
  id: string;
  rawValue: string;
  digits: string;
  imei: string;
  format: string;
  tone: Feedback["tone"];
  title: string;
  message: string;
  createdAt: string;
};

type NativeBarcodeResult = {
  rawValue: string;
  format?: string;
};

type NativeBarcodeDetector = {
  detect: (source: CanvasImageSource) => Promise<NativeBarcodeResult[]>;
};

type NativeBarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => NativeBarcodeDetector;

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: NativeBarcodeDetectorConstructor;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type ExtendedCameraCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: {
    min?: number;
    max?: number;
    step?: number;
  };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

const CAMERA_DEVICE_STORAGE_KEY = "telefluxo.preferredCameraId";
const CAMERA_MODE_STORAGE_KEY = "telefluxo.cameraMode";
const CAMERA_DUPLICATE_BLOCK_MS = 4000;

// Formatos 1D usados com mais frequência em etiquetas de IMEI.
// Manter o conjunto enxuto deixa a decodificação sensivelmente mais rápida no celular
// e evita o leitor “grudar” primeiro no EAN de 13 dígitos da caixa.
const CAMERA_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

function createCameraHints() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, CAMERA_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.ASSUME_GS1, true);
  return hints;
}

function cameraFormatName(format?: BarcodeFormat) {
  if (format === undefined) return "formato não informado";
  const labels: Partial<Record<BarcodeFormat, string>> = {
    [BarcodeFormat.CODE_128]: "Code 128",
    [BarcodeFormat.CODE_39]: "Code 39",
    [BarcodeFormat.CODE_93]: "Code 93",
    [BarcodeFormat.ITF]: "ITF",
    [BarcodeFormat.CODABAR]: "Codabar",
    [BarcodeFormat.DATA_MATRIX]: "Data Matrix",
    [BarcodeFormat.QR_CODE]: "QR Code",
    [BarcodeFormat.EAN_13]: "EAN-13",
    [BarcodeFormat.EAN_8]: "EAN-8",
    [BarcodeFormat.UPC_A]: "UPC-A",
    [BarcodeFormat.UPC_E]: "UPC-E",
    [BarcodeFormat.PDF_417]: "PDF417",
    [BarcodeFormat.AZTEC]: "Aztec",
  };
  return labels[format] ?? "código de barras";
}

function cameraName(device: MediaDeviceInfo, index: number) {
  return device.label.trim() || `Câmera ${index + 1}`;
}

function choosePreferredCamera(cameras: MediaDeviceInfo[], preferredId = "") {
  if (preferredId && cameras.some((camera) => camera.deviceId === preferredId)) return preferredId;

  const savedId = window.localStorage.getItem(CAMERA_DEVICE_STORAGE_KEY) ?? "";
  if (savedId && cameras.some((camera) => camera.deviceId === savedId)) return savedId;

  const scored = cameras
    .map((camera, index) => {
      const label = camera.label.toLowerCase();
      let score = index;
      if (/back|rear|traseira|environment|world/.test(label)) score += 100;
      if (/front|frontal|user|selfie/.test(label)) score -= 100;
      if (/ultra|telephoto|telefoto|macro/.test(label)) score -= 10;
      if (/wide|principal|main/.test(label) && !/ultra/.test(label)) score += 15;
      return { id: camera.deviceId, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? "";
}

function friendlyCameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "A permissão da câmera foi negada. Libere a câmera nas configurações do navegador e tente novamente.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "Nenhuma câmera foi encontrada neste aparelho.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "A câmera está sendo usada por outro aplicativo. Feche o outro aplicativo e tente novamente.";
    }
    if (error.name === "OverconstrainedError") {
      return "A câmera escolhida não aceitou a configuração. Selecione outra câmera ou use o modo normal.";
    }
    if (error.name === "SecurityError") {
      return "O navegador bloqueou a câmera. Acesse o sistema por HTTPS ou pelo localhost.";
    }
  }
  return error instanceof Error
    ? error.message
    : "Não foi possível iniciar a câmera. Tente trocar a câmera ou usar outro navegador.";
}

function statusLabel(status: AuditSession["status"]) {
  if (status === "active") return "Em andamento";
  if (status === "paused") return "Pausada";
  return "Concluída";
}

function resultLabel(result: ScanEvent["result"]) {
  if (result === "found") return "Conferido";
  if (result === "unexpected") return "Não consta";
  if (result === "duplicate") return "Duplicado";
  return "Inválido";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(content: string, fileName: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportReconciliation(audit: AuditSession) {
  const checked = checkedItemIds(audit);
  const foundByItem = new Map(
    audit.scans.filter((scan) => scan.result === "found" && scan.itemId).map((scan) => [scan.itemId, scan]),
  );
  const header = [
    "resultado",
    "imei_principal",
    "imei_2",
    "marca",
    "modelo",
    "cor",
    "armazenamento",
    "serial",
    "localizacao",
    "conferido_em",
    "operador",
  ];
  const rows = audit.items.map((item) => {
    const scan = foundByItem.get(item.id);
    return [
      checked.has(item.id) ? "CONFERIDO" : "FALTANTE",
      item.imei,
      item.imei2,
      item.brand,
      item.model,
      item.color,
      item.storage,
      item.serial,
      item.location,
      scan ? formatDateTime(scan.createdAt) : "",
      scan?.operator ?? "",
    ];
  });

  uniqueUnexpected(audit).forEach((scan) => {
    rows.push(["NÃO CONSTA", scan.imei, "", "", "", "", "", "", "", formatDateTime(scan.createdAt), scan.operator]);
  });

  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  downloadFile(csv, `conciliacao-${audit.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`);
}

function exportScanLog(audit: AuditSession) {
  const header = ["data_hora", "imei", "resultado", "operador", "leitura_original"];
  const rows = audit.scans
    .slice()
    .reverse()
    .map((scan) => [formatDateTime(scan.createdAt), scan.imei, resultLabel(scan.result), scan.operator, scan.rawValue]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  downloadFile(csv, `log-bipagens-${audit.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`);
}

function downloadTemplate() {
  const rows = [
    ["IMEI", "IMEI 2", "Marca", "Modelo", "Cor", "Armazenamento", "Serial", "Localização"],
    ["490154203237518", "", "Samsung", "Galaxy A55 5G", "Azul", "256 GB", "SN-0001", "Loja Centro"],
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
  downloadFile(csv, "modelo-controle-imeis.csv");
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: typeof Boxes;
  tone?: "blue" | "green" | "amber" | "red";
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <div className="stat-icon"><Icon size={19} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Boxes; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={24} /></div>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

export default function BarcodeScannerPage() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [audits, setAudits] = useState<AuditSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [auditName, setAuditName] = useState("");
  const [branch, setBranch] = useState("Loja Centro");
  const [responsible, setResponsible] = useState("adm");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraMode, setCameraMode] = useState<CameraMode>(() => {
    const savedMode = window.localStorage.getItem(CAMERA_MODE_STORAGE_KEY);
    return savedMode === "small-code" ? "small-code" : "normal";
  });
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [zoomAvailable, setZoomAvailable] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [cameraScanHeartbeat, setCameraScanHeartbeat] = useState(0);
  const [cameraReadPulse, setCameraReadPulse] = useState<Feedback["tone"] | null>(null);
  const [lastCameraRead, setLastCameraRead] = useState<CameraRead | null>(null);
  const [cameraReadHistory, setCameraReadHistory] = useState<CameraRead[]>([]);
  const [cameraResolution, setCameraResolution] = useState("");
  const [cameraEngine, setCameraEngine] = useState("ZXing 1D");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [appInstalled, setAppInstalled] = useState(() => {
    const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
    return window.matchMedia("(display-mode: standalone)").matches || Boolean(standaloneNavigator.standalone);
  });
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [divergenceTab, setDivergenceTab] = useState<DivergenceTab>("missing");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraPanelRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeAuditRef = useRef<AuditSession | null>(null);
  const recentCameraCodesRef = useRef(new Map<string, number>());
  const cameraRequestRef = useRef(0);
  const cameraAttemptRef = useRef(0);
  const precisionScanTimerRef = useRef<number | null>(null);
  const precisionReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const precisionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeBarcodeDetectorRef = useRef<NativeBarcodeDetector | null>(null);
  const scanPulseTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = loadAudits().filter((audit) => !audit.demo);
      setAudits(saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (hydrated) saveAudits(audits);
  }, [audits, hydrated]);

  const liveAudit = useMemo(() => audits.find((audit) => audit.status === "active") ?? null, [audits]);
  const currentAudit = liveAudit ?? audits[0] ?? null;
  const stats = useMemo(() => getAuditStats(currentAudit), [currentAudit]);
  const liveStats = useMemo(() => getAuditStats(liveAudit), [liveAudit]);

  useEffect(() => {
    activeAuditRef.current = liveAudit;
  }, [liveAudit]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (view === "scanner") {
      window.setTimeout(() => manualInputRef.current?.focus(), 120);
    }
  }, [view]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;

    const refreshDevices = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === "videoinput");
        setVideoDevices(cameras);
        setSelectedDeviceId((current) => choosePreferredCamera(cameras, current));
      } catch {
        // Some browsers only expose devices after camera permission is granted.
      }
    };

    void refreshDevices();
    mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => mediaDevices.removeEventListener?.("devicechange", refreshDevices);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
      setInstallHelpOpen(false);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    return () => {
      cameraRequestRef.current += 1;
      if (precisionScanTimerRef.current) window.clearTimeout(precisionScanTimerRef.current);
      precisionReaderRef.current = null;
      precisionCanvasRef.current = null;
      controlsRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (scanPulseTimeoutRef.current) window.clearTimeout(scanPulseTimeoutRef.current);
      void audioContextRef.current?.close();
    };
  }, []);

  function navigate(nextView: ViewKey) {
    if (nextView !== "scanner") stopCamera();
    setView(nextView);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function installApplication() {
    if (appInstalled) {
      setFeedback({ tone: "info", title: "Aplicativo já instalado", message: "O TeleFluxo já está disponível como aplicativo neste aparelho." });
      return;
    }
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setAppInstalled(true);
        setFeedback({ tone: "success", title: "Instalação iniciada", message: "O TeleFluxo será adicionado à tela inicial deste aparelho." });
      }
      setInstallPrompt(null);
    } catch {
      setInstallHelpOpen(true);
    }
  }

  function getAudioContext() {
    const AudioContextCtor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextCtor();
    }
    return audioContextRef.current;
  }

  function unlockFeedback() {
    try {
      const context = getAudioContext();
      if (context?.state === "suspended") void context.resume();
    } catch {
      // Some browsers do not expose Web Audio.
    }
  }

  function playFeedback(tone: Feedback["tone"]) {
    try {
      navigator.vibrate?.(
        tone === "success" ? [110, 45, 70] : tone === "info" ? [55] : [180, 65, 180],
      );
    } catch {
      // Vibration support varies by device and browser.
    }

    try {
      const context = getAudioContext();
      if (!context) return;

      const notes = tone === "success"
        ? [{ frequency: 880, offset: 0 }, { frequency: 1180, offset: 0.1 }]
        : tone === "warning"
          ? [{ frequency: 520, offset: 0 }, { frequency: 420, offset: 0.12 }]
          : tone === "danger"
            ? [{ frequency: 250, offset: 0 }, { frequency: 190, offset: 0.13 }]
            : [{ frequency: 650, offset: 0 }];

      const emitNotes = () => {
        notes.forEach(({ frequency, offset }) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const startAt = context.currentTime + offset;
          oscillator.type = tone === "success" || tone === "info" ? "sine" : "square";
          oscillator.frequency.setValueAtTime(frequency, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.095);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startAt);
          oscillator.stop(startAt + 0.11);
        });
      };

      if (context.state === "suspended") {
        void context.resume().then(emitNotes).catch(() => undefined);
      } else {
        emitNotes();
      }

    } catch {
      // Audio is an optional enhancement.
    }
  }

  function signalCameraRead(tone: Feedback["tone"]) {
    setCameraReadPulse(tone);
    if (scanPulseTimeoutRef.current) window.clearTimeout(scanPulseTimeoutRef.current);
    scanPulseTimeoutRef.current = window.setTimeout(() => setCameraReadPulse(null), 420);
    playFeedback(tone);
  }

  function recordCameraRead(rawValue: string, format: string, result: Feedback) {
    const read: CameraRead = {
      id: makeId("camera_read"),
      rawValue: rawValue.trim().slice(0, 180),
      digits: onlyDigits(rawValue).slice(0, 60),
      imei: normalizeImei(rawValue),
      format,
      tone: result.tone,
      title: result.title,
      message: result.message,
      createdAt: new Date().toISOString(),
    };
    setLastCameraRead(read);
    setCameraReadHistory((current) => [read, ...current].slice(0, 5));
  }

  function testCameraFeedback() {
    unlockFeedback();
    signalCameraRead("success");
  }

  function processScan(rawValue: string, source: ScanSource = "reader", cameraFormat = "código de barras") {
    const audit = activeAuditRef.current;
    if (!audit) {
      setFeedback({ tone: "warning", title: "Nenhuma conferência ativa", message: "Importe a planilha de estoque antes de bipar." });
      navigate("new-audit");
      return;
    }

    const trimmed = rawValue.trim();
    const imei = normalizeImei(trimmed);
    const now = new Date().toISOString();
    let event: ScanEvent;
    let nextFeedback: Feedback;

    if (!imei) {
      const digits = onlyDigits(trimmed);
      if (source === "camera") {
        const invalidFeedback: Feedback = {
          tone: "info",
          title: "Código ignorado pela câmera",
          message: digits.length === 13
            ? "Esse código parece ser o EAN do produto. Mire no código de barras do IMEI."
            : "A câmera encontrou outro código, mas ele não possui um IMEI de 15 dígitos.",
          imei: digits || undefined,
        };
        setFeedback(invalidFeedback);
        recordCameraRead(rawValue, cameraFormat, invalidFeedback);
        signalCameraRead("info");
        return;
      }
      event = {
        id: makeId("scan"),
        imei: digits.slice(0, 30) || "SEM IMEI",
        rawValue: trimmed.slice(0, 120),
        result: "invalid",
        createdAt: now,
        operator: audit.responsible,
      };
      nextFeedback = {
        tone: "danger",
        title: "Leitura recusada",
        message: "A leitura não contém um IMEI numérico de 15 dígitos.",
        imei: digits || undefined,
      };
    } else {
      const item = audit.items.find((candidate) => candidate.imei === imei || candidate.imei2 === imei);
      const itemAlreadyChecked = item
        ? audit.scans.some((scan) => scan.result === "found" && scan.itemId === item.id)
        : audit.scans.some((scan) => scan.result === "unexpected" && scan.imei === imei);

      if (itemAlreadyChecked) {
        event = {
          id: makeId("scan"),
          imei,
          rawValue: trimmed,
          result: "duplicate",
          itemId: item?.id,
          createdAt: now,
          operator: audit.responsible,
        };
        nextFeedback = {
          tone: "warning",
          title: "IMEI já conferido",
          message: item ? `${item.brand || "Aparelho"} ${item.model || ""} já havia sido localizado.`.trim() : "Este IMEI já foi registrado como não previsto.",
          imei,
        };
      } else if (item) {
        event = {
          id: makeId("scan"),
          imei,
          rawValue: trimmed,
          result: "found",
          itemId: item.id,
          createdAt: now,
          operator: audit.responsible,
        };
        nextFeedback = {
          tone: "success",
          title: "Aparelho conferido",
          message: `${item.brand || "Aparelho"} ${item.model || ""} está no controle de estoque.`.trim(),
          imei,
        };
      } else {
        event = {
          id: makeId("scan"),
          imei,
          rawValue: trimmed,
          result: "unexpected",
          createdAt: now,
          operator: audit.responsible,
        };
        nextFeedback = {
          tone: "danger",
          title: "IMEI não consta no controle",
          message: "O aparelho foi registrado em divergências para análise.",
          imei,
        };
      }
    }

    const nextAudit = { ...audit, scans: [event, ...audit.scans] };
    activeAuditRef.current = nextAudit;
    setAudits((current) => {
      const nextAudits = current.map((candidate) => candidate.id === audit.id ? nextAudit : candidate);
      // Grava no mesmo instante da bipagem. Assim uma troca de tela, refresh ou o
      // navegador sendo suspenso no celular não perde o IMEI recém-lido.
      saveAudits(nextAudits);
      return nextAudits;
    });
    setFeedback(nextFeedback);
    if (source === "camera") {
      recordCameraRead(rawValue, cameraFormat, nextFeedback);
      signalCameraRead(nextFeedback.tone);
    }
    else playFeedback(nextFeedback.tone);
    if (source === "reader") window.setTimeout(() => manualInputRef.current?.focus(), 60);
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!manualValue.trim()) return;
    processScan(manualValue);
    setManualValue("");
  }

  async function handleInventoryFile(file?: File) {
    if (!file) return;
    setImporting(true);
    setImportError("");
    try {
      const result = await parseInventoryFile(file);
      const previous = activeAuditRef.current;
      if (previous && !previous.demo && previous.scans.length > 0) {
        const proceed = window.confirm(`A conferência “${previous.name}” será pausada. Deseja importar o novo controle?`);
        if (!proceed) return;
      }

      const now = new Date().toISOString();
      const session: AuditSession = {
        id: makeId("audit"),
        name: auditName.trim() || `Conferência ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`,
        branch: branch.trim() || "Não informada",
        responsible: responsible.trim() || "adm",
        status: "active",
        sourceFile: file.name,
        importedAt: now,
        startedAt: now,
        ignoredRows: result.ignoredRows,
        duplicateRows: result.duplicateRows,
        items: result.items,
        scans: [],
      };

      setAudits((current) => {
        const nextAudits = [
          session,
          ...current
            .filter((audit) => !audit.demo)
            .map((audit) => audit.status === "active" ? { ...audit, status: "paused" as const } : audit),
        ];
        saveAudits(nextAudits);
        return nextAudits;
      });
      activeAuditRef.current = session;
      setAuditName("");
      setFeedback({
        tone: "success",
        title: "Controle importado",
        message: `${result.items.length} IMEI(s) carregados e prontos para comparação a partir da planilha. ${result.ignoredRows ? `${result.ignoredRows} linha(s) sem IMEI foram ignoradas.` : ""}`.trim(),
      });
      navigate("scanner");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function markCameraAttempt() {
    cameraAttemptRef.current += 1;
    if (cameraAttemptRef.current % 10 === 0) setCameraScanHeartbeat(cameraAttemptRef.current);
  }

  function stopPrecisionScanner() {
    if (precisionScanTimerRef.current) window.clearTimeout(precisionScanTimerRef.current);
    precisionScanTimerRef.current = null;
    precisionReaderRef.current = null;
    precisionCanvasRef.current = null;
    nativeBarcodeDetectorRef.current = null;
  }

  function startPrecisionScanner(mode: CameraMode, requestId: number) {
    stopPrecisionScanner();
    const reader = new BrowserMultiFormatReader(createCameraHints());
    const canvas = document.createElement("canvas");
    precisionReaderRef.current = reader;
    precisionCanvasRef.current = canvas;

    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (Detector) {
      try {
        nativeBarcodeDetectorRef.current = new Detector({ formats: ["code_128", "code_39", "code_93", "codabar", "itf"] });
        setCameraEngine("Leitor nativo + ZXing 1D");
      } catch {
        try {
          nativeBarcodeDetectorRef.current = new Detector();
          setCameraEngine("Leitor nativo + ZXing 1D");
        } catch {
          nativeBarcodeDetectorRef.current = null;
          setCameraEngine("ZXing 1D");
        }
      }
    } else {
      nativeBarcodeDetectorRef.current = null;
      setCameraEngine("ZXing 1D");
    }

    const scanCenter = async () => {
      if (requestId !== cameraRequestRef.current || !streamRef.current || precisionReaderRef.current !== reader) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        precisionScanTimerRef.current = window.setTimeout(() => void scanCenter(), 180);
        return;
      }

      try {
        // O IMEI da caixa é um código 1D comprido e baixo. Um recorte horizontal
        // maior preserva as barras finas e dá ao decoder muito mais pixels úteis.
        const cropWidth = Math.round(video.videoWidth * 0.96);
        const cropHeight = Math.round(video.videoHeight * (mode === "small-code" ? 0.24 : 0.34));
        const sourceX = Math.round((video.videoWidth - cropWidth) / 2);
        const sourceY = Math.round((video.videoHeight - cropHeight) / 2);
        const outputWidth = Math.min(cropWidth, mode === "small-code" ? 1800 : 1600);
        const outputHeight = Math.max(240, Math.round(outputWidth * (cropHeight / cropWidth)));
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.imageSmoothingEnabled = true;
          context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
          markCameraAttempt();

          let nativeRead = false;
          const nativeDetector = nativeBarcodeDetectorRef.current;
          if (nativeDetector) {
            try {
              const detections = await nativeDetector.detect(canvas);
              const preferred = detections.find((entry) => normalizeImei(entry.rawValue)) ?? detections[0];
              if (preferred?.rawValue) {
                nativeRead = true;
                handleCameraDetection(preferred.rawValue, preferred.format ? `Nativo ${preferred.format}` : "Leitor nativo");
              }
            } catch {
              // Alguns navegadores expõem BarcodeDetector, mas falham em certos aparelhos.
              // Nessa situação o ZXing continua funcionando como fallback no mesmo quadro.
            }
          }

          if (!nativeRead) {
            try {
              const result = reader.decodeFromCanvas(canvas);
              handleCameraDetection(result.getText(), cameraFormatName(result.getBarcodeFormat()));
            } catch {
              // Nenhum código neste quadro. Isso é esperado durante a leitura contínua.
            }
          }
        }
      } catch {
        // Um quadro ruim, tremido ou fora de foco não deve interromper o scanner.
      } finally {
        if (requestId === cameraRequestRef.current && streamRef.current) {
          precisionScanTimerRef.current = window.setTimeout(() => void scanCenter(), mode === "small-code" ? 80 : 110);
        }
      }
    };

    precisionScanTimerRef.current = window.setTimeout(() => void scanCenter(), 180);
  }

  function releaseCameraResources() {
    stopPrecisionScanner();
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function loadVideoDevices(preferredId = selectedDeviceId) {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");
      const nextDeviceId = choosePreferredCamera(cameras, preferredId);
      setVideoDevices(cameras);
      setSelectedDeviceId(nextDeviceId);
      if (nextDeviceId) window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, nextDeviceId);
      return cameras;
    } catch {
      return videoDevices;
    }
  }

  async function requestCameraStream(mode: CameraMode, deviceId: string) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não oferece acesso à câmera.");
    }

    const quality: MediaTrackConstraints = {
      width: { ideal: mode === "small-code" ? 1920 : 1280 },
      height: { ideal: mode === "small-code" ? 1080 : 720 },
      frameRate: { ideal: 30 },
    };
    const preferredVideo: MediaTrackConstraints = deviceId
      ? { ...quality, deviceId: { exact: deviceId } }
      : { ...quality, facingMode: { ideal: "environment" } };

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: preferredVideo });
    } catch (error) {
      if (!(error instanceof DOMException) || !["OverconstrainedError", "NotFoundError"].includes(error.name)) throw error;
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } },
      });
    }
  }

  async function applyCameraEnhancements(track: MediaStreamTrack, mode: CameraMode) {
    try {
      track.contentHint = "detail";
      const capabilities = track.getCapabilities?.() as ExtendedCameraCapabilities | undefined;
      const advanced: Array<Record<string, unknown>> = [];
      setTorchAvailable(Boolean(capabilities?.torch));
      setZoomAvailable(Boolean(capabilities?.zoom));

      if (capabilities?.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
      if (capabilities?.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
      if (capabilities?.whiteBalanceMode?.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });

      const zoom = capabilities?.zoom;
      if (zoom) {
        const min = zoom.min ?? 1;
        const max = zoom.max ?? 1;
        const desired = mode === "small-code" ? 1.6 : 1;
        const safeZoom = Math.min(Math.max(desired, min), max);
        setCurrentZoom(safeZoom);
        advanced.push({ zoom: safeZoom });
      } else {
        setCurrentZoom(1);
      }

      if (advanced.length) {
        await track.applyConstraints({ advanced: advanced as MediaTrackConstraintSet[] });
      }
    } catch {
      // Advanced focus, exposure and zoom are optional and vary by device.
    }
  }

  function handleCameraDetection(rawValue: string, format = "código de barras") {
    const key = normalizeImei(rawValue) || onlyDigits(rawValue) || rawValue.trim();
    if (!key) return;
    const now = new Date().getTime();
    const lastReadAt = recentCameraCodesRef.current.get(key) ?? 0;
    if (now - lastReadAt < CAMERA_DUPLICATE_BLOCK_MS) return;
    recentCameraCodesRef.current.set(key, now);
    if (recentCameraCodesRef.current.size > 30) {
      recentCameraCodesRef.current.forEach((readAt, code) => {
        if (now - readAt > 30000) recentCameraCodesRef.current.delete(code);
      });
    }
    processScan(rawValue, "camera", format);
  }

  async function startCamera(mode: CameraMode = cameraMode, deviceIdOverride?: string) {
    if (!activeAuditRef.current) {
      navigate("new-audit");
      return;
    }

    unlockFeedback();
    cameraAttemptRef.current = 0;
    recentCameraCodesRef.current.clear();
    setCameraScanHeartbeat(0);
    setCameraReadPulse(null);
    setLastCameraRead(null);
    setCameraReadHistory([]);
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;
    setCameraOpen(true);
    window.setTimeout(() => cameraPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    setCameraStarting(true);
    setCameraActive(false);
    setCameraError("");
    setFeedback(null);
    setTorchEnabled(false);
    setTorchAvailable(false);
    setZoomAvailable(false);
    setCameraResolution("");
    manualInputRef.current?.blur();
    releaseCameraResources();

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const effectiveDeviceId = deviceIdOverride ?? selectedDeviceId;
      const stream = await requestCameraStream(mode, effectiveDeviceId);
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const trackSettings = track.getSettings();
      const activeDeviceId = trackSettings.deviceId || effectiveDeviceId;
      if (trackSettings.width && trackSettings.height) {
        setCameraResolution(`${trackSettings.width}×${trackSettings.height}`);
      }
      if (activeDeviceId) {
        setSelectedDeviceId(activeDeviceId);
        window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, activeDeviceId);
      }
      await applyCameraEnhancements(track, mode);

      if (!videoRef.current) throw new Error("O visor da câmera não foi encontrado.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await loadVideoDevices(activeDeviceId);

      const reader = new BrowserMultiFormatReader(createCameraHints(), {
        delayBetweenScanAttempts: mode === "small-code" ? 90 : 125,
        delayBetweenScanSuccess: 220,
      });
      const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
        markCameraAttempt();
        if (result) handleCameraDetection(result.getText(), cameraFormatName(result.getBarcodeFormat()));
      });
      if (requestId !== cameraRequestRef.current) {
        controls.stop();
        stream.getTracks().forEach((streamTrack) => streamTrack.stop());
        return;
      }
      controlsRef.current = controls;
      startPrecisionScanner(mode, requestId);
      setCameraMode(mode);
      setCameraActive(true);
    } catch (error) {
      if (requestId !== cameraRequestRef.current) return;
      releaseCameraResources();
      const message = friendlyCameraError(error);
      setCameraError(message);
      setFeedback({ tone: "danger", title: "Não foi possível iniciar a câmera", message });
    } finally {
      if (requestId === cameraRequestRef.current) setCameraStarting(false);
    }
  }

  function stopCamera(closePanel = true) {
    cameraRequestRef.current += 1;
    releaseCameraResources();
    setCameraStarting(false);
    setCameraActive(false);
    setTorchEnabled(false);
    setTorchAvailable(false);
    setZoomAvailable(false);
    setCameraScanHeartbeat(0);
    setCameraReadPulse(null);
    setCameraResolution("");
    if (closePanel) {
      setCameraOpen(false);
      window.setTimeout(() => manualInputRef.current?.focus(), 80);
    }
  }

  async function switchCamera() {
    try {
      const cameras = videoDevices.length ? videoDevices : await loadVideoDevices();
      if (cameras.length < 2) {
        setCameraError(cameras.length ? "Este aparelho informou apenas uma câmera." : "Nenhuma câmera foi encontrada.");
        return;
      }
      const currentIndex = cameras.findIndex((device) => device.deviceId === selectedDeviceId);
      const nextDevice = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
      setSelectedDeviceId(nextDevice.deviceId);
      window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, nextDevice.deviceId);
      if (cameraActive || cameraStarting) await startCamera(cameraMode, nextDevice.deviceId);
    } catch (error) {
      setCameraError(friendlyCameraError(error));
    }
  }

  async function handleCameraSelect(deviceId: string) {
    setSelectedDeviceId(deviceId);
    setCameraError("");
    window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, deviceId);
    if (cameraActive || cameraStarting) await startCamera(cameraMode, deviceId);
  }

  async function changeCameraMode(nextMode: CameraMode) {
    setCameraMode(nextMode);
    setCameraError("");
    window.localStorage.setItem(CAMERA_MODE_STORAGE_KEY, nextMode);
    if (cameraActive || cameraStarting) await startCamera(nextMode, selectedDeviceId);
  }

  async function toggleTorch() {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      const next = !torchEnabled;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchEnabled(next);
    } catch {
      setCameraError("Este aparelho ou navegador não permitiu controlar a lanterna.");
    }
  }

  async function changeZoom(direction: "in" | "out") {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      const capabilities = track.getCapabilities?.() as ExtendedCameraCapabilities | undefined;
      const zoom = capabilities?.zoom;
      if (!zoom) throw new Error("Zoom indisponível.");
      const min = zoom.min ?? 1;
      const max = zoom.max ?? 1;
      const step = Math.max(zoom.step ?? 0.2, 0.1);
      const next = direction === "in"
        ? Math.min(currentZoom + step, max)
        : Math.max(currentZoom - step, min);
      const rounded = Math.round(next * 100) / 100;
      await track.applyConstraints({ advanced: [{ zoom: rounded } as MediaTrackConstraintSet] });
      setCurrentZoom(rounded);
    } catch {
      setCameraError("Este aparelho ou navegador não permitiu controlar o zoom.");
    }
  }

  function finishAudit() {
    if (!liveAudit) return;
    const currentStats = getAuditStats(liveAudit);
    const message = currentStats.pending > 0
      ? `Ainda existem ${currentStats.pending} aparelho(s) não localizado(s). Deseja finalizar mesmo assim?`
      : "Todos os aparelhos foram conferidos. Deseja finalizar esta conferência?";
    if (!window.confirm(message)) return;
    const completed = { ...liveAudit, status: "completed" as const, completedAt: new Date().toISOString() };
    activeAuditRef.current = null;
    setAudits((current) => current.map((audit) => audit.id === liveAudit.id ? completed : audit));
    setFeedback({ tone: "success", title: "Conferência finalizada", message: "O resultado foi salvo no histórico e já pode ser exportado." });
    navigate("reports");
  }

  function resumeAudit(auditId: string) {
    setAudits((current) => current.map((audit) => {
      if (audit.id === auditId) {
        return { ...audit, status: "active", completedAt: undefined };
      }
      return audit.status === "active" ? { ...audit, status: "paused" } : audit;
    }));
    setView("scanner");
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyImei(imei: string) {
    navigator.clipboard?.writeText(imei);
    setFeedback({ tone: "info", title: "IMEI copiado", message: imei });
  }

  const checkedIds = useMemo(() => currentAudit ? checkedItemIds(currentAudit) : new Set<string>(), [currentAudit]);
  const missingItems = useMemo(
    () => currentAudit ? currentAudit.items.filter((item) => !checkedIds.has(item.id)) : [],
    [currentAudit, checkedIds],
  );
  const unexpectedScans = useMemo(() => currentAudit ? uniqueUnexpected(currentAudit) : [], [currentAudit]);
  const duplicateScans = useMemo(() => currentAudit ? currentAudit.scans.filter((scan) => scan.result === "duplicate") : [], [currentAudit]);

  const inventoryItems = useMemo(() => {
    if (!currentAudit) return [];
    const query = inventorySearch.trim().toLowerCase();
    return currentAudit.items.filter((item) => {
      const isChecked = checkedIds.has(item.id);
      const matchesStatus = inventoryFilter === "all" || (inventoryFilter === "checked" ? isChecked : !isChecked);
      const haystack = [item.imei, item.imei2, item.brand, item.model, item.serial, item.location].join(" ").toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [currentAudit, checkedIds, inventoryFilter, inventorySearch]);

  const pageSize = 25;
  const inventoryPages = Math.max(1, Math.ceil(inventoryItems.length / pageSize));
  const visibleInventory = inventoryItems.slice((inventoryPage - 1) * pageSize, inventoryPage * pageSize);

  if (!hydrated) {
    return (
      <div className="app-loading">
        <div className="brand-mark">TF</div>
        <strong>Preparando o inventário…</strong>
      </div>
    );
  }

  const renderDashboard = () => (
    <div className="page-stack">
      <section className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">GESTÃO DE ESTOQUE</span>
          <h1>Visão geral do inventário</h1>
          <p>Acompanhe a conferência física, os aparelhos pendentes e qualquer diferença em relação ao controle.</p>
        </div>
        <button className="button primary" onClick={() => navigate(liveAudit ? "scanner" : "new-audit")}>
          {liveAudit ? <ScanLine size={18} /> : <Plus size={18} />}
          {liveAudit ? "Continuar bipagem" : "Nova conferência"}
        </button>
      </section>

      {currentAudit ? (
        <section className="audit-overview">
          <div className="audit-overview-main">
            <div className="section-kicker"><span className={`status-dot ${currentAudit.status}`} /> {statusLabel(currentAudit.status)}</div>
            <h2>{currentAudit.name}</h2>
            <p><Store size={15} /> {currentAudit.branch} <span /> <UserRound size={15} /> {currentAudit.responsible}</p>
            <div className="audit-meta-line">
              <span><FileSpreadsheet size={15} /> {currentAudit.sourceFile}</span>
              <span><Clock3 size={15} /> Iniciada em {formatDateTime(currentAudit.startedAt)}</span>
              {currentAudit.demo && <span className="demo-label">dados de demonstração</span>}
            </div>
          </div>
          <div className="progress-ring" style={{ "--progress": `${stats.progress * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{stats.progress}%</strong><span>conferido</span></div>
          </div>
        </section>
      ) : (
        <EmptyState icon={FileSpreadsheet} title="Nenhum controle importado" text="Importe sua planilha para iniciar a primeira conferência." action={<button className="button primary" onClick={() => navigate("new-audit")}>Importar planilha</button>} />
      )}

      <section className="stats-grid">
        <StatCard label="Estoque esperado" value={stats.expected} helper="aparelhos no controle" icon={Boxes} />
        <StatCard label="Conferidos" value={stats.checked} helper={`${stats.progress}% do total`} icon={CircleCheckBig} tone="green" />
        <StatCard label="Não localizados" value={stats.pending} helper="ainda precisam ser bipados" icon={PackageSearch} tone="amber" />
        <StatCard label="Não previstos" value={stats.unexpected} helper="exigem verificação" icon={CircleAlert} tone="red" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div><span className="eyebrow">ÚLTIMAS LEITURAS</span><h2>Atividade da conferência</h2></div>
            <button className="text-button" onClick={() => navigate("scanner")}>Ver todas <ChevronRight size={16} /></button>
          </div>
          {!currentAudit || currentAudit.scans.length === 0 ? (
            <EmptyState icon={ScanLine} title="Nenhuma leitura" text="As bipagens mais recentes aparecerão aqui." />
          ) : (
            <div className="activity-list">
              {currentAudit.scans.slice(0, 6).map((scan) => {
                const item = currentAudit.items.find((candidate) => candidate.id === scan.itemId);
                return (
                  <div className="activity-row" key={scan.id}>
                    <div className={`result-icon ${scan.result}`}>
                      {scan.result === "found" ? <CheckCircle2 size={18} /> : scan.result === "duplicate" ? <RefreshCw size={18} /> : <CircleAlert size={18} />}
                    </div>
                    <div className="activity-main"><strong>{scan.imei}</strong><span>{item ? `${item.brand || ""} ${item.model || ""}`.trim() : resultLabel(scan.result)}</span></div>
                    <time>{formatDateTime(scan.createdAt)}</time>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel attention-panel">
          <div className="panel-header"><div><span className="eyebrow">ATENÇÃO</span><h2>Resumo de pendências</h2></div></div>
          <div className="attention-list">
            <button onClick={() => { setDivergenceTab("missing"); navigate("divergences"); }}>
              <span className="attention-icon amber"><PackageSearch size={19} /></span>
              <span><strong>{stats.pending} não localizados</strong><small>Aparelhos do controle ainda não bipados</small></span>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => { setDivergenceTab("unexpected"); navigate("divergences"); }}>
              <span className="attention-icon red"><TriangleAlert size={19} /></span>
              <span><strong>{stats.unexpected} fora do controle</strong><small>IMEIs bipados que não constam na planilha</small></span>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => navigate("reports")}>
              <span className="attention-icon blue"><FileBarChart size={19} /></span>
              <span><strong>Relatório de conciliação</strong><small>Exporte o resultado completo em CSV</small></span>
              <ChevronRight size={18} />
            </button>
          </div>
        </article>
      </section>
    </div>
  );

  const renderNewAudit = () => (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">NOVO INVENTÁRIO</span><h1>Importar controle de estoque</h1><p>Carregue a planilha com os aparelhos esperados. O sistema prepara automaticamente a lista para bipagem.</p></div>
        <button className="button secondary" onClick={downloadTemplate}><Download size={18} /> Baixar modelo</button>
      </section>

      <section className="import-layout">
        <article className="panel import-panel">
          <div className="form-grid">
            <label><span>Nome da conferência</span><input value={auditName} onChange={(event) => setAuditName(event.target.value)} placeholder="Ex.: Inventário semanal — Loja Centro" /></label>
            <label><span>Filial / local</span><input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Ex.: Loja Centro" /></label>
            <label><span>Responsável</span><input value={responsible} onChange={(event) => setResponsible(event.target.value)} placeholder="Nome do operador" /></label>
          </div>

          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(event) => handleInventoryFile(event.target.files?.[0])} />
          <button
            type="button"
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); handleInventoryFile(event.dataTransfer.files[0]); }}
          >
            <span className="upload-icon"><UploadCloud size={27} /></span>
            <strong>{importing ? "Lendo a planilha…" : "Selecione ou arraste a planilha"}</strong>
            <span>Formatos aceitos: Excel (.xlsx) e CSV</span>
            <small>Os dados ficam salvos neste dispositivo durante a fase de testes.</small>
          </button>
          {importError && <div className="inline-alert danger"><XCircle size={18} /><span><strong>Não foi possível importar</strong>{importError}</span></div>}
        </article>

        <aside className="panel import-help">
          <span className="eyebrow">COMO FUNCIONA</span>
          <h2>Da planilha ao resultado</h2>
          <ol className="process-list">
            <li><span>1</span><div><strong>Importe o controle</strong><p>O sistema reconhece automaticamente colunas como IMEI, marca, modelo, serial e localização.</p></div></li>
            <li><span>2</span><div><strong>Bipe os aparelhos</strong><p>Use um leitor USB/Bluetooth, digitação manual ou a câmera do celular.</p></div></li>
            <li><span>3</span><div><strong>Resolva as diferenças</strong><p>Veja imediatamente o que foi encontrado, o que falta e o que não consta no controle.</p></div></li>
          </ol>
          <div className="security-note"><ShieldCheck size={20} /><span><strong>Validação de IMEI</strong>O sistema extrai números de 15 dígitos e compara diretamente com o controle importado.</span></div>
        </aside>
      </section>
    </div>
  );

  const renderScanner = () => {
    if (!liveAudit) {
      return <EmptyState icon={ScanLine} title="Nenhuma conferência em andamento" text="Importe uma planilha ou retome uma conferência pausada." action={<button className="button primary" onClick={() => navigate("new-audit")}>Importar controle</button>} />;
    }

    return (
      <div className="page-stack">
        <section className="page-heading scanner-heading">
          <div><span className="eyebrow">CONFERÊNCIA EM ANDAMENTO</span><h1>{liveAudit.name}</h1><p>{liveAudit.branch} · {liveAudit.responsible} · iniciada em {formatDateTime(liveAudit.startedAt)}</p></div>
          <div className="scanner-heading-actions">
            <button className="button secondary" onClick={() => exportScanLog(liveAudit)} disabled={liveAudit.scans.length === 0}><FileDown size={18} /> Baixar bipagens</button>
            <button className="button danger-outline" onClick={finishAudit}><SquareStopIcon /> Finalizar conferência</button>
          </div>
        </section>

        <section className="scanner-stats">
          <div><span>Progresso</span><strong>{liveStats.progress}%</strong><div className="linear-progress"><i style={{ width: `${liveStats.progress}%` }} /></div></div>
          <div><span>Esperados</span><strong>{liveStats.expected}</strong></div>
          <div><span>Conferidos</span><strong className="green-text">{liveStats.checked}</strong></div>
          <div><span>Faltam</span><strong className="amber-text">{liveStats.pending}</strong></div>
          <div><span>Fora do controle</span><strong className="red-text">{liveStats.unexpected}</strong></div>
        </section>

        <div className="scan-save-strip" role="status">
          <Database size={17} />
          <span><strong>{liveAudit.scans.length} leitura(s) salva(s) neste aparelho</strong> · cada IMEI válido é gravado imediatamente e comparado com {liveStats.expected} IMEI(s) da planilha.</span>
        </div>

        <section className="scan-workspace">
          <article className="panel scan-panel">
            <div className="panel-header">
              <div><span className="eyebrow">LEITOR PRINCIPAL</span><h2>Bipar IMEI</h2></div>
              <span className="reader-status"><i /> leitor pronto</span>
            </div>
            <form className="scan-input-form" onSubmit={submitManual}>
              <Keyboard size={22} />
              <input
                ref={manualInputRef}
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                aria-label="IMEI para conferência"
                placeholder="Bipe ou digite o IMEI de 15 dígitos"
              />
              <button type="submit">Conferir</button>
            </form>
            <p className="scan-hint">Leitores USB e Bluetooth funcionam como teclado. Mantenha este campo selecionado e bipe normalmente.</p>

            {feedback ? (
              <div className={`scan-feedback ${feedback.tone}`} aria-live="polite">
                <div className="feedback-icon">
                  {feedback.tone === "success" ? <CheckCircle2 size={28} /> : feedback.tone === "warning" ? <RefreshCw size={27} /> : feedback.tone === "danger" ? <XCircle size={28} /> : <CircleAlert size={28} />}
                </div>
                <div><strong>{feedback.title}</strong><p>{feedback.message}</p>{feedback.imei && <code>{feedback.imei}</code>}</div>
              </div>
            ) : (
              <div className="scan-ready"><ScanLine size={28} /><div><strong>Aguardando a próxima leitura</strong><span>O resultado aparecerá aqui em tempo real.</span></div></div>
            )}

            <div className="scan-actions">
              <button className="button secondary" type="button" onClick={cameraOpen ? () => stopCamera() : () => startCamera()}>
                {cameraOpen ? <CameraOff size={18} /> : <Camera size={18} />} {cameraOpen ? "Fechar câmera" : "Usar câmera"}
              </button>
              <button className="button ghost" type="button" onClick={() => manualInputRef.current?.focus()}><Keyboard size={18} /> Reativar leitor</button>
            </div>
          </article>

          <aside className="panel last-read-panel">
            <span className="eyebrow">ÚLTIMAS BIPAGENS</span>
            <div className="compact-scans">
              {liveAudit.scans.length === 0 ? <p className="muted-copy">Nenhum aparelho bipado nesta conferência.</p> : liveAudit.scans.slice(0, 7).map((scan) => (
                <div key={scan.id}>
                  <span className={`mini-result ${scan.result}`} />
                  <span><strong>{scan.imei}</strong><small>{resultLabel(scan.result)} · {formatDateTime(scan.createdAt)}</small></span>
                  <button onClick={() => copyImei(scan.imei)} aria-label={`Copiar IMEI ${scan.imei}`}><Copy size={15} /></button>
                </div>
              ))}
            </div>
            <button className="text-button full" onClick={() => navigate("inventory")}>Abrir controle completo <ArrowRight size={16} /></button>
          </aside>
        </section>

        {cameraOpen && (
          <section ref={cameraPanelRef} className="panel camera-panel">
            <div className="panel-header camera-header">
              <div><span className="eyebrow">CÂMERA DO APARELHO</span><h2>Mire no código de barras do IMEI</h2></div>
              <div className="camera-header-actions">
                <span className={`camera-status ${cameraActive ? "active" : cameraStarting ? "starting" : ""}`}>
                  <i /> {cameraActive ? "lendo" : cameraStarting ? "abrindo" : "parada"}
                </span>
                <button className="icon-button" onClick={() => stopCamera()} aria-label="Fechar câmera"><X size={20} /></button>
              </div>
            </div>

            <div className="camera-toolbar">
              <label className="camera-select-field">
                <span>Câmera escolhida</span>
                <select
                  value={selectedDeviceId}
                  onChange={(event) => void handleCameraSelect(event.target.value)}
                  disabled={cameraStarting}
                  aria-label="Selecionar câmera"
                >
                  {!selectedDeviceId && <option value="">Automática — preferir traseira</option>}
                  {videoDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{cameraName(device, index)}</option>
                  ))}
                </select>
              </label>

              <button
                className="button ghost camera-switch-button"
                type="button"
                onClick={() => void switchCamera()}
                disabled={cameraStarting || videoDevices.length < 2}
                title={videoDevices.length < 2 ? "O aparelho informou apenas uma câmera" : "Alternar para a próxima câmera"}
              >
                <RefreshCw size={17} /> Trocar câmera
              </button>

              <div className="camera-mode-field">
                <span>Modo de leitura</span>
                <div className="camera-mode-buttons">
                  <button className={cameraMode === "normal" ? "active" : ""} type="button" onClick={() => void changeCameraMode("normal")} disabled={cameraStarting}>Normal</button>
                  <button className={cameraMode === "small-code" ? "active" : ""} type="button" onClick={() => void changeCameraMode("small-code")} disabled={cameraStarting}>Código pequeno</button>
                </div>
              </div>
            </div>

            <div className={`camera-viewport ${cameraMode === "small-code" ? "small-code" : ""} ${cameraReadPulse ? `read-${cameraReadPulse}` : ""}`}>
              <video ref={videoRef} muted playsInline autoPlay />
              <div className="camera-guide"><span /></div>
              {cameraActive && (
                <div className={`camera-live-hud ${lastCameraRead?.tone ?? "searching"}`}>
                  <span>{lastCameraRead ? "ÚLTIMA LEITURA" : "PROCURANDO CÓDIGO"}</span>
                  <strong>{lastCameraRead ? (lastCameraRead.imei || lastCameraRead.digits || "código reconhecido") : "Mantenha o IMEI dentro da faixa"}</strong>
                  <small>{lastCameraRead ? lastCameraRead.title : "Quando reconhecer, vai bipar/vibrar e salvar automaticamente."}</small>
                </div>
              )}
              {!cameraActive && (
                <div className="camera-placeholder">
                  {cameraStarting ? <RefreshCw className="spin" size={32} /> : <Camera size={32} />}
                  <strong>{cameraStarting ? "Abrindo a câmera…" : "Câmera parada"}</strong>
                  <span>{cameraStarting ? "Autorize o acesso caso o navegador solicite." : "Escolha a câmera e pressione iniciar."}</span>
                </div>
              )}
            </div>

            <div className="camera-decoder-status" aria-live="polite">
              <span className={`decoder-dot ${cameraActive ? "active" : ""}`} />
              <span>
                <strong>{cameraActive ? "Câmera ativa — procurando IMEI" : "Leitor aguardando a câmera"}</strong>
                {cameraActive && ` · ${cameraEngine} · ${cameraResolution ? `${cameraResolution} · ` : ""}${cameraScanHeartbeat ? `${cameraScanHeartbeat}+ quadros analisados` : "iniciando decodificador"}`}
              </span>
            </div>

            <div className={`camera-read-monitor ${lastCameraRead?.tone ?? "idle"}`} aria-live="assertive">
              <div className="camera-read-monitor-header">
                <span>ÚLTIMO CÓDIGO CAPTURADO PELA CÂMERA</span>
                {lastCameraRead && (
                  <strong>
                    {lastCameraRead.tone === "success" ? "CONFERIDO" : lastCameraRead.tone === "warning" ? "DUPLICADO" : lastCameraRead.tone === "danger" ? "DIVERGÊNCIA" : "IGNORADO"}
                  </strong>
                )}
              </div>
              {lastCameraRead ? (
                <div className="camera-read-monitor-body">
                  <ScanLine size={24} />
                  <div>
                    <code>{lastCameraRead.imei || lastCameraRead.digits || lastCameraRead.rawValue}</code>
                    <span>{lastCameraRead.title} · {lastCameraRead.format} · {formatDateTime(lastCameraRead.createdAt)}</span>
                    {lastCameraRead.rawValue !== (lastCameraRead.imei || lastCameraRead.digits) && <small>Leitura original: {lastCameraRead.rawValue}</small>}
                  </div>
                </div>
              ) : (
                <div className="camera-read-monitor-empty">
                  <ScanLine size={22} />
                  <span><strong>Nenhum código reconhecido ainda.</strong> Quando o leitor decodificar qualquer etiqueta, o número aparecerá exatamente aqui.</span>
                </div>
              )}
            </div>

            {cameraReadHistory.length > 1 && (
              <div className="camera-read-history" aria-label="Leituras recentes da câmera">
                {cameraReadHistory.map((read) => (
                  <span key={read.id} className={read.tone}>
                    <i /> {read.imei || read.digits || read.rawValue}
                  </span>
                ))}
              </div>
            )}

            <div className="camera-tip">
              <ScanLine size={18} />
              <span><strong>{cameraMode === "small-code" ? "Modo de precisão ativo." : "Leitura rápida ativa."}</strong> Centralize o código de barras do IMEI na faixa verde. Ao reconhecer 15 dígitos, o sistema salva a leitura na hora e compara com a planilha.</span>
            </div>

            {cameraError && <div className="camera-error" role="alert"><CircleAlert size={18} /><span>{cameraError}</span></div>}

            <div className="camera-actions">
              {!cameraActive && (
                <button className="button primary" onClick={() => void startCamera()} disabled={cameraStarting}>
                  {cameraStarting ? <RefreshCw className="spin" size={18} /> : <Camera size={18} />} {cameraStarting ? "Abrindo câmera…" : "Iniciar câmera"}
                </button>
              )}
              {cameraActive && <button className="button danger-outline" onClick={() => stopCamera(false)}><CameraOff size={18} /> Parar câmera</button>}
              {cameraActive && torchAvailable && <button className="button ghost" onClick={toggleTorch}><Flashlight size={18} /> {torchEnabled ? "Desligar lanterna" : "Ligar lanterna"}</button>}
              {cameraActive && zoomAvailable && (
                <div className="camera-zoom" aria-label="Controle de zoom">
                  <button type="button" onClick={() => void changeZoom("out")} aria-label="Diminuir zoom"><Minus size={17} /></button>
                  <span>{currentZoom.toFixed(1)}×</span>
                  <button type="button" onClick={() => void changeZoom("in")} aria-label="Aumentar zoom"><Plus size={17} /></button>
                </div>
              )}
              <button
                className="button ghost"
                type="button"
                onClick={testCameraFeedback}
              >
                <Volume2 size={18} /> Testar bip e vibração
              </button>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderInventory = () => (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">BASE IMPORTADA</span><h1>Controle de estoque</h1><p>Todos os aparelhos esperados e a situação atual de cada IMEI.</p></div>
        {currentAudit && <button className="button secondary" onClick={() => exportReconciliation(currentAudit)}><FileDown size={18} /> Exportar controle</button>}
      </section>
      {!currentAudit ? <EmptyState icon={Boxes} title="Sem estoque importado" text="Inicie uma nova conferência para visualizar os aparelhos." /> : (
        <section className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-box"><Search size={18} /><input value={inventorySearch} onChange={(event) => { setInventorySearch(event.target.value); setInventoryPage(1); }} placeholder="Buscar IMEI, modelo, serial ou local…" /></div>
            <div className="filter-tabs" aria-label="Filtrar aparelhos"><Filter size={17} />
              {(["all", "checked", "pending"] as InventoryFilter[]).map((filter) => <button key={filter} className={inventoryFilter === filter ? "active" : ""} onClick={() => { setInventoryFilter(filter); setInventoryPage(1); }}>{filter === "all" ? "Todos" : filter === "checked" ? "Conferidos" : "Pendentes"}</button>)}
            </div>
          </div>
          <div className="table-summary"><span>{inventoryItems.length} aparelho(s) encontrado(s)</span><span>Origem: {currentAudit.sourceFile}</span></div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Status</th><th>IMEI</th><th>Aparelho</th><th>Detalhes</th><th>Local</th><th></th></tr></thead>
              <tbody>{visibleInventory.map((item) => {
                const isChecked = checkedIds.has(item.id);
                return <tr key={item.id}>
                  <td><span className={`status-badge ${isChecked ? "checked" : "pending"}`}>{isChecked ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{isChecked ? "Conferido" : "Pendente"}</span></td>
                  <td><strong className="imei-text">{item.imei}</strong>{item.imei2 && <small>IMEI 2: {item.imei2}</small>}</td>
                  <td><strong>{[item.brand, item.model].filter(Boolean).join(" ") || "Não informado"}</strong><small>{item.serial ? `Serial: ${item.serial}` : `Linha ${item.sourceRow}`}</small></td>
                  <td>{[item.color, item.storage].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{item.location || currentAudit.branch}</td>
                  <td><button className="icon-button small" onClick={() => copyImei(item.imei)} aria-label={`Copiar ${item.imei}`}><Copy size={15} /></button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {visibleInventory.length === 0 && <EmptyState icon={Search} title="Nenhum resultado" text="Tente alterar a busca ou o filtro selecionado." />}
          <div className="pagination"><button disabled={inventoryPage === 1} onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}>Anterior</button><span>Página {inventoryPage} de {inventoryPages}</span><button disabled={inventoryPage === inventoryPages} onClick={() => setInventoryPage((page) => Math.min(inventoryPages, page + 1))}>Próxima</button></div>
        </section>
      )}
    </div>
  );

  const renderDivergences = () => {
    const list = divergenceTab === "missing" ? missingItems : divergenceTab === "unexpected" ? unexpectedScans : duplicateScans;
    return (
      <div className="page-stack">
        <section className="page-heading"><div><span className="eyebrow">CONCILIAÇÃO</span><h1>Divergências do inventário</h1><p>Priorize os aparelhos que ainda precisam de ação antes de encerrar a conferência.</p></div></section>
        <section className="divergence-summary">
          <button className={divergenceTab === "missing" ? "active" : ""} onClick={() => setDivergenceTab("missing")}><span className="attention-icon amber"><PackageSearch size={20} /></span><span><strong>{missingItems.length}</strong><small>Não localizados</small></span></button>
          <button className={divergenceTab === "unexpected" ? "active" : ""} onClick={() => setDivergenceTab("unexpected")}><span className="attention-icon red"><TriangleAlert size={20} /></span><span><strong>{unexpectedScans.length}</strong><small>Fora do controle</small></span></button>
          <button className={divergenceTab === "duplicates" ? "active" : ""} onClick={() => setDivergenceTab("duplicates")}><span className="attention-icon blue"><RefreshCw size={20} /></span><span><strong>{duplicateScans.length}</strong><small>Leituras repetidas</small></span></button>
        </section>
        <section className="panel table-panel">
          <div className="panel-header"><div><span className="eyebrow">{divergenceTab === "missing" ? "PENDÊNCIAS" : divergenceTab === "unexpected" ? "SOBRAS FÍSICAS" : "AUDITORIA"}</span><h2>{divergenceTab === "missing" ? "Aparelhos ainda não localizados" : divergenceTab === "unexpected" ? "IMEIs que não constam na planilha" : "Bipagens duplicadas"}</h2></div></div>
          {list.length === 0 ? <EmptyState icon={PackageCheck} title="Nenhuma divergência aqui" text="Não há itens para exibir nesta categoria." /> : divergenceTab === "missing" ? (
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>IMEI</th><th>Aparelho</th><th>Serial</th><th>Local esperado</th></tr></thead><tbody>{missingItems.map((item) => <tr key={item.id}><td><strong className="imei-text">{item.imei}</strong>{item.imei2 && <small>IMEI 2: {item.imei2}</small>}</td><td>{[item.brand, item.model].filter(Boolean).join(" ") || "Não informado"}</td><td>{item.serial || "—"}</td><td>{item.location || currentAudit?.branch || "—"}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Resultado</th><th>IMEI</th><th>Data e hora</th><th>Operador</th></tr></thead><tbody>{(divergenceTab === "unexpected" ? unexpectedScans : duplicateScans).map((scan) => <tr key={scan.id}><td><span className={`status-badge ${scan.result}`}>{resultLabel(scan.result)}</span></td><td><strong className="imei-text">{scan.imei}</strong></td><td>{formatDateTime(scan.createdAt)}</td><td>{scan.operator}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
    );
  };

  const renderHistory = () => (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">RASTREABILIDADE</span><h1>Histórico de conferências</h1><p>Consulte inventários anteriores, responsáveis, datas e resultados.</p></div><button className="button primary" onClick={() => navigate("new-audit")}><Plus size={18} /> Nova conferência</button></section>
      <section className="history-list">
        {audits.map((audit) => {
          const auditStats = getAuditStats(audit);
          return <article className="panel history-card" key={audit.id}>
            <div className="history-status"><span className={`status-dot ${audit.status}`} /><span>{statusLabel(audit.status)}</span>{audit.demo && <span className="demo-label">demonstração</span>}</div>
            <div className="history-main"><h2>{audit.name}</h2><p><Store size={15} /> {audit.branch} <span /> <UserRound size={15} /> {audit.responsible}</p><small>{audit.sourceFile} · {audit.items.length} aparelhos</small></div>
            <div className="history-metrics"><div><strong>{auditStats.progress}%</strong><span>conferido</span></div><div><strong>{auditStats.pending}</strong><span>faltantes</span></div><div><strong>{auditStats.unexpected}</strong><span>não previstos</span></div></div>
            <div className="history-date"><span>Início</span><strong>{formatDateTime(audit.startedAt)}</strong>{audit.completedAt && <small>Fim: {formatDateTime(audit.completedAt)}</small>}</div>
            <div className="history-actions">
              {audit.status !== "completed" && <button className="button secondary compact" onClick={() => resumeAudit(audit.id)}><Play size={16} /> {audit.status === "active" ? "Continuar" : "Retomar"}</button>}
              <button className="button ghost compact" onClick={() => exportReconciliation(audit)}><Download size={16} /> Exportar</button>
            </div>
          </article>;
        })}
      </section>
    </div>
  );

  const renderReports = () => (
    <div className="page-stack report-page">
      <section className="page-heading"><div><span className="eyebrow">RESULTADOS</span><h1>Relatórios do inventário</h1><p>Exporte a conciliação completa para análise, arquivo ou integração.</p></div><button className="button ghost print-button" onClick={() => window.print()}><Printer size={18} /> Imprimir resumo</button></section>
      {!currentAudit ? <EmptyState icon={FileBarChart} title="Nenhum relatório disponível" text="Finalize ou inicie uma conferência para gerar resultados." /> : <>
        <section className="report-title panel"><div><span className={`status-badge ${currentAudit.status}`}>{statusLabel(currentAudit.status)}</span><h2>{currentAudit.name}</h2><p>{currentAudit.branch} · {currentAudit.sourceFile}</p></div><div><span>Período</span><strong>{formatDateTime(currentAudit.startedAt)}</strong><small>{currentAudit.completedAt ? `até ${formatDateTime(currentAudit.completedAt)}` : "em andamento"}</small></div></section>
        <section className="stats-grid"><StatCard label="Esperados" value={stats.expected} helper="base da planilha" icon={Database} /><StatCard label="Conferidos" value={stats.checked} helper={`${stats.progress}% localizado`} icon={CircleCheckBig} tone="green" /><StatCard label="Faltantes" value={stats.pending} helper="não bipados" icon={PackageSearch} tone="amber" /><StatCard label="Não previstos" value={stats.unexpected} helper="fora da base" icon={TriangleAlert} tone="red" /></section>
        <section className="report-grid">
          <article className="panel export-card"><span className="export-icon"><FileSpreadsheet size={24} /></span><div><h2>Conciliação de estoque</h2><p>Lista completa com conferidos, faltantes, aparelhos não previstos e dados cadastrais.</p></div><button className="button primary" onClick={() => exportReconciliation(currentAudit)}><FileDown size={18} /> Baixar CSV</button></article>
          <article className="panel export-card"><span className="export-icon"><FileText size={24} /></span><div><h2>Log de bipagens</h2><p>Trilha cronológica com cada leitura, resultado, operador, data e hora.</p></div><button className="button secondary" onClick={() => exportScanLog(currentAudit)}><FileDown size={18} /> Baixar CSV</button></article>
        </section>
        <section className="panel report-breakdown"><div className="panel-header"><div><span className="eyebrow">QUALIDADE DA CONFERÊNCIA</span><h2>Composição do resultado</h2></div><strong>{stats.progress}%</strong></div><div className="stacked-progress"><span className="checked" style={{ width: `${stats.expected ? (stats.checked / stats.expected) * 100 : 0}%` }} /><span className="pending" style={{ width: `${stats.expected ? (stats.pending / stats.expected) * 100 : 0}%` }} /></div><div className="progress-legend"><span><i className="checked" /> {stats.checked} conferidos</span><span><i className="pending" /> {stats.pending} faltantes</span><span><i className="unexpected" /> {stats.unexpected} não previstos</span><span><i className="duplicate" /> {stats.duplicates} duplicidades</span></div></section>
      </>}
    </div>
  );

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">TF</div><div><strong>TELEFLUXO</strong><span>Inventário & IMEI</span></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={19} /></button></div>
        <div className="sidebar-context"><span>Ambiente atual</span><strong><Store size={15} /> {liveAudit?.branch || "Sem conferência ativa"}</strong>{liveAudit && <small><i /> inventário em andamento</small>}</div>
        <nav className="main-nav" aria-label="Menu principal">
          <span className="nav-section-title">OPERAÇÃO</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label}</span>{item.id === "divergences" && (liveStats.pending + liveStats.unexpected > 0) && <b>{liveStats.pending + liveStats.unexpected}</b>}</button>;
          })}
        </nav>
        <div className="sidebar-footer"><div className="user-avatar">AD</div><div><strong>adm</strong><span>Operador de estoque</span></div><ShieldCheck size={17} /></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button><div><span>TeleFluxo Inventário</span><strong>{formatDateLong()}</strong></div></div>
          <div className="topbar-actions">
            <span className="local-save"><ShieldCheck size={15} /> dados salvos</span>
            {!appInstalled && <button className="button secondary install-app-button" onClick={() => void installApplication()}><Download size={17} /><span>Instalar app</span></button>}
            <button className="icon-button notification-button" aria-label="Notificações"><Bell size={19} />{(liveStats.pending + liveStats.unexpected > 0) && <i />}</button>
            <button className="button primary topbar-new" onClick={() => navigate("new-audit")}><Plus size={17} /> Nova conferência</button>
          </div>
        </header>

        {feedback && view !== "scanner" && <div className={`global-toast ${feedback.tone}`}><div>{feedback.tone === "success" ? <CheckCircle2 size={20} /> : feedback.tone === "danger" ? <XCircle size={20} /> : <CircleAlert size={20} />}</div><span><strong>{feedback.title}</strong>{feedback.message}</span><button onClick={() => setFeedback(null)} aria-label="Fechar aviso"><X size={16} /></button></div>}

        <div className="page-content">
          {view === "dashboard" && renderDashboard()}
          {view === "new-audit" && renderNewAudit()}
          {view === "scanner" && renderScanner()}
          {view === "inventory" && renderInventory()}
          {view === "divergences" && renderDivergences()}
          {view === "history" && renderHistory()}
          {view === "reports" && renderReports()}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Atalhos do aplicativo">
        <button className={view === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")} aria-current={view === "dashboard" ? "page" : undefined}><LayoutDashboard size={20} /><span>Início</span></button>
        <button className={view === "new-audit" ? "active" : ""} onClick={() => navigate("new-audit")} aria-current={view === "new-audit" ? "page" : undefined}><FilePlus2 size={20} /><span>Importar</span></button>
        <button className={`mobile-scan-button ${view === "scanner" ? "active" : ""}`} onClick={() => navigate("scanner")} aria-current={view === "scanner" ? "page" : undefined}><ScanLine size={23} /><span>Bipar</span></button>
        <button className={view === "reports" ? "active" : ""} onClick={() => navigate("reports")} aria-current={view === "reports" ? "page" : undefined}><FileBarChart size={20} /><span>Baixar</span></button>
      </nav>

      {installHelpOpen && (
        <div className="install-backdrop" role="presentation" onClick={() => setInstallHelpOpen(false)}>
          <section className="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
            <div className="install-sheet-header">
              <div><span className="eyebrow">APLICATIVO MOBILE</span><h2 id="install-title">Instalar o TeleFluxo</h2></div>
              <button className="icon-button" onClick={() => setInstallHelpOpen(false)} aria-label="Fechar instruções"><X size={19} /></button>
            </div>
            <p>Use o sistema em tela cheia, com acesso rápido pela tela inicial do celular.</p>
            <div className="install-platforms">
              <article><strong>Android · Chrome</strong><span>Abra o menu <b>⋮</b> e escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</span></article>
              <article><strong>iPhone · Safari</strong><span>Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</span></article>
              <article><strong>Computador</strong><span>Use o ícone de instalação exibido à direita da barra de endereço.</span></article>
            </div>
            <button className="button primary install-confirm" onClick={() => setInstallHelpOpen(false)}>Entendi</button>
          </section>
        </div>
      )}
    </div>
  );
}

function SquareStopIcon() {
  return <span className="square-stop" aria-hidden="true" />;
}
