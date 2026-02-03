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

// ----------------------------------------------------
// INICIALIZAÇÃO DO BANCO GLOBAL (SQLITE)
// ----------------------------------------------------
const dbInit = new sqlite3.Database(GLOBAL_DB_PATH);
dbInit.serialize(() => {
    // 1. Cria tabela de Vendas
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_emissao TEXT,
            nome_vendedor TEXT,
            descricao TEXT,
            quantidade REAL,
            total_liquido REAL,
            cnpj_empresa TEXT,
            familia TEXT,
            regiao TEXT
        )
    `);

    // 2. Cria tabela de KPIs
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendedores_kpi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loja TEXT,
            vendedor TEXT,
            fat_atual REAL,
            tendencia REAL,
            fat_anterior REAL,
            crescimento REAL,
            seguros REAL,
            pa REAL,
            qtd REAL,
            ticket REAL,
            regiao TEXT,
            pct_seguro REAL
        )
    `);
    console.log("📦 Tabelas do Banco de Dados Garantidas!");
})

const app = express();
const prisma = new PrismaClient();

// ✅ FILA GLOBAL DE ESCRITA (MUTEX)
let writeQueue = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Configuração de Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

// Configuração CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 1. SISTEMA DE LOGIN & USUÁRIOS
// ==========================================

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({
            where: { email: String(email).trim() },
            include: { manager: true, staff: true }
        });

        if (!user) return res.status(401).json({ error: "Usuário não encontrado." });

        const isPasswordValid = await bcrypt.compare(String(password).trim(), user.password);
        const isOldPasswordValid = user.password === String(password).trim();

        if (isPasswordValid || isOldPasswordValid) {
            const { password: _, ...userWithoutPassword } = user;
            res.json(userWithoutPassword);
        } else {
            res.status(401).json({ error: "Senha incorreta." });
        }
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro no servidor." }); 
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ 
            include: { manager: true, staff: true }, 
            orderBy: { name: 'asc' } 
        });
        const safeUsers = users.map(user => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
        res.json(safeUsers);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar equipe" }); }
});

