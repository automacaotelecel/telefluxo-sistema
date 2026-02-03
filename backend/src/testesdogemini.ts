import express, { Request, Response } from 'express';
import cors from 'cors'; 
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import crypto from 'crypto'; 
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import path from 'path';

const ROOT_DIR = process.cwd(); 
const GLOBAL_DB_PATH = path.join(ROOT_DIR, 'database', 'samsung_vendas.db');

// Cria a pasta automaticamente se não existir
if (!fs.existsSync(path.join(ROOT_DIR, 'database'))) {
    try { fs.mkdirSync(path.join(ROOT_DIR, 'database')); } catch(e) {}
}

// --- INICIALIZAÇÃO DO BANCO GLOBAL (SQLITE) ---
const dbInit = new sqlite3.Database(GLOBAL_DB_PATH);
dbInit.serialize(() => {
    dbInit.run(`CREATE TABLE IF NOT EXISTS vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, data_emissao TEXT, nome_vendedor TEXT, descricao TEXT,
        quantidade REAL, total_liquido REAL, cnpj_empresa TEXT, familia TEXT, regiao TEXT
    )`);
    dbInit.run(`CREATE TABLE IF NOT EXISTS vendedores_kpi (
        id INTEGER PRIMARY KEY AUTOINCREMENT, loja TEXT, vendedor TEXT, fat_atual REAL, tendencia REAL,
        fat_anterior REAL, crescimento REAL, seguros REAL, pa REAL, qtd REAL, ticket REAL, regiao TEXT, pct_seguro REAL
    )`);
    console.log("📦 Tabelas do Banco de Dados Garantidas!");
})

const app = express();
const prisma = new PrismaClient();

let writeQueue = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 1. SISTEMA DE LOGIN & USUÁRIOS
// ==========================================

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email: String(email).trim() }, include: { manager: true, staff: true } });
        if (!user) return res.status(401).json({ error: "Usuário não encontrado." });

        const isPasswordValid = await bcrypt.compare(String(password).trim(), user.password);
        const isOldPasswordValid = user.password === String(password).trim();

        if (isPasswordValid || isOldPasswordValid) {
            const { password: _, ...userWithoutPassword } = user;
            res.json(userWithoutPassword);
        } else {
            res.status(401).json({ error: "Senha incorreta." });
        }
    } catch (e) { res.status(500).json({ error: "Erro no servidor." }); }
});

app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ include: { manager: true, staff: true }, orderBy: { name: 'asc' } });
        const safeUsers = users.map(user => { const { password, ...u } = user; return u; });
        res.json(safeUsers);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar equipe" }); }
});

