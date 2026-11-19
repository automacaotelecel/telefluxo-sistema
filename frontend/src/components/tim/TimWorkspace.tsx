import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowRight, BarChart3, Building2, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Download, LayoutDashboard, LogOut, Menu, MapPin, Package, RefreshCw, Search, ShoppingBag, Signal, Smartphone, TrendingUp, Users, X } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie } from 'recharts';
import { canReturnToMain, timGet, money, count, n, pct, shortMoney, monthName, monthEnd, dateBR, storeName, label, exportRows } from './timApi';
import type { Kind, View, Metadata, Report, Group, Metric, Row, Period } from './timApi';
import './tim.css';

const COLORS=['#002198','#EB0028','#16A3D8','#0D947B','#7953D2','#E8A521','#4368E4','#64748B'];
const MENU=[{id:'home',name:'Visão geral',icon:LayoutDashboard},{id:'sales',name:'Vendas mensais',icon:ShoppingBag},{id:'annual',name:'Vendas anuais',icon:CalendarDays},{id:'services',name:'Serviços',icon:Signal},{id:'stock',name:'Estoque',icon:Package}] as const;
const TITLES:Record<View,string>={home:'Visão geral',sales:'Vendas mensais',annual:'Vendas anuais',services:'Serviços',stock:'Estoque'};
const mainMetric:Record<Kind,string>={sales:'revenue',services:'records',stock:'quantity'};
const fmt=(kind:Kind,v:unknown)=>kind==='sales'?money(v):count(v);
const monthLabels=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const primary= (kind:Kind)=>mainMetric[kind];
const baseFilter={store:'',area:'',category:'',seller:'',coordinator:'',status:'',brand:'',stockAge:'',search:'',liquid:false,available:false};
type Filters=typeof baseFilter;
const isAbort=(e:unknown)=>e instanceof DOMException&&e.name==='AbortError';
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);

