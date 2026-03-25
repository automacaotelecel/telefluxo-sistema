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

// --- CONFIGURAÇÃO CENTRALIZADA DE CAMINHOS (CORREÇÃO) ---
const ROOT_DIR = process.cwd(); 

// Define a pasta do banco (Render vs Local)
const DATABASE_DIR = process.env.RENDER 
    ? path.join(__dirname, '../../database') 
    : path.join(ROOT_DIR, 'database');

// Garante que a pasta existe
if (!fs.existsSync(DATABASE_DIR)) {
    try { fs.mkdirSync(DATABASE_DIR, { recursive: true }); } catch(e) {}
}

// DEFINIÇÃO DAS VARIÁVEIS DE CAMINHO (AQUI ESTAVA O ERRO)
const GLOBAL_DB_PATH = path.join(DATABASE_DIR, 'samsung_vendas.db');
const SAMSUNG_DB_PATH = GLOBAL_DB_PATH; // Cria um "apelido" para funcionar nas rotas novas e antigas
const BESTFLOW_DB_PATH = path.join(DATABASE_DIR, 'bestflow.db');

// ✅ NOVO: DB ANUAL SEPARADO
const ANUAL_DB_PATH = path.join(DATABASE_DIR, 'samsung_vendas_anuais.db');

console.log("📂 Banco Vendas:", GLOBAL_DB_PATH);
console.log("📂 Banco BestFlow:", BESTFLOW_DB_PATH);