app.post('/users', async (req, res) => {
    const { name, email, password, role, department, operation, isAdmin, managerId, allowedStores } = req.body;
    try {
        const id = crypto.randomUUID(); 
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");
        const passwordHash = await bcrypt.hash(String(password), 10);
        await prisma.$executeRawUnsafe(
            `INSERT INTO User (id, name, email, password, role, department, operation, isAdmin, status, managerId, allowedStores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            id, String(name), String(email).trim(), passwordHash, String(role), String(department), operation || "Outros", isAdmin ? 1 : 0, managerId || null, storesValue
        );
        res.status(201).json({ id, name, message: "Criado com sucesso" });
    } catch (e) { res.status(500).json({ error: "Erro ao criar usuário." }); }
});

app.put('/users/:id', async (req, res) => {
    const { name, email, role, department, operation, isAdmin, managerId, password, allowedStores } = req.body;
    const userId = req.params.id;
    try {
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");
        if (password && password.trim() !== "") {
            const passwordHash = await bcrypt.hash(String(password), 10);
            await prisma.$executeRawUnsafe(`UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=?, password=?, allowedStores=? WHERE id=?`, name, email, role, department, operation || "Outros", isAdmin ? 1 : 0, managerId || null, passwordHash, storesValue, userId);
        } else {
            await prisma.$executeRawUnsafe(`UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=?, allowedStores=? WHERE id=?`, name, email, role, department, operation || "Outros", isAdmin ? 1 : 0, managerId || null, storesValue, userId);
        }
        const updated = await prisma.user.findUnique({ where: { id: userId } });
        if (updated) { const { password: _, ...u } = updated; res.json(u); } else { res.json(null); }
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar usuário." }); }
});

app.delete('/users/:id', async (req, res) => {
    try { await prisma.user.delete({ where: { id: req.params.id } }); res.json({ message: "Usuário removido" }); } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

// ==========================================
// 2. GESTÃO DE TAREFAS (DEMANDAS)
// ==========================================

app.get('/tasks', async (req, res) => {
    const { user: userName, viewMode } = req.query;
    const mode = String(viewMode);
    try {
        const currentUser = await prisma.user.findFirst({ where: { name: String(userName) }, include: { staff: true } });
        if (!currentUser) return res.json([]);
        const allUsers: any = await prisma.$queryRawUnsafe(`SELECT name, operation FROM User`);
        const myOp = currentUser.operation || "Outros";
        const tasks = await prisma.task.findMany({ include: { history: true, subTasks: true }, orderBy: { createdAt: 'desc' } });
        
        const tasksWithOp = tasks.map((task: any) => {
            const resp = allUsers.find((u: any) => u.name === task.user);
            const firstHist = task.history.find((h:any) => h.text.includes("Iniciou")) || task.history[0];
            const creator = allUsers.find((u: any) => u.name === (firstHist ? firstHist.user : ""));
            return { ...task, operation: resp?.operation || "Outros", creatorOperation: creator?.operation || "Outros" };
        });

        const filtered = tasksWithOp.filter(task => {
            if (currentUser.isAdmin) return true;
            const isMine = task.user === userName;
            const iPart = task.history.some((h:any) => h.user === userName);
            const myScope = task.operation === myOp || task.creatorOperation === myOp;
            if (mode.startsWith('mine_')) return isMine || (task.creatorOperation === myOp && task.history[0].user === userName);
            return isMine || iPart || myScope;
        });

        const final = filtered.filter(task => {
            if (mode === 'completed' || mode === 'all') return true;
            if (mode.endsWith('_pending')) return task.status === 'pending';
            if (mode.endsWith('_doing')) return task.status === 'doing';
            if (mode.endsWith('_done')) return task.status === 'done';
            return task.status !== 'done';
        });
        res.json(final);
    } catch (e) { res.status(500).json({ error: "Erro tarefas" }); }
});

app.get('/tasks/:id', async (req, res) => {
    try { const task = await prisma.task.findUnique({ where: { id: req.params.id }, include: { history: true, subTasks: true } }); res.json(task); } catch (e) { res.status(500).json({ error: "Erro tarefa" }); }
});

app.post('/tasks', upload.single('file'), async (req: any, res: Response) => {
    const { title, responsible, priority, deadline, creatorName, description, source, parentId } = req.body;
    const file = req.file;
    try {
        const history: any[] = [{ user: String(creatorName), text: "Iniciou o fluxo", type: "system", date: new Date().toLocaleString() }];
        if (description && description.trim()) history.push({ user: String(creatorName), text: String(description), type: "message", date: new Date().toLocaleString() });
        if (file) history.push({ user: String(creatorName), text: `Anexou: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `http://172.34.0.47:3000/uploads/${file.filename}`, date: new Date().toLocaleString() });
        
        const newTask = await prisma.task.create({
            data: { id: `TASK-${Date.now()}`, title: String(title), user: String(responsible), status: "pending", priority: String(priority), deadline: String(deadline), source: source || "Rotina", parentId: parentId || null, history: { create: history } }
        });
        const target = await prisma.user.findFirst({ where: { name: String(responsible) } });
        if (target) await prisma.notification.create({ data: { userId: target.id, text: `Nova demanda: ${title}` } });
        res.status(201).json(newTask);
    } catch (e) { res.status(500).json({ error: "Erro create task" }); }
});

