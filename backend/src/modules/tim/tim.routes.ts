import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { timReadCache } from '../performance/readCache';
import { readMetasToken, verifyMetasToken } from '../metas/metas.session';
import { KINDS, SCHEMA, METRICS, PRIMARY, table, fields, validatedRows, partitions, accessScope, scopeWhere, validDate, BURST_SCHEMA, validateBurst, normalize } from './tim.core';
import type { Kind, Scope, Scalar, Row, BurstRow } from './tim.core';

type DB=Awaited<ReturnType<typeof open>>;
type Params={prisma:PrismaClient;dbPath:string};
const bearer=(req:Request)=>String(req.header('authorization')||'').replace(/^Bearer\s+/i,'').trim();
const secureEq=(a:string,b:string)=>{const x=Buffer.from(a), y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const q=(req:Request,k:string)=>typeof req.query[k]==='string'?String(req.query[k]).trim().slice(0,300):'';
const errorMessage=(err:unknown)=>err instanceof Error?err.message:String(err);

const STOCK_AGE_EXPR = "CAST(julianday('now','localtime') - julianday(COALESCE(NULLIF(entry_date,''), NULLIF(purchase_date,''))) AS INTEGER)";
const stockAgeClause=(bucket:string)=>{
  switch(bucket){
    case 'lte90': return `${STOCK_AGE_EXPR}>=0 AND ${STOCK_AGE_EXPR}<=90`;
    case '91to120': return `${STOCK_AGE_EXPR}>90 AND ${STOCK_AGE_EXPR}<=120`;
    case '121to360': return `${STOCK_AGE_EXPR}>120 AND ${STOCK_AGE_EXPR}<=360`;
    case 'gt360': return `${STOCK_AGE_EXPR}>360`;
    default: return '';
  }
};
const smartFamilyTokens=(raw:unknown):string[]=>{
  const value=normalize(raw);
  if(!value) return [];
  const found:string[]=[];
  const add=(prefix:string, token:string)=>{ const clean=normalize(token).replace(/\s+/g,' ').trim(); if(clean) found.push((prefix?`${prefix} `:'')+clean); };
  for(const match of value.match(/IPHONE\s+\d{1,2}(?:\s+(?:PRO|PLUS|MAX|MINI))?/g)||[]) add('',match);
  for(const match of value.match(/GALAXY\s+(?:S\d{1,2}(?:\s+(?:FE|PLUS|ULTRA))?|A\d{1,2}|M\d{1,2}|Z\s+(?:FLIP|FOLD)\s*\d)/g)||[]) add('',match);
  for(const match of value.match(/(?:MOTO\s+)?G\d{1,3}(?:\s+(?:PLAY|POWER|PLUS|STYLUS|5G))?/g)||[]) add('MOTO',match.replace(/^MOTO\s+/,''));
  for(const match of value.match(/EDGE\s+\d{2,3}(?:\s+(?:FUSION|PRO|ULTRA|NEO))?/g)||[]) add('MOTOROLA',match);
  for(const match of value.match(/REDMI\s+NOTE\s+\d{1,2}(?:\s+(?:PRO|S|5G))?/g)||[]) add('',match);
  for(const match of value.match(/POCO\s+[A-Z]?\d{1,3}(?:\s+(?:PRO|GT|5G|NFC))?/g)||[]) add('',match);
  return [...new Set(found)];
};
const buildSmartStock=(rows:any[])=>{
  const map=new Map<string,{name:string;store:string;devices:number;cases:number;accessories:number;device_models:Set<string>;case_items:Set<string>;oldest:string|null;newest:string|null}>();
  for(const row of rows){
    const families=smartFamilyTokens(`${row.model||''} ${row.product||''} ${row.product_code||''}`);
    if(!families.length) continue;
    const category=normalize(row.category);
    const deposit=normalize(row.deposit);
    const available=Number(row.available)===1;
    const isDevice=available && /APARELHO|CELULAR|SMARTPHONE/.test(category);
    const isAccessory=/ACESSORIO|CAPA|CASE|PELICULA/.test(category) || /CAPA|CASE/.test(normalize(`${row.product||''} ${row.model||''}`));
    if(!isDevice && !isAccessory) continue;
    for(const family of families){
      const key=`${row.store}|${family}`;
      const current=map.get(key) || {name:family,store:row.store,devices:0,cases:0,accessories:0,device_models:new Set(),case_items:new Set(),oldest:null,newest:null};
      const qty=Number(row.quantity)||0;
      const entry=String(row.entry_date||row.purchase_date||'');
      if(entry){ if(!current.oldest || entry<current.oldest) current.oldest=entry; if(!current.newest || entry>current.newest) current.newest=entry; }
      if(isDevice){ current.devices += qty; if(row.model) current.device_models.add(String(row.model)); }
      if(isAccessory){ current.accessories += qty; if(/CAPA|CASE/.test(normalize(`${row.product||''} ${row.model||''}`))) current.cases += qty; current.case_items.add(String(row.product||row.model||family)); }
      map.set(key,current);
    }
  }
  return [...map.values()].map(item=>(
    {name:item.name,store:item.store,devices:item.devices,cases:item.cases,accessories:item.accessories,
     coverage:item.devices>0?Math.round((item.cases/item.devices)*1000)/10:null,
     oldest:item.oldest,newest:item.newest,
     device_models:[...item.device_models].slice(0,4).join(' • '),
     case_items:[...item.case_items].slice(0,4).join(' • ')}
  )).filter(item=>item.devices>0 || item.cases>0 || item.accessories>0)
    .sort((a,b)=>(b.devices+b.cases)-(a.devices+a.cases)||a.name.localeCompare(b.name,'pt-BR')||a.store.localeCompare(b.store,'pt-BR'));
};

export function createTimRoutes({prisma,dbPath}:Params){
  const router=Router();
  // Open lazily, so enabling TIM doesn't block Samsung startup if the disk is offline.
  let initialized:Promise<void>|null=null;
  const ensure=()=> {
    if(!initialized) initialized=(async()=>{fs.mkdirSync(path.dirname(dbPath),{recursive:true});const db=await open({filename:dbPath,driver:sqlite3.Database});try{await db.exec('PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL;');await db.exec(SCHEMA);await db.exec(BURST_SCHEMA);}finally{await db.close();}})().catch(e=>{initialized=null;throw e;});
    return initialized;
  };
  async function connect(){await ensure();const db=await open({filename:dbPath,driver:sqlite3.Database});await db.exec('PRAGMA busy_timeout=30000;');return db;}
  // Reuse verified login tokens, not a caller-supplied userId.
  async function readAuth(req:Request,res:Response,next:NextFunction){
    try{
      const token=bearer(req), id=readMetasToken(token);
      if(!id)return res.status(401).json({error:'Sessão TIM ausente. Entre novamente no TeleFluxo.'});
      const user=await prisma.user.findUnique({where:{id}});
      if(!user||verifyMetasToken(token,user.password)!==id)return res.status(401).json({error:'Sessão expirada ou inválida. Entre novamente.'});
      const scope=accessScope(user);
      if(!scope)return res.status(403).json({error:'Seu perfil não tem acesso à operação TIM.'});
      if(!scope.network&&!scope.stores.length)return res.status(403).json({error:'Solicite a vinculação das filiais TIM ao seu usuário.'});
      res.locals.timScope=scope;res.locals.timUserId=id;res.setHeader('Cache-Control','no-store');next();
    }catch(err){console.error('[TIM] auth',errorMessage(err));return res.status(500).json({error:'Não foi possível validar a sessão TIM.'});}
  }
  // Atomic sync across all 3 datasets; repeated calls replace, never add duplicate rows.
  router.post('/sync',async(req,res)=>{
    const expected=String(process.env.TIM_SYNC_TOKEN||'');
    if(expected.length<32)return res.status(503).json({error:'TIM_SYNC_TOKEN não configurado no backend (mínimo 32 caracteres).'});
    if(!secureEq(expected,bearer(req)))return res.status(401).json({error:'Chave de sincronização inválida.'});
    const payload=req.body;
    let data:Record<Kind,Row[]>;let burst:BurstRow[]|null=null;
    try{
      if(![1,2].includes(payload?.version)||typeof payload.digest!=='string'||!/^[a-f0-9]{64}$/.test(payload.digest)||!payload.rows)throw new Error('Formato de carga inválido (versões 1 e 2).');
      data={sales:validatedRows('sales',payload.rows.sales),services:validatedRows('services',payload.rows.services),stock:validatedRows('stock',payload.rows.stock)};
      if(payload.version===2)burst=validateBurst(payload.rows.burst);
    }catch(err){return res.status(400).json({error:errorMessage(err)});}
    let db:DB|undefined;let begun=false;
    try{
      db=await connect();await db.exec('BEGIN IMMEDIATE');begun=true;
      // A successful retry is a no-op only if it is still the latest snapshot.
      const latest=await db.get<{digest:string;summary:string}>('SELECT digest, summary FROM tim_imports ORDER BY rowid DESC LIMIT 1');
      if(latest && latest.digest===payload.digest){await db.exec('COMMIT');begun=false;return res.json({ok:true,replayed:true,...JSON.parse(latest.summary)});}
      const now=new Date().toISOString(), summary:Record<string,unknown>={updated_at:now};
      const lastExisting=await db.get<{last:string|null}>("SELECT MAX(last_date) AS last FROM tim_partitions WHERE dataset='sales'");
      const incomingLast=data.sales.reduce((a,r)=>String(r.date)>a?String(r.date):a,'');
      if(payload.preserve_stock!==true&&payload.allow_regression!==true&&lastExisting?.last&&incomingLast<lastExisting.last)throw new Error('sales: a planilha cobre menos dias do que a última posição. Para importar meses antigos sem alterar o estoque, use --preservar-estoque.');
      for(const kind of KINDS){
        if(kind==='stock'&&payload.preserve_stock===true){summary[kind]={received:0,preserved:true,total_records:(await db.get<{n:number}>(`SELECT COUNT(*) AS n FROM ${table(kind)}`))?.n??0};continue;}
        const groups=partitions(kind,data[kind]);
        for(const [month,p] of groups){
          const old=await db.get<{first_date:string|null;last_date:string|null;row_count:number}>('SELECT first_date,last_date,row_count FROM tim_partitions WHERE dataset=? AND month=?',kind,month);
          if(kind!=='stock'&&old&&payload.allow_regression!==true&&((old.last_date&&p.last&&p.last<old.last_date)||(old.first_date&&p.first&&p.first>old.first_date)||p.count<old.row_count))throw new Error(`${kind} ${month}: a planilha cobre menos dias ou registros do que a carga anterior. Revise o histórico antes de substituir.`);
          if(kind==='stock')await db.run(`DELETE FROM ${table(kind)}`);
          else await db.run(`DELETE FROM ${table(kind)} WHERE date>=? AND date<=?`,`${month}-01`,`${month}-31`);
          await db.run(`INSERT INTO tim_partitions (dataset,month,first_date,last_date,row_count,imported_at) VALUES (?,?,?,?,?,?) ON CONFLICT(dataset,month) DO UPDATE SET first_date=excluded.first_date,last_date=excluded.last_date,row_count=excluded.row_count,imported_at=excluded.imported_at`,kind,month,p.first,p.last,p.count,now);
        }
        const cols=fields(kind),stmt=await db.prepare(`INSERT INTO ${table(kind)} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
        try{for(const row of data[kind])await stmt.run(...cols.map(c=>row[c]??null));}finally{await stmt.finalize();}
        summary[kind]={received:data[kind].length,partitions:[...groups.keys()],total_records:(await db.get<{n:number}>(`SELECT COUNT(*) AS n FROM ${table(kind)}`))?.n??0};
      }
      if(burst){
        const byMonth=new Map<string,BurstRow[]>();
        for(const r of burst){const month=r.date.slice(0,7);const list=byMonth.get(month)||[];list.push(r);byMonth.set(month,list);}
        const stmt=await db.prepare('INSERT INTO tim_burst(source_row,date,store,credit) VALUES(?,?,?,?)');
        try{for(const [month,rows] of byMonth){
          const firstRow=rows[0];
          if(!firstRow) continue;
          const first=rows.reduce((a,r)=>r.date<a?r.date:a,firstRow.date),last=rows.reduce((a,r)=>r.date>a?r.date:a,firstRow.date);
          const old=await db.get<{first_date:string;last_date:string;row_count:number}>("SELECT first_date,last_date,row_count FROM tim_partitions WHERE dataset='burst' AND month=?",month);
          if(old&&payload.allow_regression!==true&&(first>old.first_date||last<old.last_date||rows.length<old.row_count))throw new Error(`burst ${month}: a planilha cobre menos dias ou registros do que a carga anterior. Revise a carga.`);
          await db.run('DELETE FROM tim_burst WHERE date>=? AND date<=?',`${month}-01`,`${month}-31`);
          for(const row of rows)await stmt.run(row.source_row,row.date,row.store,row.credit);
          await db.run("INSERT INTO tim_partitions(dataset,month,first_date,last_date,row_count,imported_at) VALUES ('burst',?,?,?,?,?) ON CONFLICT(dataset,month) DO UPDATE SET first_date=excluded.first_date,last_date=excluded.last_date,row_count=excluded.row_count,imported_at=excluded.imported_at",month,first,last,rows.length,now);
        }}finally{await stmt.finalize();}
        summary.burst={received:burst.length,partitions:[...byMonth.keys()],credit:Math.round(burst.reduce((a,r)=>a+r.credit,0)*100)/100};
      }
      await db.run('INSERT OR REPLACE INTO tim_imports VALUES (?,?,?,?)',payload.digest,String(payload.source||'Excel TIM').slice(0,250),now,JSON.stringify(summary));
      await db.exec('COMMIT');begun=false;timReadCache.invalidate();return res.json({ok:true,...summary});
    }catch(err){if(begun&&db)await db.exec('ROLLBACK').catch(()=>undefined);console.error('[TIM] sync',errorMessage(err));return res.status(errorMessage(err).includes('cobre menos dias')?409:500).json({error:errorMessage(err).includes('cobre menos dias')?errorMessage(err):'Falha de sincronização. Nenhum dado TIM foi substituído.'});}
    finally{if(db)await db.close().catch(()=>undefined);}
  });
  router.use(readAuth);
  router.get('/metadata',async(_req,res)=>{
    try{
      const scope:Scope=res.locals.timScope;
      const key=JSON.stringify(['metadata',res.locals.timUserId,scope.network,[...scope.stores].sort()]);
      const result=await timReadCache.load(key,async()=>{
      let db:DB|undefined;
      try{
      db=await connect();await db.exec('BEGIN');const w=scopeWhere(scope);
      const datasets:Record<string,unknown>={};
      const storeSet=new Set<string>();
      for(const kind of KINDS){
        const t=table(kind);const stores=await db.all<{store:string}[]>(`SELECT DISTINCT store FROM ${t} WHERE ${w.sql} ORDER BY store`,...w.args);
        stores.forEach(r=>storeSet.add(r.store));
        const periods=kind==='stock'?[]:await db.all(`SELECT substr(date,1,7) AS month,MIN(date) AS first,MAX(date) AS last,COUNT(*) AS records FROM ${t} WHERE ${w.sql} GROUP BY month ORDER BY month DESC`,...w.args);
        const options:Record<string,string[]>={};
        for(const col of (kind==='stock'?['area','category','brand']:kind==='sales'?['area','category','coordinator','seller']:['area','category','status','seller'])){
          const rows=await db.all<{name:string}[]>(`SELECT DISTINCT ${col} AS name FROM ${t} WHERE ${w.sql} AND ${col} IS NOT NULL AND ${col}<>'' ORDER BY name`,...w.args);options[col]=rows.map(r=>r.name);
        }
        datasets[kind]={periods,stores:stores.map(r=>r.store),options};
      }
      const stamp=await db.get<{created_at:string}>('SELECT created_at FROM tim_imports ORDER BY rowid DESC LIMIT 1');const stockStamp=await db.get<{imported_at:string}>("SELECT imported_at FROM tim_partitions WHERE dataset='stock' AND month='snapshot'");await db.exec('COMMIT');
      return {updated_at:stamp?.created_at??null,stock_updated_at:stockStamp?.imported_at??null,scope:scope.network?'network':'stores',stores:[...storeSet].sort(),datasets};
      }finally{if(db)await db.close().catch(()=>undefined);}
      });
      return res.json(result);
    }catch(err){console.error('[TIM] metadata',errorMessage(err));return res.status(500).json({error:'Falha ao consultar cadastros da TIM.'});}
  });
  router.get('/report',async(req,res)=>{
    const kind=q(req,'kind') as Kind;if(!KINDS.includes(kind))return res.status(400).json({error:'Relatório inválido.'});
    const scope:Scope=res.locals.timScope,w=scopeWhere(scope),where=[w.sql],args:Scalar[]=[...w.args];
    const from=q(req,'from'),to=q(req,'to');
    if(kind!=='stock'&&((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to)))return res.status(400).json({error:'Período inválido.'});
    if(kind!=='stock'&&from){where.push('date>=?');args.push(from);}if(kind!=='stock'&&to){where.push('date<=?');args.push(to);}
    const allowed=kind==='sales'?['store','area','category','seller','coordinator']:kind==='services'?['store','area','category','seller','status']:['store','area','category','brand'];
    for(const col of allowed){const v=q(req,col);if(v){where.push(`${col}=?`);args.push(v);}}
    if(kind!=='stock'&&q(req,'liquid')==='true'){where.push("liquid_status='OK'");}
    if(kind==='stock'&&q(req,'available')==='true'){where.push('available=1');}
    if(kind==='stock'){const stockAge=q(req,'stock_age');const ageClause=stockAgeClause(stockAge);if(ageClause)where.push(ageClause);}
    const search=q(req,'search');if(search){const cols=kind==='sales'?['store','seller','product','model','product_code','order_id']:kind==='services'?['store','seller','plan','modality']:['store','product','model','product_code','deposit'];where.push(`(${cols.map(c=>`instr(upper(COALESCE(${c},'')),upper(?))>0`).join(' OR ')})`);args.push(...cols.map(()=>search));}
    const clause=where.join(' AND '), t=table(kind), metric=METRICS[kind], primary=PRIMARY[kind];
    try{
      const cacheable=!q(req,'revision')&&q(req,'detailsOnly')!=='true';
      const cacheKey=cacheable?JSON.stringify(['report',res.locals.timUserId,scope.network,[...scope.stores].sort(),kind,clause,args,q(req,'page'),q(req,'size'),q(req,'summaryOnly')]):null;
      const result=await timReadCache.load(cacheKey,async()=>{
      let db:DB|undefined;
      try{
      db=await connect();await db.exec('BEGIN');
      const revision=(await db.get<{digest:string}>('SELECT digest FROM tim_imports ORDER BY rowid DESC LIMIT 1'))?.digest??'';
      if(q(req,'revision')&&q(req,'revision')!==revision){await db.exec('ROLLBACK');throw new Error('TIM_REVISION_MISMATCH');}
      const summary=await db.get<Record<string,number|null>>(`SELECT ${metric} FROM ${t} WHERE ${clause}`,...args);
      const group=async(col:string,limit=100)=>db!.all(`SELECT ${col} AS name, ${metric} FROM ${t} WHERE ${clause} GROUP BY ${col} ORDER BY ${primary} DESC, name LIMIT ${limit}`,...args);
      const groups:Record<string,unknown>={};
      if(q(req,'detailsOnly')!=='true'&&q(req,'summaryOnly')!=='true'){
        groups.stores=kind==='stock' ? await db.all(`SELECT store AS name, CASE WHEN COUNT(DISTINCT COALESCE(NULLIF(area,''),'SEM AREA'))=1 THEN MIN(COALESCE(NULLIF(area,''),'SEM AREA')) ELSE 'AREAS DIVERSAS' END AS area, ${metric} FROM ${t} WHERE ${clause} GROUP BY store ORDER BY ${primary} DESC,name LIMIT 500`,...args) : await group('store',500);groups.categories=await group('category',500);groups.areas=await group('area',100);
        if(kind!=='stock'){
          groups.sellers=await db.all(`SELECT seller AS name,store,${metric} FROM ${t} WHERE ${clause} GROUP BY seller,store ORDER BY ${primary} DESC,name`,...args);
          groups.daily=await db.all(`SELECT date AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY date ORDER BY date`,...args);
          groups.monthly=await db.all(`SELECT substr(date,1,7) AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY name ORDER BY name`,...args);
          groups.matrix=await db.all(`SELECT store AS name,substr(date,1,7) AS month,${metric} FROM ${t} WHERE ${clause} GROUP BY store,month ORDER BY store,month`,...args);
        }
        if(kind==='sales'){groups.products=await group("COALESCE(NULLIF(model,''),product)",150);groups.modalities=await group('modality',150);groups.coordinators=await group('coordinator',100);}
        if(kind==='services'){groups.plans=await group('plan',200);groups.statuses=await group('status',100);groups.modalities=await group('modality',200);}
        if(kind==='stock'){
          groups.products=await db.all(`SELECT product_code AS code,MAX(model) AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY product_code ORDER BY ${primary} DESC LIMIT 250`,...args);
          groups.deposits=await group('deposit',250);
          groups.brands=await group('brand',100);
          const smartRows=await db.all(`SELECT store,deposit,product_code,product,model,category,quantity,available,entry_date,purchase_date FROM ${t} WHERE ${clause} ORDER BY store,category,model`,...args);
          groups.smart=buildSmartStock(smartRows).slice(0,500);
        }
      }
      const size=Math.min(200,Math.max(10,Number.parseInt(q(req,'size')||'50',10)||50));
      const total=Number(summary?.records||0),page=Math.min(Math.max(1,Math.ceil(total/size)),Math.max(1,Number.parseInt(q(req,'page')||'1',10)||1));
      const cols=fields(kind).filter(s=>!['source_row'].includes(s));
      const rows=q(req,'summaryOnly')==='true'?[]:await db.all(`SELECT ${cols.join(',')} FROM ${t} WHERE ${clause} ORDER BY ${kind==='stock'?'store,product_code,id':'date DESC,id DESC'} LIMIT ? OFFSET ?`,...args,size,(page-1)*size);
      // Actual scoped coverage, independent of category/filial filters; absent month is not zero.
      const periods=kind==='stock'?[]:await db.all(`SELECT substr(date,1,7) AS month,MIN(date) AS first,MAX(date) AS last,COUNT(*) AS records FROM ${t} WHERE ${w.sql} GROUP BY month ORDER BY month`,...w.args);
      let burstStatus:'loaded'|'partial'|'missing'|'unsupported'|undefined;
      if(kind==='sales'&&summary){
        // Store-level credits cannot be allocated to seller, product or text searches.
        if(q(req,'seller')||q(req,'category')||search){burstStatus='unsupported';summary.burst_total=null;summary.revenue_plus_burst=null;}
        else{
          const bw=scopeWhere(scope), bwhere=[bw.sql], bargs:Scalar[]=[...bw.args];
          if(from){bwhere.push('date>=?');bargs.push(from);}if(to){bwhere.push('date<=?');bargs.push(to);}
          if(q(req,'store')){bwhere.push('store=?');bargs.push(q(req,'store'));}
          // Assign credits through the actual store/month sales attributes, using EXISTS (no multiplication by sales rows).
          const attrs:string[]=[];const attrArgs:Scalar[]=[];
          for(const attr of ['area','coordinator']){const value=q(req,attr);if(value){attrs.push(`s.${attr}=?`);attrArgs.push(value);}}
          if(q(req,'liquid')==='true')attrs.push("s.liquid_status='OK'");
          if(attrs.length){bwhere.push(`EXISTS (SELECT 1 FROM tim_sales s WHERE s.store=tim_burst.store AND substr(s.date,1,7)=substr(tim_burst.date,1,7) AND ${attrs.join(' AND ')})`);bargs.push(...attrArgs);}
          const bclause=bwhere.join(' AND ');
          const imported=await db.all<{month:string}[]>("SELECT month FROM tim_partitions WHERE dataset='burst'");
          const covered=new Set(imported.map(r=>r.month));
          const relevant=(periods as {month:string}[]).map(p=>p.month).filter(m=>(!from||m>=from.slice(0,7))&&(!to||m<=to.slice(0,7)));
          if(from&&to&&from.slice(0,7)===to.slice(0,7)&&!relevant.includes(from.slice(0,7)))relevant.push(from.slice(0,7));
          const known=relevant.filter(m=>covered.has(m));
          burstStatus=!known.length?'missing':known.length===relevant.length?'loaded':'partial';
          const credit=await db.get<{credit:number}>(`SELECT COALESCE(SUM(credit),0) AS credit FROM tim_burst WHERE ${bclause}`,...bargs);
          summary.burst_total=burstStatus==='loaded'?credit?.credit??0:null;
          summary.revenue_plus_burst=summary.burst_total==null?null:(summary.revenue??0)+summary.burst_total;
          if(burstStatus==='loaded'&&Array.isArray(groups.stores)){
            const credits=await db.all<{name:string;credit:number}[]>(`SELECT store AS name,SUM(credit) AS credit FROM tim_burst WHERE ${bclause} GROUP BY store`,...bargs);
            const byStore=new Map(credits.map(x=>[x.name,x.credit]));
            const stores=groups.stores as {name:string;revenue:number;burst_total?:number;revenue_plus_burst?:number}[];
            for(const row of stores){row.burst_total=byStore.get(row.name)??0;row.revenue_plus_burst=(row.revenue??0)+row.burst_total;byStore.delete(row.name);}
            for(const [name,amount] of byStore)stores.push({name,revenue:0,burst_total:amount,revenue_plus_burst:amount});
          }
        }
      }
      await db.exec('COMMIT');return {kind,summary,groups,periods,rows,total,page,size,revision,burstStatus};
      }finally{if(db)await db.close().catch(()=>undefined);}
      });
      return res.json(result);
    }catch(err){if(errorMessage(err)==='TIM_REVISION_MISMATCH')return res.status(409).json({error:'A base TIM foi atualizada durante a exportação. Execute a exportação novamente.'});console.error('[TIM] report',errorMessage(err));return res.status(500).json({error:'Não foi possível gerar o relatório TIM.'});}
  });
  return router;
}
