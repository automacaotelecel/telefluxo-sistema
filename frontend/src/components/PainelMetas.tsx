import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, ChevronDown, FileSpreadsheet, LockKeyhole, RefreshCw, Target, TrendingUp, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Group = 'APARELHOS' | 'ACESSORIOS' | 'SEGUROS';
type QuarterRow = {
  quarter: number; region: string; store: string; cnpj: string; group: Group;
  base: number; actual: number; carryIn: number; adjusted: number;
  pending: number; exceeded: number; closed: boolean; dueDate: string;
};
type MonthRow = {
  month: number; quarter: number; region: string; store: string; cnpj: string;
  group: Group; value: number; actual: number;
};
type Data = {
  success: boolean; year: number; currentQuarter: number; scope: 'network' | 'stores';
  generatedAt: string; sheetUpdatedAt: string; sheetStale: boolean;
  months: MonthRow[]; quarters: QuarterRow[]; notes: string[];
  sourceByMonth: Record<number, string>;
  access: { canCompareStores: boolean; stores: number };
};
const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);
const pct = (v: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
const fmt = (v: string) => v ? new Date(v).toLocaleString('pt-BR') : '—';
const groupLabels: Record<Group,string> = { APARELHOS: 'Aparelhos + Wearables', ACESSORIOS: 'Acessórios', SEGUROS: 'Seguros' };
const monthLabels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const summary = (rows: QuarterRow[]) => ({
  base: rows.reduce((s,r) => s+r.base,0), actual: rows.reduce((s,r) => s+r.actual,0),
  adjusted: rows.reduce((s,r) => s+r.adjusted,0), carry: rows.reduce((s,r) => s+r.carryIn,0),
  pending: rows.reduce((s,r) => s+r.pending,0), exceeded: rows.reduce((s,r) => s+r.exceeded,0),
});
function Card({title,value,info,icon:Icon}: {title:string;value:string;info:string;icon: LucideIcon}) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{title}</span><Icon size={18} className="shrink-0 text-orange-600"/></div>
    <div className="mt-3 break-words text-xl font-black tracking-tight text-slate-900 lg:text-2xl">{value}</div>
    <p className="mt-1 text-xs text-slate-500">{info}</p>
  </div>;
}
const selectClass = 'min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-orange-400';
export default function PainelMetas({ currentUser }: {currentUser: any}) {
  const [data,setData] = useState<Data | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [quarter,setQuarter] = useState(0);
  const [region,setRegion] = useState('TODAS');
  const [store,setStore] = useState('TODAS');
  const [group,setGroup] = useState('TODAS');
  const [tab,setTab] = useState<'lojas' | 'regioes' | 'meses' | 'fechamentos'>('lojas');
  useEffect(() => {
    const controller = new AbortController();
    // Reutiliza o usuário autenticado no login atual do TeleFluxo.
    const userId = String(currentUser?.id || '').trim();
    if (!userId) {
      setError('Usuário não identificado. Entre novamente no TeleFluxo.');
      setLoading(false);
      return;
    }
    setLoading(true); setError('');
    fetch(`${API}/api/metas/resumo?year=2026&userId=${encodeURIComponent(userId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const contentType = res.headers.get('content-type')?.toLowerCase() || '';
        // Detecta HTML (erro 404 ou redirecionamento para o frontend) antes de tentar ler JSON.
        if (!contentType.includes('application/json')) {
          const url = res.url || `${API}/api/metas/resumo`;
          throw new Error(
            `O backend não retornou JSON para o Painel de Metas (HTTP ${res.status}). ` +
            `Verifique se a rota /api/metas/resumo está registrada e publicada na API configurada: ${url}`
          );
        }
        const body = (await res.json()) as Data & { error?: string };
        if (!res.ok || body.success === false) {
          throw new Error(body.error || `Erro ao consultar o Painel de Metas (HTTP ${res.status}).`);
        }
        return body;
      })
      .then(body => {setData(body); setQuarter(x => x || body.currentQuarter);})
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha na consulta.'); })
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[currentUser?.id,refresh]);
  const quarters = data?.quarters || [];
  const regions = useMemo(() => [...new Set(quarters.map(r=>r.region))].sort(),[quarters]);
  const stores = useMemo(() => [...new Map(quarters.filter(r=> region==='TODAS'||r.region===region).map(r=>[r.cnpj,{cnpj:r.cnpj,store:r.store}])).values()].sort((a,b)=>a.store.localeCompare(b.store)),[quarters,region]);
  useEffect(()=>setStore('TODAS'),[region]);
  const filtered = useMemo(()=> quarters.filter(r => (quarter===0 || r.quarter===quarter || (quarter===-1&&r.quarter<=2) || (quarter===-2&&r.quarter>=3)) && (region==='TODAS'||r.region===region) && (store==='TODAS'||r.cnpj===store) && (group==='TODAS'||r.group===group)),[quarters,quarter,region,store,group]);
  const totals = useMemo(()=>summary(filtered),[filtered]);
  const percent = totals.adjusted > 0 ? 100*totals.actual/totals.adjusted : 0;
  const rankings = useMemo(() => {
    const map = new Map<string,QuarterRow[]>();
    filtered.forEach(row=>map.set(row.cnpj,[...(map.get(row.cnpj)||[]),row]));
    return [...map.entries()].map(([cnpj,rows])=>{const s=summary(rows);return {cnpj,name:rows[0]?.store||'',region:rows[0]?.region||'',...s,percent:s.adjusted>0?100*s.actual/s.adjusted:0};}).sort((a,b)=>b.percent-a.percent);
  },[filtered]);
  const regionsRank = useMemo(() => [...new Set(filtered.map(r => r.region))].map(regionName => {const r=summary(filtered.filter(x=>x.region===regionName)); return {regionName,...r,percent:r.adjusted>0?100*r.actual/r.adjusted:0};}).sort((a,b)=>b.percent-a.percent),[filtered]);
  const monthRows = useMemo(()=>{
    const map=new Map<string, {month:number; value:number; actual:number}>();
    const currentQ=quarter;
    (data?.months||[]).filter(m => (!currentQ||m.quarter===currentQ || (currentQ===-1&&m.quarter<=2) || (currentQ===-2&&m.quarter>=3)) && (region==='TODAS'||m.region===region) && (store==='TODAS'||m.cnpj===store) && (group==='TODAS'||m.group===group)).forEach(m=>{
      const key=String(m.month); const prev=map.get(key)||{month:m.month,value:0,actual:0};prev.value+=m.value;prev.actual+=m.actual;map.set(key,prev);
    });
    return [...map.values()].sort((a,b)=>a.month-b.month);
  },[data,quarter,region,store,group]);
  const overdue = filtered.filter(r=>r.closed&&r.pending>0);
  const activeQuarter = quarter>0 ? quarter : data?.currentQuarter || 1;
  const due = new Date(2026,activeQuarter*3,0).toLocaleDateString('pt-BR');
  const pace = useMemo(()=>{
    if (!data || quarter !== data.currentQuarter || new Date().getFullYear() !== 2026) return null;
    const now=new Date();
    for (let month=(activeQuarter-1)*3+1; month<=Math.min(activeQuarter*3,now.getMonth()+1);month++) {
      if (data.sourceByMonth[month]==='sem registros') return null;
    }
    const start=new Date(2026,(activeQuarter-1)*3,1); const end=new Date(2026,activeQuarter*3,0);
    const days=Math.max(1,Math.floor((end.getTime()-start.getTime())/86400000)+1);
    const elapsed=Math.max(1,Math.min(days,Math.floor((now.getTime()-start.getTime())/86400000)+1));
    const remaining=Math.max(0,days-elapsed);
    return {expected:totals.adjusted*elapsed/days,remainingDaily:remaining?Math.max(0,totals.adjusted-totals.actual)/remaining:0,projected:totals.actual/elapsed*days,remaining};
  },[data,quarter,activeQuarter,totals]);
  return <div className="h-full w-full overflow-y-auto bg-slate-50 p-4 pb-12 md:p-7">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-orange-600"><Target size={15}/> Planejamento e performance</div>
          <h1 className="mt-1 text-2xl font-black text-slate-900 md:text-3xl">Painel de Metas</h1>
          <p className="mt-1 text-sm text-slate-500">Metas 2026 do Google Sheets × vendas oficiais do TeleFluxo</p>
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-orange-300" onClick={()=>setRefresh(x=>x+1)} disabled={loading}><RefreshCw size={16} className={loading?'animate-spin':''}/> Atualizar</button>
      </div>
      {loading && !data && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Consultando metas e vendas autorizadas...</div>}
      {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><LockKeyhole size={18} className="shrink-0"/>{error}</div>}
      {data && <>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Período</span><select className={selectClass} value={quarter} onChange={e=>setQuarter(Number(e.target.value))}><option value={0}>Ano completo</option><option value={-1}>1º semestre</option><option value={-2}>2º semestre</option>{[1,2,3,4].map(q=><option value={q} key={q}>{q}º trimestre</option>)}</select></label>
          {data.scope==='network'&&<label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Região</span><select className={selectClass} value={region} onChange={e=>setRegion(e.target.value)}><option value="TODAS">Todas as regiões</option>{regions.map(x=><option key={x}>{x}</option>)}</select></label>}
          {data.access.canCompareStores&&<label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Loja</span><select className={selectClass} value={store} onChange={e=>setStore(e.target.value)}><option value="TODAS">Todas as lojas autorizadas</option>{stores.map(x=><option key={x.cnpj} value={x.cnpj}>{x.store}</option>)}</select></label>}
          <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Categoria</span><select className={selectClass} value={group} onChange={e=>setGroup(e.target.value)}><option value="TODAS">Todas as categorias</option>{(['APARELHOS','ACESSORIOS','SEGUROS'] as Group[]).map(x=><option key={x} value={x}>{groupLabels[x]}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card title="Meta original" value={money(totals.base)} info="Planejamento sem saldos" icon={Target}/>
          <Card title="Faturamento realizado" value={money(totals.actual)} info="Vendas classificadas nas fontes existentes" icon={Wallet}/>
          <Card title="Meta ajustada" value={money(totals.adjusted)} info={`Inclui ${money(totals.carry)} transportados`} icon={CalendarClock}/>
          <Card title="Atingimento" value={pct(percent)} info="Realizado ÷ meta ajustada" icon={TrendingUp}/>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="flex gap-2 text-xs font-bold text-slate-500"><ArrowDownRight size={16} className="text-rose-600"/> Pendência encerrada</p><div className="mt-2 text-xl font-black text-rose-700">{money(totals.pending)}</div><p className="mt-1 text-xs text-slate-500">Apenas trimestres fechados; compõe a meta seguinte.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="flex gap-2 text-xs font-bold text-slate-500"><ArrowUpRight size={16} className="text-emerald-600"/> Excedente encerrado</p><div className="mt-2 text-xl font-black text-emerald-700">{money(totals.exceeded)}</div><p className="mt-1 text-xs text-slate-500">Crédito demonstrativo separado; não aumenta a meta seguinte.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="flex gap-2 text-xs font-bold text-slate-500"><Activity size={16} className="text-orange-600"/> Fechamento trimestral</p><div className="mt-2 text-xl font-black text-slate-900">{quarter>0?due:quarter===-1?'1º semestre':quarter===-2?'2º semestre':'Por trimestre'}</div><p className="mt-1 text-xs text-slate-500">Saldo só é transferido após o fechamento oficial.</p></div>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <h2 className="text-base font-black text-slate-900">Evolução mensal</h2><p className="mb-4 text-xs text-slate-500">Meta original versus realizado — mês a mês</p>
            <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthRows.map(x=>({...x,name:monthLabels[x.month-1]}))} margin={{top:5,right:10,bottom:5,left:5}}><CartesianGrid stroke="#e2e8f0" vertical={false}/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:10}} tickFormatter={n=>`${(Number(n)/1e6).toFixed(1)}M`}/><Tooltip formatter={(v:any)=>money(Number(v))}/><Bar dataKey="value" name="Meta" fill="#94a3b8" radius={[4,4,0,0]}/><Bar dataKey="actual" name="Realizado" fill="#ea580c" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-slate-900">Diagnóstico comercial</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p><strong className="text-slate-900">Atingimento:</strong> {pct(percent)} da meta ajustada no período selecionado.</p>
              <p><strong className="text-slate-900">Diferença:</strong> {money(totals.actual-totals.adjusted)} em relação à meta ajustada.</p>
              <p><strong className="text-slate-900">Pendências fechadas:</strong> {money(totals.pending)}.</p>
              {pace&&<p className="rounded-xl bg-orange-50 p-3 text-orange-900"><strong>Ritmo do trimestre:</strong> {money(totals.actual)} realizados ante {money(pace.expected)} esperados até agora. Projeção linear: {money(pace.projected)}. Meta diária restante: {money(pace.remainingDaily)} ({pace.remaining} dias corridos; não considera feriados ou sazonalidade).</p>}
              {overdue.length>0&&<p className="rounded-xl bg-amber-50 p-3 text-amber-800"><AlertTriangle size={16} className="mr-1 inline"/> {overdue.length} metas loja/categoria encerradas com pendências.</p>}
              <p className="rounded-xl bg-slate-50 p-3 text-xs">A classificação de Aparelhos inclui aparelhos, wearables, tablets e notebooks. Metas de APARELHO e WEARABLE são somadas, sem duplicar vendas. Acessórios e seguros permanecem exclusivos.</p>
            </div>
          </section>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
            <div><h2 className="text-base font-black text-slate-900">Detalhamento</h2><p className="text-xs text-slate-500">Somente dados pertencentes às lojas autorizadas.</p></div>
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">{(['lojas','regioes','meses','fechamentos'] as const).map(x=><button key={x} onClick={()=>setTab(x)} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab===x?'bg-white text-orange-600 shadow-sm':'text-slate-500'}`}>{x==='lojas'?'Por loja':x==='regioes'?'Regiões':x==='meses'?'Mensal':'Fechamentos'}</button>)}</div>
          </div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{(tab==='lojas'?['Loja','Região','Meta ajustada','Realizado','Atingimento','Diferença']:tab==='regioes'?['Região','Meta ajustada','Realizado','Atingimento','Diferença']:tab==='meses'?['Mês','Meta','Realizado','Diferença','Atingimento']:['Trimestre','Loja','Categoria','Meta inicial','Transportado','Meta ajustada','Realizado','Pendente','Excedente','Situação']).map(col=><th key={col} className="whitespace-nowrap px-4 py-3 font-black">{col}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 text-slate-700">
          {tab==='lojas'&&rankings.map(r=><tr key={r.cnpj} className="hover:bg-slate-50"><td className="whitespace-nowrap px-4 py-3 font-bold">{r.name}</td><td className="px-4 py-3">{r.region}</td><td className="px-4 py-3">{money(r.adjusted)}</td><td className="px-4 py-3">{money(r.actual)}</td><td className="px-4 py-3 font-black">{pct(r.percent)}</td><td className={`px-4 py-3 font-bold ${r.actual>=r.adjusted?'text-emerald-700':'text-rose-600'}`}>{money(r.actual-r.adjusted)}</td></tr>)}
          {tab==='regioes'&&regionsRank.map(r=><tr key={r.regionName}><td className="px-4 py-3 font-bold">{r.regionName}</td><td className="px-4 py-3">{money(r.adjusted)}</td><td className="px-4 py-3">{money(r.actual)}</td><td className="px-4 py-3 font-bold">{pct(r.percent)}</td><td className="px-4 py-3">{money(r.actual-r.adjusted)}</td></tr>)}
          {tab==='meses'&&monthRows.map(m=><tr key={m.month}><td className="px-4 py-3 font-bold">{monthLabels[m.month-1]}</td><td className="px-4 py-3">{money(m.value)}</td><td className="px-4 py-3">{money(m.actual)}</td><td className="px-4 py-3">{money(m.actual-m.value)}</td><td className="px-4 py-3">{m.value?pct(100*m.actual/m.value):'—'}</td></tr>)}
          {tab==='fechamentos'&&filtered.map((q,i)=><tr key={`${q.cnpj}-${q.group}-${q.quarter}-${i}`}><td className="px-4 py-3 font-bold">{q.quarter}º tri</td><td className="whitespace-nowrap px-4 py-3">{q.store}</td><td className="whitespace-nowrap px-4 py-3">{groupLabels[q.group]}</td><td className="px-4 py-3">{money(q.base)}</td><td className="px-4 py-3">{money(q.carryIn)}</td><td className="px-4 py-3 font-bold">{money(q.adjusted)}</td><td className="px-4 py-3">{money(q.actual)}</td><td className="px-4 py-3 text-rose-600">{q.closed?money(q.pending):'—'}</td><td className="px-4 py-3 text-emerald-700">{q.closed?money(q.exceeded):'—'}</td><td className="px-4 py-3">{q.closed?'Fechado':(q as any).closureStatus==='dados_incompletos'?'Dados incompletos':'Em aberto'}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 text-sm font-black text-slate-900"><FileSpreadsheet size={17} className="text-orange-600"/> Fontes e conferência</h2><p className="mt-2 text-xs text-slate-600">Metas: Google Sheets / aba META ({data.sheetStale?'cache antigo — verificar atualização':'cache verificado'}). Última leitura: {fmt(data.sheetUpdatedAt)}. Dados processados: {fmt(data.generatedAt)}.</p><p className="mt-2 text-xs text-slate-500">Vendas de 2026: base mensal no período corrente, preferindo a base anual para meses encerrados. Nenhuma fonte é somada à outra no mesmo mês.</p><details className="mt-3 text-xs text-slate-600"><summary className="flex cursor-pointer items-center gap-1 font-bold"><ChevronDown size={14}/> Detalhes e alertas ({data.notes.length})</summary><ul className="mt-2 space-y-1 pl-5">{data.notes.map((n,i)=><li key={i} className="list-disc">{n}</li>)}</ul><p className="mt-3">Fonte por mês: {Object.entries(data.sourceByMonth).map(([m,v])=>`${monthLabels[Number(m)-1]}: ${v}`).join(' • ')}</p></details></section>
      </>}
    </div>
  </div>;
}