app.post('/users', async (req, res) => {
    const { name, email, password, role, department, operation, isAdmin, managerId, allowedStores } = req.body;
    try {
        const id = crypto.randomUUID(); 
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(String(password), salt);

        await prisma.$executeRawUnsafe(
            `INSERT INTO User (id, name, email, password, role, department, operation, isAdmin, status, managerId, allowedStores) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            id, String(name), String(email).trim(), passwordHash, String(role), String(department), opValue, adminVal, managerId || null, storesValue
        );

        res.status(201).json({ id, name, message: "Criado com sucesso" });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao criar usuário." }); 
    }
});

app.put('/users/:id', async (req, res) => {
    const { name, email, role, department, operation, isAdmin, managerId, password, allowedStores } = req.body;
    const userId = req.params.id;

    try {
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");

        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(String(password), salt);

            await prisma.$executeRawUnsafe(
                `UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=?, password=?, allowedStores=? WHERE id=?`,
                name, email, role, department, opValue, adminVal, managerId || null, passwordHash, storesValue, userId
            );
        } else {
            await prisma.$executeRawUnsafe(
                `UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=?, allowedStores=? WHERE id=?`,
                name, email, role, department, opValue, adminVal, managerId || null, storesValue, userId
            );
        }
        
        const updated = await prisma.user.findUnique({ where: { id: userId } });
        if (updated) {
            const { password: _, ...userSafe } = updated;
            res.json(userSafe);
        } else {
            res.json(null);
        }
    } catch (e) { 
        console.error("Erro no Update:", e);
        res.status(500).json({ error: "Erro ao atualizar usuário." }); 
    }
});

app.delete('/users/:id', async (req, res) => {
    try { 
        await prisma.user.delete({ where: { id: req.params.id } }); 
        res.json({ message: "Usuário removido" }); 
    } catch (e) { res.status(500).json({ error: "Erro delete" }); }
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
        const tasks = await prisma.task.findMany({ 
            include: { history: true, subTasks: true }, 
            orderBy: { createdAt: 'desc' } 
        });
        const tasksWithOperation = tasks.map((task: any) => {
            const responsibleRef = allUsers.find((u: any) => u.name === task.user);
            const firstHistory = task.history.find((h:any) => h.text.includes("Iniciou")) || task.history[0];
            const creatorName = firstHistory ? firstHistory.user : "";
            const creatorRef = allUsers.find((u: any) => u.name === creatorName);
            return {
                ...task,
                operation: responsibleRef?.operation || "Outros",
                creatorOperation: creatorRef?.operation || "Outros"
            };
        });
        const filteredByScope = tasksWithOperation.filter(task => {
            if (currentUser.isAdmin) return true;
            const isMine = task.user === userName; 
            const iParticipated = task.history.some((h:any) => h.user === userName); 
            const involvesMyOp = task.operation === myOp || task.creatorOperation === myOp; 
            if (mode.startsWith('mine_')) return isMine || (task.creatorOperation === myOp && task.history[0].user === userName);
            return isMine || iParticipated || involvesMyOp;
        });
        const finalTasks = filteredByScope.filter(task => {
            if (mode === 'completed' || mode === 'all') return true;
            if (mode.endsWith('_pending')) return task.status === 'pending';
            if (mode.endsWith('_doing')) return task.status === 'doing';
            if (mode.endsWith('_done')) return task.status === 'done';
            return task.status !== 'done';
        });
        res.json(finalTasks);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao carregar demandas." }); 
    }
});

app.get('/tasks/:id', async (req, res) => {
    try {
        const task = await prisma.task.findUnique({ where: { id: req.params.id }, include: { history: true, subTasks: true } });
        res.json(task);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar tarefa" }); }
});

app.post('/tasks', upload.single('file'), async (req: any, res: Response) => {
    const { title, responsible, priority, deadline, creatorName, description, source, parentId } = req.body;
    const file = req.file;
    try {
        const historyEntries: any[] = [{ user: String(creatorName), text: "Iniciou o fluxo", type: "system", date: new Date().toLocaleString() }];
        if (description && description.trim() !== "") {
            historyEntries.push({ user: String(creatorName), text: String(description), type: "message", date: new Date().toLocaleString() });
        }
        if (file) {
            historyEntries.push({ user: String(creatorName), text: `Anexou na criação: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `/uploads/${file.filename}`, date: new Date().toLocaleString() });
        }
        const newTask = await prisma.task.create({
            data: {
                id: `TASK-${Date.now()}`,
                title: String(title),
                user: String(responsible),
                status: "pending",
                priority: String(priority),
                deadline: String(deadline),
                source: source || "Rotina",
                parentId: parentId || null, 
                history: { create: historyEntries }
            }
        });
        const target = await prisma.user.findFirst({ where: { name: String(responsible) } });
        if (target) await prisma.notification.create({ data: { userId: target.id, text: `Nova demanda: ${title}` } });
        res.status(201).json(newTask);
    } catch (e) { res.status(500).json({ error: "Erro create" }); }
});

