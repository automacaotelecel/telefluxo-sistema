import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Props = {
  currentUser: any;
  dashboard: any;
  disabled?: boolean;
};

export default function ExecutiveReportButton({ currentUser, dashboard, disabled }: Props) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!currentUser?.id || !dashboard || loading) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/executive-report/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, dashboard }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Não foi possível gerar o relatório.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const contentType = response.headers.get('content-type') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const extension = contentType.includes('text/html') ? 'html' : 'pdf';
      link.href = url;
      link.download = match?.[1] || `telefluxo-relatorio-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      alert(error?.message || 'Erro ao gerar relatório executivo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={generate}
      disabled={disabled || loading || !dashboard}
      className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-wide text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-50"
      title="Gerar relatório executivo em PDF"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
      {loading ? 'Gerando...' : 'Gerar relatório'}
    </button>
  );
}
