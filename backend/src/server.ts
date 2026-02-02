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
const dbInit = new sqlite3.Database(GLOBAL_DB_PATH);
dbInit.serialize(() => {
    // 1. Cria tabela de Vendas se não existir
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

    //2. Cria tabela de KPIs se não existir
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

// ✅ FILA GLOBAL DE ESCRITA (MUTEX SQLITE)
// ==========================================
let writeQueue = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  // mantém a fila viva mesmo se der erro
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

// Configuração CORS Liberada
app.use(cors({
    origin: '*', // Permite que qualquer site (Vercel, Localhost) acesse
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 1. SISTEMA OPERACIONAL (USUÁRIOS E LOGIN)
// ==========================================

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // 1. Busca o usuário apenas pelo email primeiro
        const user = await prisma.user.findUnique({
            where: { email: String(email).trim() },
            include: { manager: true, staff: true }
        });

        if (!user) {
            return res.status(401).json({ error: "Usuário não encontrado." });
        }

        // 2. Verifica se a senha bate com a criptografia (Hash)
        // Se a senha no banco ainda não for hash (usuários antigos), fazemos uma checagem dupla temporária
        const isPasswordValid = await bcrypt.compare(String(password).trim(), user.password);
        
        // (OPCIONAL) Fallback para usuários antigos sem hash:
        const isOldPasswordValid = user.password === String(password).trim();

        if (isPasswordValid || isOldPasswordValid) {
            // Remove a senha do objeto de retorno por segurança
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

// ATUALIZAÇÃO DA ROTA POST /users
// ATUALIZAÇÃO DA ROTA POST /users (COM CRIPTOGRAFIA)

// ROTA QUE ESTAVA FALTANDO: LISTAR USUÁRIOS
// ==========================================
app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ 
            include: { manager: true, staff: true }, 
            orderBy: { name: 'asc' } 
        });
        
        // Remove a senha do retorno para segurança (Opcional, mas recomendado)
        const safeUsers = users.map(user => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });

        res.json(safeUsers);
    } catch (e) { 
        res.status(500).json({ error: "Erro ao buscar equipe" }); 
    }
});