app.put('/tasks/:id', async (req, res) => {
    const { status, user, comment, currentUser, actionType } = req.body;
    try {
        const currentTask = await prisma.task.findUnique({ where: { id: req.params.id }, include: { subTasks: true } });
        if (status === 'done' && currentTask?.subTasks) {
            const filhasPendentes = currentTask.subTasks.some(t => t.status !== 'done');
            if (filhasPendentes) return res.status(400).json({ error: "Conclua as subtarefas primeiro." });
        }
        let historyText = comment;
        if (actionType === 'start_progress') historyText = "Iniciou a tratativa.";
        if (actionType === 'finish') historyText = comment || "Finalizou.";
        const updated = await prisma.task.update({ where: { id: req.params.id }, data: { status: status || undefined, user: user || undefined, history: { create: { user: currentUser, text: historyText || `Ação: ${actionType}`, type: 'message', date: new Date().toLocaleString() } } } });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro update" }); }
});

app.post('/tasks/:id/upload', upload.single('file'), async (req: any, res: Response) => {
    const { currentUser } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Sem arquivo" });
    try {
        await prisma.task.update({ where: { id: req.params.id }, data: { history: { create: { user: currentUser, text: `Anexou: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `/uploads/${file.filename}`, date: new Date().toLocaleString() } } } });
        res.json({ message: "OK" });
    } catch (e) { res.status(500).json({ error: "Erro upload" }); }
});

app.delete('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.task.updateMany({ where: { parentId: id }, data: { parentId: null } });
        await prisma.task.delete({ where: { id } });
        res.json({ message: "Excluída." });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir." }); }
});

// ==========================================
// 3. NOTIFICAÇÕES, AGENDA E ESTATÍSTICAS
// ==========================================

app.get('/notifications', async (req, res) => {
    try {
        const userId = String(req.query.userId);
        const notes = await prisma.notification.findMany({ where: { userId: userId, read: false } as any });
        res.json(notes);
    } catch (e) { res.json([]); }
});

app.get('/agenda', async (req, res) => {
    const { userId, date } = req.query;
    try {
        const events = await prisma.agendaEvent.findMany({ where: { userId: String(userId), date: String(date) } });
        res.json(events);
    } catch (e) { res.json([]); }
});

app.post('/agenda', async (req, res) => {
    const { userId, title, date } = req.body;
    try {
        const newEvent = await prisma.agendaEvent.create({ data: { userId, title, date } });
        res.json(newEvent);
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.put('/agenda/:id', async (req, res) => {
    const { completed } = req.body;
    try {
        const updated = await prisma.agendaEvent.update({ where: { id: req.params.id }, data: { completed: completed } });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.delete('/agenda/:id', async (req, res) => {
    try {
        await prisma.agendaEvent.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.get('/manager-stats', async (req, res) => {
    const { managerName } = req.query;
    try {
        const currentUser = await prisma.user.findFirst({ where: { name: String(managerName) }, include: { staff: true } });
        if (!currentUser) return res.json([]);
        let usersToAnalyze: string[] = [];
        let tasks: any[] = [];
        if (currentUser.isAdmin) {
            const allUsers = await prisma.user.findMany();
            usersToAnalyze = allUsers.map(u => u.name);
            tasks = await prisma.task.findMany();
        } else if (currentUser.staff.length > 0) {
            usersToAnalyze = currentUser.staff.map(s => s.name);
            tasks = await prisma.task.findMany({ where: { user: { in: usersToAnalyze } } });
        } else {
            return res.json([]);
        }
        const report = usersToAnalyze.map(userName => {
            const userTasks = tasks.filter(t => t.user === userName);
            const total = userTasks.length;
            const done = userTasks.filter(t => t.status === 'done').length;
            const efficiency = total > 0 ? Math.round((done / total) * 100) : 0;
            return { name: userName, total, done, efficiency };
        });
        report.sort((a, b) => b.done - a.done);
        res.json(report);
    } catch (e) { res.status(500).json({ error: "Erro stats" }); }
});

// =======================================================
// 4. BI DE VENDAS (SAMSUNG) - COM FILTRO DE ACESSO 🛡️
// =======================================================

// 1. MAPA DE TRADUÇÃO OFICIAL (CNPJ -> NOME)
const LOJAS_MAP_GLOBAL: Record<string, string> = {
    "12309173001309": "ARAGUAIA SHOPPING",
    "12309173000418": "BOULEVARD SHOPPING",
    "12309173000175": "BRASILIA SHOPPING",
    "12309173000680": "CONJUNTO NACIONAL",
    "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
    "12309173000507": "GOIANIA SHOPPING",
    "12309173000256": "IGUATEMI SHOPPING",
    "12309173000841": "JK SHOPPING",
    "12309173000337": "PARK SHOPPING",
    "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING",
    "12309173001147": "TERRAÇO SHOPPING",
    "12309173001651": "TAGUATINGA SHOPPING QQ",
    "12309173001732": "UBERLÂNDIA SHOPPING",
    "12309173001813": "UBERABA SHOPPING",
    "12309173001570": "FLAMBOYANT SHOPPING",
    "12309173002119": "BURITI SHOPPING",
    "12309173002461": "PASSEIO DAS AGUAS",
    "12309173002038": "PORTAL SHOPPING",
    "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE",
    "12309173002380": "PARK ANAPOLIS",
    "12309173002542": "SHOPPING RECIFE",
    "12309173002895": "MANAIRA SHOPPING",
    "12309173002976": "IGUATEMI FORTALEZA",
    "12309173001066": "CD TAGUATINGA"
};

// 2. LISTA DE CORREÇÃO MANUAL NO SERVIDOR
// Se o usuário estiver cadastrado como "PARK", o sistema converte para "PARK SHOPPING"
const CORRECAO_NOMES_SERVER: Record<string, string> = {
    "UBERABA": "UBERABA SHOPPING",
    "UBERLÂNDIA": "UBERLÂNDIA SHOPPING",
    "UBERLANDIA": "UBERLÂNDIA SHOPPING",
    "CNB SHOPPING": "CONJUNTO NACIONAL",
    "CNB QUIOSQUE": "CONJUNTO NACIONAL QUIOSQUE",
    "QQ TAGUATINGA SHOPPING": "TAGUATINGA SHOPPING QQ",
    "ESTOQUE CD": "CD TAGUATINGA",
    "CD": "CD TAGUATINGA",
    "PASSEIO DAS ÁGUAS": "PASSEIO DAS AGUAS",
    "TERRACO SHOPPING": "TERRAÇO SHOPPING",
    "PARK": "PARK SHOPPING",
    "PARKSHOPPING": "PARK SHOPPING",
    "PARK SHOPPING": "PARK SHOPPING"
};

// ==========================================
// 🛡️ SISTEMA DE SEGURANÇA E FILTROS (RBAC)
// ==========================================

// Função Auxiliar: Descobre o CNPJ pelo Nome da Loja (Reverso)
function getCnpjByName(storeName: string): string | null {
    let cleanName = String(storeName).trim().toUpperCase();
    
    // ✅ CORREÇÃO DE TIPO: Verifica se existe antes de atribuir
    const nomeCorrigido = CORRECAO_NOMES_SERVER[cleanName];
    if (nomeCorrigido) {
        cleanName = nomeCorrigido;
    }

    // Busca no mapa oficial
    for (const [cnpj, name] of Object.entries(LOJAS_MAP_GLOBAL)) {
        if (String(name).toUpperCase() === cleanName) return cnpj;
    }
    
    return null;
}

// O GUARDA-COSTAS INTELIGENTE
async function getSalesFilter(userId: string, tableType: 'vendas' | 'kpi'): Promise<string> {
    if (!userId || userId === 'undefined') return "1=0"; 

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "1=0"; 

    // console.log(`👤 ACESSO: ${user.name} | Lojas: [${user.allowedStores}]`);

    // 1. DIRETORIA E ADM: ACESSO TOTAL
    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'];
    if (user.isAdmin || superRoles.includes(String(user.role).toUpperCase())) {
        return "1=1"; 
    }

    // 2. USUÁRIOS COMUNS
    if (!user.allowedStores || user.allowedStores.trim() === "") {
        return "1=0"; 
    }

    const rawStoreNames = user.allowedStores.split(',').map(s => s.trim());
    
    // ✅ TRADUÇÃO DE APELIDOS NO FILTRO
    const correctedStoreNames = rawStoreNames.map(s => {
        const upper = s.toUpperCase();
        // Se existe correção, usa ela. Se não, usa o original.
        const corrigido = CORRECAO_NOMES_SERVER[upper];
        if (corrigido) {
            return corrigido;
        }
        return upper;
    });

    if (tableType === 'kpi') {
        // KPI usa NOME DA LOJA
        const storesSql = correctedStoreNames.map(s => `'${s}'`).join(',');
        return `loja IN (${storesSql})`;
    } else {
        // VENDAS usa CNPJ
        // O filter((c): c is string => ...) resolve o erro de tipagem do TypeScript
        const cnpjs = correctedStoreNames
            .map(name => getCnpjByName(name))
            .filter((c): c is string => c !== null);
        
        if (cnpjs.length === 0) return "1=0";
        
        const cnpjsSql = cnpjs.map(c => `'${c}'`).join(',');
        return `cnpj_empresa IN (${cnpjsSql})`;
    }
}

// ==========================================
// ROTAS DE BI (SALES, SUMMARY, CHART, RANKING)
// ==========================================

app.get('/sales', async (req, res) => {
  try {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const userId = String(req.query.userId || '');
    const filterWhere = await getSalesFilter(userId, 'vendas'); 
    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
    const query = `SELECT * FROM vendas WHERE ${filterWhere}`;
    const sales = await db.all(query);
    await db.close();
    res.json(sales);
  } catch (error: any) {
    console.error("❌ Erro em /sales:", error.message);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
});

app.get('/bi/summary', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
    const userId = String(req.query.userId || '');
    const filterWhere = await getSalesFilter(userId, 'vendas'); 
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    const sql = `SELECT SUM(TOTAL_LIQUIDO) as total_vendas, SUM(QUANTIDADE) as total_pecas, COUNT(*) as qtd_notas
                 FROM vendas WHERE ${filterWhere}`;
    db.get(sql, [], (err, row: any) => {
        db.close();
        if (err) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
        const total = row?.total_vendas || 0;
        const pecas = row?.total_pecas || 0;
        const notas = row?.qtd_notas || 1;
        res.json({ total_vendas: total, total_pecas: pecas, ticket_medio: total / notas });
    });
});

app.get('/bi/chart', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const userId = String(req.query.userId || '');
    const filterWhere = await getSalesFilter(userId, 'vendas');
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    const sql = `SELECT substr(DATA_EMISSAO, 6, 5) as dia, SUM(TOTAL_LIQUIDO) as valor 
                 FROM vendas WHERE ${filterWhere}
                 GROUP BY DATA_EMISSAO ORDER BY DATA_EMISSAO DESC LIMIT 7`;
    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows ? rows.reverse() : []);
    });
});

app.get('/bi/ranking', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    const userId = String(req.query.userId || '');
    // KPI usa NOME DA LOJA
    const filterWhere = await getSalesFilter(userId, 'kpi'); 
    const sql = `
        SELECT 
            vendedor as nome, loja, regiao, fat_atual as total, fat_anterior,
            crescimento, pa, ticket, qtd, pct_seguro
        FROM vendedores_kpi 
        WHERE fat_atual > 0 AND ${filterWhere}
        ORDER BY fat_atual DESC
    `;
    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows);
    });
});

// ==========================================
// ROTAS DE RECEBIMENTO DE DADOS (PYTHON -> NODE)
// ==========================================

app.post('/api/sync/vendas', async (req, res) => {
  const dados = req.body;
  if (!dados || !Array.isArray(dados)) return res.status(400).json({ error: "Formato inválido." });
  console.log(`📡 Recebendo ${dados.length} registros de vendas...`);

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(GLOBAL_DB_PATH);
      db.configure("busyTimeout", 15000);
      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("BEGIN IMMEDIATE TRANSACTION");
        db.run("DELETE FROM vendas", (err) => {
          if (err) { db.run("ROLLBACK"); return reject(err); }
          const stmt = db.prepare(`INSERT INTO vendas (data_emissao, nome_vendedor, descricao, quantidade, total_liquido, cnpj_empresa, familia, regiao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
          for (const item of dados) {
            stmt.run(item.data_emissao, item.nome_vendedor, item.descricao, item.quantidade, item.total_liquido, item.cnpj_empresa, item.familia, item.regiao);
          }
          stmt.finalize((err2) => {
            if (err2) { db.run("ROLLBACK"); return reject(err2); }
            db.run("COMMIT", (err3) => {
              if (err3) { db.run("ROLLBACK"); return reject(err3); }
              db.close(); resolve();
            });
          });
        });
      });
    }));
    console.log("✅ Vendas sincronizadas!");
    res.json({ message: "Sucesso!" });
  } catch (e: any) {
    console.error("❌ Erro vendas:", e);
    res.status(500).json({ error: "Erro no banco" });
  }
});