// ----------------------------------------------------
// INICIALIZAÇÃO DAS TABELAS (MANTIDA)
const dbInit = new sqlite3.Database(GLOBAL_DB_PATH);
dbInit.serialize(() => {
    // 1. Cria tabela de Vendas
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_emissao TEXT, nome_vendedor TEXT, descricao TEXT,
            quantidade REAL, total_liquido REAL, cnpj_empresa TEXT,
            familia TEXT, regiao TEXT
        )
    `);

    // 2. Cria tabela de KPIs
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendedores_kpi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loja TEXT, vendedor TEXT, fat_atual REAL, tendencia REAL,
            fat_anterior REAL, crescimento REAL, seguros REAL, pa REAL,
            qtd REAL, ticket REAL, regiao TEXT, pct_seguro REAL
        )
    `);
    
       
    // 4. Tabela de Inputs Manuais (Faturado, Sugestão, Pedido)
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS sugestao_compras_manual (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modelo TEXT,
            regiao_aba TEXT, -- Ex: 'DF_GO', 'MG', 'NE'
            faturado INTEGER DEFAULT 0,
            sugestao_coordenador INTEGER DEFAULT 0,
            pedido_rufino INTEGER DEFAULT 0,
            UNIQUE(modelo, regiao_aba)
        )
    `);

    // 5. Tabela de Compras Pendentes (Vem do Google Sheets futuramente)
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS compras_pendentes (
            modelo TEXT PRIMARY KEY,
            quantidade_pendente INTEGER DEFAULT 0
        )
    `);
    // ---------------------------------------------
    // --- [NOVO] TABELAS PARA HISTÓRICO ANUAL ---
    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendas_anuais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_emissao TEXT, nome_vendedor TEXT, descricao TEXT,
            quantidade REAL, total_liquido REAL, cnpj_empresa TEXT,
            familia TEXT, regiao TEXT
        )
    `);

    dbInit.run(`
        CREATE TABLE IF NOT EXISTS vendedores_anuais (
            loja TEXT, vendedor TEXT, fat_atual REAL, tendencia REAL,
            fat_anterior REAL, crescimento REAL, pa REAL, ticket REAL,
            qtd REAL, regiao TEXT, pct_seguro REAL, seguros REAL
        )
    `);
    console.log("📦 Tabelas do Banco de Dados Garantidas!");
});

const anualInit = new sqlite3.Database(ANUAL_DB_PATH);
anualInit.serialize(() => {
  // RAW VENDAS
  anualInit.run(`
  CREATE TABLE IF NOT EXISTS agg_lojas_mensal (
    ano INTEGER,
    mes INTEGER,
    loja TEXT,
    cnpj_empresa TEXT,
    regiao TEXT,
    vendas_total REAL,
    vendas_qtd REAL,
    seguros_total REAL,
    seguros_qtd REAL,
    PRIMARY KEY (ano, mes, loja)
  )
  `);

  // RAW SEGUROS
  anualInit.run(`
    CREATE TABLE IF NOT EXISTS seguros_anuais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_emissao TEXT,
      ano INTEGER,
      mes INTEGER,
      loja TEXT,
      cnpj_empresa TEXT,
      nome_vendedor TEXT,
      premio_real REAL,
      qtd REAL,
      regiao TEXT
    )
  `);

  // AGG LOJA/MÊS/ANO (pronto pro comparativo)
  anualInit.run(`
    CREATE TABLE IF NOT EXISTS agg_lojas_mensal (
      ano INTEGER,
      mes INTEGER,
      loja TEXT,
      cnpj_empresa TEXT,
      regiao TEXT,
      venda_total REAL,
      venda_qtd REAL,
      seguro_total REAL,
      seguro_qtd REAL,
      PRIMARY KEY (ano, mes, loja)
    )
  `);

  // AGG VENDEDOR/MÊS/ANO (pronto pro comparativo)
  anualInit.run(`
  CREATE TABLE IF NOT EXISTS agg_vendedores_mensal (
    ano INTEGER,
    mes INTEGER,
    loja TEXT,
    cnpj_empresa TEXT,
    regiao TEXT,
    vendedor TEXT,
    vendas_total REAL,
    vendas_qtd REAL,
    seguros_total REAL,
    seguros_qtd REAL,
    PRIMARY KEY (ano, mes, loja, vendedor)
  )
 `);

  console.log("📦 Tabelas ANUAIS garantidas!");
});

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());

// Garante que a pasta existe
if (!fs.existsSync(DATABASE_DIR)) {
    try { fs.mkdirSync(DATABASE_DIR, { recursive: true }); } catch(e) {}
}

console.log("📂 Banco Vendas:", GLOBAL_DB_PATH);
console.log("📂 Banco BestFlow:", BESTFLOW_DB_PATH);

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

// ==========================================
// 🛡️ SISTEMA DE SEGURANÇA E FILTROS (VERSÃO DEBUG)
// ==========================================

async function getSalesFilter(userId: string, tableType: 'vendas' | 'kpi'): Promise<string> {
    console.log(`\n🔍 [SECURITY CHECK] Validando acesso para UserID: "${userId}"`);

    if (!userId || userId === 'undefined' || userId === 'null' || userId === '') {
        console.warn("⛔ BLOQUEIO: UserID inválido ou não fornecido.");
        return "1=0"; 
    }

    // Busca usuário no Prisma (Agora apontando para o mesmo DB)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
        console.warn("⛔ BLOQUEIO: Usuário não encontrado no Banco de Dados.");
        return "1=0"; 
    }

    console.log(`👤 USUÁRIO: ${user.name} | CARGO: ${user.role}`);

    // 1. DIRETORIA E ADM: ACESSO TOTAL
    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'];
    if (user.isAdmin || superRoles.includes(String(user.role).toUpperCase())) {
        console.log("✅ ACESSO LIBERADO: Super Usuário/Admin.");
        return "1=1"; 
    }

    // 2. USUÁRIOS COMUNS (VENDEDORES/GERENTES)
    if (!user.allowedStores || user.allowedStores.trim() === "") {
        console.warn("⛔ BLOQUEIO: Usuário não tem lojas vinculadas no cadastro.");
        return "1=0"; 
    }

    const rawStoreNames = user.allowedStores.split(',').map(s => normStore(s));
    console.log(`🏢 Lojas Permitidas (Cadastro):`, rawStoreNames);

    const correctedStoreNames = rawStoreNames.map(s => {
        const corrigido = CORRECAO_NOMES_SERVER[s];
        return corrigido ? normStore(corrigido) : s;
    });
    
    if (tableType === 'kpi') {
        // Tabela KPI usa NOME DA LOJA (Texto)
        // BLINDAGEM: Garante que as aspas estão certas
        const storesSql = correctedStoreNames.map(s => `'${s}'`).join(',');
        console.log(`🛡️ Filtro SQL (KPI): UPPER(loja) IN (${storesSql})`);
        return `UPPER(loja) IN (${storesSql})`;
    } else {
        // Tabela VENDAS usa CNPJ
        const cnpjs = correctedStoreNames.map(name => getCnpjByName(name)).filter((c): c is string => c !== null);
        
        if (cnpjs.length === 0) {
            console.error("🔴 ERRO CRÍTICO: Nenhuma das lojas do usuário foi encontrada no Mapa de CNPJ.");
            console.log("Dica: Verifique a grafia em LOJAS_MAP_GLOBAL no server.ts");
            return "1=0";
        }
        
        const cnpjsSql = cnpjs.map(c => `'${c}'`).join(',');
        console.log(`🛡️ Filtro SQL (Vendas): cnpj_empresa IN (${cnpjsSql})`);
        return `cnpj_empresa IN (${cnpjsSql})`;
    }
}

// ==========================================
// 2. ROTA /sales (VERSÃO FINAL LIMPA) -- ROTA DE VENDAS
// ==========================================
app.get('/sales', async (req, res) => {
  try {
    if (!fs.existsSync(GLOBAL_DB_PATH)) return res.json({ sales: [] });

    // 1. Pega os parâmetros da URL
    const userId = String(req.query.userId || '');
    const startDate = req.query.startDate ? String(req.query.startDate) : null;
    const endDate = req.query.endDate ? String(req.query.endDate) : null;

    // 2. Filtro de Segurança (CNPJ/Loja do usuário)
    // Mantém sua função original que já funciona
    const securityFilter = await getSalesFilter(userId, 'vendas'); 

    // 3. Monta o Filtro de Datas (SQL)
    let dateFilter = "";
    
    // Se o frontend mandou as datas, aplicamos o filtro
    if (startDate && endDate) {
        // SQLite grava data como TEXTO (YYYY-MM-DD), então comparação de string funciona perfeitamente
        // Usamos >= e <= para pegar o dia inteiro
        dateFilter = ` AND data_emissao >= '${startDate}' AND data_emissao <= '${endDate}'`;
    }

    // 4. Conecta e Busca
    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
    
    // A query final combina e FORÇA o nome das colunas em MAIÚSCULO para o React ler perfeitamente
    const query = `
        SELECT 
            data_emissao AS DATA_EMISSAO,
            nome_vendedor AS NOME_VENDEDOR,
            descricao AS DESCRICAO,
            quantidade AS QUANTIDADE,
            total_liquido AS TOTAL_LIQUIDO,
            cnpj_empresa AS CNPJ_EMPRESA,
            familia AS FAMILIA,
            regiao AS REGIAO
        FROM vendas
        WHERE ${securityFilter} ${dateFilter}
        ORDER BY data_emissao ASC
    `;

    console.log("🔍 Executando Query de Vendas:", query); // Log para você ver no terminal se a data chegou

    const salesRaw = await db.all(query);
    await db.close();
    
    // APLICA A CORREÇÃO AQUI
    const sales = normalizeKeys(salesRaw);
    
    res.json({ sales });

  } catch (error: any) {
    console.error("❌ Erro na rota /sales:", error.message);
    res.status(500).json({ error: "Erro ao buscar vendas" });
  }
});

// ==========================================
// 🛡️ FUNÇÕES AUXILIARES DE BI (CORREÇÃO DE DATA BR)
// ==========================================

// Função que monta o WHERE convertendo DD/MM/YYYY para YYYY-MM-DD na voo
const getDateFilter = (start?: any, end?: any) => {
    if (start && end) {
        // Como o Python já salva como YYYY-MM-DD, não precisamos converter nada!
        // Apenas comparamos a coluna data_emissao direto.
        return ` AND data_emissao >= '${start}' AND data_emissao <= '${end}' `;
    }
    return ""; 
};

// 1. ROTA DE RESUMO (CARDS)
app.get('/bi/summary', async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        const securityFilter = await getSalesFilter(String(userId), 'vendas');
        const dateFilter = getDateFilter(startDate, endDate); // Usa o novo filtro conversor

        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        const query = `
            SELECT 
                SUM(total_liquido) as total_vendas,
                SUM(quantidade) as total_pecas,
                AVG(total_liquido) as ticket_medio
            FROM vendas 
            WHERE ${securityFilter} ${dateFilter}
        `;
        
        const result = await db.get(query);
        await db.close();
        
        res.json({
            total_vendas: result?.total_vendas || 0,
            total_pecas: result?.total_pecas || 0,
            ticket_medio: result?.total_vendas && result?.total_pecas ? result.total_vendas / result.total_pecas : 0
        });
    } catch (e) { console.error(e); res.status(500).json({}); }
});

// 2. ROTA DE GRÁFICO (EVOLUÇÃO)
app.get('/bi/chart', async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        const securityFilter = await getSalesFilter(String(userId), 'vendas');
        const dateFilter = getDateFilter(startDate, endDate);

        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

        // Aqui também convertemos para garantir a ordenação correta
        const query = `
            SELECT 
                substr(data_emissao, 1, 5) as dia, -- Pega '06/02' direto da string BR
                (substr(data_emissao, 7, 4) || '-' || substr(data_emissao, 4, 2) || '-' || substr(data_emissao, 1, 2)) as dateIso, 
                SUM(total_liquido) as valor
            FROM vendas 
            WHERE ${securityFilter} ${dateFilter}
            GROUP BY dateIso
            ORDER BY dateIso ASC
        `;

        const result = await db.all(query);
        await db.close();
        res.json(result);
    } catch (e) { console.error(e); res.json([]); }
});

// 3. ROTA DE RANKING
app.get('/bi/ranking', async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        const securityFilter = await getSalesFilter(String(userId), 'vendas');
        const dateFilter = getDateFilter(startDate, endDate);

        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

        const query = `
            SELECT 
                vendedor_nome as nome,
                loja, 
                SUM(total_liquido) as total,
                SUM(quantidade) as qtd
            FROM vendas 
            WHERE ${securityFilter} ${dateFilter}
            GROUP BY vendedor_nome
            ORDER BY total DESC
        `;

        const result = await db.all(query);
        await db.close();
        res.json(result);
    } catch (e) { console.error(e); res.json([]); }
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

app.post('/stock/sync', async (req, res) => {
  const data = req.body;
  const shouldReset = req.query.reset !== 'false';

  console.log(`📦 Recebendo lote de estoque... Resetar Banco: ${shouldReset}`);

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Formato inválido. Envie uma lista." });
  }

  try {
    if (shouldReset) {
      await prisma.stock.deleteMany();
      console.log("🗑️ Banco de estoque limpo para iniciar nova carga.");
    }

    const safeNum = (val: any) => {
      const parsed = Number(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    const safeStr = (val: any, fallback = "") => {
      if (val === null || val === undefined) return fallback;
      return String(val).trim();
    };

    const formattedData = data.map((item: any) => {
      const emLinhaValue = safeStr(
        item.EM_LINHA ??
        item.em_linha ??
        item.emLinha ??
        item.linha,
        ""
      );

      const clusterValue = safeStr(
        item.CLUSTER ??
        item.cluster ??
        item.Cluster,
        ""
      );

      return {
        cnpj: safeStr(item.CNPJ_ORIGEM),
        storeName: safeStr(item.NOME_FANTASIA, "LOJA"),
        productCode: safeStr(item.CODIGO_PRODUTO),
        reference: safeStr(item.REFERENCIA),
        description: safeStr(item.DESCRICAO, "SEM DESCRIÇÃO"),
        category: safeStr(item.CATEGORIA, "GERAL"),
        quantity: safeNum(item.QUANTIDADE),
        costPrice: safeNum(item.PRECO_CUSTO),
        salePrice: safeNum(item.PRECO_VENDA),
        averageCost: safeNum(item.CUSTO_MEDIO),
        serial: safeStr(item.SERIAL),

        // ✅ NOVAS COLUNAS
        emLinha: emLinhaValue,
        cluster: clusterValue
      };
    });

    await prisma.stock.createMany({
      data: formattedData
    });

    // =======================================================
    // INTELIGÊNCIA DE RASTREAMENTO DE IMEI
    // =======================================================
    for (const item of formattedData) {
      if (item.serial && item.serial.trim() !== '') {
        const serialClean = item.serial.trim();

        const existing = await prisma.imeiHistory.findUnique({
          where: { serial: serialClean }
        });

        if (!existing) {
          await prisma.imeiHistory.create({
            data: {
              serial: serialClean,
              productCode: item.productCode,
              description: item.description,
              currentStore: item.storeName
            }
          });
        } else if (existing.currentStore !== item.storeName) {
          await prisma.imeiHistory.update({
            where: { serial: serialClean },
            data: {
              currentStore: item.storeName,
              entryDateStore: new Date(),
              transferCount: existing.transferCount + 1
            }
          });
        }
      }
    }
    // =======================================================

    console.log(`✅ Lote processado com sucesso: ${formattedData.length} registros.`);
    console.log("🔎 Exemplo do primeiro item salvo:", formattedData[0]);

    return res.json({
      success: true,
      count: formattedData.length
    });

  } catch (error: any) {
    console.error("❌ ERRO CRÍTICO NO PRISMA:", error);
    return res.status(500).json({
      error: "Erro ao sincronizar estoque.",
      details: error.message
    });
  }
});

// ==========================================
// 📦 ROTA QUE O REACT USA PARA LER O ESTOQUE (FALTAVA ISSO)
// ==========================================
app.get('/stock', async (req, res) => {
    try {
        // Busca todo o estoque salvo pelo Python
        const stock = await prisma.stock.findMany();
        
        // Retorna para o Frontend
        res.json(stock);
    } catch (error) {
        console.error("Erro ao buscar estoque:", error);
        res.status(500).json({ error: "Erro ao carregar estoque" });
    }
});

// --- ROTA DE ANÁLISE (AGING DE ESTOQUE) ---
app.get('/stock/analysis', async (req, res) => {
    try {
        const currentStock = await prisma.stock.findMany({
            where: { serial: { not: '' } } // <-- Removido o not: null para evitar o erro 1117
        });

        const histories = await prisma.imeiHistory.findMany();

        const historyMap = new Map();
        histories.forEach((h: any) => historyMap.set(h.serial, h)); // <-- Usando h.serial

        const analysisData = currentStock.map((item: any) => {
            const hist = historyMap.get(item.serial as string);
            
            const today = new Date();
            const entryDate = hist ? new Date(hist.entryDateCompany) : today; // <-- Ajustado
            const storeEntryDate = hist ? new Date(hist.entryDateStore) : today; // <-- Ajustado
            
            const msPerDay = 1000 * 3600 * 24;
            const daysInCompany = Math.floor((today.getTime() - entryDate.getTime()) / msPerDay);
            const daysInStore = Math.floor((today.getTime() - storeEntryDate.getTime()) / msPerDay);

            return {
                id: item.id,
                storeName: item.storeName,
                productCode: item.productCode,
                description: item.description,
                category: item.category,
                serial: item.serial,
                daysInCompany,
                daysInStore,
                transferCount: hist ? hist.transferCount : 0
            };
        });

        res.json(analysisData);
    } catch (error: any) {
        console.error("Erro na rota de análise:", error);
        res.status(500).json({ error: "Erro ao buscar análise de IMEI." });
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
// ROTA /sellers-kpi (O Front-end chama essa!)
// =======================================================
const handleSellersKpi = async (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(GLOBAL_DB_PATH)) {
      return res.json([]);
    }

    const userId = String(req.query.userId || "");
    const user: any = await prisma.user.findUnique({ where: { id: userId } });

    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const baseSelect = `
      SELECT
        loja,
        vendedor,
        fat_atual,
        fat_atual AS faturamento,
        tendencia,
        fat_anterior,
        fat_anterior AS mes_anterior,
        crescimento,
        pct_acessorios,
        conv_peliculas,
        seguros,
        pct_seguro,
        pa,
        ticket,
        ticket AS ticket_medio,
        qtd,
        regiao,
        rs_aparelho,
        rs_acessorio,
        rs_tablet,
        rs_wearable
      FROM vendedores
    `;

    let query = `${baseSelect} ORDER BY fat_atual DESC, vendedor ASC`;
    let params: any[] = [];

    const isPrivileged =
      user &&
      (user.isAdmin || ['CEO', 'DIRETOR', 'ADM'].includes(user.role));

    if (!isPrivileged) {
      const allowedStores = String(user?.allowedStores || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      if (allowedStores.length === 0) {
        await db.close();
        return res.json([]);
      }

      const placeholders = allowedStores.map(() => "?").join(", ");
      query = `${baseSelect} WHERE loja IN (${placeholders}) ORDER BY fat_atual DESC, vendedor ASC`;
      params = allowedStores;
    }

    const rows = await db.all(query, params);
    await db.close();

    return res.json(rows || []);
  } catch (e: any) {
    console.error("Erro /sellers-kpi:", e);
    return res.status(500).json({ error: e.message || "Erro ao buscar KPI de vendedores" });
  }
};

app.get('/sellers-kpi', handleSellersKpi);
app.get('/api/kpi-vendedores', handleSellersKpi);

// Aumentamos o limite para 50mb para aguentar o Excel
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================
// ⚠️ ROTA DO HISTÓRICO ANUAL OTIMIZADA (CORRIGIDA)
// ============================================================
app.get('/sales_anuais', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const securityFilter = await getSalesFilter(userId, 'vendas');

    if (!fs.existsSync(ANUAL_DB_PATH)) {
      return res.json({ sales: [] });
    }

    const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const query = `
      SELECT
        substr(data_emissao, 1, 7) || '-01' as data_emissao,
        cnpj_empresa,
        descricao,
        COALESCE(familia, 'OUTROS') as familia,
        SUM(COALESCE(total_liquido, 0)) as total_liquido,
        SUM(COALESCE(quantidade, 0)) as quantidade
      FROM vendas_anuais
      WHERE ${securityFilter}
        AND data_emissao IS NOT NULL
      GROUP BY substr(data_emissao, 1, 7), cnpj_empresa, descricao, COALESCE(familia, 'OUTROS')
      ORDER BY data_emissao ASC
    `;

    const salesRaw = await db.all(query);
    await db.close();

    res.json({ sales: normalizeKeys(salesRaw) });
  } catch (e: any) {
    console.error("Erro /sales_anuais:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- ROTA DE RAIO-X (DEBUG MELHORADO) ---
app.get('/api/debug', async (req, res) => {
  try {
    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
    const dbAnual = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const totalVendas = await db.get("SELECT count(*) as total FROM vendas");
    const totalKPI = await db.get("SELECT count(*) as total FROM vendedores_kpi");

    let totalAnual: any = { total: 0 };
    try {
      totalAnual = (await dbAnual.get("SELECT count(*) as total FROM vendas_anuais")) || { total: 0 };
    } catch (e) {}

    await db.close();
    await dbAnual.close();

    res.json({
      status: "Online",
      banco_vendas_existe: fs.existsSync(GLOBAL_DB_PATH),
      banco_anual_existe: fs.existsSync(ANUAL_DB_PATH),
      total_linhas_vendas: totalVendas?.total || 0,
      total_linhas_kpi: totalKPI?.total || 0,
      total_linhas_anuais: totalAnual?.total || 0
    });
  } catch (e: any) {
    res.json({ erro: e.message });
  }
});

// 🛒 ROTA DE SINCRONIZAÇÃO DE VENDAS (RECEBE DO PYTHON)
// ==========================================
app.post('/api/sync/vendas', async (req, res) => {
    const dados = req.body;
    const reset = req.query.reset === 'true';

    if (!Array.isArray(dados)) {
        return res.status(400).json({ error: "Formato inválido" });
    }

    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        await db.exec("BEGIN TRANSACTION");

        // SEGREDO AQUI: O DROP TABLE apaga a tabela antiga para recriar com a nova coluna "familia"
        if (reset) {
            await db.exec("DROP TABLE IF EXISTS vendas");
        }

        // Cria a tabela garantindo que a coluna familia exista
        await db.exec(`
            CREATE TABLE IF NOT EXISTS vendas (
                data_emissao TEXT,
                nome_vendedor TEXT,
                descricao TEXT,
                quantidade REAL,
                total_liquido REAL,
                cnpj_empresa TEXT,
                regiao TEXT,
                familia TEXT
            )
        `);

        // Ensina o servidor a inserir a familia
        const stmt = await db.prepare(`
            INSERT INTO vendas (data_emissao, nome_vendedor, descricao, quantidade, total_liquido, cnpj_empresa, regiao, familia)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of dados) {
            await stmt.run(
                item.data_emissao,
                item.nome_vendedor,
                item.descricao,
                item.quantidade,
                item.total_liquido,
                item.cnpj_empresa,
                item.regiao,
                item.familia || 'OUTROS' // Salva a categoria enviada pelo Python
            );
        }

        await stmt.finalize();
        await db.exec("COMMIT");
        await db.close();

        res.json({ success: true, gravados: dados.length });
    } catch (e: any) {
        console.error("Erro Sync Vendas:", e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// ⚠️ [NOVO] ROTAS DE SYNC ANUAL (Para o Python enviar os lotes)
// ============================================================

// 1. Recebe Lotes de Vendas Anuais
app.post('/api/sync/vendas_anuais', async (req, res) => {
  const dados = req.body;
  const shouldReset = req.query.reset !== 'false';

  if (!dados || !Array.isArray(dados)) {
    return res.status(400).json({ error: "Formato inválido." });
  }

  const fixDate = (d: string) => {
    if (!d) return null;
    if (d.includes('/')) {
      const parts = d.split('/');
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return d;
  };

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(ANUAL_DB_PATH);
      db.configure("busyTimeout", 15000);

      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("PRAGMA synchronous=NORMAL;");
        db.run("BEGIN IMMEDIATE TRANSACTION");

        const preQuery = shouldReset ? "DELETE FROM vendas_anuais" : "SELECT 1";

        db.run(preQuery, (err) => {
          if (err) {
            db.run("ROLLBACK", () => db.close(() => reject(err)));
            return;
          }

          const stmt = db.prepare(`
            INSERT INTO vendas_anuais (
              data_emissao,
              ano,
              mes,
              loja,
              cnpj_empresa,
              nome_vendedor,
              descricao,
              familia,
              regiao,
              quantidade,
              total_liquido
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const item of dados) {
            const data = fixDate(item.data_emissao);
            const ano = data ? Number(String(data).slice(0, 4)) : null;
            const mes = data ? Number(String(data).slice(5, 7)) : null;

            stmt.run(
              data,
              ano,
              mes,
              item.loja || null,
              item.cnpj_empresa || null,
              item.nome_vendedor || null,
              item.descricao || null,
              item.familia || 'OUTROS',
              item.regiao || null,
              Number(item.quantidade || 0),
              Number(item.total_liquido || 0)
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

    res.json({ message: `Lote de Vendas Anuais Sincronizado (Reset: ${shouldReset})` });
  } catch (e: any) {
    console.error("Erro /api/sync/vendas_anuais:", e);
    res.status(500).json({ error: "Erro banco anual", details: e.message });
  }
});

// 2. Recebe Lotes de KPI Anuais (Vendedores)
app.post('/api/sync/vendedores_anuais', async (req, res) => {
    const dados = req.body;
    if (!dados || !Array.isArray(dados)) return res.status(400).json({ error: "Dados inválidos" });
    try {
      await enqueueWrite(() => new Promise<void>((resolve, reject) => {
        const db = new sqlite3.Database(GLOBAL_DB_PATH);
        db.configure("busyTimeout", 15000);
        db.serialize(() => {
          db.run("PRAGMA journal_mode=WAL;");
          db.run("BEGIN IMMEDIATE TRANSACTION");
          db.run("DELETE FROM vendedores_anuais", (err) => {
            if (err) { db.run("ROLLBACK", () => db.close(() => reject(err))); return; }
            const stmt = db.prepare(`
              INSERT INTO vendedores_anuais (
                loja, vendedor, fat_atual, tendencia, fat_anterior,
                crescimento, pa, ticket, qtd, regiao, pct_seguro, seguros
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const item of dados) {
              stmt.run(
                item.loja, item.vendedor, item.fat_atual, item.tendencia, item.fat_anterior,
                item.crescimento, item.pa, item.ticket, item.qtd, item.regiao, item.pct_seguro, item.seguros
              );
            }
            stmt.finalize((err2) => {
              if (err2) { db.run("ROLLBACK", () => db.close(() => reject(err2))); return; }
              db.run("COMMIT", (err3) => {
                if (err3) { db.run("ROLLBACK", () => db.close(() => reject(err3))); return; }
                db.close((err4) => { if (err4) return reject(err4); resolve(); });
              });
            });
          });
        });
      }));
      res.json({ message: "KPIs Anuais atualizados com sucesso!" });
    } catch (e: any) { res.status(500).json({ error: "Erro banco KPI Anual" }); }
});
// --- FIM DO BLOCO DE SINCRONIZAÇÃO ---

