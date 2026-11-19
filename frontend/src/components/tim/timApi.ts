export type Kind = 'sales' | 'services' | 'stock';
export type View = 'home' | 'sales' | 'annual' | 'services' | 'stock';
export type Metric = Record<string, number | null>;
export type Group = { name: string; store?: string; month?: string; code?: string; [key:string]: string|number|null|undefined };
export type Period = { month: string; first: string; last: string; records: number };
export type Dataset = {periods:Period[];stores:string[];options:Record<string,string[]>};
export type Metadata = {updated_at:string|null;stock_updated_at:string|null;scope:'network'|'stores';stores:string[];datasets:Record<Kind,Dataset>};
export type Row = Record<string,string|number|null>;
export type Report = {kind:Kind;summary:Metric;groups:Record<string,Group[]>;periods:Period[];rows:Row[];total:number;page:number;size:number;revision:string;burstStatus?:'loaded'|'partial'|'missing'|'unsupported'};
export const API=(import.meta.env.VITE_API_URL || (['localhost','127.0.0.1'].includes(window.location.hostname)?'http://localhost:3000':'https://telefluxo-aplicacao.onrender.com')).replace(/\/$/,'');
export async function timGet<T>(route:string, signal?:AbortSignal):Promise<T>{
  const token=sessionStorage.getItem('telefluxo_metas_token');
  if(!token)throw new Error('Sessão segura indisponível. Saia e entre novamente. O servidor precisa de METAS_SESSION_SECRET configurado.');
  const r=await fetch(`${API}/api/tim/${route}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(data?.error || `Falha na API TIM (HTTP ${r.status}).`);
  return data as T;
}
export const norm=(v:unknown)=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export function canOpenTim(u:any){
  const role=norm(u?.role),op=norm(u?.operation),scoped=/LOJA|VENDEDOR|OPERADOR|COLABORADOR/.test(role);
  return op==='TIM'||(!scoped&&(['CEO','DIRETOR','DIRETORIA','SOCIO','MASTER'].includes(role)||((u?.isAdmin===true||Number(u?.isAdmin)===1||['ADM','ADMIN','GESTOR'].includes(role))&&['TIM','GERAL','GESTAO',''].includes(op))));
}
export function canReturnToMain(_u:any){return true;}
export const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
export const money=(v:unknown)=>v==null?'—':n(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const count=(v:unknown)=>v==null?'—':n(v).toLocaleString('pt-BR',{maximumFractionDigits:1});
export const pct=(v:number|null)=>v==null?'—':`${v.toLocaleString('pt-BR',{maximumFractionDigits:1,signDisplay:'exceptZero'})}%`;
export const shortMoney=(v:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1,style:'currency',currency:'BRL'}).format(v);
export const dateBR=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10).split('-').reverse().join('/'): '—';
export const monthName=(v:string)=>v?new Date(`${v}-01T12:00:00Z`).toLocaleDateString('pt-BR',{month:'short',year:'numeric',timeZone:'UTC'}):'—';
export const monthEnd=(v:string)=>{const [y,m]=v.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
export const storeName=(v:unknown)=>String(v??'').replace(/^TIM /,'');
export const label=(v:unknown)=>String(v??'—').replace('SEM CLASSIFICACAO','Sem classificação').replace('SEM FILIAL','Sem filial').replace('SEM AREA','Sem área').replace('NAO OK','Não OK');
export async function exportRows(kind:Kind,query:string){
  const rows:Row[]=[];let page=1;let total=0;let revision='';
  do{const p=new URLSearchParams(query);p.set('kind',kind);p.set('page',String(page));p.set('size','200');p.set('detailsOnly','true');if(revision)p.set('revision',revision);const result=await timGet<Report>(`report?${p}`);if(!revision)revision=result.revision;rows.push(...result.rows);total=result.total;page++;if(!result.rows.length)break;}while(rows.length<total);
  if(!rows.length)return;
  const cols=Object.keys(rows[0]);
  // Mitigate spreadsheet formula injection in any string exported from the source.
  const cell=(v:unknown)=>`"${(typeof v==='number'?String(v).replace('.',','):String(v??'').replace(/^[=+\-@\t\r]/,"'$&")).replace(/"/g,'""')}"`;
  const csv='\ufeff'+[cols.map(cell).join(';'),...rows.map(r=>cols.map(c=>cell(r[c])).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`TIM_${kind}_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export const teamHeaders=()=>({ 'Content-Type':'application/json', Authorization:`Bearer ${sessionStorage.getItem('telefluxo_metas_token')||''}` });
export const isTimOperation=(v:unknown)=>norm(v)==='TIM';
