import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react';

const RENDER_API_URL = 'https://telefluxo-aplicacao.onrender.com';

function getApiUrl() {
  const envUrl = String(
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    '',
  ).trim();

  if (envUrl) return envUrl.replace(/\/$/, '');

  if (typeof window === 'undefined') return RENDER_API_URL;

  const hostname = window.location.hostname;
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.endsWith('.local');

  return isLocal ? `http://${hostname}:3000` : RENDER_API_URL;
}

const API_URL = getApiUrl();

type OnlinePriceResult = {
  modelo: string;
  loja: string;
  disponibilidade: 'encontrado' | 'indisponivel' | 'nao_encontrado' | 'erro';
  precoAvistaOnline: number | null;
  precoPrazo12xOnline: number | null;
  precoAvistaPlanilha: number | null;
  precoPrazo12xPlanilha: number | null;
  diferencaAvista: number | null;
  diferencaAvistaPercentual: number | null;
  parcelasTexto: string | null;
  titulo: string | null;
  url: string | null;
  confianca: number;
  observacao: string | null;
  cacheHit?: boolean;
};

type OnlinePriceResponse = {
  ok: boolean;
  message: string;
  planilha: {
    nomeArquivo: string;
    aba: string;
    produtosDetectados: number;
    lojasDetectadas: number;
    produtosProcessados: number;
    lojasProcessadas: number;
    lojas: string[];
  };
  resumo: {
    consultasPlanejadas: number;
    consultasExecutadas: number;
    encontrados: number;
    indisponiveis: number;
    naoEncontrados: number;
    erros: number;
    inputTokens: number;
    outputTokens: number;
    webSearchRequests: number;
    custoEstimadoWebSearchUsd: number;
    cacheHits?: number;
    cacheMisses?: number;
    modelosPesquisadosNaApi?: number;
    cacheTtlDias?: number;
  };
  results: OnlinePriceResult[];
  reportFileName: string;
  downloadUrl: string;
  generatedAt: string;
  historyId?: string;
};

type OnlinePriceHistoryEntry = {
  id: string;
  originalName: string;
  createdAt: string;
  produtosProcessados: number;
  lojasProcessadas: number;
  resumo: OnlinePriceResponse['resumo'];
  reportFileName: string;
  downloadUrl: string;
};

type Props = {
  currentUser: any;
};

