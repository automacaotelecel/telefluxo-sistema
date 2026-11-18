/** TIM: schema and authorization helpers, no dependency on Samsung. */
export const KINDS = ['sales', 'services', 'stock'] as const;
export type Kind = typeof KINDS[number];
export type Scalar = string | number | null;
export type Row = Record<string, Scalar>;
export type UserContext = { role?: unknown; operation?: unknown; isAdmin?: unknown; allowedStores?: unknown; status?: unknown };
export type Scope = { network: boolean; stores: string[] };
export const normalize = (v: unknown) => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export const storeKey = (v: unknown) => { const s = normalize(v).replace(/^TIM\s+/, '').replace(/\s*[-–—]\s*/g, ' ').trim(); return s ? `TIM ${s}` : 'SEM FILIAL'; };
export function accessScope(user: UserContext): Scope | null {
  const role = normalize(user.role), op = normalize(user.operation), status = normalize(user.status);
  if (status && !['ACTIVE','ATIVO','ATIVA'].includes(status)) return null;
  const scoped = /LOJA|VENDEDOR|OPERADOR|COLABORADOR/.test(role);
  if (!scoped && (['CEO','DIRETOR','DIRETORIA','SOCIO','MASTER'].includes(role) || ((user.isAdmin === true || user.isAdmin === 1 || ['ADM','ADMIN','GESTOR'].includes(role)) && ['TIM','GERAL','GESTAO',''].includes(op)))) return {network:true,stores:[]};
  if (op !== 'TIM') return null;
  const values = Array.isArray(user.allowedStores) ? user.allowedStores : String(user.allowedStores ?? '').split(',');
  // TIM stores have a brand prefix; bare Samsung store names never grant TIM access.
  const stores = [...new Set(values.map(normalize).filter(s => s.startsWith('TIM ')).map(storeKey))];
  return {network:false,stores};
}
const text = 'TEXT', number = 'REAL', integer = 'INTEGER';
export const FIELDS: Record<Kind, Record<string, string>> = {
  sales: {source_row:integer,order_id:text,date:text,store:text,area:text,seller:text,order_type:text,modality:text,product_code:text,product:text,category:text,model:text,brand:text,coordinator:text,liquid_status:text,quantity:number,source_total:number,revenue:number,liquid_total:number,unit_price:number,cost:number,film:integer},
  services: {source_row:integer,date:text,sale_date:text,store:text,area:text,seller:text,modality:text,category:text,plan:text,old_plan:text,status:text,liquid_status:text,classification:text,loyalty:text,plan_value:number,franchise:number,commission:number},
  stock: {source_row:integer,store:text,area:text,deposit:text,product_code:text,product:text,model:text,category:text,brand:text,quantity:number,unit_price:number,cost_total:number,sale_value:number,purchase_date:text,entry_date:text,available:integer},
};
export const table = (kind:Kind)=>`tim_${kind}`;
export const fields = (kind:Kind)=>Object.keys(FIELDS[kind]);
export const METRICS: Record<Kind,string> = {
  sales:`COUNT(*) AS records, COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(source_total),0) AS source_total, SUM(liquid_total) AS liquid_total,
    SUM(CASE WHEN order_type IN ('VENDA','DEVOLUCAO') THEN quantity ELSE 0 END) AS quantity,
    SUM(CASE WHEN category='APARELHO' AND order_type IN ('VENDA','DEVOLUCAO') THEN quantity ELSE 0 END) AS devices,
    SUM(CASE WHEN category='ACESSORIO' AND order_type IN ('VENDA','DEVOLUCAO') THEN quantity ELSE 0 END) AS accessories,
    SUM(CASE WHEN film=1 AND order_type IN ('VENDA','DEVOLUCAO') THEN quantity ELSE 0 END) AS films,
    COUNT(DISTINCT CASE WHEN order_type='VENDA' THEN order_id || '|' || store || '|' || date END) AS orders,
    SUM(CASE WHEN order_type='VENDA' THEN revenue ELSE 0 END) AS gross_sales,
    SUM(CASE WHEN order_type='DEVOLUCAO' THEN ABS(revenue) ELSE 0 END) AS returns_value,
    SUM(CASE WHEN liquid_status='PENDENTE' OR liquid_total IS NULL THEN 1 ELSE 0 END) AS pending,
    COUNT(DISTINCT store) AS stores`,
  services:`COUNT(*) AS records, SUM(CASE WHEN status='LIBERADO PARA PAGAMENTO' THEN 1 ELSE 0 END) AS released,
    SUM(CASE WHEN status='PENDENTE DE DOCUMENTACAO' THEN 1 ELSE 0 END) AS pending_docs,
    SUM(CASE WHEN category='SEM CLASSIFICACAO' THEN 1 ELSE 0 END) AS pending_category,
    SUM(CASE WHEN liquid_status='PENDENTE' THEN 1 ELSE 0 END) AS pending,
    SUM(franchise) AS franchise, COUNT(franchise) AS franchise_known, SUM(commission) AS commission, COUNT(commission) AS commission_known,
    COUNT(DISTINCT store) AS stores`,
  stock:`COUNT(*) AS records, COALESCE(SUM(quantity),0) AS quantity,
    SUM(CASE WHEN available=1 THEN quantity ELSE 0 END) AS available_quantity,
    SUM(CASE WHEN available=1 AND category='APARELHO' THEN quantity ELSE 0 END) AS available_devices,
    SUM(CASE WHEN available=0 THEN quantity ELSE 0 END) AS unavailable_quantity,
    SUM(CASE WHEN deposit='DEVOLVIDOS E DEFEITO' THEN quantity ELSE 0 END) AS defective_quantity,
    SUM(CASE WHEN deposit='EM TRANSITO' THEN quantity ELSE 0 END) AS transit_quantity,
    SUM(cost_total) AS cost_total, SUM(sale_value) AS sale_value, COUNT(DISTINCT product_code) AS skus,
    SUM(CASE WHEN store='SEM FILIAL' THEN 1 ELSE 0 END) AS pending, COUNT(DISTINCT CASE WHEN store<>'SEM FILIAL' THEN store END) AS stores`,
};
export const PRIMARY:Record<Kind,string> = {sales:'revenue',services:'records',stock:'quantity'};
export const SCHEMA = `CREATE TABLE IF NOT EXISTS tim_imports (digest TEXT PRIMARY KEY, source TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tim_partitions (dataset TEXT NOT NULL, month TEXT NOT NULL, first_date TEXT, last_date TEXT, row_count INTEGER NOT NULL, imported_at TEXT NOT NULL, PRIMARY KEY(dataset,month));
`+KINDS.map(k=>`CREATE TABLE IF NOT EXISTS ${table(k)} (id INTEGER PRIMARY KEY, ${Object.entries(FIELDS[k]).map(([f,t])=>`${f} ${t}`).join(',')});
  CREATE INDEX IF NOT EXISTS idx_tim_${k}_store ON ${table(k)}(store);
  ${k==='stock'?'':`CREATE INDEX IF NOT EXISTS idx_tim_${k}_date ON ${table(k)}(date);`}
  CREATE INDEX IF NOT EXISTS idx_tim_${k}_category ON ${table(k)}(category);`).join('\n');
