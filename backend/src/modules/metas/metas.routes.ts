import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';

type Params = {
  prisma: PrismaClient;
  globalDbPath: string;
  annualDbPath: string;
  getCnpjByName: (name: string) => string | null;
  getAllowedStoreNames: (user: any) => string[];
  hasNetworkScope: (user: any) => boolean;
  knownStores: Record<string, string>;
};

type Goal = { region: string; uf: string; store: string; cnpj: string; group: 'APARELHOS' | 'ACESSORIOS' | 'SEGUROS'; month: number; value: number };
type Sale = { cnpj: string; month: number; group: Goal['group']; amount: number };
const SHEET_ID = process.env.METAS_SHEET_ID || '13wrw-1DPo0O5tXpT0xK3S5tBmwGC3IUa_nSkCZ_4grc';
const SHEET_TAB = process.env.METAS_SHEET_TAB || 'META';
const CACHE_MS = 5 * 60 * 1000;
let cached: { goals: Goal[]; warnings: string[]; at: number } | null = null;
let inFlight: Promise<{ goals: Goal[]; warnings: string[]; at: number }> | null = null;

function norm(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function numeric(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let str = String(v ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (str.includes(',') && str.includes('.')) str = str.replace(/\./g, '').replace(',', '.');
  else if (str.includes(',')) str = str.replace(',', '.');
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const monthNames = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
function normalizeStore(v: string): string {
  const n = norm(v);
  const aliases: Record<string, string> = {
    'CNB SHOPPING': 'CONJUNTO NACIONAL',
    'CNB QUIOSQUE': 'CONJUNTO NACIONAL QUIOSQUE',
    'UBERLANDIA SHOPPING': 'UBERLANDIA SHOPPING',
    'TERRACO SHOPPING': 'TERRACO SHOPPING',
  };
  return aliases[n] || n;
}
function classify(category: unknown, description?: unknown): Goal['group'] | null {
  let c = norm(category);
  // Usar descrição somente quando o campo categoria está vazio / genérico.
  if (!c || c === 'OUTROS' || c === 'NAO INFORMADO') c = norm(description);
  if (/SEGURO|PROTECAO|GARANTIA/.test(c)) return 'SEGUROS';
  if (/ACESSOR|CAPA\b|PELICULA|CARREGADOR|CABO\b|FONE\b|BUDS/.test(c)) return 'ACESSORIOS';
  if (/APARELHO|SMARTPHONE|CELULAR|TELEFONE|WEARABLE|RELOGIO|WATCH|TABLET|NOTEBOOK|LAPTOP|COMPUTADOR|GALAXY TAB/.test(c)) return 'APARELHOS';
  return null;
}
function parseGoals(matrix: unknown[][], ctx: Params): { goals: Goal[]; warnings: string[]; at: number } {
  if (matrix.length < 2) throw new Error('Aba META sem linhas de metas.');
  const cols = (matrix[0] || []).map(norm);
  const pos = (name: string) => cols.indexOf(name);
  const required = ['REGIAO', 'UF', 'LOJA', 'CATEGORIA', ...monthNames];
  for (const name of required) if (pos(name) < 0) throw new Error(`Coluna obrigatória ausente na aba META: ${name}`);
  const goals = new Map<string, Goal>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [index, cells] of matrix.slice(1).entries()) {
    const region = norm(cells[pos('REGIAO')]);
    const uf = norm(cells[pos('UF')]);
    const store = String(cells[pos('LOJA')] || '').trim();
    const rawCategory = norm(cells[pos('CATEGORIA')]);
    if (!store || !rawCategory) continue;
    const cnpj = ctx.getCnpjByName(store);
    if (!cnpj) { warnings.push(`META linha ${index + 2}: loja não reconhecida (${store}); ignorada para evitar associação incorreta.`); continue; }
    const categoryMap: Record<string, Goal['group']> = { APARELHO: 'APARELHOS', WEARABLE: 'APARELHOS', ACESSORIO: 'ACESSORIOS', SEGURO: 'SEGUROS' };
    const group = categoryMap[rawCategory];
    if (!group) { warnings.push(`META linha ${index + 2}: categoria desconhecida (${rawCategory}).`); continue; }
    const unique = `${cnpj}|${rawCategory}`;
    if (seen.has(unique)) throw new Error(`Meta duplicada para ${store} / ${rawCategory}; corrija a planilha.`);
    seen.add(unique);
    for (let m = 1; m <= 12; m++) {
      const cell = cells[pos(monthNames[m-1]!)];
      if (cell === null || cell === undefined || String(cell).trim() === '') {
        warnings.push(`META linha ${index + 2}: ${monthNames[m-1]} vazio; lançado como zero.`);
      }
      const value = numeric(cell);
      if (value < 0) throw new Error(`Meta negativa inválida: ${store} / ${rawCategory} / mês ${m}.`);
      const key = `${cnpj}|${group}|${m}`;
      const old = goals.get(key);
      goals.set(key, { region, uf, store: normalizeStore(store), cnpj, group, month: m, value: value + (old?.value || 0) });
    }
  }
  if (!goals.size) throw new Error('Nenhuma meta válida encontrada no Sheets.');
  return { goals: [...goals.values()], warnings: warnings.slice(0, 40), at: Date.now() };
}
// O mesmo caminho inicial utilizado pela Base Mestre: CSV da aba primeiro.
// Quando a planilha e privada, os dois enderecos CSV podem ser recusados pelo Google.
// Nesse caso, usa uma conta de servico (se configurada) ou o OAuth existente.
function csvToMatrix(csv: string): unknown[][] {
  const start = csv.replace(/^\uFEFF/, '').trimStart();
  if (!start) throw new Error('CSV vazio.');
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(start)) {
    throw new Error('Google devolveu HTML em vez de CSV (planilha sem acesso anonimo).');
  }

  const workbook = XLSX.read(csv, { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0] || ''];
  if (!sheet) throw new Error('Nao foi possivel interpretar o CSV do Google Sheets.');

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  }) as unknown[][];
}