app.post('/users', async (req, res) => {
    const { name, email, password, role, department, operation, isAdmin, managerId, allowedStores } = req.body;
    try {
        const id = crypto.randomUUID(); 
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;
        
        // Tratamento para salvar array como string no SQLite
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");

        // === CRIPTOGRAFIA DA SENHA ===
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

// ATUALIZAÇÃO DA ROTA PUT /users/:id
// ATUALIZAÇÃO DA ROTA PUT (GARANTINDO QUE SALVA AS LOJAS)
app.put('/users/:id', async (req, res) => {
    const { name, email, role, department, operation, isAdmin, managerId, password, allowedStores } = req.body;
    const userId = req.params.id;

    try {
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;
        
        // TRATAMENTO DO ARRAY DE LOJAS
        const storesValue = Array.isArray(allowedStores) ? allowedStores.join(',') : (allowedStores || "");

        // Criptografa senha apenas se foi alterada
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
        
        // Remove a senha do retorno
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

        // 1. Buscamos TODOS os usuários para saber quem é de qual setor
        const allUsers: any = await prisma.$queryRawUnsafe(`SELECT name, operation FROM User`);
        const myOp = currentUser.operation || "Outros";

        // 2. Buscamos as tarefas (Iniciamos pegando todas para filtrar no código, garantindo o "Elo")
        const tasks = await prisma.task.findMany({ 
            include: { history: true, subTasks: true }, 
            orderBy: { createdAt: 'desc' } 
        });

        // 3. Mapeamos as operações e filtramos pelo "Elo"
        const tasksWithOperation = tasks.map((task: any) => {
            const responsibleRef = allUsers.find((u: any) => u.name === task.user);
            const firstHistory = task.history.find((h:any) => h.text.includes("Iniciou")) || task.history[0];
            const creatorName = firstHistory ? firstHistory.user : "";
            const creatorRef = allUsers.find((u: any) => u.name === creatorName);

            return {
                ...task,
                operation: responsibleRef?.operation || "Outros", // Destino
                creatorOperation: creatorRef?.operation || "Outros" // Origem
            };
        });

        // 4. APLICAÇÃO DO ELO E SEGURANÇA
        const filteredByScope = tasksWithOperation.filter(task => {
            // Admin vê tudo
            if (currentUser.isAdmin) return true;

            // Lógica do Elo: Eu vejo se...
            const isMine = task.user === userName; // Sou o dono
            const iParticipated = task.history.some((h:any) => h.user === userName); // Estou no histórico
            const involvesMyOp = task.operation === myOp || task.creatorOperation === myOp; // Envolve meu setor
            
            // Se for "Minhas Demandas", filtramos apenas o que é meu ou eu criei
            if (mode.startsWith('mine_')) return isMine || (task.creatorOperation === myOp && task.history[0].user === userName);
            
            // Se for Visão Geral ou Histórico, o "Elo" libera a visão
            return isMine || iParticipated || involvesMyOp;
        });

        // 5. Filtro final de Status (Pendente, Fazendo, etc)
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
        res.status(500).json({ error: "Erro ao carregar demandas com elo." }); 
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
            historyEntries.push({ user: String(creatorName), text: `Anexou na criação: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `http://172.34.0.47:3000/uploads/${file.filename}`, date: new Date().toLocaleString() });
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
        const currentTask = await prisma.task.findUnique({ 
            where: { id: req.params.id },
            include: { subTasks: true } 
        });

        if (status === 'done' && currentTask?.subTasks) {
            const filhasPendentes = currentTask.subTasks.some(t => t.status !== 'done');
            if (filhasPendentes) {
                return res.status(400).json({ 
                    error: "Não é possível concluir! Existem subtarefas pendentes vinculadas a esta demanda." 
                });
            }
        }

        if (currentTask?.status === 'done' && status !== 'pending' && actionType !== 'reopen') return res.status(400).json({ error: "Demanda finalizada." });

        let historyText = comment;
        if (actionType === 'start_progress') historyText = "Iniciou a tratativa desta demanda.";
        if (actionType === 'finish') historyText = comment || "Finalizou a demanda.";

        const updated = await prisma.task.update({ where: { id: req.params.id }, data: { status: status || undefined, user: user || undefined, history: { create: { user: currentUser, text: historyText || `Ação: ${actionType}`, type: 'message', date: new Date().toLocaleString() } } } });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro update" }); }
});

app.post('/tasks/:id/upload', upload.single('file'), async (req: any, res: Response) => {
    const { currentUser } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Sem arquivo" });
    try {
        const task = await prisma.task.findUnique({ where: { id: req.params.id } });
        if (task?.status === 'done') return res.status(400).json({ error: "Tarefa finalizada." });
        await prisma.task.update({ where: { id: req.params.id }, data: { history: { create: { user: currentUser, text: `Anexou: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `http://172.34.0.47:3000/uploads/${file.filename}`, date: new Date().toLocaleString() } } } });
        res.json({ message: "OK" });
    } catch (e) { res.status(500).json({ error: "Erro upload" }); }
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

const DB_PATH = GLOBAL_DB_PATH;

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
// 🛡️ SISTEMA DE SEGURANÇA E FILTROS
// ==========================================

// Função Auxiliar: Descobre o CNPJ pelo Nome da Loja (Reverso)

function normStore(s: any): string {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")   // NBSP -> espaço normal
    .replace(/\s+/g, " ")      // colapsa múltiplos espaços/tabs
    .trim()
    .toUpperCase();
}

function getCnpjByName(storeName: string): string | null {
  let cleanName = normStore(storeName);

  // 1) aplica correções (PARK -> PARK SHOPPING etc)
  const nomeCorrigido = CORRECAO_NOMES_SERVER[cleanName];
  if (nomeCorrigido) cleanName = normStore(nomeCorrigido);

  // 2) busca no mapa oficial
  for (const [cnpj, name] of Object.entries(LOJAS_MAP_GLOBAL)) {
    if (normStore(name) === cleanName) return cnpj;
  }

  return null;
}

// O GUARDA-COSTAS INTELIGENTE
async function getSalesFilter(userId: string, tableType: 'vendas' | 'kpi'): Promise<string> {
    if (!userId || userId === 'undefined') return "1=0"; 

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "1=0"; 

    console.log(`👤 LOGIN: ${user.name} | Cargo: ${user.role} | Lojas no cadastro: [${user.allowedStores}]`);

    // 1. DIRETORIA E ADM: ACESSO TOTAL
    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'];
    if (user.isAdmin || superRoles.includes(String(user.role).toUpperCase())) {
        return "1=1"; 
    }

    // 2. USUÁRIOS COMUNS
    if (!user.allowedStores || user.allowedStores.trim() === "") {
        console.log("🔴 Bloqueio: Sem lojas vinculadas.");
        return "1=0"; 
    }

    const rawStoreNames = user.allowedStores.split(',').map(s => normStore(s));

    const correctedStoreNames = rawStoreNames.map(s => {
    const corrigido = CORRECAO_NOMES_SERVER[s];
        if (corrigido) {
            console.log(`🔧 Filtro Ajustado: Usuário tem '${s}', sistema usará '${corrigido}'`);
        return normStore(corrigido);
    }
        return s;
    });
    
    if (tableType === 'kpi') {
        // Tabela KPI usa NOME DA LOJA (Texto)
        const storesSql = correctedStoreNames.map(s => `'${s}'`).join(',');
        return `UPPER(loja) IN (${storesSql})`;
    } else {
        // Tabela VENDAS usa CNPJ
        const cnpjs = correctedStoreNames.map(name => getCnpjByName(name)).filter((c): c is string => c !== null);
        
        if (cnpjs.length === 0) {
            console.log("🔴 Bloqueio: Lojas não encontradas no mapa de CNPJ.");
            return "1=0";
        }
        
        const cnpjsSql = cnpjs.map(c => `'${c}'`).join(',');
        return `cnpj_empresa IN (${cnpjsSql})`;
    }
}

// ==========================================
// 2. ROTA /sales (VERSÃO FINAL LIMPA)
// ==========================================
app.get('/sales', async (req, res) => {
  try {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);

    const userId = String(req.query.userId || '');
    // SEGURANÇA: Pede o filtro para tabela de 'vendas' (CNPJ)
    const filterWhere = await getSalesFilter(userId, 'vendas'); 

    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
    // INJEÇÃO: Adiciona o filtro na consulta SQL
    const query = `SELECT * FROM vendas WHERE ${filterWhere}`;

    const sales = await db.all(query);
    await db.close();
    res.json(sales);
  } catch (error: any) {
    console.error("❌ Erro em /sales:", error.message);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
});


// --- ROTA: RESUMO (CARDS) ---
app.get('/bi/summary', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
    
    const userId = String(req.query.userId || '');
    // SEGURANÇA: Filtra por CNPJ
    const filterWhere = await getSalesFilter(userId, 'vendas'); 

    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    const sql = `SELECT SUM(TOTAL_LIQUIDO) as total_vendas, SUM(QUANTIDADE) as total_pecas, COUNT(*) as qtd_notas
                 FROM vendas 
                 WHERE ${filterWhere}`; // <--- Filtro aplicado aqui

    db.get(sql, [], (err, row: any) => {
        db.close();
        if (err) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
        const total = row?.total_vendas || 0;
        const pecas = row?.total_pecas || 0;
        const notas = row?.qtd_notas || 1;
        res.json({ total_vendas: total, total_pecas: pecas, ticket_medio: total / notas });
    });
});

// --- ROTA: GRÁFICO (LINHA DO TEMPO) ---
app.get('/bi/chart', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    
    const userId = String(req.query.userId || '');
    const filterWhere = await getSalesFilter(userId, 'vendas');

    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    
    const sql = `SELECT substr(DATA_EMISSAO, 6, 5) as dia, SUM(TOTAL_LIQUIDO) as valor 
                 FROM vendas 
                 WHERE ${filterWhere} -- <--- Segurança aqui
                 GROUP BY DATA_EMISSAO 
                 ORDER BY DATA_EMISSAO DESC LIMIT 7`;
                 
    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows ? rows.reverse() : []);
    });
});

// --- ROTA: RANKING / KPI VENDEDORES (CORREÇÃO FINAL) ---
// --- ROTA: RANKING / KPI VENDEDORES (CORREÇÃO FINAL) ---
app.get('/bi/ranking', async (req, res) => {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);
    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    
    const userId = String(req.query.userId || '');
    
    // ATENÇÃO: Aqui usamos 'kpi' porque esta tabela usa NOME DA LOJA, não CNPJ
    const filterWhere = await getSalesFilter(userId, 'kpi'); 

    const sql = `
        SELECT 
            vendedor as nome,
            loja,
            regiao,
            fat_atual as total,
            fat_anterior,
            crescimento,
            pa,
            ticket,
            qtd,
            pct_seguro
        FROM vendedores_kpi 
        WHERE fat_atual > 0 AND ${filterWhere}  -- <--- Filtro Mágico Injetado
        ORDER BY fat_atual DESC
    `;

    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows);
    });
});

// ==========================================
// 5. IMPORTAÇÃO DE PAGAMENTOS (CSV) - VERSÃO BLINDADA 🛡️
// ==========================================
app.post('/import-payments', upload.single('file'), async (req: any, res: Response) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const results: any[] = [];
    const createdTasks: any[] = [];

    // 🔥 CORREÇÃO DA DATA: Usando .substring() que é mais seguro para string
    const converterData = (dataStr: any): string => {
        if (!dataStr) return new Date().toISOString().substring(0, 10);
        
        const s = String(dataStr).trim();
        
        if (s.includes('-')) return s;
        const partes = s.split('/');
        if (partes.length === 3) return `${partes[2]}-${partes[1]}-${partes[0]}`;
        return s;
    };

    fs.createReadStream(file.path)
        .pipe(csv({ separator: ';' })) 
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                if (results.length === 0) {
                    throw new Error("O arquivo parece vazio ou o formato está incorreto.");
                }

                for (const row of results) {
                    const tituloRaw = row.Titulo || row.titulo || "Pagamento";
                    const valorRaw = row.Valor || row.valor || "0,00";
                    const respRaw = row.Responsavel || row.responsavel;
                    const vencRaw = row.Vencimento || row.vencimento;
                    const origemRaw = row.Origem || row.origem;

                    const title = `💰 ${tituloRaw} - R$ ${valorRaw}`;
                    
                    const userExists = await prisma.user.findFirst({ where: { name: String(respRaw).trim() } });
                    const assignedUser = userExists ? userExists.name : "Andre"; 

                    const newTask = await prisma.task.create({
                        data: {
                            id: `TASK-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                            title: title,
                            user: assignedUser,
                            status: "pending",
                            priority: "Alta",
                            deadline: converterData(vencRaw),
                            source: "Planilha Recorrente",
                            parentId: null,
                            
                            history: {
                                create: [{
                                    user: "Sistema Importador",
                                    text: `Gerado via Planilha. Origem: ${origemRaw}`,
                                    type: "system",
                                    date: new Date().toLocaleString()
                                }]
                            }
                        }
                    });
                    createdTasks.push(newTask);
                    
                    if (userExists) {
                        await prisma.notification.create({ 
                            data: { userId: userExists.id, text: `Novo pagamento agendado: ${title}` } 
                        });
                    }
                }
                
                try { fs.unlinkSync(file.path); } catch(e) {}
                res.json({ message: "Importação concluída!", total: createdTasks.length });

            } catch (e: any) {
                console.error("Erro import:", e);
                try { fs.unlinkSync(file.path); } catch(e) {}
                res.status(500).json({ error: e.message || "Erro ao processar CSV." });
            }
        });
});

// ==========================================
// 6. ROTAS EXTRAS (DELETE E OUTROS)
// ==========================================

// TAREFAS - EXCLUIR (COM SEGURANÇA PARA PAIS/FILHOS)
app.delete('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Segurança: Se essa tarefa for "Pai", soltamos os "Filhos" antes de apagar
        // (Isso evita erro de vínculo no banco)
        await prisma.task.updateMany({
            where: { parentId: id },
            data: { parentId: null } 
        });

        // 2. Apaga a tarefa (O Histórico apaga junto automaticamente por causa do Cascade)
        await prisma.task.delete({ where: { id } });

        res.json({ message: "Demanda excluída com sucesso." });
    } catch (e) {
        console.error("Erro ao excluir:", e);
        res.status(500).json({ error: "Erro ao excluir demanda." });
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
            take: 10 // Pega os últimos 10
        });
        res.json(notices);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar avisos" }); }
});

// Criar aviso (Só Admin/Gestor)
app.post('/announcements', async (req, res) => {
    const { title, content, author, priority } = req.body;
    try {
        const notice = await prisma.announcement.create({
            data: { title, content, author, priority }
        });
        res.json(notice);
    } catch (e) { res.status(500).json({ error: "Erro ao criar aviso" }); }
});

// ==========================================
// 7. ANÚNCIOS E MURAL (HOME)
// ==========================================

// Listar avisos (Home)
app.get('/announcements', async (req, res) => {
    try {
        const notices = await prisma.announcement.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10 // Pega os últimos 10
        });
        res.json(notices);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar avisos" }); }
});

// Criar aviso (Só Admin/Gestor)
app.post('/announcements', async (req, res) => {
    const { title, content, author, priority } = req.body;
    try {
        const notice = await prisma.announcement.create({
            data: { title, content, author, priority }
        });
        res.json(notice);
    } catch (e) { res.status(500).json({ error: "Erro ao criar aviso" }); }
});

// ==========================================
// 7. MURAL DE AVISOS E INFORMATIVOS
// ==========================================

// Listar todos os avisos (Mural, Dica e Agenda)
app.get('/announcements', async (req, res) => {
    try {
        const notices = await prisma.announcement.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(notices);
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar avisos" });
    }
});

// Criar um novo informativo
app.post('/announcements', async (req, res) => {
    const { title, content, author, priority, category } = req.body;
    try {
        const notice = await prisma.announcement.create({
            data: { 
                title: String(title), 
                content: String(content), 
                author: String(author), 
                priority: priority || "Normal",
                category: category || "Aviso"
            }
        });
        res.json(notice);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao criar informativo" });
    }
});

// Deletar um informativo (Poder de ADM/Gestor)
app.delete('/announcements/:id', async (req, res) => {
    try {
        await prisma.announcement.delete({
            where: { id: req.params.id }
        });
        res.json({ message: "Removido com sucesso" });
    } catch (e) {
        res.status(500).json({ error: "Erro ao deletar informativo" });
    }
});

// ==========================================
// 8. INFORMATIVOS POR SETOR (ESTILO CHAT)
// ==========================================

app.get('/dept-messages/:dept', async (req, res) => {
    try {
        const messages = await prisma.deptMessage.findMany({
            where: { department: req.params.dept },
            orderBy: { createdAt: 'asc' } // Ordem cronológica
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

// Listar Títulos Financeiros

// Criar Novo Título (Conforme Planilha)
app.post('/finance', async (req, res) => {
  const { 
    supplier, description, category, unit, value, 
    issueDate, dueDate, installments, isRecurring 
  } = req.body;

  try {
    const groupId = crypto.randomUUID();
    const entries = [];
    const baseDate = new Date(dueDate);

    // Se for Recorrente (mensal sem fim definido), podemos criar os próximos 12 meses
    // Se for Parcelado, criamos o número exato de parcelas
    const loops = isRecurring ? 12 : (parseInt(installments) || 1);

    for (let i = 0; i < loops; i++) {
      const currentDueDate = new Date(baseDate);
      currentDueDate.setMonth(baseDate.getMonth() + i); // Pula 1 mês a cada loop

      entries.push({
        supplier,
        description: isRecurring ? `${description} (Recorrente)` : `${description} (${i + 1}/${loops})`,
        category,
        unit,
        value: parseFloat(value),
        issueDate: new Date(issueDate),
        dueDate: currentDueDate,
        isRecurring: !!isRecurring,
        totalInstallments: loops,
        currentInstallment: i + 1,
        groupId: groupId
      });
    }

    await prisma.finance.createMany({ data: entries });
    res.json({ message: "Títulos gerados com sucesso!" });
  } catch (e) {
    res.status(500).json({ error: "Erro ao gerar títulos inteligentes" });
  }
});

// ==========================================
// 9. IMPORTAÇÃO FINANCEIRA (COM LEITURA DE STATUS OK)
// ==========================================

app.post('/finance/import', upload.single('file'), async (req: any, res: Response) => {
  console.log("\n--- 🕵️ INICIANDO IMPORTAÇÃO ---");
  const file = req.file;
  
  // 1. AQUI: Pegamos o tipo enviado pelo Frontend (INCOME ou EXPENSE)
  const transactionType = req.body.type || 'EXPENSE';

  if (!file) return res.status(400).json({ error: "Arquivo não enviado." });

  try {
    const filePath = file.path;
    const ext = path.extname(file.originalname).toLowerCase();
    
    let results: any[] = [];

    if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        
        if (!sheetName) throw new Error("Excel sem abas.");
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) throw new Error("Erro ao ler aba.");

        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        // 1. Procurar Cabeçalho (ALTERADO PARA SER MAIS FLEXÍVEL)
        let headerIndex = -1;
        for (let i = 0; i < Math.min(rawData.length, 30); i++) {
            const rowStr = JSON.stringify(rawData[i] || []).toUpperCase();
            // Aceita FORNECEDOR ou CLIENTE ou NOME
            if ((rowStr.includes("FORNECEDOR") || rowStr.includes("CLIENTE") || rowStr.includes("NOME")) && rowStr.includes("VALOR")) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) throw new Error("Não encontrei o cabeçalho 'FORNECEDOR/CLIENTE' e 'VALOR'.");
        const headerRow = rawData[headerIndex];
        if (!headerRow) throw new Error("Linha de cabeçalho inválida.");

        const headers = headerRow.map((h: any) => String(h).trim().toUpperCase());
        const dataRows = rawData.slice(headerIndex + 1);
        
        results = dataRows.map((row: any) => {
            const rowData: any = {};
            headers.forEach((h, index) => {
                rowData[h] = row[index];
            });
            return rowData;
        });

    } else {
         throw new Error("Formato inválido. Use Excel.");
    }

    // --- FUNÇÕES AUXILIARES (MANTIDAS) ---
    const parseExcelDate = (input: any) => {
        let finalDate = new Date();
        try {
            if (!input) return finalDate;
            if (input instanceof Date) finalDate = input;
            else if (typeof input === 'number') {
                finalDate = new Date(Math.round((input - 25569) * 86400 * 1000));
            }
            else if (typeof input === 'string') {
                const cleanInput = input.trim();
                const parts = cleanInput.split('/');
                if (parts.length === 3) finalDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                else finalDate = new Date(cleanInput);
            }
        } catch (e) { finalDate = new Date(); }
        if (isNaN(finalDate.getTime())) return new Date();
        return finalDate;
    };

    const formattedData = results
        .filter((row: any) => {
            // ALTERADO: Verifica se tem Fornecedor OU Cliente
            const temForn = !!row['FORNECEDOR'] || !!row['CLIENTE'] || !!row['NOME'];
            const temValor = !!row['VALOR'];
            return temForn && temValor;
        }) 
        .map((row: any) => {
            
            // --- LÓGICA DE STATUS INTELIGENTE (MANTIDA) ---
            const statusExcel = String(row['STATUS'] || '').trim().toUpperCase();
            
            let finalStatus = 'PENDENTE';
            if (statusExcel === 'OK' || statusExcel === 'PAGO' || statusExcel === 'BAIXADO') {
                finalStatus = 'PAGO';
            }

            // Tratamento de valor para garantir float correto
            let valString = String(row['VALOR']);
            // Remove R$, troca vírgula por ponto se necessário
            if (valString.includes(',') && !valString.includes('e')) { 
                valString = valString.replace(/\./g, '').replace(',', '.'); 
            }
            const finalValue = parseFloat(valString.replace(/[^\d.-]/g, '')) || 0;

            return {
                // ALTERADO: Pega Fornecedor OU Cliente
                supplier: String(row['FORNECEDOR'] || row['CLIENTE'] || row['NOME'] || 'Não informado').trim().toUpperCase(),
                description: String(row['DESCRIÇÃO'] || row['HISTORICO'] || '').trim(),
                category: String(row['TIPO DE DESPESA'] || (transactionType === 'INCOME' ? 'VENDAS' : 'FORNECEDORES')).trim().toUpperCase(),
                unit: String(row['LOJA'] || 'Matriz').trim(),
                payer: String(row['RAZÃO SOCIAL'] || 'Matriz').trim(),
                issueDate: parseExcelDate(row['DATA DA NF'] || new Date()),
                dueDate: parseExcelDate(row['VENCIMENTO']),
                value: finalValue,
                
                status: finalStatus,
                
                // 2. AQUI: ADICIONADO O TYPE PARA SALVAR CORRETAMENTE
                type: transactionType,

                isRecurring: false, totalInstallments: 1, currentInstallment: 1
            };
        });

    console.log(`🚀 PROCESSADO: ${formattedData.length} registros válidos.`);

    if (formattedData.length > 0) {
        await prisma.finance.createMany({ data: formattedData });
        console.log("💾 Gravado no banco com sucesso!");
    }
    
    try { fs.unlinkSync(filePath); } catch(e) {}
    res.json({ message: `Sucesso! Importado.`, type: transactionType });

  } catch (error: any) {
    console.error("❌ ERRO:", error);
    try { fs.unlinkSync(file.path); } catch(e) {}
    res.status(500).json({ error: error.message });
  }
});

//==========================================
// ROTAS DE MANUTENÇÃO E EXCLUSÃO
// ==========================================

// 1. APAGAR TUDO (O botão Reset)
app.delete('/finance/all', async (req, res) => {
  try {
    await prisma.finance.deleteMany({});
    console.log("🧹 Banco de dados financeiro limpo com sucesso!");
    res.json({ message: "Todos os registros foram apagados." });
  } catch (e) {
    res.status(500).json({ error: "Erro ao resetar banco." });
  }
});

// 2. EXCLUIR ITEM ÚNICO (A lixeira individual)
app.delete('/finance/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.finance.delete({ where: { id } });
    console.log(`🗑️ Item ${id} excluído.`);
    res.json({ message: "Item removido com sucesso." });
  } catch (e) {
    res.status(500).json({ error: "Erro ao excluir item." });
  }
});

// 3. MUDAR STATUS (PAGO / PENDENTE)
app.put('/finance/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updated = await prisma.finance.update({
        where: { id },
        data: { status }
      });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: "Erro ao atualizar status." });
    }
});

// rota com paginação
app.get('/finance', async (req, res) => {
  try {
    // Recebe a página e o limite da URL
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // --- MUDANÇA 1: Captura o tipo (Se não vier nada, assume que é DESPESA) ---
    const type = req.query.type ? String(req.query.type) : 'EXPENSE';

    // Cria o objeto de filtro para usar nas duas buscas abaixo
    const where = { type: type };

    const [total, items] = await Promise.all([
      // --- MUDANÇA 2: Adiciona o 'where' na contagem ---
      prisma.finance.count({ where }), 
      
      // --- MUDANÇA 3: Adiciona o 'where' na busca ---
      prisma.finance.findMany({
        where, 
        skip: skip,
        take: limit,
        orderBy: { dueDate: 'asc' },
      })
    ]);

    res.json({
      data: items,
      total: total,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (e) {
    console.error(e); // Ajuda a ver o erro no terminal se der pau
    res.status(500).json({ error: "Erro ao procurar dados" });
  }
});

// Rota para listar o estoque
app.get('/stock', async (req, res) => {
  try {
    const stock = await prisma.stock.findMany();
    return res.json(stock); // <--- AQUI ERA O ERRO (Faltava o res.json)
  } catch (error) {
    return res.status(500).json({ error: "Erro ao buscar estoque" });
  }
});

// --- ROTA BLINDADA PARA O PYTHON ENVIAR OS DADOS ---
app.post('/stock/sync', async (req, res) => {
  const data = req.body; 

  console.log("📦 Recebendo pacote de estoque...");

  if (!Array.isArray(data)) {
      console.error("❌ Erro: O corpo da requisição não é uma lista (Array).");
      return res.status(400).json({ error: "Formato inválido. Envie uma lista." });
  }

  console.log(`📊 Quantidade de itens recebidos: ${data.length}`);
  
  // Log do primeiro item para debug (ver se os campos batem)
  if (data.length > 0) {
      console.log("🔎 Exemplo do primeiro item:", data[0]);
  }

  try {
      // 1. Limpa o estoque antigo
      await prisma.stock.deleteMany();

      // 2. Prepara os dados com tratamento de erro (evita NaN e Null)
      const formattedData = data.map((item: any) => {
          // Função auxiliar para garantir número válido
          const safeNum = (val: any) => {
              const parsed = Number(val);
              return isNaN(parsed) ? 0 : parsed;
          };

          return {
              cnpj: String(item.CNPJ_ORIGEM || ""),
              storeName: String(item.NOME_FANTASIA || "LOJA"),
              productCode: String(item.CODIGO_PRODUTO || ""),
              reference: String(item.REFERENCIA || ""),
              description: String(item.DESCRICAO || "SEM DESCRIÇÃO"),
              category: String(item.CATEGORIA || "GERAL"),
              quantity: safeNum(item.QUANTIDADE),
              costPrice: safeNum(item.PRECO_CUSTO),
              salePrice: safeNum(item.PRECO_VENDA),
              averageCost: safeNum(item.CUSTO_MEDIO)
          };
      });

      // 3. Salva os novos (em lotes, para evitar travar se for muito grande)
      // O Prisma aguenta createMany, mas vamos garantir.
      await prisma.stock.createMany({ data: formattedData });
      
      console.log("✅ Estoque salvo com sucesso!");
      return res.json({ success: true, count: formattedData.length });

  } catch (error: any) {
      console.error("❌ ERRO CRÍTICO NO PRISMA:", error);
      return res.status(500).json({ error: "Erro ao sincronizar estoque.", details: error.message });
  }
});

// ROTA /sales (VERSÃO BLINDADA & DETETIVE)

// 2. Rota para Atualizar (Dispara o Script Python)
app.post('/sales/refresh', (req, res) => {
  const { exec } = require('child_process');
  
  // Caminhos ABSOLUTOS (Garante que ele chame o arquivo certo)
  const pythonPath = 'C:/Python312/python.exe';
  
  // ATENÇÃO: Mudamos para a pasta DATABASE onde o script correto está
  const scriptPath = 'c:/Users/Usuario/Desktop/TeleFluxo_Instalador/database/extrator_vendas.py';

  console.log("🔄 Iniciando atualização de vendas via Python...");

  exec(`"${pythonPath}" "${scriptPath}"`, (error: any, stdout: any, stderr: any) => {
    if (error) {
        console.error("❌ Erro ao rodar script Python:", stderr);
        return res.status(500).json({ error: stderr });
    }
    console.log("✅ Script Python finalizado:", stdout);
    res.json({ message: "Vendas atualizadas com sucesso!" });
  });
});

// =======================================================
// ROTA /sellers-kpi (CORRIGIDA E LIMPA)
// =======================================================
app.get('/sellers-kpi', async (req, res) => {
    // Verifica o banco global
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json([]);

    const userId = String(req.query.userId || '');
    const db = new sqlite3.Database(GLOBAL_DB_PATH); // <--- Use a global
    
    // Busca usuário (com tipagem any para evitar erro)
    const user: any = await prisma.user.findUnique({ where: { id: userId } });
    
    let kpiSql = `SELECT * FROM vendedores_kpi ORDER BY FAT_ATUAL DESC`;

    // (Mantenha sua lógica de filtro de lojas aqui... if (user && !user.isAdmin...) { ... } )
    if (user && !user.isAdmin && !['CEO', 'DIRETOR', 'ADM'].includes(user.role)) {
        if (user.allowedStores) {
            const stores = user.allowedStores.split(',').map((s: string) => `'${s.trim()}'`).join(',');
            kpiSql = `SELECT * FROM vendedores_kpi WHERE LOJA IN (${stores}) ORDER BY FAT_ATUAL DESC`;
        } else {
            kpiSql = `SELECT * FROM vendedores_kpi WHERE 1=0`;
        }
    }

    db.all(kpiSql, [], (err, rows) => {
        db.close();
        if (err) return res.status(400).json({ "error": err.message });
        res.json(rows);
    });
});;
// ==========================================
// ROTA TRADUTORA (CORRIGIDA - TYPE ANY)
// ==========================================

const LOJAS_MAP: Record<string, string> = {
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

app.get('/external-stores', async (req, res) => {
    
        // Se não achar o banco, retorna a lista completa fixa (Fallback)
   if (!fs.existsSync(GLOBAL_DB_PATH)) { // (Isso já deve estar assim, mantenha)
    return res.json(Object.values(LOJAS_MAP).sort()); 
    }

    const db = new sqlite3.Database(GLOBAL_DB_PATH);

    const sql = `SELECT DISTINCT CNPJ_EMPRESA as cnpj FROM vendas WHERE CNPJ_EMPRESA IS NOT NULL`;

    // AQUI ESTAVA O ERRO: Adicionei ": any[]" depois de rows para o TS aceitar
    db.all(sql, [], (err, rows: any[]) => {
        db.close();
        
        if (err) {
            console.error("❌ Erro SQL:", err.message);
            return res.json(Object.values(LOJAS_MAP).sort());
        }

        // === DEBUG: MOSTRAR O PRIMEIRO CNPJ ENCONTRADO ===
        if (rows && rows.length > 0) {
            console.log("🔎 DADO BRUTO DO BANCO (Exemplo):", rows[0].cnpj);
        }
        // =================================================

        const storeNames = rows.map((r: any) => {
            // Tenta limpar para deixar só números
            const cleanCnpj = String(r.cnpj).replace(/\D/g, '').trim();
            return LOJAS_MAP[cleanCnpj] || null;
        });

        const uniqueStores = [...new Set(storeNames.filter((name: any) => name !== null))];
        uniqueStores.sort();

        // SE NÃO ACHOU NADA (0 encontradas), RETORNA A LISTA COMPLETA FIXA
        if (uniqueStores.length === 0) {
            console.warn("⚠️ Nenhuma correspondência exata. Usando lista completa de backup.");
            return res.json(Object.values(LOJAS_MAP).sort());
        }

        console.log(`✅ Lojas Filtradas: ${uniqueStores.length} encontradas.`);
        res.json(uniqueStores);
    });
});

// Aumentamos o limite para 50mb para aguentar o Excel
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- INICIO DO BLOCO DE SINCRONIZAÇÃO ---

// Rota 1: Receber Vendas Gerais
app.post('/api/sync/vendas', async (req, res) => {
  const dados = req.body;

  if (!dados || !Array.isArray(dados)) {
    return res.status(400).json({ error: "Formato de dados inválido. Esperado um array." });
  }

  console.log(`📡 Recebendo ${dados.length} registros de vendas...`);

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(GLOBAL_DB_PATH);

      // evita SQLITE_BUSY imediato
      db.configure("busyTimeout", 15000);

      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("PRAGMA synchronous=NORMAL;");

        db.run("BEGIN IMMEDIATE TRANSACTION");

        db.run("DELETE FROM vendas", (err) => {
          if (err) {
            db.run("ROLLBACK", () => db.close(() => reject(err)));
            return;
          }

          const stmt = db.prepare(`
            INSERT INTO vendas (
              data_emissao, nome_vendedor, descricao, quantidade,
              total_liquido, cnpj_empresa, familia, regiao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const item of dados) {
            stmt.run(
              item.data_emissao,
              item.nome_vendedor,
              item.descricao,
              item.quantidade,
              item.total_liquido,
              item.cnpj_empresa,
              item.familia,
              item.regiao
            );
          }

          stmt.finalize((err2) => {
            if (err2) {
              db.run("ROLLBACK", () => db.close(() => reject(err2)));
              return;
            }

            db.run("COMMIT", (err3) => {
              if (err3) {
                db.run("ROLLBACK", () => db.close(() => reject(err3)));
                return;
              }
              db.close((err4) => {
                if (err4) return reject(err4);
                resolve();
              });
            });
          });
        });
      });
    }));

    console.log("✅ Vendas sincronizadas com sucesso!");
    res.json({ message: "Sincronização de Vendas concluída!" });

  } catch (e: any) {
    console.error("❌ Erro ao salvar vendas:", e);
    // Se estiver ocupado, retorne 503 para o cliente tentar de novo
    if (String(e?.message || "").includes("SQLITE_BUSY")) {
      return res.status(503).json({ error: "Banco ocupado (SQLITE_BUSY). Tente novamente em alguns segundos." });
    }
    res.status(500).json({ error: "Erro no banco de dados" });
  }
});