export function validDate(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(`${value}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function validatedRows(kind:Kind,input:unknown):Row[] {
  if(!Array.isArray(input)||input.length===0||input.length>250000) throw new Error(`${kind}: envie de 1 a 250.000 linhas.`);
  const seen=new Set<number>();
  return input.map((r:unknown,i:number)=>{
    if(!r||typeof r!=='object'||Array.isArray(r))throw new Error(`${kind}: linha ${i+1} inválida.`);
    const obj=r as Record<string,unknown>, result:Row={};
    for(const [f,t] of Object.entries(FIELDS[kind])) {
      if(!Object.prototype.hasOwnProperty.call(obj,f)) throw new Error(`${kind}: campo ${f} ausente na linha ${i+1}.`);
      const v=obj[f];
      if(v===null) {result[f]=null;continue;}
      if(t==='TEXT') {if(typeof v!=='string'||v.length>2000)throw new Error(`${kind}: texto inválido em ${f}.`); result[f]=v;}
      else {if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12||(t==='INTEGER'&&!Number.isInteger(v)))throw new Error(`${kind}: número inválido em ${f}.`);result[f]=v;}
    }
    const numFields=kind==='sales'?['quantity','source_total','revenue','film']:kind==='stock'?['quantity','unit_price','cost_total','sale_value','available']:[];
    if(numFields.some(f=>typeof result[f]!=='number')) throw new Error(`${kind}: valor obrigatório ausente.`);
    const rowNo=result.source_row;
    if(typeof rowNo!=='number'||rowNo<2||seen.has(rowNo))throw new Error(`${kind}: número de linha inválido ou duplicado.`);
    seen.add(rowNo);
    if(typeof result.store!=='string'||!result.store||typeof result.category!=='string'||!result.category)throw new Error(`${kind}: filial/categoria ausente.`);
    if(kind!=='stock'&&!validDate(result.date))throw new Error(`${kind}: data inválida.`);
    if(kind==='stock'&&![0,1].includes(Number(result.available)))throw new Error('stock: disponibilidade inválida.');
    return result;
  });
}
export function partitions(kind:Kind,rows:Row[]) {
  const groups=new Map<string,{first:string|null;last:string|null;count:number}>();
  for(const r of rows){const d=kind==='stock'?null:String(r.date), m=d?d.slice(0,7):'snapshot';const p=groups.get(m)||{first:d,last:d,count:0};p.count++;if(d){if(!p.first||d<p.first)p.first=d;if(!p.last||d>p.last)p.last=d;}groups.set(m,p);}
  return groups;
}
export function scopeWhere(scope:Scope):{sql:string;args:Scalar[]} {
  return scope.network?{sql:'1=1',args:[]} : scope.stores.length?{sql:`store IN (${scope.stores.map(()=>'?').join(',')})`,args:scope.stores}:{sql:'1=0',args:[]};
}
