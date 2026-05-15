import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import "./BarcodeScannerPage.css";

type ScanItem = {
  id: string;
  code: string;
  createdAt: string;
};

const STORAGE_KEY = "bipador_aparelhos_codigos";

export default function BarcodeScannerPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCodeRef = useRef<string>("");

  const [isScanning, setIsScanning] = useState(false);
  const [lastCode, setLastCode] = useState("");
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      try {
        setScans(JSON.parse(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return () => {
      stopScanner();
    };
  }, []);

  function handleDetectedCode(code: string) {
    if (!code) return;

    const cleanCode = code.trim();

    if (!cleanCode) return;

    // Evita salvar o mesmo código repetido várias vezes seguidas
    if (cleanCode === lastCodeRef.current) return;

    lastCodeRef.current = cleanCode;
    setLastCode(cleanCode);

    const newItem: ScanItem = {
      id: crypto.randomUUID(),
      code: cleanCode,
      createdAt: new Date().toISOString(),
    };

    setScans((currentScans) => {
      const nextScans = [newItem, ...currentScans];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextScans));
      return nextScans;
    });

    setSuccessMessage(`Código salvo: ${cleanCode}`);

    setTimeout(() => {
      setSuccessMessage("");
    }, 2500);
  }

  async function startScanner() {
    try {
      setError("");
      setSuccessMessage("");
      setIsScanning(true);

      if (!videoRef.current) {
        throw new Error("Elemento de vídeo não encontrado.");
      }

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

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 500,
        });

      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
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
        "Não foi possível acessar ou ler pela câmera. Verifique se o app está em HTTPS, se você permitiu a câmera e se está usando boa iluminação."
      );

      setIsScanning(false);
    }
  }

  function stopScanner() {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }

    setIsScanning(false);
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
      .map((item) => {
        const date = new Date(item.createdAt).toLocaleString("pt-BR");
        return `${item.code} - ${date}`;
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
    <main className="scanner-page">
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

      <section className="scanner-card">
        <div className="scanner-card-header">
          <div>
            <h2>Leitor de código de barras</h2>
            <p>Aponte a câmera para o código do aparelho.</p>
          </div>

          <div className={isScanning ? "status online" : "status offline"}>
            {isScanning ? "Câmera ativa" : "Câmera parada"}
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        {successMessage && <div className="alert success">{successMessage}</div>}

        <div className="video-box">
          <video ref={videoRef} muted playsInline />
        </div>

        <div className="scanner-actions">
          {!isScanning ? (
            <button className="btn primary" onClick={startScanner}>
              Iniciar câmera
            </button>
          ) : (
            <button className="btn danger" onClick={stopScanner}>
              Parar câmera
            </button>
          )}

          <button
            className="btn secondary"
            onClick={() => handleDetectedCode("TESTE-123456789")}
          >
            Testar salvamento
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
          </div>
        )}
      </section>

      <section className="scanner-card">
        <div className="scanner-card-header">
          <div>
            <h2>Digitação manual</h2>
            <p>
              Use esta opção caso a câmera não consiga ler algum código pequeno
              ou desfocado.
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
            {scans.map((item) => (
              <article key={item.id} className="scan-item">
                <div>
                  <strong>{item.code}</strong>
                  <span>
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </span>
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