// ==========================================
// ROTA FALTANTE: LISTAR LOJAS PARA CADASTRO
// ==========================================
app.get('/external-stores', async (req, res) => {
    // Se o banco estiver vazio (deploy novo), retorna a lista fixa do código
    if (!fs.existsSync(GLOBAL_DB_PATH)) { 
        return res.json(Object.values(LOJAS_MAP_GLOBAL).sort()); 
    }

    const db = new sqlite3.Database(GLOBAL_DB_PATH);
    const sql = `SELECT DISTINCT CNPJ_EMPRESA as cnpj FROM vendas WHERE CNPJ_EMPRESA IS NOT NULL`;

    db.all(sql, [], (err, rows: any[]) => {
        db.close();
        
        // Se der erro ou não tiver vendas ainda, usa a lista fixa (Backup Seguro)
        if (err || !rows || rows.length === 0) {
            return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
        }

        // Tenta pegar do banco, mas se falhar, garante com a lista global
        const storeNames = rows.map((r: any) => {
            const cleanCnpj = String(r.cnpj).replace(/\D/g, '').trim();
            return LOJAS_MAP_GLOBAL[cleanCnpj] || null;
        });

        const uniqueStores = [...new Set(storeNames.filter((name: any) => name !== null))];
        uniqueStores.sort();

        // Se a lista do banco vier vazia, manda a completa
        if (uniqueStores.length === 0) {
            return res.json(Object.values(LOJAS_MAP_GLOBAL).sort());
        }

        res.json(uniqueStores);
    });
});