async function readViaCsv(url: string): Promise<unknown[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 8_000_000) throw new Error('CSV ultrapassou 8 MB.');
    return csvToMatrix(text);
  } finally {
    clearTimeout(timer);
  }
}

async function readViaServiceAccount(): Promise<unknown[][]> {
  const credentialJson = process.env.METAS_GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!credentialJson) throw new Error('Conta de servico nao configurada.');

  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(credentialJson) as Record<string, string>;
  } catch {
    throw new Error('METAS_GOOGLE_SERVICE_ACCOUNT_JSON nao contem JSON valido.');
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Conta de servico sem client_email ou private_key.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_TAB.replace(/'/g, "''")}'!A1:P1000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (response.data.values || []) as unknown[][];
}

async function readViaOAuth(): Promise<unknown[][]> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Credenciais OAuth ausentes ou incompletas.');
  }
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: 'v4', auth: client });
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_TAB.replace(/'/g, "''")}'!A1:P1000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (result.data.values || []) as unknown[][];
}

async function loadGoals(ctx: Params) {
  const id = encodeURIComponent(SHEET_ID);
  const csvByName = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out%3Acsv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const gid = encodeURIComponent(process.env.METAS_SHEET_GID || '0');
  const csvByGid = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  const errors: string[] = [];

  const attempts: { label: string; load: () => Promise<unknown[][]> }[] = [
    { label: 'CSV por nome de aba', load: () => readViaCsv(csvByName) },
    { label: 'CSV por gid', load: () => readViaCsv(csvByGid) },
  ];
  if (process.env.METAS_GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    attempts.push({ label: 'Conta de servico Google', load: readViaServiceAccount });
  }
  attempts.push({ label: 'OAuth Google', load: readViaOAuth });

  for (const attempt of attempts) {
    try {
      const matrix = await attempt.load();
      const parsed = parseGoals(matrix, ctx);
      console.info(`[Metas] Aba ${SHEET_TAB} carregada usando ${attempt.label} (${parsed.goals.length} registros).`);
      return parsed;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.label}: ${message}`);
      console.warn(`[Metas] ${attempt.label} indisponivel: ${message}`);
    }
  }
  throw new Error(
    `Nao foi possivel ler a aba ${SHEET_TAB}. ${errors.join(' | ')}. ` +
    'Se a planilha for privada, compartilhe-a com a conta de servico configurada ' +
    '(METAS_GOOGLE_SERVICE_ACCOUNT_JSON) ou corrija a autenticacao OAuth. ' +
    'Nao e necessario publicar a planilha na Web.'
  );
}

async function readGoals(ctx: Params) {
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached, stale: false };
  if (!inFlight) {
    inFlight = loadGoals(ctx).finally(() => { inFlight = null; });
  }
  try {
    cached = await inFlight;
    return { ...cached, stale: false };
  } catch (error) {
    if (cached) {
      return { ...cached, stale: true, warnings: [...cached.warnings, 'Google Sheets indisponivel: exibindo ultimo cache valido.'] };
    }
    throw error;
  }
}
async function tableExists(db: any, name: string) {
  return Boolean((await db.get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', name]))?.name);
}
async function columns(db: any, name: string): Promise<Set<string>> {
  return new Set((await db.all(`PRAGMA table_info(${name})`)).map((r: any) => String(r.name)));
}
function rowToSale(row: any, ctx: Params): Sale | null {
  const cnpj = digits(row.cnpj_empresa) || digits(ctx.getCnpjByName(String(row.loja || '')));
  const month = Number(row.month);
  const group = classify(row.categoria, row.descricao);
  if (!cnpj || !group || month < 1 || month > 12) return null;
  return { cnpj, month, group, amount: numeric(row.valor) };
}
async function collectSales(year: number, allowedCnpjs: string[], ctx: Params, now: Date) {
  const result: Sale[] = [];
  const notes: string[] = [];
  const sources: Record<number, string> = {};
  if (!allowedCnpjs.length) return { result, notes, sources };
  const placeholders = allowedCnpjs.map(() => '?').join(',');
  const monthly = new Map<number, Sale[]>();
  if (fs.existsSync(ctx.globalDbPath)) {
    const db = await open({ filename: ctx.globalDbPath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
      if (await tableExists(db, 'vendas')) {
        const rs = await db.all(`SELECT CAST(substr(data_emissao,6,2) AS INTEGER) month, cnpj_empresa, familia categoria, descricao, SUM(COALESCE(total_liquido,0)) valor FROM vendas WHERE data_emissao >= ? AND data_emissao < ? AND REPLACE(REPLACE(cnpj_empresa,'.',''),'/','') IS NOT NULL AND cnpj_empresa IN (${placeholders}) GROUP BY 1,2,3,4`, [`${year}-01-01`, `${year+1}-01-01`, ...allowedCnpjs]);
        for (const r of rs) { const sale = rowToSale(r, ctx); if (sale) monthly.set(sale.month, [...(monthly.get(sale.month) || []), sale]); }
      }
    } finally { await db.close(); }
  }
  const yearly = new Map<number, Sale[]>();
  if (fs.existsSync(ctx.annualDbPath)) {
    const db = await open({ filename: ctx.annualDbPath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
      const hasRaw = await tableExists(db, 'vendas_anuais_raw');
      if (hasRaw) {
        const cs = await columns(db, 'vendas_anuais_raw');
        const amount = cs.has('total_real') ? 'COALESCE(total_real, total_liquido, 0)' : 'COALESCE(total_liquido,0)';
        const cat = cs.has('categoria_real') ? "COALESCE(NULLIF(categoria_real,''),categoria,'')" : "COALESCE(categoria,'')";
        const canceled = cs.has('cancelado') ? "AND (cancelado IS NULL OR UPPER(TRIM(CAST(cancelado AS TEXT))) NOT IN ('S','SIM','TRUE','1','CANCELADO','CANCELADA'))" : '';
        const rs = await db.all(`SELECT mes month, cnpj_empresa, ${cat} categoria, descricao, SUM(${amount}) valor FROM vendas_anuais_raw WHERE ano = ? AND cnpj_empresa IN (${placeholders}) ${canceled} GROUP BY 1,2,3,4`, [year, ...allowedCnpjs]);
        for (const r of rs) { const sale = rowToSale(r, ctx); if (sale) yearly.set(sale.month, [...(yearly.get(sale.month) || []), sale]); }
      } else if (await tableExists(db, 'vendas_anuais')) {
        const rs = await db.all(`SELECT CAST(substr(data_emissao,6,2) AS INTEGER) month, cnpj_empresa, familia categoria, descricao, SUM(COALESCE(total_liquido,0)) valor FROM vendas_anuais WHERE data_emissao >= ? AND data_emissao < ? AND cnpj_empresa IN (${placeholders}) GROUP BY 1,2,3,4`, [`${year}-01-01`, `${year+1}-01-01`, ...allowedCnpjs]);
        for (const r of rs) { const sale = rowToSale(r, ctx); if (sale) yearly.set(sale.month, [...(yearly.get(sale.month) || []), sale]); }
      }
      // Seguro anual separado é fonte preferencial APENAS quando existe valor.
      if (await tableExists(db, 'seguros_anuais')) {
        const cs = await columns(db, 'seguros_anuais');
        const val = ['premio_real','premio','valor','total_real','total_liquido'].find(c => cs.has(c));
        if (val) {
          const rs = await db.all(`SELECT mes month, cnpj_empresa, SUM(COALESCE(${val},0)) valor FROM seguros_anuais WHERE ano = ? AND cnpj_empresa IN (${placeholders}) GROUP BY mes,cnpj_empresa`, [year,...allowedCnpjs]);
          const sums = new Map<string, number>();
          for (const r of rs) { const key = `${r.month}|${digits(r.cnpj_empresa)}`; sums.set(key, numeric(r.valor)); }
          // Substitui seguro por loja/mês, sem somar duas fontes.
          for (const [m, sales] of yearly) {
            const patched = sales.filter(s => !(s.group === 'SEGUROS' && sums.has(`${m}|${s.cnpj}`)));
            for (const [key, amount] of sums) {
              const [mon, cnpj] = key.split('|');
              if (Number(mon) === m && amount !== 0) patched.push({ month:m, cnpj:cnpj!, group:'SEGUROS', amount });
            }
            yearly.set(m, patched);
          }
          for (const [key,amount] of sums) {
            const [mon, cnpj] = key.split('|'); const month = Number(mon);
            if (amount !== 0 && !yearly.has(month)) yearly.set(month, [{month,cnpj:cnpj!,group:'SEGUROS',amount}]);
          }
        }
      }
    } finally { await db.close(); }
  }
  const currentYear = now.getFullYear(); const currentMonth = now.getMonth()+1;
  for (let month=1;month<=12;month++) {
    const live = monthly.get(month) || [];
    const annual = yearly.get(month) || [];
    const preferLive = year === currentYear && month === currentMonth;
    const picked = preferLive ? (live.length ? live : annual) : (annual.length ? annual : live);
    sources[month] = picked === live && live.length ? 'mensal' : picked.length ? 'anual' : 'sem registros';
    result.push(...picked);
  }
  if (!result.length) notes.push('Nenhuma venda classificada encontrada nas fontes disponíveis para as lojas autorizadas.');
  const missing = Object.entries(sources).filter(([month,source]) => source === 'sem registros' && (year < currentYear || (year === currentYear && Number(month) <= currentMonth)));
  if (missing.length) notes.push(`Sem registros de venda em ${missing.map(([m]) => m).join(', ')}. Verifique a cobertura das sincronizações.`);
  return { result, notes, sources };
}

export function createMetasRoutes(ctx: Params) {
  const router = Router();
  router.get('/resumo', async (req, res) => {
    try {
      // Mesmo padrão de identificação das rotas atuais do TeleFluxo.
      // As permissões são obtidas do cadastro no banco, nunca do frontend.
      const id = String(req.query.userId || '').trim();
      if (!id || id === 'undefined' || id === 'null' || id.length > 128) {
        return res.status(401).json({ error: 'Usuário não identificado. Entre novamente no TeleFluxo.' });
      }
      const user = await ctx.prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(403).json({ error: 'Usuário não autorizado.' });
      const role = norm(user.role);
      const operation = norm(user.operation);
      if (operation === 'TIM' && !['CEO','DIRETOR','DIRETORIA'].includes(role)) return res.status(403).json({ error: 'Sem acesso às metas Samsung.' });
      const network = ctx.hasNetworkScope(user);
      const permitted = network ? Object.keys(ctx.knownStores) : ctx.getAllowedStoreNames(user).map(ctx.getCnpjByName).filter((v): v is string => Boolean(v));
      const cnpjs = [...new Set(permitted)];
      if (!cnpjs.length) return res.status(403).json({ error: 'Nenhuma loja autorizada encontrada no cadastro.' });
      const sheet = await readGoals(ctx);
      const year = Number(req.query.year || 2026);
      if (!Number.isInteger(year) || year !== 2026) return res.status(400).json({ error: 'O Sheets enviado possui somente metas do ano de 2026.' });
      const today = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}));
      const subset = sheet.goals.filter(g => cnpjs.includes(g.cnpj));
      const sales = await collectSales(year, [...new Set(subset.map(g=>g.cnpj))], ctx, today);
      const sold = new Map<string,number>();
      for (const row of sales.result) { const key = `${row.cnpj}|${row.group}|${row.month}`; sold.set(key,(sold.get(key)||0)+row.amount); }
      const months = subset.map(goal => {
        const actual = sold.get(`${goal.cnpj}|${goal.group}|${goal.month}`) || 0;
        return { ...goal, year, quarter: Math.ceil(goal.month / 3), half: goal.month <= 6 ? 1 : 2, actual, diff: actual-goal.value };
      });
      type Month = typeof months[number];
      const storeGroups = new Map<string,Month[]>();
      for (const m of months) { const key = `${m.cnpj}|${m.group}`; storeGroups.set(key,[...(storeGroups.get(key)||[]),m]); }
      const quarters: any[] = [];
      for (const [,entries] of storeGroups) {
        const initial = entries[0]!;
        let carry = 0;
        let carryKnown = true;
        for (let q=1;q<=4;q++) {
          const items = entries.filter(x=>x.quarter===q);
          const base = items.reduce((s,v)=>s+v.value,0);
          const actual = items.reduce((s,v)=>s+v.actual,0);
          const adjusted = base + carry;
          const finished = year < today.getFullYear() || (year === today.getFullYear() && q*3 < today.getMonth()+1);
          const hasCoverage = [q*3-2,q*3-1,q*3].every(month => sales.sources[month] !== 'sem registros');
          const closed = finished && hasCoverage && carryKnown;
          const pending = closed ? Math.max(0,adjusted-actual) : 0;
          const exceeded = closed ? Math.max(0,actual-adjusted) : 0;
          quarters.push({ year,quarter:q,region:initial.region,uf:initial.uf,store:initial.store,cnpj:initial.cnpj,group:initial.group,base,actual,carryIn:carry,adjusted,pending,exceeded,closed,hasCoverage,closureStatus:finished && !hasCoverage ? 'dados_incompletos' : closed ? 'fechado' : 'aberto',dueDate:`${year}-${String(q*3).padStart(2,'0')}-${q===1||q===4?'31':'30'}` });
          // Se faltar qualquer trimestre de origem, não inferimos saldos posteriores.
          if (finished && !hasCoverage) carryKnown = false;
          // Regra C: saldo não atingido aumenta a próxima meta; excedente é separado.
          carry = closed ? pending : 0;
        }
      }
      if (quarters.some(q => q.closureStatus === 'dados_incompletos')) sales.notes.push('Há trimestres encerrados sem cobertura completa das vendas. O saldo desses trimestres não foi transportado para evitar metas incorretas.');
      const quartersFiltered = quarters.sort((a,b)=> a.quarter-b.quarter || a.store.localeCompare(b.store));
      const summary = (items: any[], label: string) => ({
        label,
        base: items.reduce((v,i)=>v+i.base,0),
        actual: items.reduce((v,i)=>v+i.actual,0),
        adjusted: items.reduce((v,i)=>v+i.adjusted,0),
        carryIn: items.reduce((v,i)=>v+i.carryIn,0),
        pending: items.reduce((v,i)=>v+i.pending,0),
        exceeded: items.reduce((v,i)=>v+i.exceeded,0),
        reachedPercent: items.reduce((v,i)=>v+i.adjusted,0)>0?100*items.reduce((v,i)=>v+i.actual,0)/items.reduce((v,i)=>v+i.adjusted,0):0,
      });
      const currentQ = year === today.getFullYear() ? Math.ceil((today.getMonth()+1)/3) : year < today.getFullYear() ? 4 : 1;
      const currentItems = quartersFiltered.filter(q=>q.quarter===currentQ);
      const byStore = [...new Set(currentItems.map(q=>q.cnpj))].map(cnpj=>{
        const items=currentItems.filter(q=>q.cnpj===cnpj);
        return { cnpj,store:items[0]?.store,region:items[0]?.region,...summary(items,String(items[0]?.store||'')) };
      }).sort((a,b)=>b.reachedPercent-a.reachedPercent);
      const byRegion = [...new Set(currentItems.map(q=>q.region))].map(region=>({ region, ...summary(currentItems.filter(q=>q.region===region),region) }));
      const byGroup = ['APARELHOS','ACESSORIOS','SEGUROS'].map(group=>({ group,...summary(currentItems.filter(q=>q.group===group),group) }));
      return res.json({ success:true,scope:network?'network':'stores',year,currentQuarter:currentQ,generatedAt:new Date().toISOString(),sheetUpdatedAt:new Date(sheet.at).toISOString(),sheetStale:sheet.stale,sourceByMonth:sales.sources,notes:[...(network ? sheet.warnings : []),...sales.notes],months,quarters:quartersFiltered,byStore,byRegion,byGroup,current:summary(currentItems,'Trimestre atual'),access:{ canCompareStores:network || cnpjs.length>1,stores:byStore.length } });
    } catch (err: any) {
      console.error('[Metas] Falha ao gerar resumo:', err?.message);
      return res.status(503).json({ success:false, error:'Não foi possível carregar metas ou vendas. Verifique o acesso do Google Sheets e as fontes de dados.' });
    }
  });
  return router;
}
