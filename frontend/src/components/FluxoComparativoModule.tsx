import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, Send, Search } from 'lucide-react';

type FluxoStatus = 'EM_ANALISE' | 'RESPONDIDO' | 'DEVOLVIDO';

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

const downloadBase64File = (base64: string, fileName: string, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') => {
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

  const loadItems = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams();
      if (user?.id) params.set('userId', String(user.id));
      const data = await requestJson(`/api/comparativos/fluxo?${params.toString()}`);
      setItems(Array.isArray(data?.items) ? data.items : []);
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

  const updateStatus = async (item: FluxoComparativo, status: FluxoStatus, motivo = '') => {
    setActionLoadingId(item.id);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(item.id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          motivoDevolucao: motivo,
          userId: user?.id || '',
        }),
      });

      setSuccessMsg(status === 'RESPONDIDO' ? 'Comparativo marcado como respondido.' : 'Comparativo devolvido com sucesso.');
      setDevolverItem(null);
      setDevolverMotivo('');
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

    try {
      const data = await requestJson(`/api/comparativos/fluxo/${encodeURIComponent(item.id)}/send-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id || '',
          to: 'analista.samsungtelecel@gmail.com',
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

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1080px] border-separate border-spacing-0 bg-white">
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
                      <div className="text-xs text-slate-400">{item.criadoPorId || '-'}</div>
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
                        {isPresidencia && item.status === 'EM_ANALISE' && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => updateStatus(item, 'RESPONDIDO')}
                              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              <CheckCircle2 size={14} /> Marcar como respondido
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => { setDevolverItem(item); setDevolverMotivo(''); }}
                              className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              <RotateCcw size={14} /> Devolver comparativo
                            </button>
                          </>
                        )}

                        {item.status === 'RESPONDIDO' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => sendTable(item)}
                            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-60"
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