app.post('/api/sync/vendedores', async (req, res) => {
  const dados = req.body;
  if (!dados || !Array.isArray(dados)) return res.status(400).json({ error: "Dados inválidos" });
  console.log(`🏆 Recebendo ${dados.length} KPIs...`);

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(GLOBAL_DB_PATH);
      db.configure("busyTimeout", 15000);
      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("BEGIN IMMEDIATE TRANSACTION");
        db.run("DELETE FROM vendedores_kpi", (err) => {
          if (err) { db.run("ROLLBACK"); return reject(err); }
          const stmt = db.prepare(`INSERT INTO vendedores_kpi (loja, vendedor, fat_atual, tendencia, fat_anterior, crescimento, seguros, pa, qtd, ticket, regiao, pct_seguro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          for (const item of dados) {
            stmt.run(item.loja, item.vendedor, item.fat_atual, item.tendencia, item.fat_anterior, item.crescimento, item.seguros, item.pa, item.qtd, item.ticket, item.regiao, item.pct_seguro);
          }
          stmt.finalize((err2) => {
            if (err2) { db.run("ROLLBACK"); return reject(err2); }
            db.run("COMMIT", (err3) => {
              if (err3) { db.run("ROLLBACK"); return reject(err3); }
              db.close(); resolve();
            });
          });
        });
      });
    }));
    res.json({ message: "KPIs atualizados!" });
  } catch (e: any) {
    console.error("❌ Erro KPI:", e);
    res.status(500).json({ error: "Erro no banco" });
  }
});

// ==========================================
// 7. ANÚNCIOS E MURAL (HOME)
// ==========================================

// Listar avisos (Home)
app.get('/announcements', async (req, res) => {
    try {
        const notices = await prisma.announcement.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10 
        });
        res.json(notices);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar avisos" }); }
});

// Criar aviso
app.post('/announcements', async (req, res) => {
    const { title, content, author, priority, category } = req.body;
    try {
        const notice = await prisma.announcement.create({
            data: { title, content, author, priority, category }
        });
        res.json(notice);
    } catch (e) { res.status(500).json({ error: "Erro ao criar aviso" }); }
});

// Deletar aviso
app.delete('/announcements/:id', async (req, res) => {
    try {
        await prisma.announcement.delete({ where: { id: req.params.id } });
        res.json({ message: "Removido com sucesso" });
    } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

// ==========================================
// 8. INFORMATIVOS POR SETOR (ESTILO CHAT)
// ==========================================

app.get('/dept-messages/:dept', async (req, res) => {
    try {
        const messages = await prisma.deptMessage.findMany({
            where: { department: req.params.dept },
            orderBy: { createdAt: 'asc' } 
        });
        res.json(messages);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar mensagens" }); }
});

app.post('/dept-messages', async (req, res) => {
    const { content, author, department } = req.body;
    try {
        const msg = await prisma.deptMessage.create({
            data: { content, author, department }
        });
        res.json(msg);
    } catch (e) { res.status(500).json({ error: "Erro ao enviar" }); }
});

// ==========================================
// 9. FINANCEIRO E ESTOQUE
// ==========================================

app.get('/finance', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const type = req.query.type ? String(req.query.type) : 'EXPENSE';
    const where = { type: type };
    const [total, items] = await Promise.all([
      prisma.finance.count({ where }), 
      prisma.finance.findMany({ where, skip, take: limit, orderBy: { dueDate: 'asc' } })
    ]);
    res.json({ data: items, total, totalPages: Math.ceil(total / limit), currentPage: page });
  } catch (e) { res.status(500).json({ error: "Erro financeiro" }); }
});

app.post('/finance', async (req, res) => {
  const { supplier, description, category, unit, value, issueDate, dueDate, installments, isRecurring } = req.body;
  try {
    const groupId = crypto.randomUUID();
    const entries = [];
    const baseDate = new Date(dueDate);
    const loops = isRecurring ? 12 : (parseInt(installments) || 1);

    for (let i = 0; i < loops; i++) {
      const currentDueDate = new Date(baseDate);
      currentDueDate.setMonth(baseDate.getMonth() + i);
      entries.push({
        supplier, description: isRecurring ? `${description} (Recorrente)` : `${description} (${i + 1}/${loops})`,
        category, unit, value: parseFloat(value), issueDate: new Date(issueDate), dueDate: currentDueDate,
        isRecurring: !!isRecurring, totalInstallments: loops, currentInstallment: i + 1, groupId: groupId
      });
    }
    await prisma.finance.createMany({ data: entries });
    res.json({ message: "Sucesso!" });
  } catch (e) { res.status(500).json({ error: "Erro ao gerar títulos" }); }
});

app.post('/finance/import', upload.single('file'), async (req: any, res: Response) => {
  const file = req.file;
  const transactionType = req.body.type || 'EXPENSE';
  if (!file) return res.status(400).json({ error: "Arquivo faltando" });
  try {
    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    let headerIndex = rawData.findIndex(r => JSON.stringify(r).toUpperCase().includes("VALOR"));
    if (headerIndex === -1) throw new Error("Sem coluna Valor");
    const headers = rawData[headerIndex].map((h: any) => String(h).trim().toUpperCase());
    const dataRows = rawData.slice(headerIndex + 1);
    
    const formattedData = dataRows.map((row: any) => {
        const rowData: any = {};
        headers.forEach((h, i) => rowData[h] = row[i]);
        return {
            supplier: String(rowData['FORNECEDOR'] || rowData['CLIENTE'] || 'N/A').toUpperCase(),
            description: String(rowData['DESCRIÇÃO'] || ''),
            category: String(rowData['TIPO'] || (transactionType === 'INCOME' ? 'VENDAS' : 'GERAL')),
            unit: 'Matriz',
            value: parseFloat(String(rowData['VALOR']).replace(/[^\d.-]/g, '')) || 0,
            issueDate: new Date(),
            dueDate: new Date(),
            status: 'PENDENTE',
            type: transactionType
        };
    }).filter(d => d.value > 0);

    if (formattedData.length > 0) await prisma.finance.createMany({ data: formattedData });
    try { fs.unlinkSync(file.path); } catch(e) {}
    res.json({ message: "OK" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete('/finance/:id', async (req, res) => {
  try { await prisma.finance.delete({ where: { id: req.params.id } }); res.json({ message: "OK" }); } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.delete('/finance/all', async (req, res) => {
  try { await prisma.finance.deleteMany({}); res.json({ message: "Reset OK" }); } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.get('/stock', async (req, res) => {
  try { const stock = await prisma.stock.findMany(); res.json(stock); } catch (e) { res.status(500).json({ error: "Erro estoque" }); }
});

app.post('/stock/sync', async (req, res) => {
  const data = req.body; 
  if (!Array.isArray(data)) return res.status(400).json({ error: "Array esperado" });
  try {
      await prisma.stock.deleteMany();
      const formatted = data.map((item: any) => ({
          cnpj: String(item.CNPJ_ORIGEM || ""),
          storeName: String(item.NOME_FANTASIA || "LOJA"),
          productCode: String(item.CODIGO_PRODUTO || ""),
          description: String(item.DESCRICAO || ""),
          quantity: Number(item.QUANTIDADE) || 0,
          costPrice: Number(item.PRECO_CUSTO) || 0
      }));
      await prisma.stock.createMany({ data: formatted });
      res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 2. Rota para Atualizar (Dispara o Script Python)
app.post('/sales/refresh', (req, res) => {
  const { exec } = require('child_process');
  const pythonPath = 'C:/Python312/python.exe';
  const scriptPath = 'c:/Users/Usuario/Desktop/TeleFluxo_Instalador/database/extrator_vendas.py';
  console.log("🔄 Iniciando atualização de vendas via Python...");
  exec(`"${pythonPath}" "${scriptPath}"`, (error: any, stdout: any, stderr: any) => {
    if (error) { console.error("❌ Erro Python:", stderr); return res.status(500).json({ error: stderr }); }
    console.log("✅ Script finalizado:", stdout);
    res.json({ message: "Atualizado!" });
  });
});

app.get('/external-stores', async (req, res) => {
   if (!fs.existsSync(GLOBAL_DB_PATH)) { return res.json(Object.values(LOJAS_MAP_GLOBAL).sort()); }
   const db = new sqlite3.Database(GLOBAL_DB_PATH);
   const sql = `SELECT DISTINCT CNPJ_EMPRESA as cnpj FROM vendas WHERE CNPJ_EMPRESA IS NOT NULL`;
   db.all(sql, [], (err, rows: any[]) => {
       db.close();
       if (err) return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
       const storeNames = rows.map((r: any) => {
           const cleanCnpj = String(r.cnpj).replace(/\D/g, '').trim();
           return LOJAS_MAP_GLOBAL[cleanCnpj] || null;
       });
       const uniqueStores = [...new Set(storeNames.filter((name: any) => name !== null))];
       uniqueStores.sort();
       if (uniqueStores.length === 0) return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
       res.json(uniqueStores);
   });
});

// Define a porta
const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ SERVIDOR RODANDO NA PORTA ${PORT}`);
});