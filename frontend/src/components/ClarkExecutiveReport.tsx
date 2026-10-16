import { Activity, AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Database, Lightbulb, ShieldAlert } from 'lucide-react';

type Metric = { label: string; value: string; detail?: string };
type Report = {
  version: 1;
  title: string;
  subtitle: string;
  agent: string;
  generatedAt: string;
  dataAsOf?: string;
  status: 'complete' | 'partial' | 'unavailable';
  metrics: Metric[];
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  diagnosis: string[];
  risks: string[];
  actions: string[];
  caveats: string[];
  sources: string[];
};

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

function validReport(value: any): value is Report {
  return value && value.version === 1 && typeof value.title === 'string' &&
    Array.isArray(value.metrics) && Array.isArray(value.columns) && Array.isArray(value.rows);
}

export default function ClarkExecutiveReport({ report }: { report: unknown }) {
  if (!validReport(report)) return null;
  const statusText = report.status === 'complete' ? 'Consulta concluída' :
    report.status === 'partial' ? 'Análise parcial' : 'Dados indisponíveis';
  const statusClass = report.status === 'complete'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100';

  return (
    <article className="w-full min-w-0 space-y-3 text-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Clark · {report.agent}</div>
          <h3 className="mt-1 text-[15px] font-extrabold leading-tight text-slate-950">{report.title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{report.subtitle}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass}`}>
          {report.status === 'complete' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {statusText}
        </span>
      </div>

      {report.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {report.metrics.slice(0, 6).map((metric, index) => (
            <div key={`${metric.label}-${index}`} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <p className="text-[10px] font-semibold text-slate-500">{metric.label}</p>
              <p className="mt-1 break-words text-[15px] font-extrabold text-slate-950">{metric.value}</p>
              {metric.detail && <p className="mt-1 text-[10px] leading-tight text-slate-500">{metric.detail}</p>}
            </div>
          ))}
        </div>
      )}

      {report.columns.length > 0 && report.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse text-left text-[11px]">
            <thead className="bg-slate-100 text-slate-600">
              <tr>{report.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-3 py-2 font-bold">{column.label}</th>
              ))}<th className="w-8" /></tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100 hover:bg-slate-50">
                  {report.columns.map((column) => (
                    <td key={column.key} className="max-w-[240px] px-3 py-2 align-top text-slate-700">
                      {String(row[column.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    {safeUrl(row.url) && <a href={safeUrl(row.url) || undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-orange-600" title="Ver evidência da oferta"><ArrowUpRight size={14}/></a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.diagnosis.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900"><Activity size={14} className="text-orange-600" /> Diagnóstico</h4>
          {report.diagnosis.map((line, i) => <p key={i} className="text-[12px] leading-relaxed text-slate-700">{line}</p>)}
        </section>
      )}

      {report.risks.length > 0 && (
        <section className="space-y-1.5 border-t border-slate-100 pt-2">
          <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900"><ShieldAlert size={14} className="text-amber-600" /> Pontos de atenção</h4>
          {report.risks.map((line, i) => <p key={i} className="text-[12px] leading-relaxed text-slate-700">• {line}</p>)}
        </section>
      )}

      {report.actions.length > 0 && (
        <section className="space-y-1.5 border-t border-slate-100 pt-2">
          <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900"><Lightbulb size={14} className="text-orange-600" /> Recomendações</h4>
          {report.actions.map((line, i) => <p key={i} className="text-[12px] leading-relaxed text-slate-700">{i + 1}. {line}</p>)}
        </section>
      )}

      <div className="space-y-1 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-500">
        <p className="flex items-start gap-1"><CalendarClock size={12} className="mt-0.5 shrink-0" /> {report.dataAsOf ? `Dados de ${new Date(report.dataAsOf).toLocaleString('pt-BR')}` : 'Horário de sincronização não confirmado'}</p>
        {report.sources.length > 0 && <p className="flex items-start gap-1"><Database size={12} className="mt-0.5 shrink-0" /> Fonte: {report.sources.join(' · ')}</p>}
        {report.caveats.map((line, i) => <p key={i}>• {line}</p>)}
      </div>
    </article>
  );
}
