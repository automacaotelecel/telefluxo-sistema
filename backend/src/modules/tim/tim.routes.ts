import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { readMetasToken, verifyMetasToken } from '../metas/metas.session';
import { KINDS, SCHEMA, METRICS, PRIMARY, table, fields, validatedRows, partitions, accessScope, scopeWhere, validDate } from './tim.core';
import type { Kind, Scope, Scalar, Row } from './tim.core';

type DB=Awaited<ReturnType<typeof open>>;
type Params={prisma:PrismaClient;dbPath:string};
const bearer=(req:Request)=>String(req.header('authorization')||'').replace(/^Bearer\s+/i,'').trim();
const secureEq=(a:string,b:string)=>{const x=Buffer.from(a), y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const q=(req:Request,k:string)=>typeof req.query[k]==='string'?String(req.query[k]).trim().slice(0,300):'';
const errorMessage=(err:unknown)=>err instanceof Error?err.message:String(err);

export function createTimRoutes({prisma,dbPath}:Params){
  const router=Router();
  // Open lazily, so enabling TIM doesn't block Samsung startup if the disk is offline.
  let initialized:Promise<void>|null=null;
  const ensure=()=> {
    if(!initialized) initialized=(async()=>{fs.mkdirSync(path.dirname(dbPath),{recursive:true});const db=await open({filename:dbPath,driver:sqlite3.Database});try{await db.exec('PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL;');await db.exec(SCHEMA);}finally{await db.close();}})().catch(e=>{initialized=null;throw e;});
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
      res.locals.timScope=scope;res.setHeader('Cache-Control','no-store');next();
    }catch(err){console.error('[TIM] auth',errorMessage(err));return res.status(500).json({error:'Não foi possível validar a sessão TIM.'});}
  }
  // Atomic sync across all 3 datasets; repeated calls replace, never add duplicate rows.
  router.post('/sync',async(req,res)=>{
    const expected=String(process.env.TIM_SYNC_TOKEN||'');
    if(expected.length<32)return res.status(503).json({error:'TIM_SYNC_TOKEN não configurado no backend (mínimo 32 caracteres).'});
    if(!secureEq(expected,bearer(req)))return res.status(401).json({error:'Chave de sincronização inválida.'});
    const payload=req.body;
    let data:Record<Kind,Row[]>;
    try{
      if(payload?.version!==1||typeof payload.digest!=='string'||!/^[a-f0-9]{64}$/.test(payload.digest)||!payload.rows)throw new Error('Formato de carga inválido (versão 1).');
      data={sales:validatedRows('sales',payload.rows.sales),services:validatedRows('services',payload.rows.services),stock:validatedRows('stock',payload.rows.stock)};
    }catch(err){return res.status(400).json({error:errorMessage(err)});}
    let db:DB|undefined;let begun=false;
    try{
      db=await connect();await db.exec('BEGIN IMMEDIATE');begun=true;
      // A successful retry is a no-op only if it is still the latest snapshot.
      const latest=await db.get<{digest:string;summary:string}>('SELECT digest, summary FROM tim_imports ORDER BY rowid DESC LIMIT 1');
      if (latest && latest.digest === payload.digest) {
          await db.exec('COMMIT');
          begun = false;

          return res.json({
              ok: true,
              replayed: true,
              ...JSON.parse(latest.summary)
          });
      }
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
      await db.run('INSERT OR REPLACE INTO tim_imports VALUES (?,?,?,?)',payload.digest,String(payload.source||'Excel TIM').slice(0,250),now,JSON.stringify(summary));
      await db.exec('COMMIT');begun=false;return res.json({ok:true,...summary});
    }catch(err){if(begun&&db)await db.exec('ROLLBACK').catch(()=>undefined);console.error('[TIM] sync',errorMessage(err));return res.status(errorMessage(err).includes('cobre menos dias')?409:500).json({error:errorMessage(err).includes('cobre menos dias')?errorMessage(err):'Falha de sincronização. Nenhum dado TIM foi substituído.'});}
    finally{if(db)await db.close().catch(()=>undefined);}
  });
  router.use(readAuth);
  router.get('/metadata',async(_req,res)=>{
    let db:DB|undefined;
    try{
      db=await connect();await db.exec('BEGIN');const scope:Scope=res.locals.timScope, w=scopeWhere(scope);
      const datasets:Record<string,unknown>={};
      const storeSet=new Set<string>();
      for(const kind of KINDS){
        const t=table(kind);const stores=await db.all<{store:string}[]>(`SELECT DISTINCT store FROM ${t} WHERE ${w.sql} ORDER BY store`,...w.args);
        stores.forEach(r=>storeSet.add(r.store));
        const periods=kind==='stock'?[]:await db.all(`SELECT substr(date,1,7) AS month,MIN(date) AS first,MAX(date) AS last,COUNT(*) AS records FROM ${t} WHERE ${w.sql} GROUP BY month ORDER BY month DESC`,...w.args);
        const options:Record<string,string[]>={};
        for(const col of (kind==='stock'?['area','category','brand','deposit']:kind==='sales'?['area','category','coordinator','seller']:['area','category','status','seller'])){
          const rows=await db.all<{name:string}[]>(`SELECT DISTINCT ${col} AS name FROM ${t} WHERE ${w.sql} AND ${col} IS NOT NULL AND ${col}<>'' ORDER BY name`,...w.args);options[col]=rows.map(r=>r.name);
        }
        datasets[kind]={periods,stores:stores.map(r=>r.store),options};
      }
      const stamp=await db.get<{created_at:string}>('SELECT created_at FROM tim_imports ORDER BY rowid DESC LIMIT 1');const stockStamp=await db.get<{imported_at:string}>("SELECT imported_at FROM tim_partitions WHERE dataset='stock' AND month='snapshot'");await db.exec('COMMIT');
      return res.json({updated_at:stamp?.created_at??null,stock_updated_at:stockStamp?.imported_at??null,scope:scope.network?'network':'stores',stores:[...storeSet].sort(),datasets});
    }catch(err){console.error('[TIM] metadata',errorMessage(err));return res.status(500).json({error:'Falha ao consultar cadastros da TIM.'});}
    finally{if(db)await db.close().catch(()=>undefined);}
  });
  router.get('/report',async(req,res)=>{
    let db:DB|undefined;
    const kind=q(req,'kind') as Kind;if(!KINDS.includes(kind))return res.status(400).json({error:'Relatório inválido.'});
    const scope:Scope=res.locals.timScope,w=scopeWhere(scope),where=[w.sql],args:Scalar[]=[...w.args];
    const from=q(req,'from'),to=q(req,'to');
    if(kind!=='stock'&&((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to)))return res.status(400).json({error:'Período inválido.'});
    if(kind!=='stock'&&from){where.push('date>=?');args.push(from);}if(kind!=='stock'&&to){where.push('date<=?');args.push(to);}
    const allowed=kind==='sales'?['store','area','category','seller','coordinator']:kind==='services'?['store','area','category','seller','status']:['store','area','category','brand','deposit'];
    for(const col of allowed){const v=q(req,col);if(v){where.push(`${col}=?`);args.push(v);}}
    if(kind!=='stock'&&q(req,'liquid')==='true'){where.push("liquid_status='OK'");}
    if(kind==='stock'&&q(req,'available')==='true'){where.push('available=1');}
    const search=q(req,'search');if(search){const cols=kind==='sales'?['store','seller','product','model','product_code','order_id']:kind==='services'?['store','seller','plan','modality']:['store','product','model','product_code','deposit'];where.push(`(${cols.map(c=>`instr(upper(COALESCE(${c},'')),upper(?))>0`).join(' OR ')})`);args.push(...cols.map(()=>search));}
    const clause=where.join(' AND '), t=table(kind), metric=METRICS[kind], primary=PRIMARY[kind];
    try{
      db=await connect();await db.exec('BEGIN');
      const revision=(await db.get<{digest:string}>('SELECT digest FROM tim_imports ORDER BY rowid DESC LIMIT 1'))?.digest??'';
      if(q(req,'revision')&&q(req,'revision')!==revision){await db.exec('ROLLBACK');return res.status(409).json({error:'A base TIM foi atualizada durante a exportação. Execute a exportação novamente.'});}
      const summary=await db.get<Record<string,number|null>>(`SELECT ${metric} FROM ${t} WHERE ${clause}`,...args);
      const group=async(col:string,limit=100)=>db!.all(`SELECT ${col} AS name, ${metric} FROM ${t} WHERE ${clause} GROUP BY ${col} ORDER BY ${primary} DESC, name LIMIT ${limit}`,...args);
      const groups:Record<string,unknown>={};
      if(q(req,'detailsOnly')!=='true'){
        groups.stores=await group('store',500);groups.categories=await group('category',500);groups.areas=await group('area',100);
        if(kind!=='stock'){
          groups.sellers=await db.all(`SELECT seller AS name,store,${metric} FROM ${t} WHERE ${clause} GROUP BY seller,store ORDER BY ${primary} DESC,name LIMIT 500`,...args);
          groups.daily=await db.all(`SELECT date AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY date ORDER BY date`,...args);
          groups.monthly=await db.all(`SELECT substr(date,1,7) AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY name ORDER BY name`,...args);
          groups.matrix=await db.all(`SELECT store AS name,substr(date,1,7) AS month,${metric} FROM ${t} WHERE ${clause} GROUP BY store,month ORDER BY store,month`,...args);
        }
        if(kind==='sales'){groups.products=await group("COALESCE(NULLIF(model,''),product)",150);groups.modalities=await group('modality',150);groups.coordinators=await group('coordinator',100);}
        if(kind==='services'){groups.plans=await group('plan',200);groups.statuses=await group('status',100);groups.modalities=await group('modality',200);}
        if(kind==='stock'){groups.products=await db.all(`SELECT product_code AS code,MAX(model) AS name,${metric} FROM ${t} WHERE ${clause} GROUP BY product_code ORDER BY ${primary} DESC LIMIT 250`,...args);groups.deposits=await group('deposit',250);groups.brands=await group('brand',100);}
      }
      const size=Math.min(200,Math.max(10,Number.parseInt(q(req,'size')||'50',10)||50));
      const total=Number(summary?.records||0),page=Math.min(Math.max(1,Math.ceil(total/size)),Math.max(1,Number.parseInt(q(req,'page')||'1',10)||1));
      const cols=fields(kind).filter(s=>!['source_row'].includes(s));
      const rows=await db.all(`SELECT ${cols.join(',')} FROM ${t} WHERE ${clause} ORDER BY ${kind==='stock'?'store,product_code,id':'date DESC,id DESC'} LIMIT ? OFFSET ?`,...args,size,(page-1)*size);
      // Actual scoped coverage, independent of category/filial filters; absent month is not zero.
      const periods=kind==='stock'?[]:await db.all(`SELECT substr(date,1,7) AS month,MIN(date) AS first,MAX(date) AS last,COUNT(*) AS records FROM ${t} WHERE ${w.sql} GROUP BY month ORDER BY month`,...w.args);
      await db.exec('COMMIT');return res.json({kind,summary,groups,periods,rows,total,page,size,revision});
    }catch(err){console.error('[TIM] report',errorMessage(err));return res.status(500).json({error:'Não foi possível gerar o relatório TIM.'});}
    finally{if(db)await db.close().catch(()=>undefined);}
  });
  return router;
}