// Rota 2: Receber KPI Vendedores
app.post('/api/sync/vendedores', async (req, res) => {
  const dados = req.body;

  if (!dados || !Array.isArray(dados)) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  console.log(`🏆 Recebendo ${dados.length} KPIs de vendedores...`);

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(GLOBAL_DB_PATH);
      db.configure("busyTimeout", 15000);

      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("PRAGMA synchronous=NORMAL;");

        db.run("BEGIN IMMEDIATE TRANSACTION");
        db.run("DELETE FROM vendedores_kpi", (err) => {
          if (err) {
            db.run("ROLLBACK", () => db.close(() => reject(err)));
            return;
          }

          const stmt = db.prepare(`
            INSERT INTO vendedores_kpi (
              loja, vendedor, fat_atual, tendencia, fat_anterior,
              crescimento, seguros, pa, qtd, ticket, regiao, pct_seguro
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const item of dados) {
            stmt.run(
              item.loja, item.vendedor, item.fat_atual, item.tendencia,
              item.fat_anterior, item.crescimento, item.seguros, item.pa,
              item.qtd, item.ticket, item.regiao, item.pct_seguro
            );
          }

          stmt.finalize((err2) => {
            if (err2) {
              db.run("ROLLBACK", () => db.close(() => reject(err2)));
              return;
            }

            db.run("COMMIT", (err3) => {
              if (err3) {
                db.run("ROLLBACK", () => db.close(() => reject(err3)));
                return;
              }
              db.close((err4) => {
                if (err4) return reject(err4);
                resolve();
              });
            });
          });
        });
      });
    }));

    res.json({ message: "KPIs atualizados com sucesso!" });

  } catch (e: any) {
    console.error("❌ Erro ao salvar KPI:", e);
    if (String(e?.message || "").includes("SQLITE_BUSY")) {
      return res.status(503).json({ error: "Banco ocupado (SQLITE_BUSY). Tente novamente em alguns segundos." });
    }
    res.status(500).json({ error: "Erro no banco de dados" });
  }
});

// --- FIM DO BLOCO DE SINCRONIZAÇÃO ---

// Define a porta: Usa a do Render (process.env.PORT) ou a 3000 se for local
const PORT = process.env.PORT || 3000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ SERVIDOR RODANDO NA PORTA ${PORT}`);
});