function buildQuery(kind:Kind,filters:Filters,from:string,to:string,page=1){
  const q=new URLSearchParams({kind,page:String(page),size:'40'});
  if(kind!=='stock'){if(from)q.set('from',from);if(to)q.set('to',to);}
  const allowed=kind==='stock'?['store','area','category','brand','stockAge','search','available']:kind==='sales'?['store','area','category','seller','coordinator','search','liquid']:['store','area','category','seller','status','search','liquid'];
  for(const key of allowed){const value=filters[key as keyof Filters];if(value)q.set(key==='stockAge'?'stock_age':key,String(value));}
  return q.toString();
}
function useReport(kind:Kind,query:string,enabled:boolean,refresh:number){
  const [data,setData]=useState<Report|null>(null),[settled,setSettled]=useState(''),[error,setError]=useState('');
  const requestKey=`${kind}:${query}:${refresh}`;
  useEffect(()=>{if(!enabled)return;const ac=new AbortController();setError('');
    timGet<Report>(`report?${query}`,ac.signal).then(r=>{if(!ac.signal.aborted)setData(r);}).catch(e=>{if(!ac.signal.aborted&&!isAbort(e))setError(errorText(e));}).finally(()=>{if(!ac.signal.aborted)setSettled(requestKey);});return()=>ac.abort();},[kind,query,enabled,refresh,requestKey]);
  return {data:enabled&&settled===requestKey&&!error?data:null,loading:enabled&&settled!==requestKey,error:enabled&&settled===requestKey?error:''};
}
function Panel({title,sub,children,action,className='',eyebrow}:{title:string;sub?:string;children:ReactNode;action?:ReactNode;className?:string;eyebrow?:string}){
  return <section className={`tf-tim-panel ${className}`}><header className="tf-tim-panel-head"><div>{eyebrow&&<span className="tf-tim-panel-eyebrow">{eyebrow}</span>}<h2>{title}</h2>{sub&&<p>{sub}</p>}</div>{action}</header>{children}</section>;
}
function KPI({title,value,sub,icon:Icon=Activity,tone='blue'}:{title:string;value:string;sub?:string;icon?:typeof Activity;tone?:string}){return <div className={`tf-tim-kpi tone-${tone}`}><div className="tf-tim-kpi-top"><span>{title}</span><i><Icon size={18}/></i></div><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>;}
function Empty({text='Nenhum registro encontrado para os filtros.'}:{text?:string}){return <div className="tf-tim-empty"><Package size={27}/><strong>{text}</strong></div>;}
function ErrorBox({text,retry}:{text:string;retry:()=>void}){return <div className="tf-tim-error"><CircleAlert size={19}/><div><strong>Não foi possível carregar os dados</strong><p>{text}</p></div><button className="tf-tim-secondary" onClick={retry}>Tentar novamente</button></div>;}
function Loading(){return <div className="tf-tim-loading"><RefreshCw className="tf-tim-spin" size={20}/> Consultando base TIM...</div>;}
function Select({title,value,options,onChange,all='Todos'}:{title:string;value:string;options:string[];onChange:(v:string)=>void;all?:string}){return <label className="tf-tim-field"><span>{title}</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">{all}</option>{options.map(x=><option key={x} value={x}>{title==='Filial'?storeName(x):label(x)}</option>)}</select></label>;}
function FiltersBar({kind,meta,filters,onChange,showDate,month,setMonth,custom,setCustom,from,setFrom,to,setTo,annual=false,year,setYear,yearA,setYearA}:{kind:Kind;meta:Metadata;filters:Filters;onChange:(f:Filters)=>void;showDate:boolean;month:string;setMonth:(v:string)=>void;custom:boolean;setCustom:(v:boolean)=>void;from:string;setFrom:(v:string)=>void;to:string;setTo:(v:string)=>void;annual?:boolean;year:string;setYear:(v:string)=>void;yearA:string;setYearA:(v:string)=>void}){
 const d=meta.datasets[kind],opts=d.options; const change=(key:keyof Filters,val:string|boolean)=>onChange({...filters,[key]:val});const years=Array.from(new Set([year,yearA,...d.periods.map(x=>x.month.slice(0,4))])).filter(Boolean).sort().reverse();
 return <div className="tf-tim-filters"><div className="tf-tim-filter-main">
 {annual?<><label className="tf-tim-field"><span>Ano atual</span><select value={year} onChange={e=>setYear(e.target.value)}>{years.map(y=><option key={y}>{y}</option>)}</select></label><label className="tf-tim-field"><span>Ano de comparação</span><select value={yearA} onChange={e=>setYearA(e.target.value)}>{Array.from(new Set([...years,String(Number(year)-1)])).sort().reverse().map(y=><option key={y}>{y}</option>)}</select></label></>:showDate&&<><label className="tf-tim-field"><span>Competência</span><select value={custom?'custom':month} onChange={e=>{if(e.target.value==='custom')setCustom(true);else{setCustom(false);setMonth(e.target.value);}}}>{Array.from(new Set([month,...d.periods.map(p=>p.month)])).filter(Boolean).map(m=><option key={m} value={m}>{monthName(m)}</option>)}<option value="custom">Personalizado</option></select></label>{custom&&<><label className="tf-tim-field"><span>De</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="tf-tim-field"><span>Até</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}</>}
 <Select title="Filial" value={filters.store} options={d.stores} onChange={v=>change('store',v)} all="Todas as filiais"/>
 <Select title="Área" value={filters.area} options={opts.area||[]} onChange={v=>change('area',v)}/>
 <Select title="Categoria" value={filters.category} options={opts.category||[]} onChange={v=>change('category',v)}/>
 {kind==='sales'&&<Select title="Coordenador" value={filters.coordinator} options={opts.coordinator||[]} onChange={v=>change('coordinator',v)}/>}
 {kind==='services'&&<Select title="Status ativação" value={filters.status} options={opts.status||[]} onChange={v=>change('status',v)}/>}
 {kind==='stock'&&<><Select title="Fabricante" value={filters.brand} options={opts.brand||[]} onChange={v=>change('brand',v)}/><label className="tf-tim-field"><span>Tempo em estoque</span><select value={filters.stockAge} onChange={e=>change('stockAge',e.target.value)}><option value="">Todos</option><option value="lte90">Até 90 dias</option><option value="91to120">Até 120 dias</option><option value="121to360">Até 360 dias</option><option value="gt360">Acima de 360 dias</option></select></label></>}
 {kind!=='stock'&&<Select title="Vendedor (vendas e serviços)" value={filters.seller} options={opts.seller||[]} onChange={v=>change('seller',v)}/>}
 </div><div className="tf-tim-filter-bottom"><label className="tf-tim-search"><Search size={16}/><input value={filters.search} onChange={e=>change('search',e.target.value)} placeholder={kind==='stock'?'Buscar produto, código, filial...':'Buscar vendedor, produto, filial...'}/></label><label className="tf-tim-check"><input type="checkbox" checked={kind==='stock'?filters.available:filters.liquid} onChange={e=>change(kind==='stock'?'available':'liquid',e.target.checked)}/>{kind==='stock'?'Somente novos disponíveis':'Somente lojas líquidas (OK)'}</label><button className="tf-tim-link" onClick={()=>onChange({...baseFilter})}>Limpar filtros</button></div></div>;
}
function Coverage({periods,from,to}:{periods:Period[];from:string;to:string}){
 const matched=periods.filter(p=>p.last>=from&&p.first<=to);if(!matched.length)return <div className="tf-tim-notice"><CircleAlert size={15}/> Sem histórico no período.</div>;
 const first=matched.reduce((a,b)=>a.first<b.first?a:b).first,last=matched.reduce((a,b)=>a.last>b.last?a:b).last;
 return <div className="tf-tim-coverage"><span><i/> Base disponível: <b>{dateBR(first)} a {dateBR(last)}</b></span></div>;
}
function BurstLine({label:caption,value,status}:{label:string;value:number|null|undefined;status?:Report['burstStatus']}){
 const reason=status==='unsupported'?'Crédito por filial':status==='partial'?'Histórico Burst incompleto':status==='missing'?'Burst não importado':undefined;
 return <div className="tf-tim-burst-line" title={reason}><span>{caption}</span><b>{money(value)}</b>{reason&&value==null&&<small>{reason}</small>}</div>;
}
function SalesKPIs({r,trend,trendPlus}:{r:Report;trend:number|null;trendPlus:number|null}){
 const m=r.summary;
 const activeSellers=new Set((r.groups.sellers||[]).map(x=>`${x.store||''}|${x.name}`)).size;
 return <div className="tf-tim-kpis tim-sales-kpis">
 <div className="tf-tim-kpi"><div className="tf-tim-kpi-top"><span>Faturamento gerencial</span><i><ShoppingBag size={18}/></i></div><strong>{money(m.revenue)}</strong><BurstLine label="Vendas + Burst" value={m.revenue_plus_burst} status={r.burstStatus}/></div>
 <KPI title="Crédito Burst" value={money(m.burst_total)} icon={Activity}/><KPI title="Líquido classificado" value={money(m.liquid_total)} icon={Activity}/><KPI title="Aparelhos vendidos" value={count(m.devices)} sub={`${count(m.accessories)} acessórios · ${count(m.films)} películas`} icon={Smartphone}/><KPI title="Vendedores ativos" value={count(activeSellers)} sub={`Ticket bruto: ${n(m.orders)>0?money(n(m.gross_sales)/n(m.orders)):'—'}`} icon={Users}/>
 <div className="tf-tim-kpi"><div className="tf-tim-kpi-top"><span>Tendência do mês</span><i><TrendingUp size={18}/></i></div><strong>{money(trend)}</strong><BurstLine label="Tendência + Burst" value={trendPlus} status={r.burstStatus}/></div>
 </div>;
}
function ServiceKPIs({r}:{r:Report}){const m=r.summary;return <div className="tf-tim-kpis"><KPI title="Registros de serviço" value={count(m.records)} sub={`${count(m.stores)} filiais`} icon={Signal}/><KPI title="Liberados p/ pagamento" value={count(m.released)} sub={`${n(m.records)?pct(n(m.released)/n(m.records)*100):'—'} dos registros`} icon={Activity} tone="green"/><KPI title="Pendentes documentação" value={count(m.pending_docs)}  icon={CircleAlert} tone="amber"/><KPI title="Valor franquia informado" value={money(m.franchise)} sub={`${count(m.franchise_known)} de ${count(m.records)} preenchidos`} icon={TrendingUp}/><KPI title="Comissão informada" value={money(m.commission)} sub={`${count(m.commission_known)} de ${count(m.records)} preenchidos`} icon={ShoppingBag}/></div>;}
function StockKPIs({r}:{r:Report}){
 const m=r.summary;
 return <div className="tf-tim-stock-kpis">
  <KPI title="Saldo total" value={count(m.quantity)} sub={`${count(m.skus)} códigos de produto`} icon={Package}/>
  <KPI title="Novos disponíveis" value={count(m.available_quantity)} sub={`${count(m.available_devices)} aparelhos disponíveis`} icon={Smartphone} tone="green"/>
  <KPI title="Outros depósitos" value={count(m.unavailable_quantity)} sub={`${count(m.defective_quantity)} devolvidos/defeito`} icon={CircleAlert} tone="amber"/>
  <div className="tf-tim-stock-financial"><div className="tf-tim-stock-financial-head"><span>VALORES DO ESTOQUE</span><TrendingUp size={17}/></div><div className="tf-tim-stock-financial-values"><div><small>Valor em custo</small><strong>{money(m.cost_total)}</strong></div><div><small>Valor potencial de venda</small><strong>{money(m.sale_value)}</strong></div></div></div>
 </div>;
}
function ChartPanel({kind,rows,title,sub,wide=false}:{kind:Kind;rows:Group[];title:string;sub?:string;wide?:boolean}){
  const metric=primary(kind), id=useId().replace(/:/g,''), color=kind==='sales'?'#003BD4':'#0D947B';
  const data=rows.map(r=>({...r,display:r.name.length===10?dateBR(r.name).slice(0,5):r.name.length===7?monthName(r.name):r.name}));
  const total=rows.reduce((sum,row)=>sum+n(row[metric]),0);
  return <Panel title={title} sub={sub} eyebrow={kind==='sales'?'PERFORMANCE COMERCIAL':'ATIVAÇÕES'} className={wide?'tf-tim-wide-chart':''} action={<div className="tf-tim-chart-total"><small>TOTAL</small><b>{fmt(kind,total)}</b></div>}>
    {!data.length?<Empty/>:<div className={`tf-tim-chart ${wide?'big':''}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:18,right:20,left:6,bottom:8}}>
      <defs><linearGradient id={`tim-grad-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.22}/><stop offset="100%" stopColor={color} stopOpacity={.015}/></linearGradient></defs>
      <CartesianGrid stroke="#DFE5EF" strokeDasharray="4 5" vertical={false}/><XAxis dataKey="display" tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false} minTickGap={16}/><YAxis width={76} tickFormatter={v=>kind==='sales'?shortMoney(n(v)):count(v)} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
      <Tooltip formatter={(v:any)=>[fmt(kind,v),kind==='sales'?'Faturamento':'Registros']} contentStyle={{borderRadius:12,border:'1px solid #dfe5ef',boxShadow:'0 8px 26px #14234716'}}/>
      <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2.6} fill={`url(#tim-grad-${id})`} connectNulls={false} activeDot={{r:5,stroke:'white',strokeWidth:2}}/>
    </AreaChart></ResponsiveContainer></div>}
  </Panel>;
}
function Ranking({kind,rows,title,sub,limit=8,scrollHeight=520}:{kind:Kind;rows:Group[];title:string;sub?:string;limit?:number;scrollHeight?:number}){
 const metric=primary(kind), ordered=[...rows].sort((a,b)=>n(b[metric])-n(a[metric])||String(a.store||a.name).localeCompare(String(b.store||b.name),'pt-BR')||a.name.localeCompare(b.name,'pt-BR')).slice(0,limit), max=Math.max(1,...ordered.map(r=>Math.abs(n(r[metric]))));
 const scrollable=limit===Infinity && ordered.length>10;
 return <Panel title={title} sub={sub} eyebrow="RANKING" className="tf-tim-ranked-panel">{!ordered.length?<Empty/>:<div className={`tf-tim-horizontal-rank${scrollable?' scrollable':''}`} style={scrollable?{maxHeight:scrollHeight}:undefined} role="list" aria-label={title}>{ordered.map((r,i)=><div className="tf-tim-horizontal-row" role="listitem" key={`${r.name}-${r.store||''}-${i}`}><div className="tf-tim-horizontal-name"><span>{String(i+1).padStart(2,'0')}</span><b title={r.name}>{storeName(label(r.name))}{r.store&&<small>{storeName(r.store)}</small>}</b></div><div className="tf-tim-horizontal-plot"><i style={{width:`${Math.abs(n(r[metric]))/max*100}%`,background:n(r[metric])<0?'#EB0028':i<3?'#003BD4':'#94A3B8'}}/></div><strong>{fmt(kind,r[metric])}</strong></div>)}</div>}</Panel>;
}
function Mix({kind,rows,title,share=false}:{kind:Kind;rows:Group[];title:string;share?:boolean}){
  const metric=primary(kind), visible=rows.filter(r=>n(r[metric])>0).sort((a,b)=>n(b[metric])-n(a[metric])),data=visible.length>8?[...visible.slice(0,7),{name:'Outros',[metric]:visible.slice(7).reduce((a,b)=>a+n(b[metric]),0)}]:visible;
  const total=data.reduce((a,b)=>a+n(b[metric]),0), negative=rows.some(r=>n(r[metric])<0);
  return <Panel title={title} eyebrow="COMPOSIÇÃO" sub={negative?'Participação dos valores positivos':undefined}>{!data.length?<Empty/>:<div className="tf-tim-mix">
    <div className="tf-tim-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey={metric} nameKey="name" innerRadius="65%" outerRadius="91%" paddingAngle={2} stroke="none">{data.map((r,i)=><Cell key={r.name} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v:any)=>fmt(kind,v)}/></PieChart></ResponsiveContainer><div className="tf-tim-donut-center"><small>TOTAL</small><b>{kind==='sales'?shortMoney(total):count(total)}</b></div></div>
    <div className="tf-tim-legend">{data.map((r,i)=><div key={r.name} title={`${label(r.name)} · ${fmt(kind,r[metric])}`}><i style={{background:COLORS[i%COLORS.length]}}/><span>{label(r.name)}</span><strong>{share?`${(n(r[metric])/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:fmt(kind,r[metric])}</strong></div>)}</div></div>}</Panel>;
}
function OperationalIndicators({r}:{r:Report}){
  const m=r.summary, best=[...(r.groups.stores||[])].sort((a,b)=>n(b.revenue)-n(a.revenue))[0], activeSellers=new Set((r.groups.sellers||[]).map(x=>`${x.store||''}|${x.name}`)).size;
  const items=[{label:'Aparelhos vendidos',value:count(m.devices),icon:Smartphone},{label:'Vendedores ativos',value:count(activeSellers),icon:Users},{label:'Ticket bruto',value:n(m.orders)>0?money(n(m.gross_sales)/n(m.orders)):'—',icon:TrendingUp},{label:'Filiais com vendas',value:count(m.stores),icon:Building2}];
  return <Panel title="Indicadores de vendas" eyebrow="VISÃO OPERACIONAL"><div className="tf-tim-operational-grid">{items.map(({label,value,icon:Icon})=><div key={label}><span><Icon size={13}/>{label}</span><b>{value}</b></div>)}</div>{best&&<div className="tf-tim-best"><div><small>DESTAQUE DO PERÍODO</small><b>{storeName(best.name)}</b></div><strong>{money(best.revenue)}</strong></div>}</Panel>;
}
function CategoryBars({rows}:{rows:Group[]}){
 const metric='revenue', sorted=[...rows].sort((a,b)=>n(b[metric])-n(a[metric])), max=Math.max(1,...sorted.map(r=>Math.abs(n(r[metric]))));
 return <Panel title="Faturamento por categoria" eyebrow="CATEGORIAS">{sorted.length?<div className="tf-tim-category-list">{sorted.map(r=><div key={r.name}><div><span>{label(r.name)}</span><b>{money(r.revenue)}</b></div><div className="tf-tim-track"><i style={{width:`${Math.abs(n(r.revenue))/max*100}%`,background:n(r.revenue)<0?'#EB0028':'#003BD4'}}/></div></div>)}</div>:<Empty/>}</Panel>;
}
type Col={key:string;name:string;format?:(v:unknown,r:any)=>string;numeric?:boolean};
const col=(key:string,name:string,format?:(v:unknown,r:any)=>string,numeric=false):Col=>({key,name,format,numeric});
const cash=(key:string,name:string)=>col(key,name,money,true), num=(key:string,name:string)=>col(key,name,count,true);
function DataTable({rows,columns,empty='Nenhum resultado.',maxHeight,foot}:{rows:(Row|Group)[];columns:Col[];empty?:string;maxHeight?:number;foot?:ReactNode}){
 const [sort,setSort]=useState<{key:string;dir:number}|null>(null); const sorted=useMemo(()=>{if(!sort)return rows;return [...rows].sort((a,b)=>{const x=a[sort.key],y=b[sort.key];return sort.dir*(typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''),'pt-BR',{numeric:true}));});},[rows,sort]);
 return <div className="tf-tim-table-wrap" style={maxHeight?{maxHeight}:undefined}><table className="tf-tim-table"><thead><tr>{columns.map(c=><th key={c.key} className={c.numeric?'numeric':''}><button onClick={()=>setSort(s=>({key:c.key,dir:s?.key===c.key?-s.dir:c.numeric?-1:1}))}>{c.name}{sort?.key===c.key?(sort.dir>0?' ↑':' ↓'):''}</button></th>)}</tr></thead><tbody>{sorted.map((r,i)=><tr key={i}>{columns.map(c=>{const v=r[c.key];return <td className={c.numeric?'numeric':''} key={c.key} title={String(v??'')}>{c.format?c.format(v,r):label(v)}</td>;})}</tr>)}{!sorted.length&&<tr><td colSpan={columns.length} className="tf-tim-empty-cell">{empty}</td></tr>}</tbody>{foot&&<tfoot>{foot}</tfoot>}</table></div>;
}
const detailCols:Record<Kind,Col[]>={sales:[col('date','Data',dateBR),col('order_id','Pedido'),col('store','Filial',storeName),col('seller','Vendedor'),col('order_type','Tipo'),col('category','Categoria'),col('product','Produto'),num('quantity','Qtd.'),cash('source_total','Valor origem'),cash('revenue','Realizado'),cash('liquid_total','Líquido'),col('liquid_status','Loja líquida')],services:[col('date','Ativação',dateBR),col('sale_date','Venda',dateBR),col('store','Filial',storeName),col('seller','Vendedor'),col('category','Tipo serviço'),col('modality','Modalidade'),col('plan','Plano'),col('status','Status'),cash('franchise','Franquia'),cash('commission','Comissão'),col('liquid_status','Líquido')],stock:[col('store','Filial',storeName),col('deposit','Depósito'),col('product_code','Código'),col('model','Modelo'),col('category','Categoria'),col('brand','Fabricante'),num('quantity','Saldo'),cash('unit_price','Preço venda'),cash('cost_total','Custo total'),cash('sale_value','Valor potencial'),col('purchase_date','Data compra',dateBR)]};
function Detail({kind,r,query,setPage}:{kind:Kind;r:Report;query:string;setPage:(v:number)=>void}){const [exporting,setExporting]=useState(false),[err,setErr]=useState('');const totalPages=Math.max(1,Math.ceil(r.total/r.size));return <Panel title="Detalhamento dos registros" sub={`${count(r.total)} registros`} action={<button className="tf-tim-secondary" disabled={exporting||!r.total} onClick={async()=>{setExporting(true);setErr('');try{await exportRows(kind,query);}catch(e){setErr(errorText(e));}finally{setExporting(false);}}}><Download size={15}/>{exporting?'Exportando...':'Exportar CSV'}</button>}>{err&&<p className="tf-tim-inline-error">{err}</p>}<DataTable rows={r.rows} columns={detailCols[kind]}/><div className="tf-tim-pages"><span>Página {r.page} de {totalPages}</span><button aria-label="Página anterior" disabled={r.page<=1} onClick={()=>setPage(r.page-1)}><ChevronLeft size={17}/></button><button aria-label="Próxima página" disabled={r.page>=totalPages} onClick={()=>setPage(r.page+1)}><ChevronRight size={17}/></button></div></Panel>;}
function SummaryTable({kind,rows,title,groupLabel='Filial',seller=false}:{kind:Kind;rows:Group[];title:string;groupLabel?:string;seller?:boolean}){const name=col('name',groupLabel,groupLabel==='Filial'?storeName:label);const cols=kind==='sales'?[name,...(seller?[col('store','Filial',storeName)]:[]),cash('revenue','Faturamento'),...(groupLabel==='Filial'&&!seller?[cash('burst_total','Burst'),cash('revenue_plus_burst','Vendas + Burst')]:[]),cash('liquid_total','Líquido'),num('devices','Aparelhos'),num('accessories','Acessórios')]:kind==='services'?[name,...(seller?[col('store','Filial',storeName)]:[]),num('records','Registros'),num('released','Liberados'),num('pending_docs','Pendentes'),cash('franchise','Franquia'),cash('commission','Comissão')]:[name,num('quantity','Saldo'),num('available_quantity','Disponível'),num('defective_quantity','Defeito/devol.'),cash('cost_total','Custo total'),cash('sale_value','Valor potencial')];return <Panel title={title} ><DataTable rows={rows} columns={cols} maxHeight={650}/></Panel>;}
function Tabs({value,onChange,items}:{value:string;onChange:(s:string)=>void;items:[string,string][]}){return <div className="tf-tim-tabs">{items.map(([key,name])=><button key={key} onClick={()=>onChange(key)} className={key===value?'active':''}>{name}</button>)}</div>;}
function monthlyTrend(r:Report|undefined|null,month:string,custom=false,metric='revenue'):number|null {
 if(!r||!month||custom)return null;
 const p=r.periods.find(x=>x.month===month),value=r.summary[metric];
 const elapsed=p?Number(p.last.slice(-2)):0;
 return p&&p.first.endsWith('-01')&&elapsed>0&&typeof value==='number'?value*Number(monthEnd(month).slice(-2))/elapsed:null;
}
function annualTrend(r:Report|null,month:string,metric='revenue'):number|null {
 if(!r||!month)return null;
 const year=month.slice(0,4), selected=Number(month.slice(-2));
 const periods=r.periods.filter(p=>p.month.startsWith(year+'-')&&p.month<=month).sort((a,b)=>a.month.localeCompare(b.month));
 if(periods.length!==selected||!periods.every((p,i)=>Number(p.month.slice(-2))===i+1&&p.first.endsWith('-01')&&(i===periods.length-1||p.last===monthEnd(p.month))))return null;
 const value=r.summary[metric],last=periods[periods.length-1];
 const days=(Date.parse(last.last)-Date.parse(`${year}-01-01`))/86400000+1,yearDays=(Date.parse(`${Number(year)+1}-01-01`)-Date.parse(`${year}-01-01`))/86400000;
 return days>0&&typeof value==='number'?value*yearDays/days:null;
}
function rowMonthlyTrend(value:unknown, month:string, periods:Period[], custom=false):number|null {
 if(custom||!month||typeof value!=='number') return null;
 const p=periods.find(x=>x.month===month);
 if(!p||!p.first.endsWith('-01')) return null;
 const elapsed=Number(p.last.slice(-2));
 const totalDays=Number(monthEnd(month).slice(-2));
 return elapsed>0?value*totalDays/elapsed:null;
}
function brazilToday(){const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(t:string)=>d.find(p=>p.type===t)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`;}
function summaryQuery(filters:Filters,from:string,to:string){return `${buildQuery('sales',filters,from,to)}&summaryOnly=true`;}
function MonthlySales({r,month,custom,query,setPage}:{r:Report;month:string;custom:boolean;query:string;setPage:(v:number)=>void}){
 const [tab,setTab]=useState('overview');
 const trend=monthlyTrend(r,month,custom);
 const g=r.groups;
 const sellerRows=[...(g.sellers||[])].map(row=>({...row,trend:rowMonthlyTrend(row.revenue,month,r.periods,custom)})).sort((a,b)=>String(a.store||'').localeCompare(String(b.store||''),'pt-BR')||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
 return <>
   <SalesKPIs r={r} trend={trend} trendPlus={monthlyTrend(r,month,custom,'revenue_plus_burst')}/>
   <Tabs value={tab} onChange={setTab} items={[['overview','Visão geral'],['stores','Por filial'],['sellers','Vendedores'],['products','Produtos'],['details','Detalhamento']]}/>
   {tab==='overview'&&<>
     <div className="tf-tim-grid-wide"><ChartPanel kind="sales" rows={g.daily||[]} title="Faturamento diário" /><Mix kind="sales" rows={g.categories||[]} title="Mix de vendas"/></div>
     <div className="tf-tim-grid-2">
       <Ranking kind="sales" title="Ranking de filiais" rows={g.stores||[]} limit={Infinity} scrollHeight={540}/>
       <Ranking kind="sales" title="Ranking de vendedores" rows={g.sellers||[]} limit={Infinity} scrollHeight={540}/>
     </div>
   </>}
   {tab==='stores'&&<><SummaryTable kind="sales" rows={[...(g.stores||[])].sort((a,b)=>n(b.revenue)-n(a.revenue))} title="Desempenho das filiais"/><SummaryTable kind="sales" rows={g.coordinators||[]} title="Desempenho por coordenador" groupLabel="Coordenador"/></>}
   {tab==='sellers'&&<Panel title="Performance por vendedor e filial"><DataTable maxHeight={680} rows={sellerRows} columns={[col('store','Filial',storeName),col('name','Vendedor'),cash('revenue','Faturamento'),cash('trend','Tendência mês'),cash('liquid_total','Líquido'),num('devices','Aparelhos'),num('accessories','Acessórios')]}/></Panel>}
   {tab==='products'&&<><SummaryTable kind="sales" rows={g.categories||[]} title="Resultado por categoria" groupLabel="Categoria"/><SummaryTable kind="sales" rows={g.products||[]} title="Produtos e modelos · top 150" groupLabel="Produto / modelo"/></>}
   {tab==='details'&&<Detail kind="sales" r={r} query={query} setPage={setPage}/>}
 </>;
}
function Services({r,query,setPage}:{r:Report;query:string;setPage:(v:number)=>void}){const [tab,setTab]=useState('overview'),g=r.groups;return <><ServiceKPIs r={r}/><Tabs value={tab} onChange={setTab} items={[["overview","Visão geral"],["stores","Por filial"],["plans","Planos e serviços"],["sellers","Vendedores"],["details","Detalhamento"]]}/>{tab==='overview'&&<><div className="tf-tim-grid-wide"><ChartPanel kind="services" rows={g.daily||[]} title="Serviços por dia" /><Mix kind="services" rows={g.statuses||[]} title="Status de ativação"/></div><div className="tf-tim-grid-2"><Ranking kind="services" rows={g.categories||[]} title="Tipos de serviço"/><Ranking kind="services" rows={g.stores||[]} title="Ranking de filiais" limit={Infinity}/></div></>}{tab==='stores'&&<SummaryTable kind="services" rows={g.stores||[]} title="Serviços por filial"/>}{tab==='plans'&&<><SummaryTable kind="services" rows={g.categories||[]} title="Tipos de serviços" groupLabel="Tipo"/><SummaryTable kind="services" rows={g.plans||[]} title="Planos da operadora · top 200" groupLabel="Plano"/><SummaryTable kind="services" rows={g.modalities||[]} title="Modalidades" groupLabel="Modalidade"/></>}{tab==='sellers'&&<SummaryTable kind="services" rows={g.sellers||[]} seller title="Serviços por vendedor e filial" groupLabel="Vendedor"/>}{tab==='details'&&<Detail kind="services" r={r} query={query} setPage={setPage}/>}</>;}
function StockIntelligence({rows}:{rows:Group[]}){
  const groups=Array.from(rows.reduce((map,row)=>{const family=String(row.name||'SEM FAMÍLIA');const list=map.get(family)||[];list.push(row);map.set(family,list);return map;},new Map<string,Group[]>()).entries())
    .map(([family,list])=>({family,items:list.sort((a,b)=>n(b.devices)-n(a.devices)||n(b.cases)-n(a.cases)||String(a.store||'').localeCompare(String(b.store||''),'pt-BR')),devices:list.reduce((s,r)=>s+n(r.devices),0),cases:list.reduce((s,r)=>s+n(r.cases),0),accessories:list.reduce((s,r)=>s+n(r.accessories),0)}))
    .sort((a,b)=>(b.devices+b.cases)-(a.devices+a.cases)||a.family.localeCompare(b.family,'pt-BR'));
  return <Panel title="Estoque inteligente" sub="Onde estão os aparelhos e as capas relacionadas por modelo">{!groups.length?<Empty text="Nenhuma relação inteligente encontrada para os filtros aplicados."/>:<div className="tf-tim-smart-grid">{groups.map(group=><article key={group.family} className="tf-tim-smart-card"><header><div><small>Modelo / família</small><strong>{label(group.family)}</strong></div><span>{count(group.devices)} aparelhos · {count(group.cases)} capas</span></header><div className="tf-tim-smart-totals"><div><small>Aparelhos</small><b>{count(group.devices)}</b></div><div><small>Capas</small><b>{count(group.cases)}</b></div><div><small>Acessórios</small><b>{count(group.accessories)}</b></div></div><div className="tf-tim-smart-stores">{group.items.map((item,i)=><div key={`${group.family}-${item.store}-${i}`}><div><strong>{storeName(item.store)}</strong>{item.oldest&&<small>Mais antigo: {dateBR(item.oldest)}</small>}</div><div className="tf-tim-smart-badges"><span>Aparelhos: <b>{count(item.devices)}</b></span><span>Capas: <b>{count(item.cases)}</b></span></div>{item.case_items&&<p>{String(item.case_items)}</p>}</div>)}</div></article>)}</div>}</Panel>;
}

function Stock({r,query,setPage,store,onStore,stores}:{r:Report;query:string;setPage:(v:number)=>void;store:string;onStore:(v:string)=>void;stores:string[]}) {
  const [tab,setTab]=useState('stores');
  const g=r.groups;
  const rows=[...(g.stores||[])].sort((a,b)=>n(b.quantity)-n(a.quantity)||a.name.localeCompare(b.name,'pt-BR'));
  const storeGroups=Array.from(rows.reduce((map,row)=>{const area=String(row.area||'SEM AREA');const list=map.get(area)||[];list.push(row);map.set(area,list);return map;},new Map<string,Group[]>())).sort(([a],[b])=>a.localeCompare(b,'pt-BR'));
  const select=(name:string)=>{setTab('stores');onStore(name);};
  return <>
    {store&&<div className="tf-tim-store-detail-head">
      <div><button type="button" onClick={()=>select('')} className="tf-tim-store-back"><ArrowLeft size={16}/> Todas as filiais</button><h2><Building2 size={23}/>{storeName(store)}</h2></div>
      <span><Package size={19}/> {count(r.summary.quantity)} un.</span>
    </div>}
    <StockKPIs r={r}/>
    {store?<>
      <div className="tf-tim-grid-2"><Mix kind="stock" rows={g.categories||[]} title="Categorias"/><Ranking kind="stock" rows={g.deposits||[]} title="Depósitos" limit={Infinity} scrollHeight={420}/></div>
      <Detail key={store} kind="stock" r={r} query={query} setPage={setPage}/>
    </>:<>
      <Tabs value={tab} onChange={setTab} items={[['stores','Por filial'],['overview','Visão geral'],['smart','Estoque inteligente'],['products','Produtos'],['deposits','Depósitos'],['details','Estoque detalhado']]}/>
      {tab==='stores'&&<Panel title="Estoque por filial" action={<span className="tf-tim-store-count">{rows.length} / {stores.length} filiais</span>}>
        {rows.length?<div className="tf-tim-stock-groups">{storeGroups.map(([area,branches])=><section className="tf-tim-stock-group" key={area}><header><MapPin size={15}/><strong>{label(area)}</strong><span>{branches.length} {branches.length===1?'filial':'filiais'}</span><b>{count(branches.reduce((sum,r)=>sum+n(r.quantity),0))} un.</b></header><div className="tf-tim-store-grid">{branches.map(row=><button className="tf-tim-store-card" key={row.name} type="button" onClick={()=>select(row.name)} title={`Abrir estoque: ${storeName(row.name)}`}>
          <div className="tf-tim-store-card-head"><span className="tf-tim-store-icon"><Building2 size={18}/></span><strong>{storeName(row.name)}</strong><ChevronRight size={17}/></div>
          <div className="tf-tim-store-metrics"><div><small>Estoque total</small><b>{count(row.quantity)}</b></div><div><small>Valor em custo</small><b>{money(row.cost_total)}</b></div></div>
          <div className="tf-tim-store-card-foot"><span><i/> {count(row.available_quantity)} disponíveis</span><span>{count(row.defective_quantity)} defeito/devol.</span></div>
        </button>)}</div></section>)}</div>:<Empty/>}
      </Panel>}
      {tab==='overview'&&<><div className="tf-tim-grid-wide"><Ranking kind="stock" rows={rows} title="Estoque por filial" limit={Infinity} scrollHeight={560}/><Mix kind="stock" rows={g.categories||[]} title="Composição do estoque"/></div><div className="tf-tim-grid-2"><Ranking kind="stock" rows={g.deposits||[]} title="Saldos por depósito" limit={Infinity} scrollHeight={420}/><Ranking kind="stock" rows={g.brands||[]} title="Saldos por fabricante" limit={Infinity} scrollHeight={420}/></div></>}
      {tab==='smart'&&<StockIntelligence rows={(g.smart||[]) as Group[]}/>}
      {tab==='products'&&<Panel title="Estoque por código de produto" sub="250 maiores saldos"><DataTable maxHeight={650} rows={g.products||[]} columns={[col('code','Código'),col('name','Modelo'),num('quantity','Saldo'),num('available_quantity','Disponível'),cash('cost_total','Custo'),cash('sale_value','Valor potencial')]}/></Panel>}
      {tab==='deposits'&&<SummaryTable kind="stock" rows={g.deposits||[]} title="Posição por depósito" groupLabel="Depósito"/>}
      {tab==='details'&&<Detail kind="stock" r={r} query={query} setPage={setPage}/>}
    </>}
  </>;
}
function comparable(a:Period|undefined,b:Period|undefined){if(!a||!b)return false;return a.first.slice(-2)===b.first.slice(-2)&&(a.last.slice(-2)===b.last.slice(-2)||(a.last===monthEnd(a.month)&&b.last===monthEnd(b.month)));}
function Annual({current,previous,year,yearA,query,setPage}:{current:Report;previous:Report;year:string;yearA:string;query:string;setPage:(v:number)=>void}){
 const [tab,setTab]=useState('overview');const c=current.summary,a=previous.summary;
 const bp=current.periods.filter(p=>p.month.startsWith(year+'-')),ap=previous.periods.filter(p=>p.month.startsWith(yearA+'-'));
 const bmap=new Map(bp.map(p=>[p.month.slice(-2),p])),amap=new Map(ap.map(p=>[p.month.slice(-2),p]));
 const fullCompare=year!==yearA&&bp.length>0&&bp.length===ap.length&&bp.every(p=>comparable(amap.get(p.month.slice(-2)),p));
 const growth=fullCompare&&n(a.revenue)>0?(n(c.revenue)/n(a.revenue)-1)*100:null;
 const stores=Array.from(new Set([...(current.groups.stores||[]).map(r=>r.name),...(previous.groups.stores||[]).map(r=>r.name)])).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const cm=new Map((current.groups.matrix||[]).map(r=>[`${r.name}|${r.month?.slice(-2)}`,r])),pm=new Map((previous.groups.matrix||[]).map(r=>[`${r.name}|${r.month?.slice(-2)}`,r]));
 const cg=new Map((current.groups.stores||[]).map(r=>[r.name,r])),pg=new Map((previous.groups.stores||[]).map(r=>[r.name,r]));
 const chart=monthLabels.map((name,i)=>{const m=String(i+1).padStart(2,'0');const b=current.groups.monthly?.find(x=>x.name===`${year}-${m}`),a=previous.groups.monthly?.find(x=>x.name===`${yearA}-${m}`);return {name,current:b?n(b.revenue):null,previous:a?n(a.revenue):null};});
 const storeRows=stores.map(name=>{const b=cg.get(name),a=pg.get(name);const av=a?n(a.revenue):null,bv=b?n(b.revenue):null;return {name,previous:av,current:bv,growth:fullCompare&&av!=null&&av>0&&bv!=null?(bv/av-1)*100:null,devices:b?.devices??null,liquid_total:b?.liquid_total??null,burst_total:b?.burst_total??null,revenue_plus_burst:b?.revenue_plus_burst??null};});
 // A valid annual projection requires contiguous coverage from January, ending in current year.
 const sorted=[...bp].sort((a,b)=>a.month.localeCompare(b.month)),last=sorted.at(-1);
 const isFullStart=sorted.length>0&&sorted.every((p,i)=>Number(p.month.slice(-2))===i+1&&p.first.endsWith('-01')&&(i===sorted.length-1||p.last===monthEnd(p.month)));
 const dayCount=last?Math.floor((Date.parse(last.last)-Date.parse(`${year}-01-01`))/86400000)+1:0, days=Math.floor((Date.parse(`${Number(year)+1}-01-01`)-Date.parse(`${year}-01-01`))/86400000);
 const trend=isFullStart&&dayCount>0?n(c.revenue)*days/dayCount:null;
 return <><div className="tf-tim-kpis annual"><KPI title={`Realizado ${year}`} value={bp.length?money(c.revenue):'—'} sub={`Vendas + Burst: ${money(c.revenue_plus_burst)}`} icon={ShoppingBag}/><KPI title={`Realizado ${yearA}`} value={ap.length?money(a.revenue):'—'} sub={`${ap.length} competência(s) importadas`} icon={CalendarDays}/><KPI title="Variação comparável" value={pct(growth)} sub={fullCompare?'Mesma cobertura de datas':'Sem períodos equivalentes'} icon={TrendingUp}/><KPI title="Tendência anual" value={money(trend)} sub={trend==null?'Histórico insuficiente':`Tendência + Burst: ${money(c.revenue_plus_burst==null?null:c.revenue_plus_burst*days/dayCount)}`} icon={Activity}/></div>
 {!fullCompare&&<div className="tf-tim-notice"><CircleAlert size={16}/> Sem período anual comparável.</div>}
 <Tabs value={tab} onChange={setTab} items={[["overview","Visão geral"],["stores","Por filial"],["heatmap","Mapa de calor (Jan–Dez)"],["trend","Tendência por filial"],["details","Detalhamento"]]}/>
 {tab==='overview'&&<><Panel title="Evolução do faturamento" ><div className="tf-tim-chart big"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{top:12,right:14,bottom:8,left:6}}><CartesianGrid vertical={false} stroke="#e8eff8"/><XAxis dataKey="name" tick={{fontSize:12}} axisLine={false}/><YAxis tickFormatter={v=>shortMoney(n(v))} width={85} tick={{fontSize:11}}/><Tooltip formatter={(v:any)=>money(v)}/><Bar dataKey="previous" name={yearA} fill="#a7b9ed" radius={[4,4,0,0]}/><Bar dataKey="current" name={year} fill="#002198" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div><div className="tf-tim-chart-key"><span><i style={{background:'#a7b9ed'}}/>{yearA}</span><span><i style={{background:'#002198'}}/>{year}</span></div></Panel><div className="tf-tim-grid-2"><Ranking kind="sales" title={`Filiais · ${year}`} rows={current.groups.stores||[]}/><Mix kind="sales" title={`Categorias · ${year}`} rows={current.groups.categories||[]}/></div></>}
 {tab==='stores'&&<Panel title="Comparativo anual por filial" ><DataTable rows={storeRows} columns={[col('name','Filial',storeName),cash('previous',yearA),cash('current',year),cash('burst_total','Burst'),cash('revenue_plus_burst','Vendas + Burst'),col('growth','Variação',v=>pct(typeof v==='number'?v:null),true),num('devices','Aparelhos'),cash('liquid_total','Líquido')]} maxHeight={650}/></Panel>}
 {tab==='heatmap'&&<Panel title="Mapa de calor · realizado por mês"  className="tf-tim-heat-panel"><div className="tf-tim-heat-scroll"><table className="tf-tim-heat"><thead><tr><th>FILIAL</th>{monthLabels.map(m=><th key={m}>{m}</th>)}<th>TOTAL {year}</th></tr></thead><tbody>{stores.map(s=><tr key={s}><th>{storeName(s)}</th>{monthLabels.map((_,i)=>{const m=String(i+1).padStart(2,'0'),b=cm.get(`${s}|${m}`),a=pm.get(`${s}|${m}`),g=b&&a&&comparable(amap.get(m),bmap.get(m))&&n(a.revenue)>0?(n(b.revenue)/n(a.revenue)-1)*100:null;return <td key={m}><div className={`tf-tim-heat-cell ${g==null?'neutral':g>=0?'positive':'negative'}`} title={`Atual: ${b?money(b.revenue):'sem registro'} / anterior: ${a?money(a.revenue):'sem registro'}`}><b>{b?shortMoney(n(b.revenue)):'—'}</b><span>{pct(g)}</span></div></td>;})}<td className="tf-tim-heat-total">{cg.get(s)?shortMoney(n(cg.get(s)?.revenue)):'—'}</td></tr>)}</tbody></table></div></Panel>}
 {tab==='trend'&&<Panel title="Projeção anual por filial" ><DataTable rows={storeRows.map(r=>({...r,trend:trend!=null&&r.current!=null?n(r.current)*days/dayCount:null,trendPlus:trend!=null&&typeof r.revenue_plus_burst==='number'?r.revenue_plus_burst*days/dayCount:null}))} columns={[col('name','Filial',storeName),cash('previous',`Realizado ${yearA}`),cash('current',`Realizado ${year}`),cash('trend',`Tendência ${year}`),cash('trendPlus','Tendência + Burst')]}/></Panel>}
 {tab==='details'&&<Detail kind="sales" r={current} query={query} setPage={setPage}/>}</>;
}
// Home uses the existing API. Coordinator scope is resolved from sales for the
// selected month, then applied by store to services and stock (no invented attribution).
function mergeHomeReports(kind:'services'|'stock',reports:Report[]):Report {
  if(new Set(reports.map(r=>r.revision)).size>1)throw new Error('Base atualizada durante a consulta. Atualize novamente.');
  // Only additive metrics used by Home. Distinct SKU counts must never be summed.
  const metrics=kind==='services'?['records','released']:['records','quantity','available_quantity'];
  const summary:Metric={};for(const m of metrics)summary[m]=reports.reduce((sum,r)=>sum+n(r.summary[m]),0);
  const groups:Record<string,Group[]>={};
  const metric=primary(kind);
  for(const name of kind==='services'?['daily','stores','statuses']:['categories']){
    const byName=new Map<string,Group>();
    for(const report of reports)for(const row of report.groups[name]||[]){
      const current=byName.get(row.name);byName.set(row.name,{name:row.name,[metric]:n(current?.[metric])+n(row[metric])});
    }
    groups[name]=Array.from(byName.values()).sort((a,b)=>name==='daily'?a.name.localeCompare(b.name):n(b[metric])-n(a[metric])||a.name.localeCompare(b.name,'pt-BR'));
  }
  return {kind,summary,groups,periods:reports[0]?.periods||[],rows:[],total:n(summary.records),page:1,size:40,revision:reports[0]?.revision||''};
}
function useHomeScopedReport(kind:'services'|'stock',query:string,storeScope:string|null,enabled:boolean,refresh:number){
  const key=JSON.stringify([kind,query,storeScope,refresh]);
  const [state,setState]=useState<{key:string;data:Report|null;error:string}>({key:'',data:null,error:''});
  useEffect(()=>{
    if(!enabled)return;
    const ac=new AbortController();
    const run=async():Promise<Report>=>{
      if(storeScope===null)return timGet<Report>(`report?${query}`,ac.signal);
      const names=JSON.parse(storeScope) as string[];
      const reports:Report[]=[];
      for(let i=0;i<names.length;i+=4){
        if(ac.signal.aborted)throw new DOMException('Aborted','AbortError');
        reports.push(...await Promise.all(names.slice(i,i+4).map(name=>{
          const q=new URLSearchParams(query);q.set('store',name);return timGet<Report>(`report?${q}`,ac.signal);
        })));
      }
      return mergeHomeReports(kind,reports);
    };
    run().then(data=>{if(!ac.signal.aborted)setState({key,data,error:''});}).catch(e=>{if(!ac.signal.aborted&&!isAbort(e))setState({key,data:null,error:errorText(e)});});
    return()=>ac.abort();
  },[kind,query,storeScope,enabled,refresh,key]);
  return {data:enabled&&state.key===key?state.data:null,error:enabled&&state.key===key?state.error:'',loading:enabled&&state.key!==key};
}
function Overview({meta,month,refresh,onView,filters,onFilter}:{meta:Metadata;month:string;refresh:number;onView:(v:View,f?:Filters)=>void;filters:Filters;onFilter:(f:Filters)=>void}){
 const today=brazilToday(),currentMonth=today.slice(0,7);
 const f=month?`${month}-01`:'',t=month?monthEnd(month):'';
 const end=month===currentMonth?today:t;
 const [serviceCategory,setServiceCategory]=useState('');
 const [stockCategory,setStockCategory]=useState('');
 const [stockBrand,setStockBrand]=useState('');
 const [stockAge,setStockAge]=useState('');
 const salesFilters={...filters};
 const serviceFilters={...baseFilter,store:filters.store,area:filters.area,seller:filters.seller,status:filters.status,category:serviceCategory,liquid:filters.liquid};
 const inventoryFilters={...baseFilter,store:filters.store,area:filters.area,category:stockCategory,brand:stockBrand,stockAge,available:filters.available};
 const s=useReport('sales',buildQuery('sales',salesFilters,f,end),!!month,refresh);
 const day=useReport('sales',summaryQuery(salesFilters,today,today),!!month,refresh);
 const annual=useReport('sales',summaryQuery(salesFilters,month?`${month.slice(0,4)}-01-01`:'',end),!!month&&!s.loading&&!s.error,refresh);
 const assignment=useReport('sales',buildQuery('sales',{...baseFilter,coordinator:filters.coordinator,store:filters.store},f,t),!!month&&!!filters.coordinator,refresh);
 const scoped=!!filters.coordinator;
 const scopeReady=!scoped||(!assignment.loading&&!assignment.error&&!!assignment.data);
 const scopeNames=(assignment.data?.groups.stores||[]).map(r=>r.name).sort();
 const effectiveScope=!scoped?null:JSON.stringify(scopeNames);
 const v=useHomeScopedReport('services',buildQuery('services',serviceFilters,f,t),effectiveScope,!!month&&scopeReady,refresh);
 const e=useHomeScopedReport('stock',buildQuery('stock',inventoryFilters,'',''),effectiveScope,scopeReady,refresh);
 const ss=!s.loading&&!s.error?s.data?.summary:undefined,sv=v.data?.summary,st=e.data?.summary;
 const errors=[s.error,day.error,annual.error,scoped?assignment.error:'',v.error,e.error].filter(Boolean);
 const opt=(key:string,kinds:Kind[])=>Array.from(new Set(kinds.flatMap(k=>meta.datasets[k].options[key]||[]))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const change=(key:keyof Filters,val:string|boolean)=>onFilter({...filters,[key]:val});
 const projection=ss?monthlyTrend(s.data,month):null;
 const projectionPlus=monthlyTrend(s.data,month,false,'revenue_plus_burst');
 const annualProjection=annualTrend(annual.data,month),annualPlus=annualTrend(annual.data,month,'revenue_plus_burst');
 const todayCovered=meta.datasets.sales.periods.some(p=>p.month===currentMonth&&p.last>=today);
 const dayValue=day.data&&todayCovered?day.data.summary.revenue:null;
 const cutoff=ss?s.data?.periods.find(p=>p.month===month)?.last:undefined;
 const activeStockFilters=!!(stockCategory||stockBrand||stockAge||filters.available);
 return <>
   <div className="tf-tim-filters tf-tim-home-filters">
    <div className="tf-tim-filter-main">
     <Select title="Filial" value={filters.store} options={meta.stores} onChange={v=>change('store',v)} all="Todas as filiais"/>
     <Select title="Coordenador" value={filters.coordinator} options={opt('coordinator',['sales'])} onChange={v=>change('coordinator',v)}/>
     <Select title="Área" value={filters.area} options={opt('area',['sales','services','stock'])} onChange={v=>change('area',v)}/>
     <Select title="Vendedor (vendas e serviços)" value={filters.seller} options={opt('seller',['sales','services'])} onChange={v=>change('seller',v)}/>
     <Select title="Categoria de venda" value={filters.category} options={opt('category',['sales'])} onChange={v=>change('category',v)}/>
     <Select title="Tipo de serviço" value={serviceCategory} options={opt('category',['services'])} onChange={setServiceCategory}/>
     <Select title="Status de serviço" value={filters.status} options={opt('status',['services'])} onChange={v=>change('status',v)}/>
    </div>
    <div className="tf-tim-filter-bottom">
     <label className="tf-tim-search"><Search size={16}/><input aria-label="Buscar nas vendas" value={filters.search} onChange={e=>change('search',e.target.value)} placeholder="Buscar nas vendas..."/></label><label className="tf-tim-check"><input type="checkbox" checked={filters.liquid} onChange={e=>change('liquid',e.target.checked)}/> Somente lojas líquidas</label>
     {scoped&&scopeReady&&<span className="tf-tim-scope-label">{scopeNames.length} filiais do coordenador</span>}
     <button type="button" className="tf-tim-link" onClick={()=>{onFilter({...baseFilter});setServiceCategory('');setStockCategory('');setStockBrand('');setStockAge('');}}>Limpar filtros</button>
    </div>
    <details className="tf-tim-stock-filters" open={activeStockFilters||undefined}><summary>Filtros de estoque</summary><div className="tf-tim-filter-main">
     <Select title="Categoria de estoque" value={stockCategory} options={opt('category',['stock'])} onChange={setStockCategory}/>
     <Select title="Fabricante" value={stockBrand} options={opt('brand',['stock'])} onChange={setStockBrand}/>
     <label className="tf-tim-field"><span>Tempo em estoque</span><select value={stockAge} onChange={e=>setStockAge(e.target.value)}><option value="">Todos</option><option value="lte90">Até 90 dias</option><option value="91to120">Até 120 dias</option><option value="121to360">Até 360 dias</option><option value="gt360">Acima de 360 dias</option></select></label>
     <label className="tf-tim-check"><input type="checkbox" checked={filters.available} onChange={e=>change('available',e.target.checked)}/> Somente disponíveis</label>
    </div></details>
   </div>
   {errors.length>0&&<div className="tf-tim-error"><CircleAlert size={18}/>{errors[0]}</div>}
   <div className="tf-tim-overview-cards home-kpis tim-executive-kpis">
    <section className="tf-tim-overview-card tim-executive-card"><div><span>Vendas do dia</span><ShoppingBag size={21}/></div><strong>{money(dayValue)}</strong><p>{dateBR(today)} · {todayCovered?'realizado hoje':'Sem carga de hoje'}</p></section>
    <section className="tf-tim-overview-card tim-executive-card"><div><span>Faturamento do mês</span><ShoppingBag size={21}/></div><strong>{money(ss?.revenue)}</strong><p>Faturamento gerencial</p><BurstLine label="Vendas + Burst" value={ss?.revenue_plus_burst} status={s.data?.burstStatus}/></section>
    <section className="tf-tim-overview-card tim-executive-card"><div><span>Tendência mês</span><BarChart3 size={21}/></div><strong>{money(projection)}</strong><p>{cutoff?`Posição ${dateBR(cutoff)}`:'—'}</p><BurstLine label="Tendência + Burst" value={projectionPlus} status={s.data?.burstStatus}/></section>
    <section className="tf-tim-overview-card tim-executive-card"><div><span>Tendência ano</span><Activity size={21}/></div><strong>{money(annualProjection)}</strong><p>{annualProjection==null?'Histórico anual insuficiente':`Realizado: ${money(annual.data?.summary.revenue)}`}</p><BurstLine label="Tendência + Burst" value={annualPlus} status={annual.data?.burstStatus}/></section>
    <section className="tf-tim-overview-card tim-executive-card tim-executive-operations"><div><span>Operação comercial</span><Signal size={21}/></div><div className="tim-mini-grid"><button type="button" disabled={scoped&&(!scopeReady||scopeNames.length!==1)} onClick={()=>onView('services',{...serviceFilters,store:scoped?scopeNames[0]:serviceFilters.store})}><span>Serviços</span><b>{count(sv?.records)}</b></button><button type="button" disabled={scoped&&(!scopeReady||scopeNames.length!==1)} onClick={()=>onView('stock',{...inventoryFilters,store:scoped?scopeNames[0]:inventoryFilters.store})}><span>Estoque</span><b>{count(st?.quantity)}</b></button><div><span>Liberados</span><b>{count(sv?.released)}</b></div><div><span>Disponíveis</span><b>{count(st?.available_quantity)}</b></div></div></section>
   </div>
   {(s.loading||day.loading||annual.loading||v.loading||e.loading||(scoped&&assignment.loading))&&<div className="tf-tim-inline-loading" role="status"><RefreshCw size={14} className="tf-tim-spin"/> Atualizando indicadores</div>}
   {ss&&s.data&&<>
     <ChartPanel kind="sales" rows={s.data.groups.daily||[]} title="Faturamento diário" sub={monthName(month)} wide/>
     <div className="tf-tim-home-insights"><OperationalIndicators r={s.data}/><CategoryBars rows={s.data.groups.categories||[]}/><Mix kind="sales" rows={s.data.groups.areas||[]} title="Participação por área" share/></div>
   </>}
   {(ss||v.data)&&<div className="tf-tim-grid-2 tim-executive-rankings">
     {ss&&s.data&&<Ranking kind="sales" title="Ranking completo de vendas" rows={s.data.groups.stores||[]} sub={`${(s.data.groups.stores||[]).length} filiais`} limit={Infinity} scrollHeight={520}/>}
     {v.data&&<Ranking kind="services" title="Ranking completo de serviços" rows={v.data.groups.stores||[]} sub={`${(v.data.groups.stores||[]).length} filiais`} limit={Infinity} scrollHeight={520}/>}
   </div>}
   {v.data&&<div className="tf-tim-grid-wide"><ChartPanel kind="services" rows={v.data.groups.daily||[]} title="Ativações por dia" sub={monthName(month)}/><Mix kind="services" rows={v.data.groups.statuses||[]} title="Status de ativação" share/></div>}
   {e.data&&<Mix kind="stock" rows={e.data.groups.categories||[]} title="Composição do estoque"/>}
 </>;
}
export default function TimWorkspace({user,onBack,onLogout}:{user:any;onBack:()=>void;onLogout:()=>void}){
 const [view,setView]=useState<View>('home'),[collapsed,setCollapsed]=useState(false),[mobile,setMobile]=useState(false),[meta,setMeta]=useState<Metadata|null>(null),[metaError,setMetaError]=useState(''),[refresh,setRefresh]=useState(0),[filters,setFilters]=useState<Filters>({...baseFilter}),[month,setMonth]=useState(''),[year,setYear]=useState(String(new Date().getFullYear())),[yearA,setYearA]=useState(String(new Date().getFullYear()-1)),[custom,setCustom]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1);
 const kind:Kind=view==='services'?'services':view==='stock'?'stock':'sales';
 const go=(v:View,f?:Filters)=>{setView(v);setFilters(f?{...f}:{...baseFilter});setPage(1);setCustom(false);setMobile(false);if(meta&&v!=='stock'&&v!=='annual'){const k=v==='services'?'services':'sales';if(!meta.datasets[k].periods.some(p=>p.month===month))setMonth(meta.datasets[k].periods[0]?.month||month);}};
 useEffect(()=>{const ac=new AbortController();setMetaError('');timGet<Metadata>('metadata',ac.signal).then(m=>{setMeta(m);const latest=m.datasets.sales.periods[0]?.month||m.datasets.services.periods[0]?.month||'';setMonth(prev=>prev||latest);if(latest){if(!meta){setYear(latest.slice(0,4));setYearA(String(Number(latest.slice(0,4))-1));}setFrom(prev=>prev||`${latest}-01`);setTo(prev=>prev||monthEnd(latest));}}).catch(e=>{if(!isAbort(e))setMetaError(errorText(e));});return()=>ac.abort();},[refresh]);
 const dateFrom=view==='annual'?`${year}-01-01`:custom?from:month?`${month}-01`:'',dateTo=view==='annual'?`${year}-12-31`:custom?to:month?monthEnd(month):'';
 const invalid=kind!=='stock'&&(!dateFrom||!dateTo||dateFrom>dateTo);
 const query=buildQuery(kind,filters,dateFrom,dateTo,page),previousQuery=buildQuery('sales',filters,`${yearA}-01-01`,`${yearA}-12-31`);
 const report=useReport(kind,query,!!meta&&view!=='home'&&!invalid,refresh),previous=useReport('sales',previousQuery,!!meta&&view==='annual',refresh);
 const title=TITLES[view];
 const onFilter=(f:Filters)=>{setFilters(f);setPage(1);};const changeMonth=(v:string)=>{setMonth(v);setPage(1);if(v){setFrom(`${v}-01`);setTo(monthEnd(v));}};
 return <div className="tf-tim-root"><aside className={`tf-tim-sidebar ${collapsed?'collapsed':''} ${mobile?'mobile-open':''}`}><div className="tf-tim-brand"><div className="tf-tim-brand-mark"><span>TIM</span><i/><i/><i/></div>{!collapsed&&<div><strong>TELE<span>FLUXO</span></strong><small>OPERAÇÃO TIM</small></div>}<button className="tf-tim-collapse" aria-label={collapsed?"Expandir menu":"Recolher menu"} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button><button className="tf-tim-mobile-close" aria-label="Fechar menu" onClick={()=>setMobile(false)}><X size={20}/></button></div><div className="tf-tim-nav-label">GESTÃO COMERCIAL</div><nav>{MENU.map(m=><button key={m.id} className={view===m.id?'active':''} aria-current={view===m.id?'page':undefined} onClick={()=>go(m.id)} title={m.name}><m.icon size={19}/>{!collapsed&&<span>{m.name}</span>}{!collapsed&&view===m.id&&<ChevronRight size={15}/>}</button>)}</nav><div className="tf-tim-side-bottom">{canReturnToMain(user)&&<button className="tf-tim-back" onClick={onBack} title="Voltar ao TeleFluxo"><ArrowLeft size={18}/>{!collapsed&&<span>Voltar ao TeleFluxo</span>}</button>}<div className="tf-tim-profile"><div className="tf-tim-avatar">{String(user?.name||'T').slice(0,1).toUpperCase()}</div>{!collapsed&&<div><strong>{String(user?.name||'Usuário')}</strong><small>{String(user?.role||'')}</small></div>}<button title="Sair" onClick={onLogout}><LogOut size={17}/></button></div></div></aside>{mobile&&<button className="tf-tim-overlay" aria-label="Fechar navegação" onClick={()=>setMobile(false)}/>}
 <main className="tf-tim-main"><header className="tf-tim-top"><div><button className="tf-tim-hamburger" onClick={()=>{if(window.matchMedia('(max-width: 900px)').matches){setCollapsed(false);setMobile(true);}else setCollapsed(x=>!x);}} aria-label={collapsed?'Expandir menu':'Alternar menu'} title={collapsed?'Expandir menu':'Recolher menu'}>{collapsed?<Menu size={19}/>:<ChevronLeft size={19}/>}</button><span className="tf-tim-breadcrumb">GRUPO TELECEL <ChevronRight size={12}/> <b>TIM</b></span></div><div><span className="tf-tim-sync-stamp"><i className={meta?.updated_at?'synced':''}/>{meta?.updated_at?`Sincronizado em ${new Date(meta.updated_at).toLocaleString('pt-BR')}`:'Aguardando primeira carga'}</span><button className="tf-tim-secondary" onClick={()=>setRefresh(x=>x+1)}><RefreshCw size={15}/> Atualizar</button></div></header><div className={`tf-tim-content tim-view-${view}`}><div className="tf-tim-pagehead"><div><div className="tf-tim-section-label"><BarChart3 size={15}/> BUSINESS INTELLIGENCE / TIM</div><h1>{view==='home'?`Olá, ${String(user?.name||'').trim().split(/\s+/)[0]||'bem-vindo'}.`:title}</h1></div>{view==='home'&&meta&&<label className="tf-tim-field tf-tim-home-month"><span>Competência</span><select value={month} onChange={e=>changeMonth(e.target.value)}>{Array.from(new Set([month,...meta.datasets.sales.periods.map(p=>p.month),...meta.datasets.services.periods.map(p=>p.month)])).filter(Boolean).map(m=><option key={m} value={m}>{monthName(m)}</option>)}</select></label>}</div>
 {metaError?<ErrorBox text={metaError} retry={()=>setRefresh(x=>x+1)}/>:!meta?<Loading/>:!meta.updated_at?<Empty text="Nenhuma carga TIM publicada ainda."/>:view==='home'?<Overview meta={meta} month={month} refresh={refresh} onView={go} filters={filters} onFilter={onFilter}/>:<>
 <FiltersBar kind={kind} meta={meta} filters={filters} onChange={onFilter} showDate={view!=='stock'} month={month} setMonth={changeMonth} custom={custom} setCustom={v=>{setCustom(v);setPage(1);}} from={from} setFrom={v=>{setFrom(v);setPage(1);}} to={to} setTo={v=>{setTo(v);setPage(1);}} annual={view==='annual'} year={year} setYear={v=>{setYear(v);setPage(1);}} yearA={yearA} setYearA={setYearA}/>
 {invalid?<div className="tf-tim-notice">Selecione um período válido.</div>:report.error||view==='annual'&&previous.error?<ErrorBox text={report.error||previous.error} retry={()=>setRefresh(x=>x+1)}/>:<>
 {report.loading||view==='annual'&&previous.loading?<Loading/>:null}
 <div className="tf-tim-results" style={{display:report.loading||view==='annual'&&previous.loading?'none':undefined}}>{report.data&&report.data.kind===kind&&<>{kind!=='stock'?<Coverage periods={report.data.periods} from={dateFrom} to={dateTo}/>:<div className="tf-tim-coverage"><span><i/> Estoque sincronizado em: <b>{meta.stock_updated_at?new Date(meta.stock_updated_at).toLocaleString('pt-BR'):'—'}</b></span></div>}<ReactReport key={view} view={view} data={report.data} previous={previous.data} month={month} custom={custom} year={year} yearA={yearA} query={query} setPage={setPage} stockStore={filters.store} onStockStore={store=>onFilter({...filters,store})} stockStores={meta.datasets.stock.stores}/></>}</div></>}
 </>}
 <footer className="tf-tim-footer">TeleFluxo · Operação TIM <span>Fonte: API_VENDAS · API_SERVICOS · API_ESTOQUE · API_BURST</span></footer></div></main></div>;
}
function ReactReport({view,data,previous,month,custom,year,yearA,query,setPage,stockStore,onStockStore,stockStores}:{view:View;data:Report;previous:Report|null;month:string;custom:boolean;year:string;yearA:string;query:string;setPage:(p:number)=>void;stockStore:string;onStockStore:(s:string)=>void;stockStores:string[]}){
 if(view!=='annual'&&view!=='stock'&&data.total===0&&!(view==='sales'&&typeof data.summary.burst_total==='number'&&data.summary.burst_total!==0))return <Empty/>;
 if(view==='annual')return previous?<Annual current={data} previous={previous} year={year} yearA={yearA} query={query} setPage={setPage}/>:null;
 if(view==='sales')return <MonthlySales r={data} month={month} custom={custom} query={query} setPage={setPage}/>;
 if(view==='services')return <Services r={data} query={query} setPage={setPage}/>;
 return <Stock r={data} query={query} setPage={setPage} store={stockStore} onStore={onStockStore} stores={stockStores}/>;
}
