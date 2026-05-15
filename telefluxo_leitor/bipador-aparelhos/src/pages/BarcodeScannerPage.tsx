import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import "./BarcodeScannerPage.css";

type ScanItem = {
  id: string;
  code: string;
  createdAt: string;
};

type CameraMode = "normal" | "small-code";

const STORAGE_KEY = "bipador_aparelhos_codigos";
const DUPLICATE_BLOCK_TIME_MS = 1400;

export default function BarcodeScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCodeRef = useRef<string>("");
  const lastReadAtRef = useRef<number>(0);

  const [isScanning, setIsScanning] = useState(false);
  const [lastCode, setLastCode] = useState("");
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [cameraMode, setCameraMode] = useState<CameraMode>("normal");
  const [scanFlash, setScanFlash] = useState(false);

  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [zoomAvailable, setZoomAvailable] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      try {
        setScans(JSON.parse(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    loadVideoDevices();

    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const newItem: ScanItem = {
      id: crypto.randomUUID(),
      code: cleanCode,
      createdAt: new Date().toISOString(),
    };

    setScans((currentScans) => {
      const alreadyExists = currentScans.some(
        (item) => item.code === cleanCode
      );

      if (alreadyExists) {
        showReadFeedback(`${cleanCode} — já estava na lista`);
        return currentScans;
      }

      const nextScans = [newItem, ...currentScans];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextScans));
      showReadFeedback(cleanCode);
      return nextScans;
    });
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
        advancedConstraints.push({
          focusMode: "continuous",
        });
      }

      if (capabilities?.exposureMode?.includes("continuous")) {
        advancedConstraints.push({
          exposureMode: "continuous",
        });
      }

      if (capabilities?.whiteBalanceMode?.includes("continuous")) {
        advancedConstraints.push({
          whiteBalanceMode: "continuous",
        });
      }

      if (capabilities?.zoom) {
        const minZoom = capabilities.zoom.min ?? 1;
        const maxZoom = capabilities.zoom.max ?? 1;

        const desiredZoom = mode === "small-code" ? 2 : 1.35;
        const safeZoom = Math.min(Math.max(desiredZoom, minZoom), maxZoom);

        setCurrentZoom(safeZoom);

        advancedConstraints.push({
          zoom: safeZoom,
        });
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
            console.log("Código detectado:", code);
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
        advanced: [
          {
            torch: nextValue,
          },
        ],
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
        advanced: [
          {
            zoom: nextZoom,
          },
        ],
      } as any);

      setCurrentZoom(nextZoom);
    } catch (err) {
      console.warn("Não foi possível alterar zoom:", err);
      setError("Não foi possível alterar o zoom neste aparelho.");
    }
  }

  function clearScans() {
    const confirmClear = window.confirm(
      "Tem certeza que deseja apagar todos os códigos salvos?"
    );

    if (!confirmClear) return;

    localStorage.removeItem(STORAGE_KEY);
    setScans([]);
    setLastCode("");
    setSuccessMessage("");
    lastCodeRef.current = "";
    lastReadAtRef.current = 0;
  }

  function removeScan(id: string) {
    const nextScans = scans.filter((item) => item.id !== id);
    setScans(nextScans);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextScans));
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);

    setSuccessMessage(`Código copiado: ${code}`);

    setTimeout(() => {
      setSuccessMessage("");
    }, 2000);
  }

  function exportTxt() {
    if (scans.length === 0) {
      alert("Nenhum código para exportar.");
      return;
    }

    const content = scans
      .slice()
      .reverse()
      .map((item, index) => {
        const date = new Date(item.createdAt).toLocaleString("pt-BR");
        return `${index + 1}. ${item.code} - ${date}`;
      })
      .join("\n");

    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "codigos-bipados.txt";
    link.click();

    URL.revokeObjectURL(url);
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
    <main className={scanFlash ? "scanner-page scan-success" : "scanner-page"}>
      <section className="scanner-header">
        <div>
          <span className="scanner-badge">MVP</span>
          <h1>Bipador de Aparelhos</h1>
          <p>
            Leia códigos de barras pelo celular e salve os códigos diretamente
            no navegador.
          </p>
        </div>
      </section>

      <section
        className={scanFlash ? "scanner-card card-success" : "scanner-card"}
      >
        <div className="scanner-card-header">
          <div>
            <h2>Bipagem em lote</h2>
            <p>
              Se a câmera abrir embaçada, use “Trocar câmera” até encontrar a
              lente mais nítida do aparelho.
            </p>
          </div>

          <div className={isScanning ? "status online" : "status offline"}>
            {isScanning ? "Câmera ativa" : "Câmera parada"}
          </div>
        </div>

        <div className="batch-summary">
          <div>
            <span>Total bipado</span>
            <strong>{scans.length}</strong>
          </div>

          <div>
            <span>Modo</span>
            <strong>
              {cameraMode === "small-code" ? "Código pequeno" : "Normal"}
            </strong>
          </div>

          <div>
            <span>Zoom</span>
            <strong>{zoomAvailable ? `${currentZoom.toFixed(1)}x` : "Auto"}</strong>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        {successMessage && <div className="alert success">{successMessage}</div>}

        {scanFlash && (
          <div className="big-success">
            <strong>✅ BIPADO</strong>
            <span>Pode passar para o próximo aparelho</span>
          </div>
        )}

        <div className={scanFlash ? "video-box video-success" : "video-box"}>
          <video ref={videoRef} muted playsInline autoPlay />

          <div className="scan-guide">
            <span />
          </div>
        </div>

        <div className="scanner-tip">
          No Fold/Samsung com várias lentes, a primeira câmera pode abrir
          embaçada. Toque em “Trocar câmera” e teste as opções até uma ficar
          nítida.
        </div>

        <div className="scanner-actions">
          {videoDevices.length > 0 && (
            <select
              className="camera-select"
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

          <button className="btn ghost" onClick={switchCamera}>
            Trocar câmera
          </button>

          {!isScanning ? (
            <>
              <button
                className="btn primary"
                onClick={() => startScanner("normal")}
              >
                Iniciar câmera
              </button>

              <button
                className="btn secondary"
                onClick={() => startScanner("small-code")}
              >
                Modo código pequeno
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={stopScanner}>
              Parar câmera
            </button>
          )}

          {isScanning && zoomAvailable && (
            <>
              <button className="btn ghost" onClick={() => changeZoom("out")}>
                Zoom -
              </button>

              <button className="btn ghost" onClick={() => changeZoom("in")}>
                Zoom +
              </button>
            </>
          )}

          {isScanning && torchAvailable && (
            <button className="btn ghost" onClick={toggleTorch}>
              {torchEnabled ? "Desligar lanterna" : "Ligar lanterna"}
            </button>
          )}

          <button
            className="btn secondary"
            onClick={() => handleDetectedCode("TESTE-123456789")}
          >
            Testar bip
          </button>

          <button className="btn secondary" onClick={exportTxt}>
            Exportar TXT
          </button>

          <button className="btn ghost" onClick={clearScans}>
            Limpar lista
          </button>
        </div>

        {lastCode && (
          <div className="last-code">
            <span>Último código lido</span>
            <strong>{lastCode}</strong>
            <small>Passe para o próximo aparelho.</small>
          </div>
        )}
      </section>

      <section className="scanner-card">
        <div className="scanner-card-header">
          <div>
            <h2>Digitação manual</h2>
            <p>
              Use esta opção caso a câmera não consiga ler algum código pequeno,
              desfocado ou com reflexo.
            </p>
          </div>
        </div>

        <form className="manual-form" onSubmit={handleManualSubmit}>
          <input
            type="text"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Digite ou cole o código aqui"
          />

          <button type="submit" className="btn primary">
            Salvar código
          </button>
        </form>
      </section>

      <section className="scanner-card">
        <div className="scanner-card-header">
          <div>
            <h2>Códigos salvos</h2>
            <p>Total de códigos bipados: {scans.length}</p>
          </div>
        </div>

        {scans.length === 0 ? (
          <div className="empty-state">
            Nenhum código salvo ainda. Inicie a câmera e faça a primeira
            bipagem.
          </div>
        ) : (
          <div className="scan-list">
            {scans.map((item, index) => (
              <article key={item.id} className="scan-item">
                <div className="scan-main">
                  <div className="scan-number">{scans.length - index}</div>

                  <div>
                    <strong>{item.code}</strong>
                    <span>
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>

                <div className="scan-item-actions">
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
    </main>
  );
}