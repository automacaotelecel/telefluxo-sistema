import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  SearchX,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type MasterIssue = {
  id: number;
  source?: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  reference?: string;
  description?: string;
  mappingStatus: 'FALLBACK' | 'AMBIGUOUS' | 'UNMAPPED';
  telefluxoCode?: string;
  matchBy?: string;
  details?: string;
  occurrences: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  resolved?: number | boolean;
};

type MasterStatus = {
  loadedAt?: string | null;
  rows?: number;
  groups?: number;
  stale?: boolean;
  lastError?: string | null;
};

function statusLabel(status: MasterIssue['mappingStatus']) {
  if (status === 'UNMAPPED') return 'Não mapeado';
  if (status === 'AMBIGUOUS') return 'Ambíguo';
  return 'Fallback';
}

function statusClass(status: MasterIssue['mappingStatus']) {
  if (status === 'UNMAPPED') return 'bg-red-50 text-red-700 border-red-100';
  if (status === 'AMBIGUOUS') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

export default function ProductMasterIssuesPanel() {
  const [issues, setIssues] = useState<MasterIssue[]>([]);
  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [issuesRes, statusRes] = await Promise.all([
        fetch(`${API_URL}/api/product-master/issues?limit=300`, { cache: 'no-store' }),
        fetch(`${API_URL}/api/product-master/status`, { cache: 'no-store' }),
      ]);

      const issuesData = await issuesRes.json();
      const statusData = await statusRes.json();

      setIssues(Array.isArray(issuesData?.issues) ? issuesData.issues : []);
      setStatus(statusData?.success ? statusData : null);
    } catch (error) {
      console.error('Erro ao carregar pendências da Base Mestre:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshMaster = async () => {
    try {
      setRefreshing(true);
      const response = await fetch(`${API_URL}/api/product-master/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Não foi possível atualizar a Base Mestre.');
      }
      await load();
    } catch (error: any) {
      alert(error?.message || 'Erro ao atualizar Base Mestre.');
    } finally {
      setRefreshing(false);
    }
  };

  const markResolved = async (id: number) => {
    const response = await fetch(`${API_URL}/api/product-master/issues/${id}/resolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok || !data?.success) {
      alert(data?.error || 'Não foi possível marcar como resolvido.');
      return;
    }
    setIssues((current) => current.filter((item) => item.id !== id));
  };

  const counts = useMemo(() => ({
    unmapped: issues.filter((item) => item.mappingStatus === 'UNMAPPED').length,
    fallback: issues.filter((item) => item.mappingStatus === 'FALLBACK').length,
    ambiguous: issues.filter((item) => item.mappingStatus === 'AMBIGUOUS').length,
  }), [issues]);

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <Database size={19} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-black text-slate-900">Base Mestre de Produtos</h3>
              {issues.length > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[9px] font-black text-white">
                  {issues.length} pendência{issues.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {status?.groups || 0} chaves TeleFluxo em cache
              {status?.loadedAt ? ` • atualizado ${formatDate(status.loadedAt)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden rounded-xl bg-red-50 px-3 py-2 text-[10px] font-black text-red-700 sm:inline-flex">
            {counts.unmapped} não mapeados
          </span>
          <span className="hidden rounded-xl bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 sm:inline-flex">
            {counts.fallback} fallback
          </span>
          <AlertTriangle className={issues.length ? 'text-orange-500' : 'text-slate-300'} size={18} />
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
              <span className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-red-700">Não mapeados {counts.unmapped}</span>
              <span className="rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-amber-700">Ambíguos {counts.ambiguous}</span>
              <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-blue-700">Fallback {counts.fallback}</span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={load}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600 hover:border-slate-300"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Recarregar
              </button>
              <button
                type="button"
                onClick={refreshMaster}
                className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-black uppercase text-white hover:bg-orange-600"
              >
                {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Atualizar Sheets
              </button>
            </div>
          </div>

          {status?.lastError && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              Último erro ao carregar o Sheets: {status.lastError}
            </div>
          )}

          {loading && issues.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-slate-400">
              <Loader2 size={17} className="animate-spin" /> Carregando pendências...
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="mt-2 text-sm font-black text-slate-800">Nenhuma pendência aberta</p>
              <p className="mt-1 text-xs text-slate-400">Os produtos consultados estão sendo relacionados normalmente.</p>
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {issues.map((issue) => (
                <div key={issue.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${statusClass(issue.mappingStatus)}`}>
                          {statusLabel(issue.mappingStatus)}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{issue.source || 'SISTEMA'}</span>
                        <span className="text-[9px] font-bold text-slate-400">{issue.occurrences || 1} ocorrência(s)</span>
                      </div>

                      <div className="mt-2 flex items-start gap-2">
                        <SearchX size={15} className="mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-800">{issue.description || 'Produto sem descrição'}</p>
                          <p className="mt-1 break-all text-[10px] font-semibold text-slate-500">
                            Código: {issue.productCode || '-'} • EAN: {issue.barcode || '-'} • SKU: {issue.sku || '-'} • Ref.: {issue.reference || '-'}
                          </p>
                          {issue.telefluxoCode && (
                            <p className="mt-1 text-[10px] font-black text-blue-600">Chave encontrada: {issue.telefluxoCode} via {issue.matchBy || 'fallback'}</p>
                          )}
                          <p className="mt-1 text-[9px] text-slate-400">Última ocorrência: {formatDate(issue.lastSeenAt)}</p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => markResolved(issue.id)}
                      className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase text-emerald-700 hover:bg-emerald-100"
                    >
                      Marcar resolvido
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
