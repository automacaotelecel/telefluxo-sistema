import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import "./BarcodeScannerPage.css";

type ScanItem = {
  id: string;
  code: string;
  createdAt: string;
};

type CameraMode = "normal" | "small-code";
type PageMode = "single" | "batch";

const STORAGE_SINGLE_KEY = "telefluxo_scanner_single";
const STORAGE_BATCH_DRAFT_KEY = "telefluxo_scanner_batch_draft";
const DUPLICATE_BLOCK_TIME_MS = 1400;

export default function BarcodeScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCodeRef = useRef<string>("");
  const lastReadAtRef = useRef<number>(0);

  const [pageMode, setPageMode] = useState<PageMode>("single");
  const [cameraMode, setCameraMode] = useState<CameraMode>("normal");
  const [isScanning, setIsScanning] = useState(false);

  const [singleScans, setSingleScans] = useState<ScanItem[]>([]);
  const [batchScans, setBatchScans] = useState<ScanItem[]>([]);

  const [batchTarget, setBatchTarget] = useState<number>(5);

  const [lastCode, setLastCode] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [scanFlash, setScanFlash] = useState(false);

  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [zoomAvailable, setZoomAvailable] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const activeScans = pageMode === "single" ? singleScans : batchScans;
  const batchProgressPercent = useMemo(() => {
    if (batchTarget <= 0) return 0;
    return Math.min((batchScans.length / batchTarget) * 100, 100);
  }, [batchScans.length, batchTarget]);

  useEffect(() => {
    const savedSingle = localStorage.getItem(STORAGE_SINGLE_KEY);
    const savedBatch = localStorage.getItem(STORAGE_BATCH_DRAFT_KEY);

    if (savedSingle) {
      try {
        setSingleScans(JSON.parse(savedSingle));
      } catch {
        localStorage.removeItem(STORAGE_SINGLE_KEY);
      }
    }

    if (savedBatch) {
      try {
        setBatchScans(JSON.parse(savedBatch));
      } catch {
        localStorage.removeItem(STORAGE_BATCH_DRAFT_KEY);
      }
    }

    loadVideoDevices();

    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_SINGLE_KEY, JSON.stringify(singleScans));
  }, [singleScans]);

  useEffect(() => {
    localStorage.setItem(STORAGE_BATCH_DRAFT_KEY, JSON.stringify(batchScans));
  }, [batchScans]);

  async function loadVideoDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");

      setVideoDevices(cameras);

      if (!selectedDeviceId && cameras.length > 0) {
        const backCamera =
          cameras.find((camera) =>
            camera.label.toLowerCase().includes("back")
          ) ||
          cameras.find((camera) =>
            camera.label.toLowerCase().includes("traseira")
          ) ||
          cameras.find((camera) =>
            camera.label.toLowerCase().includes("environment")
          ) ||
          cameras[cameras.length - 1];

        setSelectedDeviceId(backCamera.deviceId);
      }
    } catch (err) {
      console.warn("Não foi possível listar câmeras:", err);
    }
  }

  function createBeep() {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;

      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = 880;

      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.22,
        audioContext.currentTime + 0.02
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.18
      );

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      console.warn("Não foi possível tocar beep:", err);
    }
  }

  function vibrateDevice() {
    try {
      if ("vibrate" in navigator) {
        navigator.vibrate([120, 60, 120]);
      }
    } catch (err) {
      console.warn("Não foi possível vibrar:", err);
    }
  }

  function showReadFeedback(code: string) {
    setSuccessMessage(`✅ Bipado com sucesso: ${code}`);
    setScanFlash(true);

    createBeep();
    vibrateDevice();

    setTimeout(() => {
      setScanFlash(false);
    }, 850);

    setTimeout(() => {
      setSuccessMessage("");
    }, 2600);
  }

  function addScanToCurrentMode(cleanCode: string) {
    const newItem: ScanItem = {
      id: crypto.randomUUID(),
      code: cleanCode,
      createdAt: new Date().toISOString(),
    };

    if (pageMode === "single") {
      setSingleScans((current) => {
        const alreadyExists = current.some((item) => item.code === cleanCode);

        if (alreadyExists) {
          showReadFeedback(`${cleanCode} — já estava na lista`);
          return current;
        }

        const next = [newItem, ...current];
        showReadFeedback(cleanCode);
        return next;
      });
      return;
    }

    setBatchScans((current) => {
      const alreadyExists = current.some((item) => item.code === cleanCode);

      if (alreadyExists) {
        showReadFeedback(`${cleanCode} — já estava no lote`);
        return current;
      }

      const next = [newItem, ...current];
      showReadFeedback(cleanCode);
      return next;
    });
  }

  function handleDetectedCode(code: string) {
    if (!code) return;

    const cleanCode = code.trim();
    if (!cleanCode) return;

    const now = Date.now();

    if (
      cleanCode === lastCodeRef.current &&
      now - lastReadAtRef.current < DUPLICATE_BLOCK_TIME_MS
    ) {
      return;
    }

    lastCodeRef.current = cleanCode;
    lastReadAtRef.current = now;

    setLastCode(cleanCode);
    addScanToCurrentMode(cleanCode);
  }

  async function applyCameraEnhancements(
    videoTrack: MediaStreamTrack,
    mode: CameraMode
  ) {
    try {
      const capabilities = (videoTrack as any).getCapabilities?.();
      const advancedConstraints: any[] = [];

      setTorchAvailable(Boolean(capabilities?.torch));
      setZoomAvailable(Boolean(capabilities?.zoom));

      if (capabilities?.focusMode?.includes("continuous")) {
        advancedConstraints.push({ focusMode: "continuous" });
      }

      if (capabilities?.exposureMode?.includes("continuous")) {
        advancedConstraints.push({ exposureMode: "continuous" });
      }

      if (capabilities?.whiteBalanceMode?.includes("continuous")) {
        advancedConstraints.push({ whiteBalanceMode: "continuous" });
      }

      if (capabilities?.zoom) {
        const minZoom = capabilities.zoom.min ?? 1;
        const maxZoom = capabilities.zoom.max ?? 1;

        const desiredZoom = mode === "small-code" ? 2 : 1.35;
        const safeZoom = Math.min(Math.max(desiredZoom, minZoom), maxZoom);

        setCurrentZoom(safeZoom);
        advancedConstraints.push({ zoom: safeZoom });
      } else {
        setCurrentZoom(1);
      }

      if (advancedConstraints.length > 0) {
        await videoTrack.applyConstraints({
          advanced: advancedConstraints,
        } as any);
      }
    } catch (cameraConfigError) {
      console.warn(
        "Não foi possível aplicar foco/zoom avançado:",
        cameraConfigError
      );
    }
  }

  async function startScanner(
    mode: CameraMode = cameraMode,
    deviceIdOverride?: string
  ) {
    try {
      setError("");
      setSuccessMessage("");
      setTorchEnabled(false);
      setTorchAvailable(false);
      setZoomAvailable(false);

      if (!videoRef.current) {
        throw new Error("Elemento de vídeo não encontrado.");
      }

      stopScanner();

      setIsScanning(true);
      setCameraMode(mode);

      const effectiveDeviceId = deviceIdOverride || selectedDeviceId;

      const hints = new Map();

      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
        BarcodeFormat.QR_CODE,
      ]);

      hints.set(DecodeHintType.TRY_HARDER, true);

      const videoConstraints: MediaTrackConstraints = effectiveDeviceId
        ? {
            deviceId: { exact: effectiveDeviceId },
            width: { ideal: mode === "small-code" ? 2560 : 1920 },
            height: { ideal: mode === "small-code" ? 1440 : 1080 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: "environment" },
            width: { ideal: mode === "small-code" ? 2560 : 1920 },
            height: { ideal: mode === "small-code" ? 1440 : 1080 },
            frameRate: { ideal: 30 },
          };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });

      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      await applyCameraEnhancements(videoTrack, mode);

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      await loadVideoDevices();

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: mode === "small-code" ? 160 : 230,
      });

      const controls = await reader.decodeFromStream(
        stream,
        videoRef.current,
        (result) => {
          if (result) {
            const code = result.getText();
            handleDetectedCode(code);
          }
        }
      );

      controlsRef.current = controls;
    } catch (err) {
      console.error(err);

      setError(
        "Não foi possível acessar ou focar a câmera. Tente trocar a câmera, usar boa iluminação, afastar um pouco o celular ou usar outro navegador."
      );

      stopScanner();
    }
  }

  function stopScanner() {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
    setTorchEnabled(false);
  }

  async function switchCamera() {
    try {
      if (videoDevices.length === 0) {
        await loadVideoDevices();
        return;
      }

      const currentIndex = videoDevices.findIndex(
        (device) => device.deviceId === selectedDeviceId
      );

      const nextIndex =
        currentIndex >= 0 && currentIndex < videoDevices.length - 1
          ? currentIndex + 1
          : 0;

      const nextDevice = videoDevices[nextIndex];
      if (!nextDevice) return;

      setSelectedDeviceId(nextDevice.deviceId);

      if (isScanning) {
        await startScanner(cameraMode, nextDevice.deviceId);
      }
    } catch (err) {
      console.error(err);
      setError("Não foi possível trocar a câmera.");
    }
  }

  async function handleCameraSelect(deviceId: string) {
    setSelectedDeviceId(deviceId);

    if (isScanning) {
      await startScanner(cameraMode, deviceId);
    }
  }

  async function toggleTorch() {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;

      const nextValue = !torchEnabled;

      await track.applyConstraints({
        advanced: [{ torch: nextValue }],
      } as any);

      setTorchEnabled(nextValue);
    } catch (err) {
      console.warn("Lanterna não suportada neste aparelho/navegador:", err);
      setError("Este aparelho ou navegador não permitiu controlar a lanterna.");
    }
  }

  async function changeZoom(direction: "in" | "out") {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;

      const capabilities = (track as any).getCapabilities?.();

      if (!capabilities?.zoom) {
        setError("Este aparelho ou navegador não permitiu controlar o zoom.");
        return;
      }

      const minZoom = capabilities.zoom.min ?? 1;
      const maxZoom = capabilities.zoom.max ?? 1;
      const step = capabilities.zoom.step ?? 0.2;

      const nextZoom =
        direction === "in"
          ? Math.min(currentZoom + step, maxZoom)
          : Math.max(currentZoom - step, minZoom);

      await track.applyConstraints({
        advanced: [{ zoom: nextZoom }],
      } as any);

      setCurrentZoom(nextZoom);
    } catch (err) {
      console.warn("Não foi possível alterar zoom:", err);
      setError("Não foi possível alterar o zoom neste aparelho.");
    }
  }

  function clearCurrentList() {
    const confirmClear = window.confirm(
      pageMode === "single"
        ? "Tem certeza que deseja apagar as leituras individuais?"
        : "Tem certeza que deseja apagar o lote atual?"
    );

    if (!confirmClear) return;

    if (pageMode === "single") {
      setSingleScans([]);
      localStorage.removeItem(STORAGE_SINGLE_KEY);
    } else {
      setBatchScans([]);
      localStorage.removeItem(STORAGE_BATCH_DRAFT_KEY);
    }

    setLastCode("");
    setSuccessMessage("");
    lastCodeRef.current = "";
    lastReadAtRef.current = 0;
  }

  function removeScan(id: string) {
    if (pageMode === "single") {
      setSingleScans((current) => current.filter((item) => item.id !== id));
      return;
    }

    setBatchScans((current) => current.filter((item) => item.id !== id));
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);

    setSuccessMessage(`Código copiado: ${code}`);

    setTimeout(() => {
      setSuccessMessage("");
    }, 2000);
  }

  function getExportContentTxt(scans: ScanItem[]) {
    return scans
      .slice()
      .reverse()
      .map((item, index) => {
        const date = new Date(item.createdAt).toLocaleString("pt-BR");
        return `${index + 1}. ${item.code} - ${date}`;
      })
      .join("\n");
  }

  function getExportContentCsv(scans: ScanItem[]) {
    const header = "ordem;codigo;data_hora";
    const rows = scans
      .slice()
      .reverse()
      .map((item, index) => {
        const date = new Date(item.createdAt).toLocaleString("pt-BR");
        return `${index + 1};${item.code};${date}`;
      });

    return [header, ...rows].join("\n");
  }

  function downloadFile(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
  }

  async function shareCurrentList() {
    const scans = activeScans;

    if (scans.length === 0) {
      alert("Nenhum código para compartilhar.");
      return;
    }

    const baseName =
      pageMode === "single"
        ? "telefluxo-leituras-individuais"
        : "telefluxo-lote-bipado";

    const txtContent = getExportContentTxt(scans);
    const fileName = `${baseName}.txt`;

    try {
      const file = new File([txtContent], fileName, {
        type: "text/plain;charset=utf-8",
      });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Leituras bipadas",
          text:
            pageMode === "single"
              ? "Leituras individuais bipadas no TeleFluxo."
              : "Lote bipado no TeleFluxo.",
          files: [file],
        });
        return;
      }

      downloadFile(txtContent, fileName, "text/plain;charset=utf-8");
      alert(
        "Seu aparelho/navegador não suportou compartilhamento direto. O arquivo foi baixado."
      );
    } catch (err) {
      console.warn("Não foi possível compartilhar:", err);
      downloadFile(txtContent, fileName, "text/plain;charset=utf-8");
      alert(
        "Não foi possível compartilhar diretamente. O arquivo foi baixado."
      );
    }
  }

  function exportTxt() {
    if (activeScans.length === 0) {
      alert("Nenhum código para exportar.");
      return;
    }

    const content = getExportContentTxt(activeScans);
    const baseName =
      pageMode === "single"
        ? "telefluxo-leituras-individuais"
        : "telefluxo-lote-bipado";

    downloadFile(content, `${baseName}.txt`, "text/plain;charset=utf-8");
  }

  function exportCsv() {
    if (activeScans.length === 0) {
      alert("Nenhum código para exportar.");
      return;
    }

    const content = getExportContentCsv(activeScans);
    const baseName =
      pageMode === "single"
        ? "telefluxo-leituras-individuais"
        : "telefluxo-lote-bipado";

    downloadFile(content, `${baseName}.csv`, "text/csv;charset=utf-8");
  }

  function finalizeBatch() {
    if (batchScans.length === 0) {
      alert("Nenhum código no lote para finalizar.");
      return;
    }

    const reachedTarget = batchScans.length >= batchTarget;

    if (!reachedTarget) {
      const continuar = window.confirm(
        `O lote ainda não atingiu a meta de ${batchTarget} aparelhos.\n\nDeseja finalizar assim mesmo?`
      );

      if (!continuar) return;
    }

    setSuccessMessage(
      `✅ Lote finalizado com ${batchScans.length} aparelho(s). Agora você pode compartilhar ou exportar.`
    );

    setTimeout(() => {
      setSuccessMessage("");
    }, 3500);
  }

  function newBatch() {
    const confirmar = window.confirm(
      "Deseja iniciar um novo lote? O lote atual será apagado."
    );

    if (!confirmar) return;

    setBatchScans([]);
    setLastCode("");
    setSuccessMessage("");
    lastCodeRef.current = "";
    lastReadAtRef.current = 0;
    localStorage.removeItem(STORAGE_BATCH_DRAFT_KEY);
  }

  function saveManualCode() {
    const cleanCode = manualCode.trim();

    if (!cleanCode) {
      alert("Digite um código antes de salvar.");
      return;
    }

    handleDetectedCode(cleanCode);
    setManualCode("");
  }

  function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveManualCode();
  }

  return (
    <main className={scanFlash ? "tf-page tf-page-success" : "tf-page"}>
      <aside className="tf-sidebar">
        <div className="tf-brand">
          <div className="tf-brand-logo">TF</div>
          <div>
            <strong>TELEFLUXO</strong>
            <span>Scanner Mobile</span>
          </div>
        </div>

        <nav className="tf-menu">
          <button
            className={pageMode === "single" ? "tf-menu-item active" : "tf-menu-item"}
            onClick={() => setPageMode("single")}
          >
            Leitura Individual
          </button>

          <button
            className={pageMode === "batch" ? "tf-menu-item active" : "tf-menu-item"}
            onClick={() => setPageMode("batch")}
          >
            Bipar por Lote
          </button>
        </nav>

        <div className="tf-sidebar-box">
          <span>Modo atual</span>
          <strong>
            {pageMode === "single" ? "Leitura Individual" : "Bipar por Lote"}
          </strong>
        </div>
      </aside>

      <section className="tf-content">
        <header className="tf-topbar">
          <div>
            <div className="tf-breadcrumb">GRUPO TELECEL • SCANNER DASH</div>
            <h1>
              {pageMode === "single"
                ? "Controle de Leitura"
                : "Controle de Bipagem por Lote"}
            </h1>
            <p>
              {pageMode === "single"
                ? "Bipe aparelhos individualmente e acompanhe as leituras em tempo real."
                : "Monte lotes de aparelhos, acompanhe o progresso e compartilhe o arquivo final."}
            </p>
          </div>

          <div className="tf-topbar-actions">
            {pageMode === "batch" && (
              <div className="tf-target-box">
                <label>Meta do lote</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={batchTarget}
                  onChange={(e) => setBatchTarget(Number(e.target.value) || 1)}
                />
              </div>
            )}

            <button className="tf-primary-btn" onClick={shareCurrentList}>
              Compartilhar arquivo
            </button>
          </div>
        </header>

        <div className="tf-tabs">
          <button
            className={pageMode === "single" ? "tf-tab active" : "tf-tab"}
            onClick={() => setPageMode("single")}
          >
            Leitura Individual
          </button>

          <button
            className={pageMode === "batch" ? "tf-tab active" : "tf-tab"}
            onClick={() => setPageMode("batch")}
          >
            Bipar por Lote
          </button>
        </div>

        <section className="tf-kpis">
          <article className="tf-kpi-card blue">
            <span>Total atual</span>
            <strong>{activeScans.length}</strong>
            <small>
              {pageMode === "single"
                ? "leituras individuais"
                : "itens no lote"}
            </small>
          </article>

          <article className="tf-kpi-card purple">
            <span>Modo da câmera</span>
            <strong>
              {cameraMode === "small-code" ? "Código pequeno" : "Normal"}
            </strong>
            <small>ajuste para leitura</small>
          </article>

          <article className="tf-kpi-card dark">
            <span>Zoom</span>
            <strong>{zoomAvailable ? `${currentZoom.toFixed(1)}x` : "Auto"}</strong>
            <small>ajuste da lente</small>
          </article>

          <article className="tf-kpi-card green">
            <span>Status</span>
            <strong>{isScanning ? "Câmera ativa" : "Câmera parada"}</strong>
            <small>scanner em operação</small>
          </article>
        </section>

        {pageMode === "batch" && (
          <section className="tf-batch-panel">
            <div className="tf-batch-panel-header">
              <div>
                <h3>Andamento do lote</h3>
                <p>
                  O modo lote funciona como um agrupador de bipagens. Você pode
                  colocar a meta em 5 e ir bipando os 5 aparelhos no mesmo lote.
                </p>
              </div>

              <div className="tf-batch-stats">
                <div>
                  <span>Meta</span>
                  <strong>{batchTarget}</strong>
                </div>
                <div>
                  <span>Lidos</span>
                  <strong>{batchScans.length}</strong>
                </div>
                <div>
                  <span>Faltam</span>
                  <strong>{Math.max(batchTarget - batchScans.length, 0)}</strong>
                </div>
              </div>
            </div>

            <div className="tf-progress-bar">
              <div
                className="tf-progress-fill"
                style={{ width: `${batchProgressPercent}%` }}
              />
            </div>
          </section>
        )}

        <section className={scanFlash ? "tf-scanner-card success" : "tf-scanner-card"}>
          <div className="tf-section-header">
            <div>
              <h2>
                {pageMode === "single"
                  ? "Leitor de código de barras"
                  : "Leitor do lote atual"}
              </h2>
              <p>
                Se a câmera abrir embaçada, use “Trocar câmera” até encontrar a
                lente mais nítida.
              </p>
            </div>

            <div className={isScanning ? "tf-status online" : "tf-status offline"}>
              {isScanning ? "Câmera ativa" : "Câmera parada"}
            </div>
          </div>

          {error && <div className="tf-alert error">{error}</div>}
          {successMessage && <div className="tf-alert success">{successMessage}</div>}

          {scanFlash && (
            <div className="tf-big-success">
              <strong>✅ BIPADO</strong>
              <span>
                {pageMode === "single"
                  ? "Pode passar para o próximo aparelho"
                  : "Item adicionado ao lote"}
              </span>
            </div>
          )}

          <div className={scanFlash ? "tf-video-box success" : "tf-video-box"}>
            <video ref={videoRef} muted playsInline autoPlay />
            <div className="tf-scan-guide">
              <span />
            </div>
          </div>

          <div className="tf-scanner-tip">
            Dica: para código pequeno, use “Modo código pequeno”, boa
            iluminação e mantenha o aparelho estável por 1 a 2 segundos.
          </div>

          <div className="tf-controls-grid">
            {videoDevices.length > 0 && (
              <select
                className="tf-select"
                value={selectedDeviceId}
                onChange={(event) => handleCameraSelect(event.target.value)}
              >
                {videoDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Câmera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}

            <button className="tf-btn ghost" onClick={switchCamera}>
              Trocar câmera
            </button>

            {!isScanning ? (
              <>
                <button
                  className="tf-btn primary"
                  onClick={() => startScanner("normal")}
                >
                  Iniciar câmera
                </button>

                <button
                  className="tf-btn secondary"
                  onClick={() => startScanner("small-code")}
                >
                  Modo código pequeno
                </button>
              </>
            ) : (
              <button className="tf-btn danger" onClick={stopScanner}>
                Parar câmera
              </button>
            )}

            {isScanning && zoomAvailable && (
              <>
                <button className="tf-btn ghost" onClick={() => changeZoom("out")}>
                  Zoom -
                </button>

                <button className="tf-btn ghost" onClick={() => changeZoom("in")}>
                  Zoom +
                </button>
              </>
            )}

            {isScanning && torchAvailable && (
              <button className="tf-btn ghost" onClick={toggleTorch}>
                {torchEnabled ? "Desligar lanterna" : "Ligar lanterna"}
              </button>
            )}

            <button
              className="tf-btn secondary"
              onClick={() => handleDetectedCode("TESTE-123456789")}
            >
              Testar bip
            </button>

            <button className="tf-btn ghost" onClick={clearCurrentList}>
              Limpar
            </button>
          </div>

          {lastCode && (
            <div className="tf-last-code">
              <span>Último código lido</span>
              <strong>{lastCode}</strong>
              <small>
                {pageMode === "single"
                  ? "Passe para o próximo aparelho."
                  : "Se quiser, continue adicionando ao lote."}
              </small>
            </div>
          )}
        </section>

        <section className="tf-bottom-grid">
          <section className="tf-panel">
            <div className="tf-section-header">
              <div>
                <h2>Digitação manual</h2>
                <p>Use quando a câmera não conseguir ler algum código.</p>
              </div>
            </div>

            <form className="tf-manual-form" onSubmit={handleManualSubmit}>
              <input
                type="text"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Digite ou cole o código aqui"
              />

              <button type="submit" className="tf-btn primary">
                Salvar código
              </button>
            </form>
          </section>

          <section className="tf-panel">
            <div className="tf-section-header">
              <div>
                <h2>
                  {pageMode === "single"
                    ? "Ações das leituras"
                    : "Ações do lote"}
                </h2>
                <p>Exporte ou compartilhe os códigos bipados.</p>
              </div>
            </div>

            <div className="tf-action-cards">
              <button className="tf-action-card" onClick={exportTxt}>
                <strong>Exportar TXT</strong>
                <span>Baixar em formato texto</span>
              </button>

              <button className="tf-action-card" onClick={exportCsv}>
                <strong>Exportar CSV</strong>
                <span>Baixar para Excel / planilhas</span>
              </button>

              <button className="tf-action-card" onClick={shareCurrentList}>
                <strong>Compartilhar</strong>
                <span>Enviar arquivo pelo celular</span>
              </button>

              {pageMode === "batch" ? (
                <>
                  <button className="tf-action-card highlight" onClick={finalizeBatch}>
                    <strong>Finalizar lote</strong>
                    <span>Encerrar lote atual</span>
                  </button>

                  <button className="tf-action-card" onClick={newBatch}>
                    <strong>Novo lote</strong>
                    <span>Limpar e começar outro lote</span>
                  </button>
                </>
              ) : null}
            </div>
          </section>
        </section>

        <section className="tf-panel">
          <div className="tf-section-header">
            <div>
              <h2>
                {pageMode === "single"
                  ? "Códigos lidos"
                  : "Códigos do lote atual"}
              </h2>
              <p>Total: {activeScans.length}</p>
            </div>
          </div>

          {activeScans.length === 0 ? (
            <div className="tf-empty-state">
              {pageMode === "single"
                ? "Nenhum código salvo ainda. Inicie a câmera e faça a primeira bipagem."
                : "Nenhum item no lote atual. Defina a meta e comece a bipar os aparelhos."}
            </div>
          ) : (
            <div className="tf-scan-list">
              {activeScans.map((item, index) => (
                <article key={item.id} className="tf-scan-item">
                  <div className="tf-scan-main">
                    <div className="tf-scan-number">{activeScans.length - index}</div>

                    <div>
                      <strong>{item.code}</strong>
                      <span>
                        {new Date(item.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  </div>

                  <div className="tf-scan-actions">
                    <button type="button" onClick={() => copyCode(item.code)}>
                      Copiar
                    </button>

                    <button type="button" onClick={() => removeScan(item.id)}>
                      Excluir
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}