function money(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

function statusLabel(status: OnlinePriceResult['disponibilidade']) {
  switch (status) {
    case 'encontrado':
      return 'Encontrado';
    case 'indisponivel':
      return 'Indisponível';
    case 'erro':
      return 'Erro';
    default:
      return 'Não encontrado';
  }
}

function statusClass(status: OnlinePriceResult['disponibilidade']) {
  switch (status) {
    case 'encontrado':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'indisponivel':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'erro':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export default function OnlinePricesAgent({ currentUser }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [maxModels, setMaxModels] = useState('');
  const [maxStores, setMaxStores] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<OnlinePriceResponse | null>(null);
  const [history, setHistory] = useState<OnlinePriceHistoryEntry[]>([]);

  const estimatedMode = useMemo(() => {
    const modelLimit = Number(maxModels);
    const storeLimit = Number(maxStores);

    if (!maxModels && !maxStores) {
      return 'Execução completa da planilha enviada.';
    }

    return [
      Number.isFinite(modelLimit) && modelLimit > 0 ? `${modelLimit} modelo(s)` : 'todos os modelos',
      Number.isFinite(storeLimit) && storeLimit > 0 ? `${storeLimit} loja(s)` : 'todas as lojas',
    ].join(' • ');
  }, [maxModels, maxStores]);

  const loadHistory = async () => {
    const userId = String(currentUser?.id || '').trim();
    if (!userId) return;

    try {
      const response = await fetch(`${API_URL}/api/online-prices/history?limit=5&userId=${encodeURIComponent(userId)}`, {
        headers: { 'x-user-id': userId },
      });
      const json = await response.json().catch(() => null);
      if (response.ok && Array.isArray(json?.history)) {
        setHistory(json.history);
      }
    } catch (_) {
      // Histórico é auxiliar. Não bloquear a tela se falhar.
    }
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const handleSubmit = async () => {
    if (!file || loading) return;

    const userId = String(currentUser?.id || '').trim();
    if (!userId) {
      setError('Usuário não identificado. Faça login novamente.');
      return;
    }

    setError('');
    setData(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('xlsx', file);
      formData.append('userId', userId);
      if (maxModels.trim()) formData.append('maxModels', maxModels.trim());
      if (maxStores.trim()) formData.append('maxStores', maxStores.trim());
      formData.append('forceFullRun', !maxModels.trim() && !maxStores.trim() ? 'true' : 'false');

      const response = await fetch(`${API_URL}/api/online-prices/analyze`, {
        method: 'POST',
        headers: {
          'x-user-id': userId,
        },
        body: formData,
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Erro ao executar o agente de preços online.');
      }

      setData(json);
      loadHistory();
    } catch (err: any) {
      setError(err?.message || 'Erro desconhecido ao analisar preços online.');
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = async (downloadUrl: string, fileName: string) => {
    if (!downloadUrl || downloading) return;

    const userId = String(currentUser?.id || '').trim();
    if (!userId) {
      setError('Usuário não identificado. Faça login novamente.');
      return;
    }

    try {
      setDownloading(true);
      const separator = downloadUrl.includes('?') ? '&' : '?';
      const response = await fetch(
        `${API_URL}${downloadUrl}${separator}userId=${encodeURIComponent(userId)}`,
        {
          headers: { 'x-user-id': userId },
        },
      );

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || 'Erro ao baixar relatório.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || `precos-online-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Erro ao baixar relatório.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownload = async () => {
    if (!data?.downloadUrl || downloading) return;
    await downloadReport(data.downloadUrl, data.reportFileName || `precos-online-${Date.now()}.xlsx`);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-slate-950 rounded-3xl p-6 md:p-8 text-white shadow-xl overflow-hidden relative">
          <div className="absolute right-0 top-0 w-72 h-72 bg-orange-500/20 rounded-full blur-3xl translate-x-24 -translate-y-24" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-orange-600 flex items-center justify-center shadow-lg">
                <Bot size={28} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-300">
                  Clark IA • Novo agente
                </p>
                <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tight mt-1">
                  Preços Online
                </h1>
                <p className="text-sm text-slate-300 mt-2 max-w-3xl font-semibold leading-relaxed">
                  Carregue uma planilha Excel com modelos na primeira coluna e lojas no cabeçalho. A Clark pesquisa os preços nas lojas listadas, separa à vista e 12x, compara com a planilha e gera um relatório final em Excel.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-white/10 border border-white/10 rounded-2xl px-4 py-3 text-xs font-black uppercase text-slate-200">
              <ShieldCheck size={16} className="text-emerald-300" />
              Acesso ADM
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-5">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">
                1. Enviar planilha
              </h2>
              <p className="text-xs text-slate-500 font-semibold mt-1">
                Aceita .xlsx, .xls e .xlsm. O formato esperado é igual ao modelo enviado: MODELO + lojas + A VISTA/12X.
              </p>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 hover:border-orange-400 bg-slate-50 hover:bg-orange-50 rounded-3xl p-6 flex flex-col items-center justify-center gap-3 transition-all"
            >
              <UploadCloud size={34} className="text-orange-600" />
              <div className="text-center">
                <p className="text-sm font-black text-slate-800">
                  {file ? file.name : 'Clique para selecionar o Excel'}
                </p>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                  Até 15 MB
                </p>
              </div>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                setData(null);
                setError('');
              }}
            />

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-500">Limite modelos</span>
                <input
                  value={maxModels}
                  onChange={(event) => setMaxModels(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Todos"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-orange-400"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-500">Limite lojas</span>
                <input
                  value={maxStores}
                  onChange={(event) => setMaxStores(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Todas"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-orange-400"
                />
              </label>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 flex gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-amber-800 font-bold">
                {estimatedMode} O agente agora usa cache por 7 dias, consulta consolidada por modelo e limite de buscas para reduzir custo.
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!file || loading}
              className="w-full h-12 rounded-2xl bg-slate-950 hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {loading ? 'Pesquisando preços...' : 'Iniciar agente'}
            </button>

            {history.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase text-slate-500">Últimas consultas</p>
                {history.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => downloadReport(item.downloadUrl, item.reportFileName)}
                    className="block w-full text-left rounded-xl bg-white border border-slate-200 p-2 hover:border-orange-300 transition-colors"
                  >
                    <p className="text-[11px] font-black text-slate-800 truncate">{item.originalName}</p>
                    <p className="text-[10px] font-bold text-slate-500">
                      {new Date(item.createdAt).toLocaleString('pt-BR')} • {item.produtosProcessados} modelo(s) • cache {item.resumo.cacheHits || 0}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-3xl p-4 flex items-start gap-3">
                <XCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-black text-red-800 uppercase">Erro no agente</p>
                  <p className="text-sm text-red-700 font-semibold mt-1">{error}</p>
                </div>
              </div>
            )}

            {!data && !loading && (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center min-h-[360px] flex flex-col items-center justify-center">
                <FileSpreadsheet size={54} className="text-slate-300" />
                <h2 className="text-xl font-black uppercase text-slate-800 mt-4">
                  Aguardando planilha
                </h2>
                <p className="text-sm text-slate-500 font-semibold max-w-xl mt-2">
                  Após enviar o Excel, a Clark identifica modelos e lojas, reutiliza cache recente quando existir, pesquisa apenas o necessário e gera o relatório em Excel.
                </p>
              </div>
            )}

            {loading && (
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 min-h-[360px] flex flex-col items-center justify-center text-center">
                <Loader2 size={54} className="text-orange-600 animate-spin" />
                <h2 className="text-xl font-black uppercase text-slate-800 mt-4">
                  Clark pesquisando na internet
                </h2>
                <p className="text-sm text-slate-500 font-semibold max-w-xl mt-2">
                  Esse processo pode demorar em planilhas grandes. A Clark reaproveita cache recente e faz consultas consolidadas por modelo para reduzir tokens e web searches.
                </p>
              </div>
            )}

            {data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black uppercase text-slate-400">Consultas</p>
                    <p className="text-2xl font-black text-slate-900">{data.resumo.consultasExecutadas}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black uppercase text-slate-400">Encontrados</p>
                    <p className="text-2xl font-black text-emerald-600">{data.resumo.encontrados}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black uppercase text-slate-400">Cache</p>
                    <p className="text-2xl font-black text-blue-600">{data.resumo.cacheHits || 0}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black uppercase text-slate-400">Web searches</p>
                    <p className="text-2xl font-black text-orange-600">{data.resumo.webSearchRequests}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black uppercase text-slate-400">Tokens</p>
                    <p className="text-2xl font-black text-slate-900">
                      {(data.resumo.inputTokens + data.resumo.outputTokens).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
                    <div>
                      <div className="flex items-center gap-2 text-emerald-700">
                        <CheckCircle2 size={18} />
                        <h2 className="text-sm font-black uppercase tracking-widest">Análise concluída</h2>
                      </div>
                      <p className="text-xs text-slate-500 font-semibold mt-1">
                        {data.planilha.produtosProcessados} de {data.planilha.produtosDetectados} modelos • {data.planilha.lojasProcessadas} de {data.planilha.lojasDetectadas} lojas • cache {data.resumo.cacheHits || 0}/{data.resumo.consultasExecutadas} • web search US$ {data.resumo.custoEstimadoWebSearchUsd.toFixed(4)}
                      </p>
                    </div>

                    <button
                      onClick={handleDownload}
                      disabled={downloading}
                      className="h-11 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 transition-colors"
                    >
                      {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      {downloading ? 'Baixando...' : 'Baixar relatório'}
                    </button>
                  </div>

                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 mb-4">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Lojas detectadas</p>
                    <p className="text-xs font-bold text-slate-700">{data.planilha.lojas.join(' • ')}</p>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-950 text-white">
                        <tr>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase">Modelo</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase">Loja</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase">Status</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase">À vista online</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase">12x online</th>
                          <th className="px-3 py-3 text-right text-[10px] font-black uppercase">Dif. à vista</th>
                          <th className="px-3 py-3 text-left text-[10px] font-black uppercase">Obs.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {data.results.slice(0, 80).map((item, index) => (
                          <tr key={`${item.modelo}-${item.loja}-${index}`} className="hover:bg-slate-50">
                            <td className="px-3 py-3 font-black text-slate-800 whitespace-nowrap">{item.modelo}</td>
                            <td className="px-3 py-3 font-bold text-slate-700 whitespace-nowrap">{item.loja}</td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className={`inline-flex px-2 py-1 rounded-full border text-[10px] font-black uppercase ${statusClass(item.disponibilidade)}`}>
                                {statusLabel(item.disponibilidade)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{money(item.precoAvistaOnline)}</td>
                            <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{money(item.precoPrazo12xOnline)}</td>
                            <td className="px-3 py-3 text-right font-bold whitespace-nowrap">
                              {money(item.diferencaAvista)}
                              <span className="block text-[10px] text-slate-400">{pct(item.diferencaAvistaPercentual)}</span>
                            </td>
                            <td className="px-3 py-3 max-w-[220px]">
                              <span className="text-slate-500 font-semibold">
                                {item.cacheHit ? 'Cache reutilizado' : item.observacao || 'Consulta nova'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {data.results.length > 80 && (
                    <p className="text-[11px] text-slate-500 font-bold mt-3">
                      Mostrando os primeiros 80 registros na tela. O relatório Excel contém todos os resultados processados.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