// ROTA: TABELA DE PREÇOS (COM TRADUÇÃO DE CATEGORIA)
app.get('/price-table', async (req, res) => {
    try {
        const { category } = req.query;
        
        const whereClause: any = {};

        // --- AQUI ESTÁ A CORREÇÃO MÁGICA ---
        if (category) {
             const cat = String(category);
             
             if (cat === 'Aparelhos') {
                 whereClause.category = 'Tabela Aparelhos';
             } 
             else if (cat === 'Obsoletos') {
                 whereClause.category = 'Tabela Obsoletos';
             } 
             else if (cat === 'Acessorios') {
                 // O Python salva como "Tabela Acessorios" (sem acento no código python)
                 whereClause.category = 'Tabela Acessorios'; 
             }
             else {
                 // Caso venha algo diferente, tenta buscar direto
                 whereClause.category = cat;
             }
        }
        // ------------------------------------
        
        const prices = await prisma.priceTable.findMany({
            where: whereClause,
            orderBy: [
                { highlight: 'desc' }, // Destaques primeiro
                { model: 'asc' }       // Ordem alfabética
            ]
        });
        
        res.json(prices);
    } catch (e) {
        console.error("Erro rota price-table:", e);
        res.status(500).json({ error: "Erro ao buscar preços" });
    }
});

// ==========================================
// MÓDULO DE COMPRAS (VERSÃO CORRIGIDA E SIMPLIFICADA)
// ==========================================

