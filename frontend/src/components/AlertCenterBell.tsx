import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  BellRing,
  Boxes,
  ChevronRight,
  Loader2,
  RefreshCw,
  TrendingDown,
} from 'lucide-react';

type IntelligentAlert = {
  id: string;
  type: string;
  severity: 'critica' | 'alta' | 'media' | 'baixa';
  title: string;
  description: string;
  module: string;
  store?: string;
  product?: string;
  metric?: { label: string; value: string | number; helper?: string };
  createdAt: string;
};

type Props = {
  currentUser: any;
  onOpenCenter?: () => void;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const severityClass: Record<string, string> = {
  critica: 'bg-rose-500',
  alta: 'bg-orange-500',
  media: 'bg-amber-400',
  baixa: 'bg-sky-400',
};

function AlertIcon({ alert }: { alert: IntelligentAlert }) {
  const Icon = alert.module === 'estoque' ? Boxes : alert.type.includes('queda') ? TrendingDown : AlertTriangle;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
      <Icon size={16} />
    </span>
  );
}

export default function AlertCenterBell({ currentUser, onOpenCenter }: Props) {
  const [alerts, setAlerts] = useState<IntelligentAlert[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const userId = String(currentUser?.id || '');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/intelligent-alerts?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Central indisponível');
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
      setSummary(data?.summary || null);
    } catch (error) {
      console.error('Erro ao carregar Central de Alertas:', error);
      setAlerts([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 180000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const importantCount = useMemo(
    () => alerts.filter((item) => item.severity === 'critica' || item.severity === 'alta').length,
    [alerts],
  );

  const topAlerts = useMemo(() => alerts.slice(0, 7), [alerts]);

  const openCenter = () => {
    setIsOpen(false);
    onOpenCenter?.();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-orange-600"
        title="Central de Alertas"
      >
        <ShieldAlert size={20} />
        {importantCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-rose-500 px-0.5 text-[8px] font-black text-white">
            {importantCount > 9 ? '9+' : importantCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-[1010] mt-3 w-[min(92vw,430px)] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <header className="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-orange-400">
                    <BellRing size={15} />
                    <span className="text-[9px] font-black uppercase tracking-[0.18em]">Central de Alertas</span>
                  </div>
                  <h3 className="mt-1 text-base font-black">Pontos que precisam de atenção</h3>
                </div>
                <button onClick={load} disabled={loading} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/15">
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-white/[0.07] px-3 py-2"><p className="text-[8px] font-black uppercase text-slate-400">Total</p><p className="mt-1 text-lg font-black">{summary?.total || 0}</p></div>
                <div className="rounded-xl bg-rose-500/10 px-3 py-2"><p className="text-[8px] font-black uppercase text-rose-300">Críticos</p><p className="mt-1 text-lg font-black text-rose-200">{Number(summary?.criticas || 0) + Number(summary?.altas || 0)}</p></div>
                <div className="rounded-xl bg-orange-500/10 px-3 py-2"><p className="text-[8px] font-black uppercase text-orange-300">Estoque</p><p className="mt-1 text-lg font-black text-orange-200">{summary?.estoque || 0}</p></div>
              </div>
            </header>

            <div className="max-h-[440px] overflow-y-auto p-2">
              {loading && alerts.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs font-bold text-slate-400"><Loader2 size={16} className="animate-spin" /> Analisando a operação...</div>
              ) : topAlerts.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs font-bold text-slate-400">Nenhum alerta relevante no seu escopo.</div>
              ) : (
                topAlerts.map((alert) => (
                  <button key={alert.id} onClick={openCenter} className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-slate-50">
                    <AlertIcon alert={alert} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${severityClass[alert.severity] || 'bg-slate-400'}`} />
                        <span className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">{alert.severity}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-black text-slate-800">{alert.title}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] font-medium leading-relaxed text-slate-500">{alert.description}</p>
                    </div>
                    <ChevronRight size={14} className="mt-3 shrink-0 text-slate-300" />
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <button onClick={openCenter} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-orange-600">
                Abrir Central completa <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