app.put('/tasks/:id', async (req, res) => {
    const { status, user, comment, currentUser, actionType } = req.body;
    try {
        const current = await prisma.task.findUnique({ where: { id: req.params.id }, include: { subTasks: true } });
        if (status === 'done' && current?.subTasks.some(t => t.status !== 'done')) return res.status(400).json({ error: "Subtarefas pendentes." });
        
        let txt = comment;
        if (actionType === 'start_progress') txt = "Iniciou a tratativa.";
        if (actionType === 'finish') txt = comment || "Finalizou.";
        
        const updated = await prisma.task.update({ where: { id: req.params.id }, data: { status: status || undefined, user: user || undefined, history: { create: { user: currentUser, text: txt || `Ação: ${actionType}`, type: 'message', date: new Date().toLocaleString() } } } });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro update task" }); }
});

app.post('/tasks/:id/upload', upload.single('file'), async (req: any, res: Response) => {
    const { currentUser } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Sem arquivo" });
    try {
        await prisma.task.update({ where: { id: req.params.id }, data: { history: { create: { user: currentUser, text: `Anexou: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `http://172.34.0.47:3000/uploads/${file.filename}`, date: new Date().toLocaleString() } } } });
        res.json({ message: "OK" });
    } catch (e) { res.status(500).json({ error: "Erro upload" }); }
});

app.delete('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.task.updateMany({ where: { parentId: id }, data: { parentId: null } });
        await prisma.task.delete({ where: { id } });
        res.json({ message: "Excluída." });
    } catch (e) { res.status(500).json({ error: "Erro delete task" }); }
});

// ==========================================
// 3. IMPORTAÇÃO DE PAGAMENTOS (CSV)
// ==========================================
app.post('/import-payments', upload.single('file'), async (req: any, res: Response) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Sem arquivo." });
    const results: any[] = [];
    const created: any[] = [];
    const convDate = (d:any) => { if(!d) return new Date().toISOString().substring(0,10); const s=String(d).trim(); if(s.includes('-')) return s; const p=s.split('/'); if(p.length===3) return `${p[2]}-${p[1]}-${p[0]}`; return s; };

    fs.createReadStream(file.path).pipe(csv({ separator: ';' })).on('data', (d) => results.push(d)).on('end', async () => {
        try {
            for (const r of results) {
                const title = `💰 ${r.Titulo||r.titulo} - R$ ${r.Valor||r.valor}`;
                const user = await prisma.user.findFirst({ where: { name: String(r.Responsavel||r.responsavel).trim() } });
                const newTask = await prisma.task.create({
                    data: { id: `TASK-${Date.now()}-${Math.floor(Math.random()*1000)}`, title, user: user?.name||"Andre", status: "pending", priority: "Alta", deadline: convDate(r.Vencimento||r.vencimento), source: "Planilha Recorrente", history: { create: [{ user: "Sistema", text: `Origem: ${r.Origem||r.origem}`, type: "system", date: new Date().toLocaleString() }] } }
                });
                created.push(newTask);
                if (user) await prisma.notification.create({ data: { userId: user.id, text: `Novo pagamento: ${title}` } });
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
            res.json({ message: "Importação OK", total: created.length });
        } catch (e:any) { res.status(500).json({ error: e.message }); }
    });
});

// ==========================================
// 4. NOTIFICAÇÕES, AGENDA, STATS, AVISOS
// ==========================================

app.get('/notifications', async (req, res) => {
    try { res.json(await prisma.notification.findMany({ where: { userId: String(req.query.userId), read: false } as any })); } catch(e) { res.json([]); }
});

app.get('/agenda', async (req, res) => {
    try { res.json(await prisma.agendaEvent.findMany({ where: { userId: String(req.query.userId), date: String(req.query.date) } })); } catch(e) { res.json([]); }
});
app.post('/agenda', async (req, res) => {
    try { res.json(await prisma.agendaEvent.create({ data: { userId: req.body.userId, title: req.body.title, date: req.body.date } })); } catch(e) { res.status(500).json({ error: "Erro" }); }
});
app.put('/agenda/:id', async (req, res) => {
    try { res.json(await prisma.agendaEvent.update({ where: { id: req.params.id }, data: { completed: req.body.completed } })); } catch(e) { res.status(500).json({ error: "Erro" }); }
});
app.delete('/agenda/:id', async (req, res) => {
    try { await prisma.agendaEvent.delete({ where: { id: req.params.id } }); res.json({ success: true }); } catch(e) { res.status(500).json({ error: "Erro" }); }
});

app.get('/manager-stats', async (req, res) => {
    const { managerName } = req.query;
    try {
        const current = await prisma.user.findFirst({ where: { name: String(managerName) }, include: { staff: true } });
        if (!current) return res.json([]);
        let users: string[] = [];
        if (current.isAdmin) users = (await prisma.user.findMany()).map(u=>u.name);
        else if (current.staff.length > 0) users = current.staff.map(u=>u.name);
        else return res.json([]);
        
        const tasks = await prisma.task.findMany({ where: { user: { in: users } } });
        const report = users.map(u => {
            const userTasks = tasks.filter(t => t.user === u);
            const done = userTasks.filter(t => t.status === 'done').length;
            const total = userTasks.length;
            return { name: u, total, done, efficiency: total > 0 ? Math.round((done/total)*100) : 0 };
        });
        res.json(report.sort((a,b)=>b.done-a.done));
    } catch (e) { res.status(500).json({ error: "Erro stats" }); }
});

app.get('/announcements', async (req, res) => {
    try { res.json(await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })); } catch (e) { res.status(500).json({ error: "Erro avisos" }); }
});
app.post('/announcements', async (req, res) => {
    try { res.json(await prisma.announcement.create({ data: req.body })); } catch (e) { res.status(500).json({ error: "Erro criar aviso" }); }
});
app.delete('/announcements/:id', async (req, res) => {
    try { await prisma.announcement.delete({ where: { id: req.params.id } }); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

app.get('/dept-messages/:dept', async (req, res) => {
    try { res.json(await prisma.deptMessage.findMany({ where: { department: req.params.dept }, orderBy: { createdAt: 'asc' } })); } catch (e) { res.status(500).json({ error: "Erro msg" }); }
});
app.post('/dept-messages', async (req, res) => {
    try { res.json(await prisma.deptMessage.create({ data: req.body })); } catch (e) { res.status(500).json({ error: "Erro enviar" }); }
});

// ==========================================
// 5. FINANCEIRO E ESTOQUE
// ==========================================

app.get('/finance', async (req, res) => {
    try {
        const page = Number(req.query.page)||1; const limit = Number(req.query.limit)||50; const skip=(page-1)*limit;
        const where = { type: String(req.query.type || 'EXPENSE') };
        const [total, items] = await Promise.all([prisma.finance.count({where}), prisma.finance.findMany({where, skip, take:limit, orderBy:{dueDate:'asc'}})]);
        res.json({ data: items, total, totalPages: Math.ceil(total/limit), currentPage: page });
    } catch(e) { res.status(500).json({ error: "Erro financeiro" }); }
});

app.post('/finance', async (req, res) => {
    const { supplier, description, category, unit, value, issueDate, dueDate, installments, isRecurring } = req.body;
    try {
        const groupId = crypto.randomUUID(); const entries = []; const baseDate = new Date(dueDate); const loops = isRecurring ? 12 : (parseInt(installments)||1);
        for(let i=0; i<loops; i++) {
            const d = new Date(baseDate); d.setMonth(baseDate.getMonth()+i);
            entries.push({ supplier, description: isRecurring ? `${description} (Recorrente)` : `${description} (${i+1}/${loops})`, category, unit, value: parseFloat(value), issueDate: new Date(issueDate), dueDate: d, isRecurring: !!isRecurring, totalInstallments: loops, currentInstallment: i+1, groupId });
        }
        await prisma.finance.createMany({ data: entries });
        res.json({ message: "Sucesso" });
    } catch(e) { res.status(500).json({ error: "Erro gerar títulos" }); }
});

app.post('/finance/import', upload.single('file'), async (req: any, res: Response) => {
    const file = req.file; if(!file) return res.status(400).json({ error: "Sem arquivo" });
    const type = req.body.type || 'EXPENSE';
    try {
        const wb = XLSX.readFile(file.path); const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
        let hIdx = data.findIndex(r => JSON.stringify(r).toUpperCase().includes("VALOR"));
        if(hIdx === -1) throw new Error("Sem coluna VALOR");
        const headers = data[hIdx].map((h:any) => String(h).trim().toUpperCase());
        const rows = data.slice(hIdx+1).map((r:any) => {
            const d:any = {}; headers.forEach((h,i) => d[h]=r[i]);
            return {
                supplier: String(d['FORNECEDOR']||d['CLIENTE']||'N/A').toUpperCase(), description: String(d['DESCRIÇÃO']||''), category: String(d['TIPO']||(type==='INCOME'?'VENDAS':'GERAL')), unit: 'Matriz',
                value: parseFloat(String(d['VALOR']).replace(/[^\d.-]/g,''))||0, issueDate: new Date(), dueDate: new Date(), status: 'PENDENTE', type
            };
        }).filter(d => d.value > 0);
        if(rows.length) await prisma.finance.createMany({ data: rows });
        try { fs.unlinkSync(file.path); } catch(e) {}
        res.json({ message: "OK" });
    } catch(e:any) { res.status(500).json({ error: e.message }); }
});

app.delete('/finance/:id', async (req, res) => { try { await prisma.finance.delete({ where: { id: req.params.id } }); res.json({ message: "OK" }); } catch(e) { res.status(500).json({ error: "Erro" }); } });
app.delete('/finance/all', async (req, res) => { try { await prisma.finance.deleteMany({}); res.json({ message: "Reset OK" }); } catch(e) { res.status(500).json({ error: "Erro" }); } });
app.put('/finance/:id/status', async (req, res) => { try { res.json(await prisma.finance.update({ where: { id: req.params.id }, data: { status: req.body.status } })); } catch(e) { res.status(500).json({ error: "Erro" }); } });

app.get('/stock', async (req, res) => { try { res.json(await prisma.stock.findMany()); } catch(e) { res.status(500).json({ error: "Erro estoque" }); } });
app.post('/stock/sync', async (req, res) => {
    const data = req.body; if (!Array.isArray(data)) return res.status(400).json({ error: "Array esperado" });
    try {
        await prisma.stock.deleteMany();
        const fmt = data.map((i:any) => ({ cnpj: String(i.CNPJ_ORIGEM||""), storeName: String(i.NOME_FANTASIA||"LOJA"), productCode: String(i.CODIGO_PRODUTO||""), description: String(i.DESCRICAO||""), quantity: Number(i.QUANTIDADE)||0, costPrice: Number(i.PRECO_CUSTO)||0 }));
        await prisma.stock.createMany({ data: fmt });
        res.json({ success: true });
    } catch(e:any) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 6. BI DE VENDAS (SEGURANÇA BLINDADA) 🛡️
// ==========================================

const LOJAS_MAP_GLOBAL: Record<string, string> = {
    "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING", "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL", "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
    "12309173000507": "GOIANIA SHOPPING", "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING", "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING", "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING", "12309173001813": "UBERABA SHOPPING",
    "12309173001570": "FLAMBOYANT SHOPPING", "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS", "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS", "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING", "12309173002976": "IGUATEMI FORTALEZA",
    "12309173001066": "CD TAGUATINGA"
};

// LISTA DE CORREÇÃO MANUAL
const CORRECAO_NOMES_SERVER: Record<string, string> = {
    "UBERABA": "UBERABA SHOPPING", "UBERLÂNDIA": "UBERLÂNDIA SHOPPING", "UBERLANDIA": "UBERLÂNDIA SHOPPING", "CNB SHOPPING": "CONJUNTO NACIONAL", "CNB QUIOSQUE": "CONJUNTO NACIONAL QUIOSQUE",
    "QQ TAGUATINGA SHOPPING": "TAGUATINGA SHOPPING QQ", "ESTOQUE CD": "CD TAGUATINGA", "CD": "CD TAGUATINGA", "PASSEIO DAS ÁGUAS": "PASSEIO DAS AGUAS", "TERRACO SHOPPING": "TERRAÇO SHOPPING",
    "PARK": "PARK SHOPPING", "PARKSHOPPING": "PARK SHOPPING", "PARK SHOPPING": "PARK SHOPPING"
};

function getCnpjByName(storeName: string): string | null {
    let cleanName = String(storeName).trim().toUpperCase();
    const nomeCorrigido = CORRECAO_NOMES_SERVER[cleanName];
    if (nomeCorrigido) cleanName = nomeCorrigido;
    for (const [cnpj, name] of Object.entries(LOJAS_MAP_GLOBAL)) { if (String(name).toUpperCase() === cleanName) return cnpj; }
    return null;
}

async function getSalesFilter(userId: string, tableType: 'vendas' | 'kpi'): Promise<string> {
    if (!userId || userId === 'undefined') return "1=0";
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "1=0";
    console.log(`👤 LOGIN: ${user.name} | Lojas: [${user.allowedStores}]`);
    
    if (user.isAdmin || ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'].includes(String(user.role).toUpperCase())) return "1=1";
    if (!user.allowedStores || user.allowedStores.trim() === "") { console.log("🔴 Bloqueio: Sem lojas."); return "1=0"; }

    const correctedStores = user.allowedStores.split(',').map(s => {
        const u = s.trim().toUpperCase();
        return CORRECAO_NOMES_SERVER[u] || u;
    });

    if (tableType === 'kpi') {
        return `loja IN (${correctedStores.map(s => `'${s}'`).join(',')})`;
    } else {
        const cnpjs = correctedStores.map(n => getCnpjByName(n)).filter((c): c is string => c !== null);
        if (cnpjs.length === 0) { console.log("🔴 Bloqueio: CNPJs não achados."); return "1=0"; }
        return `cnpj_empresa IN (${cnpjs.map(c => `'${c}'`).join(',')})`;
    }
}

app.get('/sales', async (req, res) => {
    try {
        if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
        const filter = await getSalesFilter(String(req.query.userId || ''), 'vendas');
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        const data = await db.all(`SELECT * FROM vendas WHERE ${filter}`);
        await db.close(); res.json(data);
    } catch (e) { res.status(500).json({ error: "Erro vendas" }); }
});

app.get('/bi/summary', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
    const filter = await getSalesFilter(String(req.query.userId || ''), 'vendas');
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    db.get(`SELECT SUM(TOTAL_LIQUIDO) as t, SUM(QUANTIDADE) as q, COUNT(*) as n FROM vendas WHERE ${filter}`, [], (err, row: any) => {
        db.close(); res.json({ total_vendas: row?.t||0, total_pecas: row?.q||0, ticket_medio: (row?.t||0)/(row?.n||1) });
    });
});

app.get('/bi/chart', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const filter = await getSalesFilter(String(req.query.userId || ''), 'vendas');
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    db.all(`SELECT substr(DATA_EMISSAO, 6, 5) as dia, SUM(TOTAL_LIQUIDO) as valor FROM vendas WHERE ${filter} GROUP BY DATA_EMISSAO ORDER BY DATA_EMISSAO DESC LIMIT 7`, [], (err, rows) => {
        db.close(); res.json(rows ? rows.reverse() : []);
    });
});

app.get('/bi/ranking', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const filter = await getSalesFilter(String(req.query.userId || ''), 'kpi');
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    db.all(`SELECT vendedor as nome, loja, regiao, fat_atual as total, fat_anterior, crescimento, pa, ticket, qtd, pct_seguro FROM vendedores_kpi WHERE fat_atual > 0 AND ${filter} ORDER BY fat_atual DESC`, [], (err, rows) => {
        db.close(); res.json(rows);
    });
});

// ✅ ROTA FALTANTE REINSERIDA AQUI
app.get('/external-stores', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    db.all(`SELECT DISTINCT CNPJ_EMPRESA as c FROM vendas WHERE CNPJ_EMPRESA IS NOT NULL`, [], (err, rows: any[]) => {
        db.close(); if(err) return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
        const found = [...new Set(rows.map(r => LOJAS_MAP_GLOBAL[String(r.c).replace(/\D/g, '').trim()] || null).filter(n => n))];
        res.json(found.length ? found.sort() : Object.values(LOJAS_MAP_GLOBAL).sort());
    });
 });

// Rota Python
app.post('/sales/refresh', (req, res) => {
    const { exec } = require('child_process');
    console.log("🔄 Atualizando vendas...");
    exec(`"C:/Python312/python.exe" "c:/Users/Usuario/Desktop/TeleFluxo_Instalador/database/extrator_vendas.py"`, (err:any, out:any, stderr:any) => {
        if(err) return res.status(500).json({ error: stderr });
        res.json({ message: "OK" });
    });
});

// Rotas Sync
app.post('/api/sync/vendas', async (req, res) => {
    const dados = req.body; if(!Array.isArray(dados)) return res.status(400).json({error:"Erro"});
    try {
        await enqueueWrite(() => new Promise<void>((resolve, reject) => {
            const db = new sqlite3.Database(GLOBAL_DB_PATH); db.configure("busyTimeout", 15000);
            db.serialize(() => {
                db.run("BEGIN IMMEDIATE TRANSACTION"); db.run("DELETE FROM vendas", (err) => { if(err) { db.run("ROLLBACK"); return reject(err); }
                const stmt = db.prepare(`INSERT INTO vendas (data_emissao, nome_vendedor, descricao, quantidade, total_liquido, cnpj_empresa, familia, regiao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                dados.forEach(d => stmt.run(d.data_emissao, d.nome_vendedor, d.descricao, d.quantidade, d.total_liquido, d.cnpj_empresa, d.familia, d.regiao));
                stmt.finalize(() => db.run("COMMIT", () => { db.close(); resolve(); })); });
            });
        }));
        res.json({ message: "OK" });
    } catch(e) { res.status(500).json({ error: "Erro DB" }); }
});

app.post('/api/sync/vendedores', async (req, res) => {
    const dados = req.body; if(!Array.isArray(dados)) return res.status(400).json({error:"Erro"});
    try {
        await enqueueWrite(() => new Promise<void>((resolve, reject) => {
            const db = new sqlite3.Database(GLOBAL_DB_PATH); db.configure("busyTimeout", 15000);
            db.serialize(() => {
                db.run("BEGIN IMMEDIATE TRANSACTION"); db.run("DELETE FROM vendedores_kpi", (err) => { if(err) { db.run("ROLLBACK"); return reject(err); }
                const stmt = db.prepare(`INSERT INTO vendedores_kpi (loja, vendedor, fat_atual, tendencia, fat_anterior, crescimento, seguros, pa, qtd, ticket, regiao, pct_seguro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                dados.forEach(d => stmt.run(d.loja, d.vendedor, d.fat_atual, d.tendencia, d.fat_anterior, d.crescimento, d.seguros, d.pa, d.qtd, d.ticket, d.regiao, d.pct_seguro));
                stmt.finalize(() => db.run("COMMIT", () => { db.close(); resolve(); })); });
            });
        }));
        res.json({ message: "OK" });
    } catch(e) { res.status(500).json({ error: "Erro DB" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => { console.log(`✅ SERVER ON PORT ${PORT}`); });