// 1. Rota de Escrita (Sync) - Sem WAL, Sem Transações complexas
app.post('/api/sync/compras', async (req, res) => {
    let dbConn;
    try {
        const { compras } = req.body;
        if (!compras || !Array.isArray(compras)) return res.status(400).json({ error: "Dados inválidos" });

        // Abre conexão direta
        dbConn = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        // Garante tabela
        await dbConn.exec(`CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, descricao TEXT, regiao TEXT, qtd_total INTEGER, previsao_info TEXT, data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP)`);

        // Limpa tudo
        await dbConn.run('DELETE FROM compras'); 
        
        // Prepara inserção
        const stmt = await dbConn.prepare('INSERT INTO compras (descricao, regiao, qtd_total, previsao_info) VALUES (?, ?, ?, ?)');
        
        let inseridos = 0;
        for (const c of compras) {
            const desc = c.descricao || "N/D";
            const reg = c.regiao || "OUTROS";
            const qtd = Number(c.qtd) || 0;
            const prev = JSON.stringify(c.previsao || {});
            
            await stmt.run(desc, reg, qtd, prev);
            inseridos++;
        }
        
        await stmt.finalize();
        
        // VERIFICAÇÃO FINAL (O "Dedo-Duro")
        const count = await dbConn.get('SELECT count(*) as total FROM compras');
        
        await dbConn.close(); // Fecha para garantir gravação no disco
        
        console.log(`📦 Sincronização finalizada. Itens no banco: ${count.total}`);
        
        res.json({ 
            message: "Sincronização concluída", 
            enviados: compras.length, 
            gravados: count.total // O Python vai mostrar isso
        });

    } catch (error: any) {
        console.error("❌ Erro no backend:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Rota de Leitura (Frontend)
app.get('/purchases', async (req, res) => {
    try {
        // Abre conexão nova para garantir leitura atualizada
        const dbConn = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        const compras = await dbConn.all('SELECT * FROM compras');
        await dbConn.close();
        res.json(compras);
    } catch (error) {
        res.status(500).json({ error: "Erro ao ler compras" });
    }
});

app.get('/api/bestflow', async (req, res) => {
    try {
        const dbConn = await open({ filename: BESTFLOW_DB_PATH, driver: sqlite3.Database });
        
        // Verifica se a tabela 'resumo_diario' existe (o Python cria com esse nome)
        const tables = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='resumo_diario'");
        
        if (tables.length === 0) {
            await dbConn.close();
            return res.json([]); 
        }

        const dados = await dbConn.all("SELECT * FROM resumo_diario");
        await dbConn.close();
        res.json(dados);
    } catch (error) {
        console.error("Erro Bestflow:", error);
        res.json([]);
    }
});

// --- ROTA DE KPIS (TENDÊNCIA, SEGUROS) ---
app.get('/api/kpi-vendedores', async (req, res) => {
    try {
        const db = await open({ filename: SAMSUNG_DB_PATH, driver: sqlite3.Database });
        
        // Lendo DIRETAMENTE E APENAS da tabela 'vendedores' conforme solicitado
        const kpis = await db.all("SELECT * FROM vendedores");
        
        await db.close();
        res.json(normalizeKeys(kpis));
    } catch (error) {
        console.error("Erro KPI:", error);
        res.json([]);
    }
});

// --- ROTAS DE SINCRONIZAÇÃO (RECEBEM DADOS DO PYTHON) ---

// 1. Recebe BESTFLOW (Fluxo)
app.post('/api/sync/bestflow', async (req, res) => {
    try {
        const dados = req.body;
        if (!Array.isArray(dados)) return res.status(400).json({ error: "Dados inválidos" });

        const db = await open({ filename: BESTFLOW_DB_PATH, driver: sqlite3.Database });
        await db.exec(`
            CREATE TABLE IF NOT EXISTS resumo_diario (
                data TEXT, cnpj14 TEXT, loja TEXT, entradas INTEGER, saidas INTEGER,
                qtd_vendida INTEGER, valor_vendido REAL, conversao REAL,
                PRIMARY KEY (data, cnpj14)
            )
        `);

        await db.exec("BEGIN TRANSACTION");
        const stmt = await db.prepare(`
            INSERT OR REPLACE INTO resumo_diario (data, cnpj14, loja, entradas, saidas, qtd_vendida, valor_vendido, conversao)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of dados) {
            await stmt.run(row.data, row.cnpj14, row.loja, row.entradas, row.saidas, row.qtd_vendida, row.valor_vendido, row.conversao);
        }
        await stmt.finalize();
        await db.exec("COMMIT");
        await db.close();
        
        console.log(`✅ Bestflow Sync: ${dados.length} registros.`);
        res.json({ success: true });
    } catch (e: any) {
        console.error("Erro sync Bestflow:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 🛒 SINCRONIZAÇÃO DE VENDEDORES (Para o Python)
// ==========================================

app.post('/api/sync/vendedores', async (req, res) => {
  let db: any;

  try {
    const dados = req.body;
    const reset = String(req.query.reset || "true") !== "false";

    if (!Array.isArray(dados)) {
      return res.status(400).json({ error: "Dados inválidos" });
    }

    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    await db.exec("BEGIN TRANSACTION");

    if (reset) {
      await db.exec("DROP TABLE IF EXISTS vendedores");

      await db.exec(`
        CREATE TABLE vendedores (
          loja TEXT,
          cnpj_empresa TEXT,
          vendedor TEXT,
          fat_atual REAL,
          tendencia REAL,
          fat_anterior REAL,
          crescimento REAL,
          pa REAL,
          ticket REAL,
          qtd REAL,
          regiao TEXT,
          pct_seguro REAL,
          seguros REAL,
          pct_acessorios REAL,
          conv_peliculas REAL,
          rs_aparelho REAL,
          rs_acessorio REAL,
          rs_tablet REAL,
          rs_wearable REAL
        )
      `);
    } else {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS vendedores (
          loja TEXT,
          cnpj_empresa TEXT,
          vendedor TEXT,
          fat_atual REAL,
          tendencia REAL,
          fat_anterior REAL,
          crescimento REAL,
          pa REAL,
          ticket REAL,
          qtd REAL,
          regiao TEXT,
          pct_seguro REAL,
          seguros REAL,
          pct_acessorios REAL,
          conv_peliculas REAL,
          rs_aparelho REAL,
          rs_acessorio REAL,
          rs_tablet REAL,
          rs_wearable REAL
        )
      `);
    }

    const stmt = await db.prepare(`
      INSERT INTO vendedores (
        loja,
        cnpj_empresa,
        vendedor,
        fat_atual,
        tendencia,
        fat_anterior,
        crescimento,
        pa,
        ticket,
        qtd,
        regiao,
        pct_seguro,
        seguros,
        pct_acessorios,
        conv_peliculas,
        rs_aparelho,
        rs_acessorio,
        rs_tablet,
        rs_wearable
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of dados) {
      await stmt.run(
        item.loja ?? null,
        item.cnpj_empresa ?? null,
        item.vendedor ?? null,
        Number(item.fat_atual ?? item.faturamento ?? 0),
        Number(item.tendencia ?? 0),
        Number(item.fat_anterior ?? item.mes_anterior ?? 0),
        Number(item.crescimento ?? 0),
        Number(item.pa ?? 0),
        Number(item.ticket ?? item.ticket_medio ?? 0),
        Number(item.qtd ?? 0),
        item.regiao ?? null,
        Number(item.pct_seguro ?? item.pct_seguros ?? 0),
        Number(item.seguros ?? 0),
        Number(item.pct_acessorios ?? 0),
        Number(item.conv_peliculas ?? 0),
        Number(item.rs_aparelho ?? 0),
        Number(item.rs_acessorio ?? 0),
        Number(item.rs_tablet ?? 0),
        Number(item.rs_wearable ?? 0)
      );
    }

    await stmt.finalize();
    await db.exec("COMMIT");

    const resumoSync = await db.get(`
      SELECT COUNT(*) as total, COUNT(DISTINCT loja) as lojas
      FROM vendedores
    `);

    console.log("SYNC /api/sync/vendedores -> reset:", reset);
    console.log("SYNC /api/sync/vendedores -> DB:", GLOBAL_DB_PATH);
    console.log("SYNC /api/sync/vendedores -> RESUMO:", resumoSync);

    await db.close();

    return res.json({ success: true, gravados: dados.length, reset });
  } catch (e: any) {
    if (db) {
      try { await db.exec("ROLLBACK"); } catch {}
      try { await db.close(); } catch {}
    }
    console.error("Erro sync Vendedores:", e);
    return res.status(500).json({ error: e.message });
  }
});

// --- ROTA DE RAIO-X (DEBUG) ---
app.get('/api/debug', async (req, res) => {
    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        // Conta quantos registros existem de verdade
        const totalVendas = await db.get("SELECT count(*) as total FROM vendas");
        const totalKPI = await db.get("SELECT count(*) as total FROM vendedores_kpi");
        
        // Pega as 3 primeiras vendas para conferir a data
        const amostra = await db.all("SELECT data_emissao, total_liquido FROM vendas LIMIT 3");

        await db.close();

        res.json({
            status: "Online",
            banco_vendas_existe: fs.existsSync(GLOBAL_DB_PATH),
            total_linhas_vendas: totalVendas?.total || 0,
            total_linhas_kpi: totalKPI?.total || 0,
            exemplo_datas_no_banco: amostra
        });
    } catch (e: any) {
        res.json({ erro: e.message });
    }
});

// --- FUNÇÃO AUXILIAR PARA CORRIGIR MAIÚSCULAS/MINÚSCULAS ---
const normalizeKeys = (rows: any[]) => {
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map((row: any) => {
        const newRow: any = {};
        Object.keys(row).forEach(key => {
            newRow[key.toLowerCase()] = row[key];
        });
        return newRow;
    });
};

// ==========================================
// 🚀 MÓDULO ESTOQUE X VENDAS (VERSÃO FINAL: FILTRO NA MEMÓRIA)
// ==========================================

app.get('/api/estoque-vendas', async (req, res) => {
    const { regiao_aba, start, end, category } = req.query;
    
    console.log(`\n🔎 [DEBUG] Iniciando Estoque x Vendas`);
    console.log(`👉 Filtros: Região=${regiao_aba}, Categoria=${category}`);

    // 1. CONFIGURAÇÃO DE FILTROS DE REGIÃO (SQL para Vendas e Keywords para Estoque)
    let filtroVendasSQL = "";
    let keywordsEstoque: string[] = []; 

    switch (regiao_aba) {
        case 'DF_GO':
            // Pega DF e GO (Vendas)
            filtroVendasSQL = "('DISTRITO FEDERAL', 'GOIAS', 'GOIÁS', 'BRASILIA', 'GO', 'DF')";
            // Palavras-chave para identificar lojas no Estoque
            keywordsEstoque = ['BRASILIA', 'TAGUATINGA', 'CONJUNTO', 'PARK', 'JK', 'IGUATEMI', 'BOULEVARD', 'TERRACO', 'PATIO', 'GOIANIA', 'FLAMBOYANT', 'PASSEIO', 'BURITI SHOPPING', 'PORTAL'];
            break;

        case 'MG': // Uberlândia e Uberaba
            filtroVendasSQL = "('MINAS GERAIS', 'MG', 'UBERLANDIA', 'UBERABA')";
            keywordsEstoque = ['UBERLANDIA', 'UBERABA'];
            break;

        case 'RV': // Rio Verde (Separado de GO)
            filtroVendasSQL = "('RIO VERDE')";
            keywordsEstoque = ['RIO VERDE']; 
            break;

        case 'REC': // Recife
            filtroVendasSQL = "('PERNAMBUCO', 'RECIFE', 'PE')";
            keywordsEstoque = ['RECIFE'];
            break;

        case 'JPA': // João Pessoa
            filtroVendasSQL = "('PARAIBA', 'JOAO PESSOA', 'PB')";
            keywordsEstoque = ['JOAO PESSOA', 'MANAIRA'];
            break;

        case 'FOR': // Fortaleza
            filtroVendasSQL = "('CEARA', 'FORTALEZA', 'CE')";
            keywordsEstoque = ['FORTALEZA', 'IGUATEMI FORTALEZA'];
            break;

        default:
            filtroVendasSQL = "('DISTRITO FEDERAL')"; 
            keywordsEstoque = ['BRASILIA'];
    }

    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        // 2. Busca TODAS as Vendas da região (sem filtrar categoria aqui para não perder dados por nome diferente)
        const vendas = await db.all(`
            SELECT 
                UPPER(descricao) as modelo, 
                SUM(quantidade) as qtd_venda,
                SUM(CASE WHEN regiao IN ('GOIAS', 'GOIÁS', 'GO') THEN quantidade ELSE 0 END) as qtd_venda_go
            FROM vendas 
            WHERE regiao IN ${filtroVendasSQL}
            AND data_emissao >= '${start}' AND data_emissao <= '${end}'
            GROUP BY UPPER(descricao)
        `);

        // Busca Inputs Manuais e Pendentes
        const manuais = await db.all(`SELECT * FROM sugestao_compras_manual WHERE regiao_aba = '${regiao_aba}'`);
        const pendentes = await db.all(`SELECT * FROM compras_pendentes`);
        
        await db.close();

        // 3. Busca TODO o Estoque (Puxamos tudo para filtrar no código com segurança)
        const estoqueRaw = await prisma.stock.findMany();
        
        console.log(`📦 Estoque Total Carregado do Banco: ${estoqueRaw.length} itens.`);

        // --- LÓGICA DE FILTRAGEM NA MEMÓRIA (INFALÍVEL) ---
        
        const categoriaAlvo = category && category !== 'TODAS' 
            ? String(category).toUpperCase().trim() 
            : null;

        const modelosPermitidos = new Set<string>(); // Lista VIP de modelos desta categoria
        const estoqueMap = new Map();
        
        estoqueRaw.forEach((item: any) => {
            // A. Normalização para comparação segura
            const itemCategoria = String(item.category || "").toUpperCase().trim();
            const storeName = String(item.storeName || "").toUpperCase();

            // B. FILTRO DE CATEGORIA: Se tiver filtro E for diferente, ignora este item
            if (categoriaAlvo && itemCategoria !== categoriaAlvo) {
                return; 
            }

            // Se chegou aqui, o item pertence à categoria escolhida!
            const mod = String(item.description).toUpperCase().trim();
            
            // Adiciona na Lista VIP (Isso permite mostrar a venda depois, mesmo se o estoque for 0 na loja)
            modelosPermitidos.add(mod);

            // C. FILTRO DE REGIÃO DO ESTOQUE
            // Verifica se a loja pertence à aba atual
            const pertenceRegiao = keywordsEstoque.some(key => storeName.includes(key));
            
            // Exceção: Não deixar Rio Verde entrar na aba DF_GO
            if (regiao_aba === 'DF_GO' && storeName.includes('RIO VERDE')) return;

            if (pertenceRegiao) {
                if (!estoqueMap.has(mod)) estoqueMap.set(mod, { total: 0, go: 0 });
                
                const qtd = Number(item.quantity) || 0;
                const entry = estoqueMap.get(mod);
                entry.total += qtd;

                // Lógica específica para separar GOIÁS dentro da aba DF_GO
                if (regiao_aba === 'DF_GO' && (storeName.includes('GOIANIA') || storeName.includes('BURITI') || storeName.includes('FLAMBOYANT') || storeName.includes('PASSEIO'))) {
                    if (!storeName.includes('RIO VERDE')) entry.go += qtd;
                }
            }
        });

        console.log(`✅ Modelos únicos encontrados na categoria ${category}: ${modelosPermitidos.size}`);

        // 4. MERGE FINAL (CRUZAMENTO DE DADOS)
        const map = new Map();
        
        const initModel = (m: string) => {
            if (!m) return null;
            const key = m.trim().toUpperCase();

            // 🔥 FILTRO FINAL: 
            // Se estamos filtrando por categoria, só criamos a linha se o modelo existir na lista de modelos do estoque.
            // Isso evita mostrar "Capa de Celular" quando filtrei "Smartphone".
            if (categoriaAlvo && !modelosPermitidos.has(key)) {
                return null;
            }

            if (!map.has(key)) map.set(key, { modelo: key, venda: 0, estoque: 0, venda_go: 0, estoque_go: 0, pendente: 0, faturado: 0, sugestao: 0, pedido: 0 });
            return map.get(key);
        }

        // Processa Vendas
        vendas.forEach((v: any) => {
            const item = initModel(v.modelo);
            if (item) {
                item.venda = v.qtd_venda || 0;
                if (regiao_aba === 'DF_GO') item.venda_go = v.qtd_venda_go || 0;
            }
        });

        // Processa Estoque (Do mapa já filtrado acima)
        for (const [modelo, dados] of estoqueMap.entries()) {
            const item = initModel(modelo);
            if (item) {
                item.estoque = dados.total;
                item.estoque_go = dados.go;
            }
        }

        // Processa Manuais
        manuais.forEach((m: any) => {
            const item = initModel(m.modelo);
            if (item) {
                item.faturado = m.faturado;
                item.sugestao = m.sugestao_coordenador;
                item.pedido = m.pedido_rufino;
            }
        });
        
        // Processa Pendentes
        pendentes.forEach((p: any) => {
             const item = initModel(p.modelo);
             if (item) item.pendente = p.quantidade_pendente;
        });

        // Retorna apenas linhas com movimento
        const resultado = Array.from(map.values()).filter(i => i.venda > 0 || i.estoque > 0);
        
        console.log(`🚀 Enviando ${resultado.length} linhas para o Frontend.`);
        res.json(resultado);

    } catch (e: any) {
        console.error("Erro Fatal na API:", e);
        res.status(500).json({ error: e.message, fallback: [] });
    }
});

// Rota para listar Categorias do Estoque (para o filtro)
app.get('/api/categories', async (req, res) => {
    try {
        // Busca categorias distintas usando Prisma
        const categories = await prisma.stock.findMany({
            select: { category: true },
            distinct: ['category'],
            orderBy: { category: 'asc' }
        });
        
        // Retorna apenas a lista de nomes limpa
        const list = categories
            .map(c => String(c.category || "").toUpperCase().trim())
            .filter(c => c !== "");
            
        // Remove duplicatas extras caso existam diferenças deespaço
        const uniqueList = [...new Set(list)];
        
        res.json(uniqueList);
    } catch (e) {
        res.json([]);
    }
});

// ==========================================
// 🛒 ROTA DE SINCRONIZAÇÃO DE COMPRAS (PENDENTES)
// ==========================================
app.post('/api/sync/compras-pendentes', async (req, res) => {
    const dados = req.body;

    // Validação básica
    if (!Array.isArray(dados)) {
        return res.status(400).json({ error: "Formato inválido. Envie uma lista." });
    }

    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        // Inicia Transação (Segurança)
        await db.exec("BEGIN TRANSACTION");
        
        // 1. Limpa a tabela anterior
        await db.exec("DELETE FROM compras_pendentes");

        // 2. Prepara a inserção otimizada
        const stmt = await db.prepare(`
            INSERT INTO compras_pendentes (modelo, quantidade_pendente) 
            VALUES (?, ?)
        `);

        for (const item of dados) {
            const modelo = String(item.modelo || "").toUpperCase().trim();
            const qtd = Number(item.quantidade_pendente) || 0;

            if (modelo && qtd > 0) {
                await stmt.run(modelo, qtd);
            }
        }

        await stmt.finalize();
        await db.exec("COMMIT");
        await db.close();

        console.log(`📦 Compras Pendentes Sincronizadas: ${dados.length} modelos.`);
        res.json({ success: true });

    } catch (e: any) {
        console.error("Erro Sync Compras:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 📦 MÓDULO MALOTE (DISTRIBUIÇÃO INTELIGENTE CD)
// ==========================================
app.get('/api/malote', async (req, res) => {
    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        
        // 1. Busca Vendas dos últimos 30 dias para cálculo do VMD
        const vendas30d = await db.all(`
            SELECT 
                UPPER(descricao) as modelo, 
                cnpj_empresa,
                SUM(quantidade) as qtd_venda
            FROM vendas 
            WHERE data_emissao >= date('now', '-30 days')
            GROUP BY UPPER(descricao), cnpj_empresa
        `);

        // 2. Busca Estoque Atual via Prisma
        const estoqueRaw = await prisma.stock.findMany();
        
        // 3. Organização dos dados
        const cdName = "CD TAGUATINGA";
        const modelData: any = {};

        // Inicializa estrutura
        estoqueRaw.forEach((item: any) => {
            const mod = String(item.description).toUpperCase().trim();
            if (!modelData[mod]) {
                modelData[mod] = { modelo: mod, estoqueCD: 0, lojas: [], totalNecessidade: 0 };
            }
            
            if (item.storeName.toUpperCase().includes(cdName)) {
                modelData[mod].estoqueCD += Number(item.quantity) || 0;
            } else {
                modelData[mod].lojas.push({
                    loja: item.storeName,
                    estoqueAtual: Number(item.quantity) || 0,
                    venda30d: 0,
                    vmd: 0,
                    necessidade: 0,
                    sugestaoEnvio: 0
                });
            }
        });

        // Cruza com vendas para calcular VMD e Necessidade
        vendas30d.forEach((v: any) => {
            const mod = v.modelo;
            if (modelData[mod]) {
                const loja = modelData[mod].lojas.find((l:any) => getCnpjByName(l.loja) === v.cnpj_empresa);
                if (loja) {
                    loja.venda30d = v.qtd_venda;
                    loja.vmd = v.qtd_venda / 30;
                    // Fórmula: (VMD * 15 dias) - Estoque Atual
                    const nec = Math.ceil((loja.vmd * 15) - loja.estoqueAtual);
                    loja.necessidade = nec > 0 ? nec : 0;
                    modelData[mod].totalNecessidade += loja.necessidade;
                }
            }
        });

        // 4. LÓGICA DE DISTRIBUIÇÃO (PRIORIDADE QUEM VENDE MAIS)
        Object.values(modelData).forEach((item: any) => {
            let saldoCD = item.estoqueCD;
            // Ordena lojas pela venda 30d (descendente)
            item.lojas.sort((a: any, b: any) => b.venda30d - a.venda30d);

            item.lojas.forEach((loja: any) => {
                if (saldoCD > 0 && loja.necessidade > 0) {
                    const enviar = Math.min(saldoCD, loja.necessidade);
                    loja.sugestaoEnvio = enviar;
                    saldoCD -= enviar;
                }
            });

            // Sugestão de Compra para o CD
            // Se o CD zerou OU não supre a necessidade total
            item.sugestaoCompra = Math.max(0, item.totalNecessidade - item.estoqueCD);
        });

        await db.close();
        res.json(Object.values(modelData).filter((m:any) => m.totalNecessidade > 0 || m.estoqueCD > 0));
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/anuais/summary', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const yearA = Number(req.query.yearA || 2025);
    const yearB = Number(req.query.yearB || 2026);
    const month = Number(req.query.month || 0); // 1..12 (0 = todos)

    const securityFilter = await getSalesFilter(userId, 'vendas');

    const monthFilter = month >= 1 && month <= 12 ? ` AND mes = ${month} ` : '';

    const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const q = `
        SELECT
            ano,
            SUM(vendas_total)  AS venda_total,
            SUM(seguros_total) AS seguro_total
        FROM agg_lojas_mensal
        WHERE ${securityFilter}
            AND ano IN (${yearA}, ${yearB})
            ${monthFilter}
        GROUP BY ano
    `;

    const rows = await db.all(q);
    await db.close();

    const byYear: any = {};
    rows.forEach((r: any) => (byYear[r.ano] = { venda_total: r.venda_total || 0, seguro_total: r.seguro_total || 0 }));

    res.json({
      yearA, yearB, month,
      a: byYear[yearA] || { venda_total: 0, seguro_total: 0 },
      b: byYear[yearB] || { venda_total: 0, seguro_total: 0 },
    });
  } catch (e: any) {
    console.error("Erro /anuais/summary:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/anuais/lojas_compare', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const yearA = Number(req.query.yearA || 2025);
    const yearB = Number(req.query.yearB || 2026);
    const month = Number(req.query.month || 0);

    const securityFilter = await getSalesFilter(userId, 'vendas');
    const monthFilter = month >= 1 && month <= 12 ? ` AND mes = ${month} ` : '';

    const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const q = `
        SELECT
            ano, mes, loja, cnpj_empresa, regiao,
            vendas_total  AS venda_total,
            vendas_qtd    AS venda_qtd,
            seguros_total AS seguro_total,
            seguros_qtd   AS seguro_qtd
        FROM agg_lojas_mensal
        WHERE ${securityFilter}
            AND ano IN (${yearA}, ${yearB})
            ${monthFilter}
        ORDER BY loja ASC, ano ASC, mes ASC
    `;

    const rows = await db.all(q);
    await db.close();

    res.json({ yearA, yearB, month, data: normalizeKeys(rows) });
  } catch (e: any) {
    console.error("Erro /anuais/lojas_compare:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/anuais/vendedores_compare', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const yearA = Number(req.query.yearA || 2025);
    const yearB = Number(req.query.yearB || 2026);
    const month = Number(req.query.month || 0);
    const store = req.query.store ? String(req.query.store).toUpperCase().trim() : '';

    const securityFilter = await getSalesFilter(userId, 'vendas');
    const monthFilter = month >= 1 && month <= 12 ? ` AND mes = ${month} ` : '';
    const storeFilter = store ? ` AND UPPER(loja) = '${store.replace(/'/g, "''")}' ` : '';

    const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const q = `
        SELECT
            ano, mes, loja, cnpj_empresa, regiao, vendedor,
            vendas_total  AS venda_total,
            vendas_qtd    AS venda_qtd,
            seguros_total AS seguro_total,
            seguros_qtd   AS seguro_qtd
        FROM agg_vendedores_mensal
        WHERE ${securityFilter}
            AND ano IN (${yearA}, ${yearB})
            ${monthFilter}
            ${storeFilter}
        ORDER BY vendedor ASC, loja ASC, ano ASC
    `;

    const rows = await db.all(q);
    await db.close();

    res.json({ yearA, yearB, month, store, data: normalizeKeys(rows) });
  } catch (e: any) {
    console.error("Erro /anuais/vendedores_compare:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/forecast/ano', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const year = Number(req.query.year || new Date().getFullYear());

    const securityFilter = await getSalesFilter(userId, 'vendas');

    if (!fs.existsSync(ANUAL_DB_PATH)) {
      return res.json({
        year,
        month: 0,
        day: 0,
        daysInMonth: 0,
        month_so_far: 0,
        month_forecast: 0,
        month_remaining_forecast: 0,
        ytd: 0,
        year_forecast: 0,
      });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const tables = await db.all(`
      SELECT name
      FROM sqlite_master
      WHERE type='table' AND name='vendas_anuais_raw'
    `);

    if (!tables || tables.length === 0) {
      await db.close();
      return res.json({
        year,
        month: currentMonth,
        day: currentDay,
        daysInMonth,
        month_so_far: 0,
        month_forecast: 0,
        month_remaining_forecast: 0,
        ytd: 0,
        year_forecast: 0,
      });
    }

    // Se o ano consultado não for o ano atual, não existe "tendência do mês atual"
    // então retornamos o total do ano fechado, sem projeção parcial
    if (year !== currentYear) {
      const fullYearRow = await db.get(`
        SELECT COALESCE(SUM(total_real), 0) AS total
        FROM vendas_anuais_raw
        WHERE ${securityFilter}
          AND ano = ${year}
      `);

      await db.close();

      const totalYear = Number(fullYearRow?.total || 0);

      return res.json({
        year,
        month: currentMonth,
        day: currentDay,
        daysInMonth,
        month_so_far: 0,
        month_forecast: 0,
        month_remaining_forecast: 0,
        ytd: totalYear,
        year_forecast: totalYear,
      });
    }

    // Total do mês atual até o dia de hoje
    const mtdRow = await db.get(`
      SELECT COALESCE(SUM(total_real), 0) AS total
      FROM vendas_anuais_raw
      WHERE ${securityFilter}
        AND ano = ${year}
        AND mes = ${currentMonth}
        AND CAST(substr(data_emissao, 9, 2) AS INTEGER) <= ${currentDay}
    `);

    // Total do mês atual inteiro (se já houver lançamentos futuros dentro do mesmo mês)
    const fullMonthRow = await db.get(`
      SELECT COALESCE(SUM(total_real), 0) AS total
      FROM vendas_anuais_raw
      WHERE ${securityFilter}
        AND ano = ${year}
        AND mes = ${currentMonth}
    `);

    // Total dos meses fechados antes do mês atual
    const closedMonthsRow = await db.get(`
      SELECT COALESCE(SUM(total_real), 0) AS total
      FROM vendas_anuais_raw
      WHERE ${securityFilter}
        AND ano = ${year}
        AND mes < ${currentMonth}
    `);

    // Quantos meses fechados já existem
    const closedMonthsCountRow = await db.get(`
      SELECT COUNT(DISTINCT mes) AS total
      FROM vendas_anuais_raw
      WHERE ${securityFilter}
        AND ano = ${year}
        AND mes < ${currentMonth}
    `);

    await db.close();

    const monthSoFar = Number(mtdRow?.total || 0);
    const monthFullActual = Number(fullMonthRow?.total || 0);
    const closedMonthsTotal = Number(closedMonthsRow?.total || 0);
    const closedMonthsCount = Number(closedMonthsCountRow?.total || 0);

    // Projeção do mês atual:
    // se já existe mês inteiro carregado no banco, usa ele;
    // senão, projeta pelo ritmo diário
    const projectedMonth =
      monthFullActual > monthSoFar
        ? monthFullActual
        : currentDay > 0
          ? (monthSoFar / currentDay) * daysInMonth
          : monthSoFar;

    const monthRemainingForecast = Math.max(0, projectedMonth - monthSoFar);

    // YTD real = meses fechados + realizado do mês atual
    const ytd = closedMonthsTotal + monthSoFar;

    // Projeção anual:
    // meses fechados reais + projeção do mês atual + média dos meses fechados para os meses restantes
    const avgClosedMonth = closedMonthsCount > 0 ? (closedMonthsTotal / closedMonthsCount) : projectedMonth;
    const remainingFutureMonths = 12 - currentMonth;

    const yearForecast =
      closedMonthsTotal +
      projectedMonth +
      (avgClosedMonth * remainingFutureMonths);

    res.json({
      year,
      month: currentMonth,
      day: currentDay,
      daysInMonth,
      month_so_far: monthSoFar,
      month_forecast: projectedMonth,
      month_remaining_forecast: monthRemainingForecast,
      ytd,
      year_forecast: yearForecast,
    });
  } catch (e: any) {
    console.error("Erro /forecast/ano:", e);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================================
// 🚀 INTEGRAÇÃO LINX (PYTHON -> SERVER -> REACT)
// ==========================================================

// Função Mágica Dinâmica: Lê o JSON do Python e cria a tabela automaticamente (Versão TypeScript)
async function handleLinxSync(req: any, res: any, tableName: string) {
    const dados = req.body;
    const reset = req.query.reset === 'true';

    if (!Array.isArray(dados) || dados.length === 0) {
        return res.json({ success: true, gravados: 0 }); 
    }

    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
        await db.exec("BEGIN TRANSACTION");

        // Se for o primeiro lote de uma atualização, apaga a tabela velha
        if (reset) {
            await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
        }

        // 1. Descobre as colunas lendo o primeiro item do pacote
        const colunas = Object.keys(dados[0]);
        
        // 2. Cria a tabela dinamicamente com essas colunas
        const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${colunas.map(c => `${c} TEXT`).join(', ')})`;
        await db.exec(createTableSql);

        // 3. Prepara o comando de inserção
        const placeholders = colunas.map(() => '?').join(', ');
        const insertSql = `INSERT INTO ${tableName} (${colunas.join(', ')}) VALUES (${placeholders})`;
        const stmt = await db.prepare(insertSql);
        
        // 4. Salva todos os 100 itens do lote
        for (const item of dados) {
            const valores = colunas.map(c => item[c] !== undefined && item[c] !== null ? String(item[c]) : null);
            await stmt.run(valores);
        }

        await stmt.finalize();
        await db.exec("COMMIT");
        await db.close();

        res.json({ success: true, gravados: dados.length });
    } catch (e: any) { // <-- Correção do tipo de erro (e: any)
        console.error(`❌ Erro Sync Linx (${tableName}):`, e);
        res.status(500).json({ error: e.message });
    }
}

// AS 4 PORTAS DE ENTRADA PARA O PYTHON (POST)
app.post('/api/sync/linx_movimento_resumo', (req: any, res: any) => handleLinxSync(req, res, 'linx_movimento_resumo'));
app.post('/api/sync/linx_movimento_planos', (req: any, res: any) => handleLinxSync(req, res, 'linx_movimento_planos'));
app.post('/api/sync/linx_movimento_cartoes', (req: any, res: any) => handleLinxSync(req, res, 'linx_movimento_cartoes'));
app.post('/api/sync/linx_planos_parcelas', (req: any, res: any) => handleLinxSync(req, res, 'linx_planos_parcelas'));

// A PORTA DE SAÍDA PARA O FRONTEND REACT (GET)
app.get('/api/linx/pagamentos', async (req: any, res: any) => {
    try {
        const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

        const tableCheck = await db.all(`
            SELECT name
            FROM sqlite_master
            WHERE type='table'
              AND name IN ('linx_movimento_planos', 'linx_movimento_resumo', 'linx_movimento_cartoes')
        `);

        if (tableCheck.length < 2) {
            await db.close();
            return res.json([]);
        }

        const query = `
            WITH resumo_unico AS (
                SELECT
                    cnpj_emp,
                    identificador,
                    MAX(data_lancamento) AS data_lancamento
                FROM linx_movimento_resumo
                GROUP BY cnpj_emp, identificador
            ),
            planos_unicos AS (
                SELECT DISTINCT
                    mp.cnpj_emp,
                    mp.identificador,
                    mp.plano,
                    mp.desc_plano,
                    mp.total,
                    mp.qtde_parcelas,
                    mp.forma_pgto,
                    mp.tipo_transacao,
                    mp.ordem_cartao
                FROM linx_movimento_planos mp
            ),
            cartoes_unicos AS (
                SELECT DISTINCT
                    mc.cnpj_emp,
                    mc.identificador,
                    mc.ordem_cartao,
                    mc.credito_debito,
                    mc.descricao_bandeira,
                    mc.valor,
                    mc.nsu_host,
                    mc.nsu_sitef,
                    mc.cod_autorizacao
                FROM linx_movimento_cartoes mc
            )
            SELECT
                p.cnpj_emp,
                p.identificador,
                p.plano,
                p.desc_plano,
                CAST(REPLACE(COALESCE(p.total, '0'), ',', '.') AS REAL) AS valor_pagamento,
                CAST(COALESCE(NULLIF(p.qtde_parcelas, ''), '1') AS INTEGER) AS qtde_parcelas,
                p.forma_pgto,
                p.tipo_transacao,
                CAST(COALESCE(NULLIF(p.ordem_cartao, ''), '0') AS INTEGER) AS ordem_cartao,
                r.data_lancamento,
                c.credito_debito,
                c.descricao_bandeira,
                CAST(REPLACE(COALESCE(c.valor, '0'), ',', '.') AS REAL) AS valor_cartao,
                c.nsu_host,
                c.nsu_sitef,
                c.cod_autorizacao
            FROM planos_unicos p
            LEFT JOIN resumo_unico r
                ON r.cnpj_emp = p.cnpj_emp
               AND r.identificador = p.identificador
            LEFT JOIN cartoes_unicos c
                ON c.cnpj_emp = p.cnpj_emp
               AND c.identificador = p.identificador
               AND COALESCE(c.ordem_cartao, '0') = COALESCE(p.ordem_cartao, '0')
            ORDER BY r.data_lancamento DESC, p.identificador DESC
        `;

        const pagamentos = await db.all(query);
        await db.close();

        res.status(200).json(pagamentos);
    } catch (error: any) {
        console.error("Erro ao buscar pagamentos Linx:", error);
        res.status(500).json({ error: "Erro interno ao buscar pagamentos" });
    }
});

// Define a porta: Usa a do Render (process.env.PORT) ou a 3000 se for local
const PORT = process.env.PORT || 3000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ SERVIDOR RODANDO NA PORTA ${PORT}`);
});

