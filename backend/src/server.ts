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
import https from 'https';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai'; //IMPORTE DA CLARK (IA DO TELEFLUXO)

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const genAI = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY não configurada. A Clark IA não funcionará até configurar a chave no .env.');
}

const uploadSolicitacao = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

mailTransporter.verify()
  .then(() => console.log('📧 SMTP Gmail pronto para envio'))
  .catch((err) => console.error('❌ Erro no SMTP Gmail:', err));
  

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

// DEFINIÇÃO DAS VARIÁVEIS DE CAMINHO - VARIÁVIES DE CAMINHO 
const GLOBAL_DB_PATH = path.join(DATABASE_DIR, 'samsung_vendas.db');
const SAMSUNG_DB_PATH = GLOBAL_DB_PATH; // Cria um "apelido" para funcionar nas rotas novas e antigas
const BESTFLOW_DB_PATH = path.join(DATABASE_DIR, 'bestflow.db');
// Constantes para compras - para verificar se as compras feitas estão no sistema 
const COMPRAS_DB_DIR = path.join(DATABASE_DIR, 'compras');
const COMPRAS_DB_PATH = path.join(COMPRAS_DB_DIR, 'compras_imei_ano_atual.db');
const LOCAL_SALES_DB_CANDIDATES = [
  path.join(ROOT_DIR, 'relatorio_vendas_consolidado.db'),
  path.join(DATABASE_DIR, 'relatorio_vendas_consolidado.db'),
  path.join(DATABASE_DIR, 'vendas', 'relatorio_vendas_consolidado.db'),
];

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

      dbInit.run(`
    CREATE TABLE IF NOT EXISTS vendas_detalhadas_imei (
        data_emissao TEXT,
        nota_fiscal TEXT,
        nome_fantasia TEXT,
        cnpj_empresa TEXT,
        nome_vendedor TEXT,
        codigo_produto TEXT,
        referencia TEXT,
        descricao TEXT,
        categoria TEXT,
        imei TEXT,
        quantidade REAL,
        total_liquido REAL,
        regiao TEXT
    )
`);


    console.log("📦 Tabelas do Banco de Dados Garantidas!");
});

const anualInit = new sqlite3.Database(ANUAL_DB_PATH);
anualInit.serialize(() => {
  anualInit.run(`
    CREATE TABLE IF NOT EXISTS vendas_anuais_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nota_fiscal TEXT,
      cancelado TEXT,
      tipo_transacao TEXT,
      natureza_operacao TEXT,
      data_emissao TEXT,
      nome_vendedor TEXT,
      codigo_produto TEXT,
      referencia TEXT,
      descricao TEXT,
      categoria TEXT,
      imei TEXT,
      quantidade REAL,
      total_liquido REAL,
      qtd_real REAL,
      total_real REAL,
      categoria_real TEXT,
      loja TEXT,
      regiao TEXT,
      ano INTEGER,
      mes INTEGER,
      cnpj_empresa TEXT
    )
  `);

  anualInit.run(`
    CREATE TABLE IF NOT EXISTS vendas_anuais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_emissao TEXT,
      ano INTEGER,
      mes INTEGER,
      loja TEXT,
      cnpj_empresa TEXT,
      nome_vendedor TEXT,
      descricao TEXT,
      familia TEXT,
      regiao TEXT,
      quantidade REAL,
      total_liquido REAL
    )
  `);

  anualInit.run(`
    CREATE TABLE IF NOT EXISTS seguros_anuais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_emissao TEXT,
      ano INTEGER,
      mes INTEGER,
      loja TEXT,
      cnpj_empresa TEXT,
      nome_vendedor TEXT,
      descricao TEXT,
      regiao TEXT,
      qtd REAL,
      premio REAL,
      nf TEXT
    )
  `);

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

// Adiciona um limite no banco de dados, para aceitar os COMPARATIVOS.
const app = express();
const prisma = new PrismaClient();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Garante que a pasta existe
if (!fs.existsSync(DATABASE_DIR)) {
    try { fs.mkdirSync(DATABASE_DIR, { recursive: true }); } catch(e) {}
}

console.log("📂 Banco Vendas:", GLOBAL_DB_PATH);
console.log("📂 Banco BestFlow:", BESTFLOW_DB_PATH);

if (!fs.existsSync(COMPRAS_DB_DIR)) {
  try { fs.mkdirSync(COMPRAS_DB_DIR, { recursive: true }); } catch(e) {}
}

function normalizeSerial(value: any) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐-–—−]/g, '')
    .replace(/\s+/g, '')
    .replace(/\.0+$/g, '')
    .trim();
}

function safeNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nextIsoDate(isoDate: string) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalizeReferenceFamily(value: any) {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐-–—−]/g, '-')
    .replace(/\s+/g, '')
    .trim()
    .match(/^([A-Z]{2,3}-[A-Z]?\d{3})/i)?.[1] ||
    String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function pickExistingPath(paths: string[]) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

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

const GSHEET_TRANSLATION_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS96tjslp46EX-F8-Q8AfYfanS_DzG-2XpUJ6bjK7xTE73m-7LdsX59sTjRnyPMWcE8niiHpJa-A4pX/pub?output=csv';

type TranslationRow = {
  basicModel: string;
  marketingName: string;
  descricao2: string;
  referencia2: string;
};

function fetchText(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Muitos redirecionamentos ao carregar Google Sheets.'));
    }

    https
      .get(url, (resp) => {
        const statusCode = resp.statusCode || 0;
        const location = resp.headers.location;

        // segue redirecionamentos do Google
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          const nextUrl = location.startsWith('http')
            ? location
            : new URL(location, url).toString();

          resp.resume();
          return resolve(fetchText(nextUrl, redirectCount + 1));
        }

        let data = '';

        resp.on('data', (chunk) => {
          data += chunk;
        });

        resp.on('end', () => {
          if (statusCode >= 400) {
            return reject(new Error(`Falha ao carregar URL (${statusCode})`));
          }

          resolve(data);
        });
      })
      .on('error', reject);
  });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result.map((s) => s.trim());
}

function normalizeBasicModel(value: any): string {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐-–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9\/-]/g, '')
    .replace(/^BSM(?!-)/, 'BSM-')
    .replace(/^BSM\/?/, 'BSM-')
    .replace(/-+/g, '-')
    .trim();
}

function normalizeReferencePrefix(value: any): string {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/[‐-–—−]/g, '-')
    .replace(/[\uFFFE\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

async function loadGoogleSheetTranslations(): Promise<TranslationRow[]> {
  const csvText = await fetchText(GSHEET_TRANSLATION_URL);

  const workbook = XLSX.read(csvText, { type: 'string' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
    throw new Error(`Não consegui abrir a primeira aba da planilha: ${firstSheetName}`);
    }

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    }) as any[][];

  if (rawRows.length < 2) return [];

  const headers = (rawRows[0] || []).map((h: any) =>
    String(h || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );

  const findHeader = (...names: string[]) =>
    headers.findIndex((h) => names.includes(h));

  const idxBasic = findHeader('basic model', 'basicmodel');
  const idxMarketing = findHeader('marketing name', 'marketingname');
  const idxDescricao = findHeader('descrição 2', 'descricao 2', 'descrição2', 'descricao2');
  const idxReferencia = findHeader('referência 2', 'referencia 2', 'referência2', 'referencia2');

  if (idxBasic < 0) {
    throw new Error(`Não encontrei a coluna Basic Model na planilha publicada. Cabeçalhos encontrados: ${headers.join(' | ')}`);
  }

  const rows: TranslationRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const cols = rawRows[i] || [];

    const basicModel = normalizeBasicModel(cols[idxBasic] || '');
    if (!basicModel) continue;

    rows.push({
      basicModel,
      marketingName: String(cols[idxMarketing] || '').trim(),
      descricao2: String(cols[idxDescricao] || '').trim(),
      referencia2: normalizeReferencePrefix(cols[idxReferencia] || ''),
    });
  }

  return rows;
}

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

// =======================================================
// CLARK IA - ASSISTENTE INTERNO DO TELEFLUXO
// =======================================================

type ClarkIntent =
  | 'vendas_hoje'
  | 'vendas_mes'
  | 'ranking_lojas_mes'
  | 'ranking_vendedores_mes'
  | 'categoria_mes'
  | 'produto_maior_estoque'
  | 'ranking_estoque_produtos'
  | 'ajuda';

type ClarkFiltros = {
  limite: number;
  categoriaOriginal: string | undefined;
  categoriaCanonica: string | undefined;
  aliasesCategoria: string[];
};

function todayIsoSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function monthStartIsoSaoPaulo() {
  const today = todayIsoSaoPaulo();
  return `${today.slice(0, 7)}-01`;
}

function formatBRL(value: any) {
  const n = Number(value || 0);

  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function traduzirCnpjParaLoja(cnpj: any) {
  const key = String(cnpj || '').replace(/\D/g, '');
  return LOJAS_MAP_GLOBAL[key] || String(cnpj || 'Loja não identificada');
}

function normalizarTextoClark(value: any) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairFiltrosClark(pergunta: string): ClarkFiltros {
  const texto = normalizarTextoClark(pergunta);

  const numeroEncontrado = texto.match(/\b(\d{1,2})\b/);
  let limite = numeroEncontrado ? Number(numeroEncontrado[1]) : 10;

  if (!Number.isFinite(limite) || limite <= 0) limite = 10;
  if (limite > 20) limite = 20;

  let categoriaOriginal: string | undefined;
  let categoriaCanonica: string | undefined;
  let aliasesCategoria: string[] = [];

  if (
    texto.includes('SMARTPHONE') ||
    texto.includes('SMARTPHONES') ||
    texto.includes('APARELHO') ||
    texto.includes('APARELHOS') ||
    texto.includes('CELULAR') ||
    texto.includes('CELULARES')
  ) {
    categoriaOriginal = 'SMARTPHONES';
    categoriaCanonica = 'SMARTPHONES';
    aliasesCategoria = ['SMARTPHONE', 'SMARTPHONES', 'APARELHO', 'APARELHOS', 'CELULAR', 'CELULARES'];
  }

  else if (
    texto.includes('ACESSORIO') ||
    texto.includes('ACESSORIOS') ||
    texto.includes('ACESSÓRIO') ||
    texto.includes('ACESSÓRIOS')
  ) {
    categoriaOriginal = 'ACESSÓRIOS';
    categoriaCanonica = 'ACESSÓRIOS';
    aliasesCategoria = ['ACESSORIO', 'ACESSORIOS', 'ACESSÓRIO', 'ACESSÓRIOS'];
  }

  else if (
    texto.includes('WEARABLE') ||
    texto.includes('WEARABLES') ||
    texto.includes('RELOGIO') ||
    texto.includes('RELÓGIO') ||
    texto.includes('BUDS') ||
    texto.includes('FONE')
  ) {
    categoriaOriginal = 'WEARABLES';
    categoriaCanonica = 'WEARABLES';
    aliasesCategoria = ['WEARABLE', 'WEARABLES', 'RELOGIO', 'RELÓGIO', 'BUDS', 'FONE', 'FONES'];
  }

  else if (
    texto.includes('TABLET') ||
    texto.includes('TABLETS')
  ) {
    categoriaOriginal = 'TABLETS';
    categoriaCanonica = 'TABLETS';
    aliasesCategoria = ['TABLET', 'TABLETS'];
  }

  return {
    limite,
    categoriaOriginal,
    categoriaCanonica,
    aliasesCategoria,
  };
}

function detectarIntencaoClark(pergunta: string): ClarkIntent {
  const p = String(pergunta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const falaDeVenda =
    p.includes('venda') ||
    p.includes('vendemos') ||
    p.includes('vendeu') ||
    p.includes('faturamento') ||
    p.includes('faturamos') ||
    p.includes('receita');

  const falaDeEstoque =
    p.includes('estoque') ||
    p.includes('saldo') ||
    p.includes('quantidade em loja') ||
    p.includes('quantidade nas lojas') ||
    p.includes('temos em loja') ||
    p.includes('temos nas lojas');

  if (
    falaDeEstoque &&
    (
      p.includes('mais temos') ||
      p.includes('mais tem') ||
      p.includes('maior estoque') ||
      p.includes('mais em estoque') ||
      p.includes('produto que mais') ||
      p.includes('produto com mais') ||
      p.includes('qual produto temos mais') ||
      p.includes('qual o produto que mais')
    )
  ) {
    return 'produto_maior_estoque';
  }

  if (falaDeEstoque) {
    return 'ranking_estoque_produtos';
  }

  if (
    p.includes('ranking') &&
    (p.includes('vendedor') || p.includes('vendedores'))
  ) {
    return 'ranking_vendedores_mes';
  }

  if (
    p.includes('ranking') &&
    (p.includes('loja') || p.includes('lojas'))
  ) {
    return 'ranking_lojas_mes';
  }

  if (
    (p.includes('loja') || p.includes('lojas')) &&
    (
      p.includes('mais vendeu') ||
      p.includes('melhor') ||
      p.includes('top') ||
      p.includes('primeira')
    )
  ) {
    return 'ranking_lojas_mes';
  }

  if (
    (p.includes('vendedor') || p.includes('vendedores')) &&
    (
      p.includes('mais vendeu') ||
      p.includes('melhor') ||
      p.includes('top') ||
      p.includes('primeiro')
    )
  ) {
    return 'ranking_vendedores_mes';
  }

  if (
    p.includes('categoria') ||
    p.includes('familia') ||
    p.includes('produto mais vendido') ||
    p.includes('o que mais vendeu')
  ) {
    return 'categoria_mes';
  }

  if (p.includes('hoje') && falaDeVenda) {
    return 'vendas_hoje';
  }

  if (
    p.includes('mes') ||
    p.includes('mensal') ||
    p.includes('esse mes') ||
    p.includes('este mes') ||
    p.includes('mes atual')
  ) {
    return 'vendas_mes';
  }

  if (falaDeVenda) {
    return 'vendas_mes';
  }

  return 'ajuda';
}

async function consultarResumoVendasClark(
  db: any,
  securityFilter: string,
  startDate: string,
  endDate: string
) {
  return await db.get(
    `
      SELECT
        COALESCE(SUM(total_liquido), 0) AS total_vendas,
        COALESCE(SUM(quantidade), 0) AS total_pecas,
        CASE
          WHEN COALESCE(SUM(quantidade), 0) > 0
          THEN COALESCE(SUM(total_liquido), 0) / COALESCE(SUM(quantidade), 0)
          ELSE 0
        END AS ticket_medio
      FROM vendas
      WHERE ${securityFilter}
        AND data_emissao >= ?
        AND data_emissao <= ?
    `,
    [startDate, endDate]
  );
}

async function consultarRankingLojasClark(
  db: any,
  securityFilter: string,
  startDate: string,
  endDate: string
) {
  return await db.all(
    `
      SELECT
        cnpj_empresa,
        COALESCE(SUM(total_liquido), 0) AS total_vendas,
        COALESCE(SUM(quantidade), 0) AS total_pecas,
        CASE
          WHEN COALESCE(SUM(quantidade), 0) > 0
          THEN COALESCE(SUM(total_liquido), 0) / COALESCE(SUM(quantidade), 0)
          ELSE 0
        END AS ticket_medio
      FROM vendas
      WHERE ${securityFilter}
        AND data_emissao >= ?
        AND data_emissao <= ?
      GROUP BY cnpj_empresa
      ORDER BY total_vendas DESC
      LIMIT 10
    `,
    [startDate, endDate]
  );
}

async function consultarRankingVendedoresClark(
  db: any,
  securityFilter: string,
  startDate: string,
  endDate: string
) {
  return await db.all(
    `
      SELECT
        nome_vendedor,
        cnpj_empresa,
        COALESCE(SUM(total_liquido), 0) AS total_vendas,
        COALESCE(SUM(quantidade), 0) AS total_pecas,
        CASE
          WHEN COALESCE(SUM(quantidade), 0) > 0
          THEN COALESCE(SUM(total_liquido), 0) / COALESCE(SUM(quantidade), 0)
          ELSE 0
        END AS ticket_medio
      FROM vendas
      WHERE ${securityFilter}
        AND data_emissao >= ?
        AND data_emissao <= ?
        AND nome_vendedor IS NOT NULL
        AND TRIM(nome_vendedor) <> ''
      GROUP BY nome_vendedor, cnpj_empresa
      ORDER BY total_vendas DESC
      LIMIT 10
    `,
    [startDate, endDate]
  );
}

async function consultarCategoriasClark(
  db: any,
  securityFilter: string,
  startDate: string,
  endDate: string
) {
  return await db.all(
    `
      SELECT
        COALESCE(familia, 'OUTROS') AS familia,
        COALESCE(SUM(total_liquido), 0) AS total_vendas,
        COALESCE(SUM(quantidade), 0) AS total_pecas
      FROM vendas
      WHERE ${securityFilter}
        AND data_emissao >= ?
        AND data_emissao <= ?
      GROUP BY COALESCE(familia, 'OUTROS')
      ORDER BY total_vendas DESC
      LIMIT 10
    `,
    [startDate, endDate]
  );
}

function categoriaEstoqueConfere(categoriaItem: any, filtros: ClarkFiltros) {
  if (!filtros.aliasesCategoria.length) return true;

  const categoriaNormalizada = normalizarTextoClark(categoriaItem);

  return filtros.aliasesCategoria.some((alias) => {
    const aliasNormalizado = normalizarTextoClark(alias);
    return (
      categoriaNormalizada === aliasNormalizado ||
      categoriaNormalizada.includes(aliasNormalizado) ||
      aliasNormalizado.includes(categoriaNormalizada)
    );
  });
}

async function consultarRankingEstoqueProdutosClark(
  userId: string,
  filtros: ClarkFiltros
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      acesso_negado: true,
      total_itens_estoque: 0,
      total_itens_filtrados: 0,
      categoria_solicitada: filtros.categoriaCanonica || null,
      categorias_encontradas: [],
      ranking: [],
    };
  }

  const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'];
  const userRole = String(user.role || '').toUpperCase();
  const isSuperUser = Boolean(user.isAdmin) || superRoles.includes(userRole);

  const allowedStores = String(user.allowedStores || '')
    .split(',')
    .map((s) => {
      const clean = normStore(s);
      const corrigido = CORRECAO_NOMES_SERVER[clean];
      return corrigido ? normStore(corrigido) : clean;
    })
    .filter(Boolean);

  const estoqueRaw = await prisma.stock.findMany({
    where: {
      quantity: {
        gt: 0,
      },
    },
    select: {
      storeName: true,
      productCode: true,
      reference: true,
      description: true,
      category: true,
      quantity: true,
      salePrice: true,
    },
  });

  const estoquePorPermissao = isSuperUser
    ? estoqueRaw
    : estoqueRaw.filter((item: any) => {
        const lojaItem = normStore(item.storeName);

        return allowedStores.some((lojaPermitida) => {
          return lojaItem === lojaPermitida || lojaItem.includes(lojaPermitida);
        });
      });

  const categoriasMap = new Map<string, number>();

  for (const item of estoquePorPermissao as any[]) {
    const categoria = String(item.category || 'SEM CATEGORIA').trim();
    const categoriaKey = categoria || 'SEM CATEGORIA';
    categoriasMap.set(categoriaKey, (categoriasMap.get(categoriaKey) || 0) + Number(item.quantity || 0));
  }

  const categoriasEncontradas = Array.from(categoriasMap.entries())
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 20)
    .map(([categoria, quantidade]) => ({
      categoria,
      quantidade,
    }));

  const estoqueFiltrado = estoquePorPermissao.filter((item: any) => {
    return categoriaEstoqueConfere(item.category, filtros);
  });

  const produtosMap = new Map<string, any>();

  for (const item of estoqueFiltrado as any[]) {
    const descricao = String(item.description || 'SEM DESCRIÇÃO').trim();
    const referencia = String(item.reference || '').trim();
    const codigo = String(item.productCode || '').trim();
    const categoria = String(item.category || 'GERAL').trim();

    const key = `${descricao.toUpperCase()}|${referencia.toUpperCase()}|${codigo.toUpperCase()}`;

    const qtd = Number(item.quantity || 0);
    const precoVenda = Number(item.salePrice || 0);

    if (!produtosMap.has(key)) {
      produtosMap.set(key, {
        descricao,
        referencia,
        codigo_produto: codigo,
        categoria,
        quantidade_total: 0,
        valor_estimado_estoque: 0,
        lojas: new Map<string, number>(),
      });
    }

    const atual = produtosMap.get(key);
    atual.quantidade_total += qtd;
    atual.valor_estimado_estoque += qtd * precoVenda;

    const loja = String(item.storeName || 'LOJA NÃO IDENTIFICADA').trim();
    atual.lojas.set(loja, (atual.lojas.get(loja) || 0) + qtd);
  }

  const ranking = Array.from(produtosMap.values())
    .sort((a: any, b: any) => Number(b.quantidade_total) - Number(a.quantidade_total))
    .slice(0, filtros.limite)
    .map((item: any, index: number) => {
      const lojasEntries = Array.from(
        (item.lojas as Map<string, number>).entries()
      ) as Array<[string, number]>;

      const principaisLojas = lojasEntries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 8)
        .map(([loja, quantidade]) => ({
          loja,
          quantidade: Number(quantidade || 0),
        }));

      return {
        posicao: index + 1,
        descricao: item.descricao,
        referencia: item.referencia,
        codigo_produto: item.codigo_produto,
        categoria: item.categoria,
        quantidade_total: Number(item.quantidade_total || 0),
        valor_estimado_estoque: Number(item.valor_estimado_estoque || 0),
        valor_estimado_estoque_formatado: formatBRL(item.valor_estimado_estoque),
        principais_lojas: principaisLojas,
      };
    });

  return {
    acesso_negado: false,
    total_itens_estoque: estoquePorPermissao.length,
    total_itens_filtrados: estoqueFiltrado.length,
    categoria_solicitada: filtros.categoriaCanonica || null,
    categorias_encontradas: categoriasEncontradas,
    ranking,
  };
}

function montarPromptClark(params: {
  pergunta: string;
  intencao: string;
  filtros: ClarkFiltros;
  dados: any;
}) {
  return `
Você é a Clark, assistente de IA interna do sistema TeleFluxo.

Personalidade:
- Profissional, clara e objetiva.
- Inteligente, calma e analítica.
- Fala como uma consultora de gestão.
- Não usa linguagem robótica.
- Não inventa números.
- Não promete ações que o sistema ainda não executa.
- Usa apenas o JSON de dados fornecido.
- Responde em português do Brasil.
- Quando houver valores, usa formato de moeda em R$.
- Quando fizer sentido, encerra com uma sugestão prática.
- Se o módulo for estoque, explique os produtos com maior quantidade, a quantidade total e as principais lojas quando essa informação existir.
- Se o usuário pediu uma categoria específica, responda somente com base nessa categoria filtrada.
- Se o JSON filtrado vier vazio, diga que não encontrou itens naquela categoria e mostre as categorias encontradas para ajudar o usuário a ajustar a pergunta.
- Se o módulo for vendas, destaque total vendido, peças, ticket médio, ranking ou categoria conforme os dados disponíveis.

Contexto:
O TeleFluxo é um sistema interno de gestão com dados de vendas, lojas, vendedores, estoque e operação.
Nesta versão, você responde sobre vendas e estoque usando apenas os dados fornecidos em JSON.

Pergunta do usuário:
${params.pergunta}

Intenção identificada:
${params.intencao}

Filtros extraídos da pergunta:
${JSON.stringify(params.filtros, null, 2)}

Dados disponíveis em JSON:
${JSON.stringify(params.dados, null, 2)}

Gere a resposta final para o usuário.
`;
}

function gerarRespostaFallbackClark(intencao: ClarkIntent, dados: any, filtros: ClarkFiltros) {
  if (dados?.modulo === 'estoque') {
    const ranking = dados?.ranking_top || dados?.ranking_top_10 || [];
    const categoria = dados?.categoria_solicitada || filtros.categoriaCanonica;

    if (!ranking.length) {
      const cats = Array.isArray(dados?.categorias_encontradas)
        ? dados.categorias_encontradas
            .slice(0, 8)
            .map((c: any) => `- ${c.categoria}: ${c.quantidade} unidades`)
            .join('\n')
        : '';

      return `Não encontrei produtos em estoque para a categoria ${categoria || 'solicitada'}.

Categorias encontradas no estoque:
${cats || 'Nenhuma categoria disponível no retorno atual.'}

Sugestão: confira se a categoria está cadastrada no sistema como SMARTPHONES, APARELHOS, ACESSÓRIOS, WEARABLES ou outro nome parecido.`;
    }

    const titulo = categoria
      ? `Top ${ranking.length} produtos em estoque da categoria ${categoria}`
      : `Top ${ranking.length} produtos com maior estoque`;

    const linhas = ranking.map((item: any) => {
      const lojas = Array.isArray(item.principais_lojas)
        ? item.principais_lojas
            .slice(0, 5)
            .map((l: any) => `${l.loja}: ${l.quantidade} un.`)
            .join(' | ')
        : 'Lojas não informadas';

      return `${item.posicao}. ${item.descricao}${item.referencia ? ` — Ref. ${item.referencia}` : ''}
   Quantidade: ${item.quantidade_total} un.
   Valor estimado: ${item.valor_estimado_estoque_formatado}
   Principais lojas: ${lojas}`;
    }).join('\n\n');

    return `${titulo}:

${linhas}

Sugestão: use esse ranking para avaliar redistribuição entre lojas com maior concentração e lojas com maior giro.`;
  }

  if (dados?.modulo === 'vendas') {
    if (dados?.total_vendas_formatado) {
      return `Resumo de vendas para ${dados?.periodo?.descricao || 'o período consultado'}:

Total vendido: ${dados.total_vendas_formatado}
Peças vendidas: ${dados.total_pecas}
Ticket médio: ${dados.ticket_medio_formatado}

Sugestão: compare esse resultado com a meta do período para identificar se precisa reforçar ação comercial hoje.`;
    }

    if (Array.isArray(dados?.ranking)) {
      const linhas = dados.ranking
        .slice(0, 10)
        .map((item: any) => {
          const nome = item.loja || item.vendedor || item.familia || 'Item';
          return `${item.posicao}. ${nome} — ${item.total_vendas_formatado || ''} | ${item.total_pecas || 0} peças`;
        })
        .join('\n');

      return `Ranking do período ${dados?.periodo?.descricao || ''}:

${linhas}`;
    }
  }

  return `Ainda estou evoluindo. No momento, consigo responder melhor perguntas sobre vendas, ranking de lojas, vendedores, categorias e estoque.`;
}

app.post('/api/clark/perguntar', async (req, res) => {
  let db: any = null;

  try {
    const { userId, pergunta } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'Usuário não informado.',
      });
    }

    if (!pergunta || !String(pergunta).trim()) {
      return res.status(400).json({
        error: 'Digite uma pergunta para a Clark.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY não configurada no backend.',
      });
    }

    const perguntaLimpa = String(pergunta).trim();
    const intencao = detectarIntencaoClark(perguntaLimpa);
    const filtros = extrairFiltrosClark(perguntaLimpa);

    const hoje = todayIsoSaoPaulo();
    const inicioMes = monthStartIsoSaoPaulo();

    let dados: any = {};

    const precisaBancoVendas = [
      'vendas_hoje',
      'vendas_mes',
      'ranking_lojas_mes',
      'ranking_vendedores_mes',
      'categoria_mes',
    ].includes(intencao);

    let securityFilter = '';

    if (precisaBancoVendas) {
      securityFilter = await getSalesFilter(String(userId), 'vendas');

      if (securityFilter === '1=0') {
        return res.status(403).json({
          error: 'Você não tem permissão para consultar esses dados.',
        });
      }

      db = await open({
        filename: GLOBAL_DB_PATH,
        driver: sqlite3.Database,
      });
    }

    if (intencao === 'vendas_hoje') {
      const resumo = await consultarResumoVendasClark(db, securityFilter, hoje, hoje);

      dados = {
        modulo: 'vendas',
        periodo: {
          descricao: `Hoje (${hoje})`,
          data_inicio: hoje,
          data_fim: hoje,
        },
        total_vendas: Number(resumo?.total_vendas || 0),
        total_vendas_formatado: formatBRL(resumo?.total_vendas || 0),
        total_pecas: Number(resumo?.total_pecas || 0),
        ticket_medio: Number(resumo?.ticket_medio || 0),
        ticket_medio_formatado: formatBRL(resumo?.ticket_medio || 0),
      };
    }

    else if (intencao === 'vendas_mes') {
      const resumo = await consultarResumoVendasClark(db, securityFilter, inicioMes, hoje);

      dados = {
        modulo: 'vendas',
        periodo: {
          descricao: `Mês atual (${inicioMes} até ${hoje})`,
          data_inicio: inicioMes,
          data_fim: hoje,
        },
        total_vendas: Number(resumo?.total_vendas || 0),
        total_vendas_formatado: formatBRL(resumo?.total_vendas || 0),
        total_pecas: Number(resumo?.total_pecas || 0),
        ticket_medio: Number(resumo?.ticket_medio || 0),
        ticket_medio_formatado: formatBRL(resumo?.ticket_medio || 0),
      };
    }

    else if (intencao === 'ranking_lojas_mes') {
      const ranking = await consultarRankingLojasClark(db, securityFilter, inicioMes, hoje);

      dados = {
        modulo: 'vendas',
        periodo: {
          descricao: `Mês atual (${inicioMes} até ${hoje})`,
          data_inicio: inicioMes,
          data_fim: hoje,
        },
        ranking: ranking.map((r: any, index: number) => ({
          posicao: index + 1,
          loja: traduzirCnpjParaLoja(r.cnpj_empresa),
          cnpj_empresa: r.cnpj_empresa,
          total_vendas: Number(r.total_vendas || 0),
          total_vendas_formatado: formatBRL(r.total_vendas || 0),
          total_pecas: Number(r.total_pecas || 0),
          ticket_medio: Number(r.ticket_medio || 0),
          ticket_medio_formatado: formatBRL(r.ticket_medio || 0),
        })),
      };
    }

    else if (intencao === 'ranking_vendedores_mes') {
      const ranking = await consultarRankingVendedoresClark(db, securityFilter, inicioMes, hoje);

      dados = {
        modulo: 'vendas',
        periodo: {
          descricao: `Mês atual (${inicioMes} até ${hoje})`,
          data_inicio: inicioMes,
          data_fim: hoje,
        },
        ranking: ranking.map((r: any, index: number) => ({
          posicao: index + 1,
          vendedor: r.nome_vendedor,
          loja: traduzirCnpjParaLoja(r.cnpj_empresa),
          cnpj_empresa: r.cnpj_empresa,
          total_vendas: Number(r.total_vendas || 0),
          total_vendas_formatado: formatBRL(r.total_vendas || 0),
          total_pecas: Number(r.total_pecas || 0),
          ticket_medio: Number(r.ticket_medio || 0),
          ticket_medio_formatado: formatBRL(r.ticket_medio || 0),
        })),
      };
    }

    else if (intencao === 'categoria_mes') {
      const categorias = await consultarCategoriasClark(db, securityFilter, inicioMes, hoje);

      dados = {
        modulo: 'vendas',
        periodo: {
          descricao: `Mês atual (${inicioMes} até ${hoje})`,
          data_inicio: inicioMes,
          data_fim: hoje,
        },
        categorias: categorias.map((r: any, index: number) => ({
          posicao: index + 1,
          familia: r.familia,
          total_vendas: Number(r.total_vendas || 0),
          total_vendas_formatado: formatBRL(r.total_vendas || 0),
          total_pecas: Number(r.total_pecas || 0),
        })),
      };
    }

    else if (intencao === 'produto_maior_estoque') {
      const estoque = await consultarRankingEstoqueProdutosClark(String(userId), {
        ...filtros,
        limite: filtros.limite || 1,
      });

      dados = {
        modulo: 'estoque',
        pergunta_respondida: 'Produto com maior quantidade em estoque hoje',
        data_consulta: hoje,
        categoria_solicitada: estoque.categoria_solicitada,
        total_itens_estoque_analisados: estoque.total_itens_estoque,
        total_itens_filtrados: estoque.total_itens_filtrados,
        categorias_encontradas: estoque.categorias_encontradas,
        produto_mais_em_estoque: estoque.ranking[0] || null,
        ranking_top: estoque.ranking,
      };
    }

    else if (intencao === 'ranking_estoque_produtos') {
      const estoque = await consultarRankingEstoqueProdutosClark(String(userId), filtros);

      dados = {
        modulo: 'estoque',
        pergunta_respondida: 'Ranking de produtos com maior quantidade em estoque',
        data_consulta: hoje,
        categoria_solicitada: estoque.categoria_solicitada,
        total_itens_estoque_analisados: estoque.total_itens_estoque,
        total_itens_filtrados: estoque.total_itens_filtrados,
        categorias_encontradas: estoque.categorias_encontradas,
        ranking_top: estoque.ranking,
      };
    }

    else {
      dados = {
        modulo: 'ajuda',
        mensagem:
          'Posso responder perguntas sobre vendas, ranking de lojas, ranking de vendedores, categorias e estoque.',
        exemplos: [
          'Quanto vendemos hoje?',
          'Quanto vendemos no mês?',
          'Qual loja mais vendeu no mês?',
          'Me mostre o ranking de vendedores.',
          'Qual categoria mais vendeu no mês?',
          'Qual produto temos mais em estoque hoje?',
          'Liste os 5 maiores modelos da categoria SMARTPHONES em estoque.',
        ],
      };
    }

    if (db) {
      await db.close();
      db = null;
    }

    const prompt = montarPromptClark({
      pergunta: perguntaLimpa,
      intencao,
      filtros,
      dados,
    });

    let resposta = '';

    try {
      const geminiResponse = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });

      resposta =
        geminiResponse.text ||
        gerarRespostaFallbackClark(intencao, dados, filtros);

      return res.json({
        ok: true,
        clark: resposta,
        intencao,
        filtros,
        dados,
        fallback: false,
      });

    } catch (geminiError: any) {
      console.warn('⚠️ Gemini falhou. Usando fallback local:', geminiError?.message || geminiError);

      resposta = gerarRespostaFallbackClark(intencao, dados, filtros);

      return res.json({
        ok: true,
        clark: resposta,
        intencao,
        filtros,
        dados,
        fallback: true,
        gemini_error: geminiError?.message || 'Falha temporária no Gemini',
      });
    }

  } catch (error: any) {
    try {
      if (db) await db.close();
    } catch {}

    console.error('❌ Erro no Clark:', error);

    return res.status(500).json({
      error: error?.message || 'Erro interno no Clark.',
    });
  }
});

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
// 📦 ROTA QUE O REACT USA PARA LER O ESTOQUE
// ==========================================
app.get('/stock', async (req, res) => {
  try {
    const stock = await prisma.stock.findMany();
    res.json(stock);
  } catch (error) {
    console.error("Erro ao buscar estoque:", error);
    res.status(500).json({ error: "Erro ao carregar estoque" });
  }
});

app.get('/comparativos/google-sheet-base', async (_req, res) => {
  try {
    const rows = await loadGoogleSheetTranslations();

    res.json({
      success: true,
      total: rows.length,
      rows,
    });
  } catch (error: any) {
    console.error('Erro ao carregar Google Sheets:', error);

    res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao carregar base do Google Sheets.',
    });
  }
});

app.get('/api/comparativos/mkt-base', async (_req, res) => {
  try {
    const rows = await loadGoogleSheetTranslations();

    res.json({
      success: true,
      total: rows.length,
      rows,
    });
  } catch (error: any) {
    console.error('Erro ao carregar Google Sheets:', error);

    res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao carregar base do Google Sheets.',
    });
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



app.get('/api/comparativos/mkt-base', async (_req, res) => {
  try {
    const rows = await loadGoogleSheetTranslations();

    res.json({
      success: true,
      total: rows.length,
      rows,
    });
  } catch (error: any) {
    console.error('Erro ao carregar Google Sheets:', error);

    res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao carregar base do Google Sheets.',
    });
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
app.use(express.json({ limit: '100mb' }));
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

app.post('/api/sync/vendas_anuais_raw', async (req, res) => {
  const dados = req.body;
  const shouldReset = req.query.reset !== 'false';

  if (!dados || !Array.isArray(dados)) {
    return res.status(400).json({ error: "Formato inválido." });
  }

  try {
    await enqueueWrite(() => new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(ANUAL_DB_PATH);
      db.configure("busyTimeout", 15000);

      db.serialize(() => {
        db.run("PRAGMA journal_mode=WAL;");
        db.run("BEGIN IMMEDIATE TRANSACTION");

        const preQuery = shouldReset ? "DELETE FROM vendas_anuais_raw" : "SELECT 1";

        db.run(preQuery, (err) => {
          if (err) {
            db.run("ROLLBACK", () => db.close(() => reject(err)));
            return;
          }

          const stmt = db.prepare(`
            INSERT INTO vendas_anuais_raw (
              nota_fiscal,
              cancelado,
              tipo_transacao,
              natureza_operacao,
              data_emissao,
              nome_vendedor,
              codigo_produto,
              referencia,
              descricao,
              categoria,
              imei,
              quantidade,
              total_liquido,
              qtd_real,
              total_real,
              categoria_real,
              loja,
              regiao,
              ano,
              mes,
              cnpj_empresa
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const item of dados) {
            stmt.run(
              item.nota_fiscal || null,
              item.cancelado || null,
              item.tipo_transacao || null,
              item.natureza_operacao || null,
              item.data_emissao || null,
              item.nome_vendedor || null,
              item.codigo_produto || null,
              item.referencia || null,
              item.descricao || null,
              item.categoria || null,
              item.imei || null,
              Number(item.quantidade || 0),
              Number(item.total_liquido || 0),
              Number(item.qtd_real || 0),
              Number(item.total_real || 0),
              item.categoria_real || null,
              item.loja || null,
              item.regiao || null,
              Number(item.ano || 0),
              Number(item.mes || 0),
              item.cnpj_empresa || null
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

    res.json({ message: `Lote de Vendas Anuais RAW sincronizado (Reset: ${shouldReset})` });
  } catch (e: any) {
    console.error("Erro /api/sync/vendas_anuais_raw:", e);
    res.status(500).json({ error: "Erro banco anual RAW", details: e.message });
  }
});

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

app.post('/api/solicitacoes', uploadSolicitacao.single('referenciaFile'), async (req, res) => {
  try {
    const {
      lojaSolicitante,
      emailOrigem,
      tipoArte,
      tipoArteOutro,
      produtoFoco,
      precoVista,
      precoParcelado,
      quantidadeParcelas,
      validadeOferta,
      destaqueObrigatorio,
      referenciaLink,
      solicitanteNome,
      solicitanteCargo,
      solicitanteSetor,
      solicitanteEmailSistema,
    } = req.body;

    if (!lojaSolicitante || !produtoFoco || !validadeOferta || !emailOrigem) {
      return res.status(400).json({
        error: 'Campos obrigatórios não preenchidos.',
      });
    }

    const tipoArteFinal =
      tipoArte === 'Outro' && tipoArteOutro?.trim()
        ? `Outro - ${tipoArteOutro}`
        : tipoArte;

    const emailResposta = String(emailOrigem || solicitanteEmailSistema || '').trim();

    const html = `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <h2 style="margin-bottom: 16px;">Nova solicitação enviada pelo TeleFluxo</h2>

        <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 760px;">
          <tr>
            <td style="font-weight: bold; width: 220px; border-bottom: 1px solid #e2e8f0;">Loja solicitante</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${lojaSolicitante || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">E-mail de origem</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${emailOrigem || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Tipo de arte</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${tipoArteFinal || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Produto foco</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${produtoFoco || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Preço à vista</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${precoVista || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Preço parcelado</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${precoParcelado || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Parcelamento</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${quantidadeParcelas || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Validade da oferta</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${validadeOferta || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Destaque obrigatório</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${destaqueObrigatorio || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Link de referência</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${referenciaLink || '-'}</td>
          </tr>
        </table>

        <h3 style="margin-top: 28px;">Dados do solicitante</h3>

        <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 760px;">
          <tr>
            <td style="font-weight: bold; width: 220px; border-bottom: 1px solid #e2e8f0;">Nome</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${solicitanteNome || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Cargo</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${solicitanteCargo || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">Setor</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${solicitanteSetor || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; border-bottom: 1px solid #e2e8f0;">E-mail do sistema</td>
            <td style="border-bottom: 1px solid #e2e8f0;">${solicitanteEmailSistema || '-'}</td>
          </tr>
        </table>

        <p style="margin-top: 20px; font-size: 12px; color: #64748b;">
          Enviado automaticamente pelo módulo Solicitações do TeleFluxo.
        </p>
      </div>
    `;

    const attachments = req.file
      ? [
          {
            filename: req.file.originalname,
            content: req.file.buffer,
            contentType: req.file.mimetype,
          },
        ]
      : [];

    await mailTransporter.sendMail({
      from: `"TeleFluxo Solicitações" <${process.env.GMAIL_USER}>`,
      to: 'marketinggrupotelecel@gmail.com',
      subject: `[TeleFluxo] Nova solicitação - ${lojaSolicitante}`,
      html,
      attachments,
      replyTo: emailResposta || undefined,
    });

    return res.status(200).json({
      ok: true,
      message: 'Solicitação enviada com sucesso.',
    });
  } catch (error: any) {
    console.error('Erro ao enviar solicitação:', error);
    return res.status(500).json({
      error: error?.message || 'Erro interno ao enviar e-mail da solicitação.',
    });
  }
});

// ==========================================
// ROTA: COMPRAS X VENDAS (CONFERÊNCIA IMEI)
// ==========================================
app.get('/api/compras-x-vendas', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const user: any = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !(user.isAdmin || ['CEO', 'DIRETOR', 'ADM'].includes(user.role))) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    }

    if (!fs.existsSync(COMPRAS_DB_PATH)) {
      return res.json({
        summary: {
          totalCompras: 0,
          emEstoque: 0,
          vendidos: 0,
          conciliadoModelo: 0,
          semLocalizacao: 0,
          valorComprado: 0,
        },
        rows: [],
        info: {
          comprasDb: COMPRAS_DB_PATH,
          annualSalesDb: ANUAL_DB_PATH,
          annualSalesRawUsed: false,
          localSalesDb: '',
          dailyDetailUsed: false,
          periodo: {
            startDate: String(req.query.startDate || ''),
            endDate: String(req.query.endDate || ''),
          },
        },
      });
    }

    const today = new Date();
    const defaultStart = `${today.getFullYear()}-01-01`;
    const startDate = String(req.query.startDate || defaultStart);
    const endDate = String(req.query.endDate || today.toISOString().slice(0, 10));

    // --------------------------------------------------
    // COMPRAS
    // --------------------------------------------------
    const comprasDb = await open({ filename: COMPRAS_DB_PATH, driver: sqlite3.Database });

    const comprasRows = await comprasDb.all(`
      SELECT
        data_emissao,
        nota_fiscal,
        nome_fantasia,
        nome_vendedor,
        codigo_produto,
        referencia,
        descricao,
        categoria,
        imei,
        quantidade,
        total_liquido,
        tipo_transacao,
        natureza_operacao,
        cnpj_origem
      FROM compras
      WHERE data_emissao >= ? AND data_emissao <= ?
        AND trim(COALESCE(imei, '')) <> ''
      ORDER BY data_emissao DESC, descricao ASC
    `, [startDate, endDate]);

    await comprasDb.close();

    // --------------------------------------------------
    // ESTOQUE
    // --------------------------------------------------
    const stock = await prisma.stock.findMany({
      where: { serial: { not: '' } }
    });

    const stockBySerial = new Map<string, any>();
    const stockQtyByFamily = new Map<string, number>();

    stock.forEach((item: any) => {
      const serial = normalizeSerial(item.serial);
      if (serial) stockBySerial.set(serial, item);

      const family = normalizeReferenceFamily(item.reference);
      if (family) {
        stockQtyByFamily.set(
          family,
          (stockQtyByFamily.get(family) || 0) + safeNumber(item.quantity, 0)
        );
      }
    });

    // --------------------------------------------------
    // VENDAS — EXATAS POR IMEI + AGREGADAS POR FAMÍLIA
    // --------------------------------------------------
    const soldBySerial = new Map<string, any>();
    const soldQtyByFamily = new Map<string, number>();
    const lastSaleByFamily = new Map<string, any>();

    let annualSalesRawUsed = false;
    let dailyDetailUsed = false;
    let localSalesDbPath = '';

    const addFamilyQty = (family: string, qty: number) => {
      if (!family) return;
      soldQtyByFamily.set(family, (soldQtyByFamily.get(family) || 0) + safeNumber(qty, 0));
    };

    const setLastSaleByFamily = (family: string, row: any) => {
      if (!family) return;
      const prev = lastSaleByFamily.get(family);
      if (!prev || String(prev.data_emissao || '') <= String(row.data_emissao || '')) {
        lastSaleByFamily.set(family, row);
      }
    };

    const setSoldBySerial = (row: any, origem: string) => {
      const imei = normalizeSerial(row.imei);
      if (!imei) return;

      const existing = soldBySerial.get(imei);
      const candidate = {
        ...row,
        imei,
        origem,
      };

      if (!existing || String(existing.data_emissao || '') <= String(candidate.data_emissao || '')) {
        soldBySerial.set(imei, candidate);
      }
    };

    let annualMaxDate = '';

    if (fs.existsSync(ANUAL_DB_PATH)) {
      try {
        const annualDb = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

        const maxDateRow = await annualDb.get(`
          SELECT MAX(data_emissao) as max_date
          FROM vendas_anuais_raw
          WHERE cancelado = 'N'
        `);

        annualMaxDate = String(maxDateRow?.max_date || '').slice(0, 10);

        // IMEI exato da anual raw
        const soldRowsAnnual = await annualDb.all(`
          SELECT
            data_emissao,
            nota_fiscal,
            referencia,
            descricao,
            imei,
            total_liquido,
            loja,
            quantidade,
            cnpj_empresa
          FROM vendas_anuais_raw
          WHERE trim(COALESCE(imei, '')) <> ''
            AND cancelado = 'N'
            AND data_emissao >= ?
            AND data_emissao <= ?
        `, [startDate, endDate]);

        for (const row of soldRowsAnnual) {
          setSoldBySerial(row, 'ANUAL_RAW');
          const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
          setLastSaleByFamily(family, row);
        }

        // agregado anual por família/modelo (inclui vendas SEM IMEI)
        const annualFamilyAgg = await annualDb.all(`
          SELECT
            referencia,
            descricao,
            SUM(COALESCE(quantidade, 0)) as quantidade,
            MAX(data_emissao) as data_emissao
          FROM vendas_anuais_raw
          WHERE cancelado = 'N'
            AND data_emissao >= ?
            AND data_emissao <= ?
          GROUP BY referencia, descricao
        `, [startDate, endDate]);

        for (const row of annualFamilyAgg) {
          const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
          addFamilyQty(family, safeNumber(row.quantidade, 0));
          setLastSaleByFamily(family, row);
        }

        annualSalesRawUsed = soldRowsAnnual.length > 0 || annualFamilyAgg.length > 0;
        await annualDb.close();
      } catch (error) {
        console.error('Erro ao ler ANUAL_DB_PATH / vendas_anuais_raw:', error);
      }
    }

    // --------------------------------------------------
    // SUPLEMENTO DIÁRIO DETALHADO
    // Só soma o que vier DEPOIS da última data do anual raw
    // --------------------------------------------------
    const globalDb = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const dailyDetailTable = await globalDb.get(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
        AND name='vendas_detalhadas_imei'
    `);

    const dailySupplementStart =
      annualMaxDate && annualMaxDate < endDate
        ? nextIsoDate(annualMaxDate)
        : (!annualMaxDate ? startDate : '');

    if (dailyDetailTable && dailySupplementStart && dailySupplementStart <= endDate) {
      const dailyDetailRows = await globalDb.all(`
        SELECT
          data_emissao,
          nota_fiscal,
          nome_fantasia as loja,
          cnpj_empresa,
          nome_vendedor,
          codigo_produto,
          referencia,
          descricao,
          categoria,
          imei,
          quantidade,
          total_liquido,
          regiao
        FROM vendas_detalhadas_imei
        WHERE data_emissao >= ?
          AND data_emissao <= ?
      `, [dailySupplementStart, endDate]);

      for (const row of dailyDetailRows) {
        setSoldBySerial(row, 'DIARIO_DETALHE');

        const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
        addFamilyQty(family, safeNumber(row.quantidade, 0));
        setLastSaleByFamily(family, row);
      }

      dailyDetailUsed = dailyDetailRows.length > 0;
    }

    // fallback legado local, se nada anual nem diário existir
    if (!annualSalesRawUsed && !dailyDetailUsed) {
      localSalesDbPath = pickExistingPath(LOCAL_SALES_DB_CANDIDATES);

      if (localSalesDbPath) {
        try {
          const salesDb = await open({ filename: localSalesDbPath, driver: sqlite3.Database });

          const soldRows = await salesDb.all(`
            SELECT
              DATA_EMISSAO as data_emissao,
              NOTA_FISCAL as nota_fiscal,
              REFERENCIA as referencia,
              DESCRICAO as descricao,
              IMEI as imei,
              TOTAL_LIQUIDO as total_liquido,
              NOME_FANTASIA as loja,
              QUANTIDADE as quantidade
            FROM vendas
            WHERE DATA_EMISSAO >= ?
              AND DATA_EMISSAO <= ?
          `, [startDate, endDate]);

          for (const row of soldRows) {
            setSoldBySerial(row, 'LOCAL_FALLBACK');

            const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
            addFamilyQty(family, safeNumber(row.quantidade, 0));
            setLastSaleByFamily(family, row);
          }

          await salesDb.close();
        } catch (error) {
          console.error('Erro ao ler DB local de vendas:', error);
        }
      }
    }

    await globalDb.close();

    // --------------------------------------------------
    // QUOTAS DE CONCILIAÇÃO POR MODELO
    // --------------------------------------------------
    const purchaseQtyByFamily = new Map<string, number>();

    comprasRows.forEach((row: any) => {
      const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
      if (!family) return;
      purchaseQtyByFamily.set(
        family,
        (purchaseQtyByFamily.get(family) || 0) + safeNumber(row.quantidade, 1)
      );
    });

    const modelQuotaRemaining = new Map<string, number>();

    for (const [family, purchasedQty] of purchaseQtyByFamily.entries()) {
      const stockQty = stockQtyByFamily.get(family) || 0;
      const soldQty = soldQtyByFamily.get(family) || 0;

      const quota = Math.max(
        0,
        Math.min(
          Math.max(purchasedQty - stockQty, 0),
          soldQty
        )
      );

      modelQuotaRemaining.set(family, quota);
    }

    // --------------------------------------------------
    // MONTAGEM DAS LINHAS
    // --------------------------------------------------
    const rows = comprasRows.map((row: any) => {
      const imei = normalizeSerial(row.imei);
      const family = normalizeReferenceFamily(row.referencia || row.descricao || '');
      const stockHit = stockBySerial.get(imei);
      const soldHit = soldBySerial.get(imei);

      const rowQty = Math.max(1, safeNumber(row.quantidade, 1));
      let modelHit = false;

      if (!stockHit && !soldHit && family) {
        const remaining = modelQuotaRemaining.get(family) || 0;
        if (remaining >= rowQty) {
          modelHit = true;
          modelQuotaRemaining.set(family, remaining - rowQty);
        }
      }

      let status = 'SEM LOCALIZAÇÃO';
      if (stockHit) status = 'EM ESTOQUE';
      else if (soldHit) status = 'VENDIDO';
      else if (modelHit) status = 'CONCILIADO POR MODELO';

      const familySaleRef = lastSaleByFamily.get(family);

      return {
        dataCompra: row.data_emissao,
        notaFiscalCompra: row.nota_fiscal,
        lojaCompra: row.nome_fantasia,
        vendedorCompra: row.nome_vendedor,
        codigoProduto: row.codigo_produto,
        referencia: family,
        descricao: row.descricao,
        categoria: row.categoria,
        imei,
        quantidadeCompra: rowQty,
        valorCompra: safeNumber(row.total_liquido, 0),
        tipoTransacao: row.tipo_transacao,
        naturezaOperacao: row.natureza_operacao,
        status,
        lojaAtual: stockHit?.storeName || '-',
        quantidadeEstoqueFamilia: stockQtyByFamily.get(family) || 0,
        quantidadeVendidaFamilia: soldQtyByFamily.get(family) || 0,
        dataVenda: soldHit?.data_emissao || (modelHit ? familySaleRef?.data_emissao || '-' : '-'),
        notaFiscalVenda: soldHit?.nota_fiscal || (modelHit ? 'CONCILIADO_POR_MODELO' : '-'),
        lojaVenda: soldHit?.loja || (modelHit ? familySaleRef?.loja || '-' : '-'),
        serialNoEstoque: Boolean(stockHit),
        serialVendido: Boolean(soldHit),
        matchMetodo: stockHit
          ? 'IMEI_ESTOQUE'
          : soldHit
            ? `IMEI_${soldHit?.origem || 'VENDA'}`
            : modelHit
              ? 'MODELO_REFERENCIA'
              : 'NAO_LOCALIZADO',
      };
    });

    const summary = {
      totalCompras: rows.length,
      emEstoque: rows.filter((r: any) => r.status === 'EM ESTOQUE').length,
      vendidos: rows.filter((r: any) => r.status === 'VENDIDO').length,
      conciliadoModelo: rows.filter((r: any) => r.status === 'CONCILIADO POR MODELO').length,
      semLocalizacao: rows.filter((r: any) => r.status === 'SEM LOCALIZAÇÃO').length,
      valorComprado: rows.reduce((sum: number, r: any) => sum + safeNumber(r.valorCompra, 0), 0),
    };

    return res.json({
      summary,
      rows,
      info: {
        comprasDb: COMPRAS_DB_PATH,
        annualSalesDb: ANUAL_DB_PATH,
        annualSalesRawUsed,
        annualMaxDate,
        dailyDetailUsed,
        dailySupplementStart: dailySupplementStart || '',
        localSalesDb: localSalesDbPath || '',
        periodo: { startDate, endDate }
      }
    });
  } catch (error: any) {
    console.error('Erro /api/compras-x-vendas:', error);
    return res.status(500).json({ error: error?.message || 'Erro ao montar Compras x Vendas' });
  }
});

// ==========================================
// ROTA: VENDAS DETALHADAS
// ==========================================

app.post('/api/sync/vendas_detalhadas_imei', async (req, res) => {
  const dados = req.body;
  const reset = req.query.reset === 'true';

  if (!Array.isArray(dados)) {
    return res.status(400).json({ error: 'Formato inválido' });
  }

  try {
    const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
    await db.exec('BEGIN TRANSACTION');

    if (reset) {
      await db.exec('DROP TABLE IF EXISTS vendas_detalhadas_imei');
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS vendas_detalhadas_imei (
        data_emissao TEXT,
        nota_fiscal TEXT,
        nome_fantasia TEXT,
        cnpj_empresa TEXT,
        nome_vendedor TEXT,
        codigo_produto TEXT,
        referencia TEXT,
        descricao TEXT,
        categoria TEXT,
        imei TEXT,
        quantidade REAL,
        total_liquido REAL,
        regiao TEXT
      )
    `);

    const stmt = await db.prepare(`
      INSERT INTO vendas_detalhadas_imei (
        data_emissao,
        nota_fiscal,
        nome_fantasia,
        cnpj_empresa,
        nome_vendedor,
        codigo_produto,
        referencia,
        descricao,
        categoria,
        imei,
        quantidade,
        total_liquido,
        regiao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of dados) {
      await stmt.run(
        item.data_emissao || null,
        item.nota_fiscal || null,
        item.nome_fantasia || null,
        item.cnpj_empresa || null,
        item.nome_vendedor || null,
        item.codigo_produto || null,
        item.referencia || null,
        item.descricao || null,
        item.categoria || null,
        item.imei || null,
        safeNumber(item.quantidade, 0),
        safeNumber(item.total_liquido, 0),
        item.regiao || null
      );
    }

    await stmt.finalize();
    await db.exec('COMMIT');
    await db.close();

    res.json({ success: true, gravados: dados.length });
  } catch (e: any) {
    console.error('Erro Sync Vendas Detalhadas IMEI:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// ROTA: VENDAS POR MODELO PARA COMPARATIVO
// ==========================================
app.get('/api/comparativos/vendas-modelos', async (req, res) => {
  const userId = String(req.query.userId || '');
  const startDate = String(req.query.startDate || '');
  const endDate = String(req.query.endDate || '');

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: 'Informe startDate e endDate no formato YYYY-MM-DD.',
    });
  }

  const normalizeDateSql = (col: string) => `
    CASE
      WHEN ${col} LIKE '__/__/____%' THEN
        substr(${col}, 7, 4) || '-' || substr(${col}, 4, 2) || '-' || substr(${col}, 1, 2)
      ELSE
        substr(${col}, 1, 10)
    END
  `;

  const salesMap = new Map<string, any>();

  const addRows = (rows: any[], origem: string) => {
    for (const row of rows) {
      const referencia = String(row.REFERENCIA || row.referencia || '').trim();
      const descricao = String(row.DESCRICAO || row.descricao || '').trim();
      const quantidade = safeNumber(row.QUANTIDADE ?? row.quantidade, 0);

      if (!referencia && !descricao) continue;

      const key = `${referencia.toUpperCase()}||${descricao.toUpperCase()}`;

      const current = salesMap.get(key) || {
        REFERENCIA: referencia,
        FAMILIA: referencia,
        DESCRICAO: descricao,
        QUANTIDADE: 0,
        origem,
      };

      current.QUANTIDADE += quantidade;
      salesMap.set(key, current);
    }
  };

  let globalDb: any;
  let annualDb: any;

  try {
    const securityFilter = await getSalesFilter(userId, 'vendas');

    // 1) Primeiro tenta buscar na base anual RAW, que possui referência/modelo.
    let annualMaxDate = '';

    if (fs.existsSync(ANUAL_DB_PATH)) {
      try {
        annualDb = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

        const hasAnnualRaw = await annualDb.get(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'vendas_anuais_raw'
        `);

        if (hasAnnualRaw) {
          const dateExpr = normalizeDateSql('data_emissao');

          const maxDateRow = await annualDb.get(`
            SELECT MAX(${dateExpr}) as max_date
            FROM vendas_anuais_raw
            WHERE COALESCE(cancelado, 'N') = 'N'
              AND ${dateExpr} >= ?
              AND ${dateExpr} <= ?
              AND ${securityFilter}
          `, [startDate, endDate]);

          annualMaxDate = String(maxDateRow?.max_date || '').slice(0, 10);

          const annualRows = await annualDb.all(`
            SELECT
              referencia AS REFERENCIA,
              descricao AS DESCRICAO,
              SUM(
                CASE
                  WHEN COALESCE(qtd_real, 0) <> 0 THEN COALESCE(qtd_real, 0)
                  ELSE COALESCE(quantidade, 0)
                END
              ) AS QUANTIDADE
            FROM vendas_anuais_raw
            WHERE COALESCE(cancelado, 'N') = 'N'
              AND ${dateExpr} >= ?
              AND ${dateExpr} <= ?
              AND ${securityFilter}
            GROUP BY referencia, descricao
          `, [startDate, endDate]);

          addRows(annualRows, 'ANUAL_RAW');
        }

        await annualDb.close();
        annualDb = null;
      } catch (error) {
        console.error('Erro ao buscar vendas no ANUAL RAW:', error);
        if (annualDb) {
          try { await annualDb.close(); } catch {}
          annualDb = null;
        }
      }
    }

    // 2) Depois complementa com venda diária detalhada após a última data anual.
    globalDb = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const hasDetailed = await globalDb.get(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'vendas_detalhadas_imei'
    `);

    const dailyStart =
      annualMaxDate && annualMaxDate < endDate
        ? nextIsoDate(annualMaxDate)
        : (!annualMaxDate ? startDate : '');

    if (hasDetailed && dailyStart && dailyStart <= endDate) {
      const dateExpr = normalizeDateSql('data_emissao');

      const detailedRows = await globalDb.all(`
        SELECT
          referencia AS REFERENCIA,
          descricao AS DESCRICAO,
          SUM(COALESCE(quantidade, 0)) AS QUANTIDADE
        FROM vendas_detalhadas_imei
        WHERE ${dateExpr} >= ?
          AND ${dateExpr} <= ?
          AND ${securityFilter}
        GROUP BY referencia, descricao
      `, [dailyStart, endDate]);

      addRows(detailedRows, 'DIARIO_DETALHE');
    }

    // 3) Fallback: se nada veio das bases detalhadas, usa a tabela vendas antiga.
    if (salesMap.size === 0) {
      const dateExpr = normalizeDateSql('data_emissao');

      const legacyRows = await globalDb.all(`
        SELECT
          familia AS REFERENCIA,
          descricao AS DESCRICAO,
          SUM(COALESCE(quantidade, 0)) AS QUANTIDADE
        FROM vendas
        WHERE ${dateExpr} >= ?
          AND ${dateExpr} <= ?
          AND ${securityFilter}
        GROUP BY familia, descricao
      `, [startDate, endDate]);

      addRows(legacyRows, 'VENDAS_LEGADO');
    }

    await globalDb.close();

    const sales = Array.from(salesMap.values());

    return res.json({
      success: true,
      total: sales.length,
      sales,
      periodo: { startDate, endDate },
    });
  } catch (error: any) {
    console.error('Erro /api/comparativos/vendas-modelos:', error);

    try {
      if (globalDb) await globalDb.close();
      if (annualDb) await annualDb.close();
    } catch {}

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao buscar vendas por modelo.',
    });
  }
});

// =======================================================
// 🔁 FLUXO DE COMPARATIVO
// =======================================================

const COMPARATIVO_EMAIL_DEFAULT = 'analista.samsungtelecel@gmail.com';

// Lista fixa de destinatários da tabela final.
// Para adicionar mais e-mails depois, basta incluir aqui.
const COMPARATIVO_EMAIL_LIST = [
  'analista.samsungtelecel@gmail.com',
];


type ComparativoStatus = 'EM_ANALISE' | 'RESPONDIDO' | 'DEVOLVIDO';

function safeJsonParse(value: any, fallback: any) {
  try {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function sanitizeFileName(value: any) {
  return String(value || 'comparativo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'comparativo';
}

function toMoneyNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  return Number(
    String(value)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
  ) || 0;
}

function roundUpToEndingNine(value: any) {
  const base = Math.ceil(toMoneyNumber(value));
  if (base <= 0) return 0;

  let candidate = base;

  while (candidate % 10 !== 9) {
    candidate += 1;
  }

  return candidate;
}

function getFinalPriceFromRow(row: any) {
  return toMoneyNumber(
    row.precoFinal ??
    row.preco_final ??
    row.precoPromocional ??
    row['PREÇO PROMOCIONAL'] ??
    row['PRECO PROMOCIONAL'] ??
    row.ofertaAtual ??
    row['OFERTA ATUAL'] ??
    0
  );
}

function normalizeComparativoRowForExcel(row: any) {
  const precoFinal = getFinalPriceFromRow(row);
  const preco18x = roundUpToEndingNine(precoFinal * 1.06);

  return {
    'DESCRIÇÃO': row.descricao || row.DESCRICAO || row['DESCRIÇÃO'] || '',
    'REFERÊNCIA': row.referencia || row.REFERENCIA || row['REFERÊNCIA'] || '',
    'PREÇO SAMSUNG': toMoneyNumber(row.precoSamsung ?? row['PREÇO SAMSUNG']),
    'PREÇO TELECEL': toMoneyNumber(row.precoTelecel ?? row['PREÇO TELECEL']),
    'DESC. TELECEL': toMoneyNumber(row.totalDescontoTelecel ?? row['DESC. TELECEL']),
    'DESC. REBATE': toMoneyNumber(row.descontoRebate ?? row['DESC. REBATE']),
    'DESC. TRADE IN': toMoneyNumber(row.descontoTradeIn ?? row['DESC. TRADE IN']),
    'DESC. BOGO': toMoneyNumber(row.descontoBogo ?? row['DESC. BOGO']),
    'DESC. SIP': toMoneyNumber(row.descontoSip ?? row['DESC. SIP']),
    'TOTAL DESCONTO': toMoneyNumber(row.totalDesconto ?? row['TOTAL DESCONTO']),
    'PREÇO FINAL': precoFinal,
    'PREÇO 18X': preco18x,
    'QTD ESTOQUE': toMoneyNumber(row.qtdEstoque ?? row['QTD ESTOQUE']),
    'CUSTO MÉDIO': toMoneyNumber(row.custoMedioEstoque ?? row['CUSTO MÉDIO']),
    'MARGEM ESTOQUE': row.margemEstoque ?? row['MARGEM ESTOQUE'] ?? '',
    'NOVO CUSTO MÉDIO': toMoneyNumber(row.novoCustoMedio ?? row['NOVO CUSTO MÉDIO']),
    'MARGEM PRICE': row.margemPrice ?? row['MARGEM PRICE'] ?? '',
    'QTD VENDIDA': toMoneyNumber(row.qtdVendida ?? row['QTD VENDIDA']),
    'PRICE REBATE': toMoneyNumber(row.priceRebate ?? row['PRICE REBATE']),
    'PRICE TRADE IN': toMoneyNumber(row.priceTradeIn ?? row['PRICE TRADE IN']),
    'PRICE BOGO': toMoneyNumber(row.priceBogo ?? row['PRICE BOGO']),
    'PRICE SIP': toMoneyNumber(row.priceSip ?? row['PRICE SIP']),
    'OFERTA ATUAL': toMoneyNumber(row.ofertaAtual ?? row['OFERTA ATUAL']),
    'STATUS': row.status || row.STATUS || '',
  };
}

function buildComparativoWorkbookBuffer(row: any, override?: any) {
  const comOfertas = Array.isArray(override?.comOfertas)
    ? override.comOfertas
    : safeJsonParse(row.com_ofertas_json, []);

  const semOfertas = Array.isArray(override?.semOfertas)
    ? override.semOfertas
    : safeJsonParse(row.sem_ofertas_json, []);

  const payload = override?.payload
    ? override.payload
    : safeJsonParse(row.payload_json, {});

  const tabelaFinal = [
    ...comOfertas.map((item: any) => ({
      ...normalizeComparativoRowForExcel(item),
      'TIPO': 'COM OFERTA',
    })),
    ...semOfertas.map((item: any) => ({
      ...normalizeComparativoRowForExcel(item),
      'TIPO': 'SEM OFERTA',
    })),
  ];

  const resumo = [
    { Campo: 'ID', Valor: row.id },
    { Campo: 'Título', Valor: row.titulo },
    { Campo: 'Tipo Comparativo', Valor: row.tipo_comparativo },
    { Campo: 'Status', Valor: row.status },
    { Campo: 'Criado por', Valor: row.criado_por_nome },
    { Campo: 'Criado em', Valor: row.created_at },
    { Campo: 'Enviado em', Valor: row.enviado_em || '' },
    { Campo: 'Respondido em', Valor: row.respondido_em || '' },
    { Campo: 'Devolvido em', Valor: row.devolvido_em || '' },
    { Campo: 'Motivo devolução', Valor: row.motivo_devolucao || '' },
    { Campo: 'Total com ofertas', Valor: comOfertas.length },
    { Campo: 'Total sem ofertas', Valor: semOfertas.length },
    { Campo: 'Payload', Valor: JSON.stringify(payload).slice(0, 25000) },
  ];

  const workbook = XLSX.utils.book_new();

  const wsComOfertas = XLSX.utils.json_to_sheet(
    comOfertas.map((item: any) => normalizeComparativoRowForExcel(item))
  );

  const wsSemOfertas = XLSX.utils.json_to_sheet(
    semOfertas.map((item: any) => normalizeComparativoRowForExcel(item))
  );

  const wsTabelaFinal = XLSX.utils.json_to_sheet(tabelaFinal);
  const wsResumo = XLSX.utils.json_to_sheet(resumo);

  XLSX.utils.book_append_sheet(workbook, wsComOfertas, 'Com Ofertas');
  XLSX.utils.book_append_sheet(workbook, wsSemOfertas, 'Sem Ofertas');
  XLSX.utils.book_append_sheet(workbook, wsTabelaFinal, 'Tabela Final');
  XLSX.utils.book_append_sheet(workbook, wsResumo, 'Resumo');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}

function getComparativoPayloadFromRequest(body: any, row: any) {
  const payloadAtual = safeJsonParse(row.payload_json, {});
  const comOfertasAtual = safeJsonParse(row.com_ofertas_json, []);
  const semOfertasAtual = safeJsonParse(row.sem_ofertas_json, []);

  const payloadBody = body?.payload && typeof body.payload === 'object'
    ? body.payload
    : null;

  const comOfertas =
    Array.isArray(body?.comOfertas)
      ? body.comOfertas
      : Array.isArray(payloadBody?.comOfertas)
        ? payloadBody.comOfertas
        : comOfertasAtual;

  const semOfertas =
    Array.isArray(body?.semOfertas)
      ? body.semOfertas
      : Array.isArray(payloadBody?.semOfertas)
        ? payloadBody.semOfertas
        : semOfertasAtual;

  const payload = {
    ...payloadAtual,
    ...(payloadBody || {}),
    comOfertas,
    semOfertas,
  };

  return {
    payload,
    comOfertas,
    semOfertas,
  };
}

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoneyBR(value: any) {
  const n = toMoneyNumber(value);
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: any) {
  const n = toMoneyNumber(value);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickRowValue(row: any, keys: string[], fallback: any = '') {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return fallback;
}

function normalizeFinalTableRow(row: any) {
  const descricao = String(pickRowValue(row, ['descricao', 'DESCRICAO', 'DESCRIÇÃO', 'produto', 'PRODUTO'], ''));
  const referencia = String(pickRowValue(row, ['referencia', 'REFERENCIA', 'REFERÊNCIA'], ''));

  const precoSamsung = roundMoney(pickRowValue(row, ['precoSamsung', 'PREÇO SAMSUNG', 'PRECO SAMSUNG'], 0));

  const descTelecel = roundMoney(
    pickRowValue(row, [
      'totalDescontoTelecel',
      'descontoTelecel',
      'DESC. TELECEL',
      'TELECEL DESC. MANUAL',
      'TOTAL DESCONTO TELECEL',
    ], 0)
  );

  const descRebate = roundMoney(pickRowValue(row, ['descontoRebate', 'DESC. REBATE', 'REBATE DESC. AUTOMATICO'], 0));
  const descTradeIn = roundMoney(pickRowValue(row, ['descontoTradeIn', 'DESC. TRADE IN', 'TRADE IN DESC. AUTOMATICO'], 0));
  const descBogo = roundMoney(pickRowValue(row, ['descontoBogo', 'DESC. BOGO', 'BOGO / CASH BACK DESC. MANUAL'], 0));
  const descSip = roundMoney(pickRowValue(row, ['descontoSip', 'DESC. SIP', 'SIP DESC. MANUAL'], 0));

  const totalDesconto = roundMoney(descTelecel + descRebate + descTradeIn + descBogo + descSip);
  const precoFinal = roundMoney(Math.max(precoSamsung - totalDesconto, 0));
  const preco18x = roundUpToEndingNine(precoFinal * 1.06);

  // Base original da tabela de preços usada no comparativo.
  // Na montagem do comparativo, ofertaAtual representa o preço final original da planilha guia.
  const precoFinalOriginal = roundMoney(pickRowValue(row, ['ofertaAtual', 'OFERTA ATUAL', 'PREÇO FINAL ORIGINAL'], 0));

  const changed =
    Boolean(row?.hasOferta) ||
    (precoFinalOriginal > 0 && Math.abs(precoFinal - precoFinalOriginal) > 0.01);

  return {
    descricao,
    referencia,
    precoSamsung,
    descTelecel,
    descRebate,
    descTradeIn,
    descBogo,
    descSip,
    precoFinal,
    preco18x,
    changed,
    excel: {
      'DESCRIÇÃO': descricao,
      'REFERÊNCIA': referencia,
      'PREÇO SAMSUNG': precoSamsung,
      'TELECEL DESC. MANUAL': descTelecel,
      'REBATE DESC. AUTOMATICO': descRebate,
      'TRADE IN DESC. AUTOMATICO': descTradeIn,
      'BOGO / CASH BACK DESC. MANUAL': descBogo,
      'SIP DESC. MANUAL': descSip,
      'PREÇO FINAL': precoFinal,
      'PREÇO PARCELAMENTO 18x': preco18x,
    },
  };
}

function getFinalTableRowsFromComparativo(row: any, override?: any) {
  const comOfertas = Array.isArray(override?.comOfertas)
    ? override.comOfertas
    : safeJsonParse(row.com_ofertas_json, []);

  const semOfertas = Array.isArray(override?.semOfertas)
    ? override.semOfertas
    : safeJsonParse(row.sem_ofertas_json, []);

  const allRows = [...comOfertas, ...semOfertas]
    .filter((item: any) => item && item.isSelected !== false)
    .map((item: any) => normalizeFinalTableRow(item));

  allRows.sort((a: any, b: any) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  return allRows;
}

function buildFinalTableWorkbookBuffer(finalRows: any[], titulo: string) {
  const headers = [
    'DESCRIÇÃO',
    'REFERÊNCIA',
    'PREÇO SAMSUNG',
    'TELECEL DESC. MANUAL',
    'REBATE DESC. AUTOMATICO',
    'TRADE IN DESC. AUTOMATICO',
    'BOGO / CASH BACK DESC. MANUAL',
    'SIP DESC. MANUAL',
    'PREÇO FINAL',
    'PREÇO PARCELAMENTO 18x',
  ];

  const aoa = [
    [`${titulo || 'Tabela Telecel'}`],
    headers,
    ...finalRows.map((row: any) => headers.map((header) => row.excel[header])),
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  sheet['!cols'] = [
    { wch: 36 },
    { wch: 16 },
    { wch: 15 },
    { wch: 20 },
    { wch: 23 },
    { wch: 25 },
    { wch: 30 },
    { wch: 18 },
    { wch: 14 },
    { wch: 24 },
  ];

  // Mescla o título da linha 1.
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

  // Tentativa de aplicar estilos no Excel. Dependendo da lib xlsx instalada,
  // o estilo pode ser respeitado ou ignorado. O HTML do e-mail sempre respeita o amarelo.
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:J1');

  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const headerCell = XLSX.utils.encode_cell({ r: 1, c });
    if (sheet[headerCell]) {
      sheet[headerCell].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1F4E78' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      };
    }
  }

  finalRows.forEach((row: any, idx: number) => {
    const excelRowIndex = idx + 2;

    for (let c = 0; c < headers.length; c += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: excelRowIndex, c });
      if (!sheet[cellRef]) continue;

      sheet[cellRef].s = {
        fill: row.changed ? { fgColor: { rgb: 'FFF2CC' } } : undefined,
        alignment: { vertical: 'center', wrapText: true },
      };
    }
  });

  XLSX.utils.book_append_sheet(workbook, sheet, 'TABELA TELECEL');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}

function buildFinalTableHtml(finalRows: any[]) {
  const headers = [
    'DESCRIÇÃO',
    'REFERÊNCIA',
    'PREÇO SAMSUNG',
    'TELECEL DESC. MANUAL',
    'REBATE DESC. AUTOMATICO',
    'TRADE IN DESC. AUTOMATICO',
    'BOGO / CASH BACK DESC. MANUAL',
    'SIP DESC. MANUAL',
    'PREÇO FINAL',
    'PREÇO PARCELAMENTO 18x',
  ];

  const moneyHeaders = new Set(headers.slice(2));

  const rowsHtml = finalRows.map((row: any) => {
    const bg = row.changed ? '#fff2cc' : '#ffffff';

    const cells = headers.map((header) => {
      const value = row.excel[header];
      const display = moneyHeaders.has(header) ? formatMoneyBR(value) : escapeHtml(value);
      const align = moneyHeaders.has(header) ? 'right' : 'left';

      return `<td style="border:1px solid #d9e2f3;padding:7px 9px;text-align:${align};background:${bg};font-size:12px;">${display}</td>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  const headersHtml = headers.map((header) => `
    <th style="border:1px solid #d9e2f3;padding:8px 9px;background:#1f4e78;color:#ffffff;font-size:11px;text-align:center;">
      ${escapeHtml(header)}
    </th>
  `).join('');

  return `
    <table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;margin-top:16px;">
      <thead><tr>${headersHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function buildEmailHtml(body: string, finalRows: any[]) {
  const bodyHtml = escapeHtml(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px;line-height:1.5;">
      <div>${bodyHtml}</div>
      ${buildFinalTableHtml(finalRows)}
      <p style="margin-top:18px;font-size:12px;color:#6b7280;">
        Linhas destacadas em amarelo indicam produtos com alteração em relação à tabela original.
      </p>
    </div>
  `;
}


async function ensureComparativosFluxoTable() {
  const db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS comparativos_fluxo (
      id TEXT PRIMARY KEY,
      titulo TEXT,
      tipo_comparativo TEXT,
      status TEXT DEFAULT 'EM_ANALISE',
      criado_por_id TEXT,
      criado_por_nome TEXT,
      enviado_para TEXT,
      payload_json TEXT,
      com_ofertas_json TEXT,
      sem_ofertas_json TEXT,
      motivo_devolucao TEXT,
      email_enviado_para TEXT,
      created_at TEXT,
      updated_at TEXT,
      enviado_em TEXT,
      respondido_em TEXT,
      devolvido_em TEXT
    )
  `);

  await db.close();
}

// =======================================================
// Excluir comparativo
// Regra:
// - EM_ANALISE: quem criou pode excluir
// - RESPONDIDO/DEVOLVIDO: somente CEO ou MASTER
// =======================================================
app.delete('/api/comparativos/fluxo/:id', async (req, res) => {
  await ensureComparativosFluxoTable();

  const userId = String(req.body?.userId || req.query?.userId || '').trim();
  let db: any;

  try {
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;

    if (!user) {
      return res.status(403).json({
        success: false,
        error: 'Usuário inválido para excluir comparativo.',
      });
    }

    const userRole = String((user as any)?.role || '').toUpperCase();
    const isCeoOrMaster = userRole === 'CEO' || userRole === 'MASTER';

    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    const isCreator = String(row.criado_por_id || '') === userId;
    const canDelete = row.status === 'EM_ANALISE'
      ? (isCreator || isCeoOrMaster)
      : isCeoOrMaster;

    if (!canDelete) {
      await db.close();
      return res.status(403).json({
        success: false,
        error: 'Você não tem permissão para excluir este comparativo.',
      });
    }

    await db.run(`DELETE FROM comparativos_fluxo WHERE id = ?`, [req.params.id]);
    await db.close();

    return res.json({
      success: true,
      message: 'Comparativo excluído com sucesso.',
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao excluir comparativo:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao excluir comparativo.',
    });
  }
});

// =======================================================
// Prévia da tabela final
// =======================================================
app.get('/api/comparativos/fluxo/:id/final-table-preview', async (req, res) => {
  await ensureComparativosFluxoTable();

  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    if (row.status !== 'RESPONDIDO') {
      await db.close();
      return res.status(400).json({
        success: false,
        error: 'A tabela final só pode ser visualizada depois que o comparativo estiver respondido.',
      });
    }

    const finalRows = getFinalTableRowsFromComparativo(row);

    await db.close();

    return res.json({
      success: true,
      titulo: row.titulo,
      destinatarios: COMPARATIVO_EMAIL_LIST,
      defaultSubject: `Tabela Telecel - ${row.titulo}`,
      defaultBody: `Prezados, boa tarde!\n\nSegue tabela atualizada referente ao comparativo ${row.titulo}.\n\nQualquer dúvida, fico à disposição.`,
      rows: finalRows.map((row: any) => ({
        ...row.excel,
        descricao: row.descricao,
        referencia: row.referencia,
        precoSamsung: row.precoSamsung,
        descTelecel: row.descTelecel,
        descRebate: row.descRebate,
        descTradeIn: row.descTradeIn,
        descBogo: row.descBogo,
        descSip: row.descSip,
        precoFinal: row.precoFinal,
        preco18x: row.preco18x,
        changed: row.changed,
      })),
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao montar prévia da tabela final:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao montar prévia da tabela final.',
    });
  }
});

// =======================================================
// Enviar tabela final: HTML no corpo + Excel anexo
// Também permite downloadOnly=true para baixar sem enviar
// =======================================================
app.post('/api/comparativos/fluxo/:id/send-final-table', async (req, res) => {
  await ensureComparativosFluxoTable();

  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  const downloadOnly = req.body?.downloadOnly === true;

  if (!subject) {
    return res.status(400).json({
      success: false,
      error: 'Informe o assunto do e-mail.',
    });
  }

  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    if (row.status !== 'RESPONDIDO') {
      await db.close();
      return res.status(400).json({
        success: false,
        error: 'A tabela só pode ser enviada depois que o comparativo estiver respondido.',
      });
    }

    const payloadParts = getComparativoPayloadFromRequest(req.body, row);

    const rowForFinal = {
      ...row,
      payload_json: JSON.stringify(payloadParts.payload),
      com_ofertas_json: JSON.stringify(payloadParts.comOfertas),
      sem_ofertas_json: JSON.stringify(payloadParts.semOfertas),
    };

    const finalRows = getFinalTableRowsFromComparativo(rowForFinal, payloadParts);
    const fileName = `Tabela_Telecel_${sanitizeFileName(row.titulo)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const buffer = buildFinalTableWorkbookBuffer(finalRows, row.titulo);

    if (!downloadOnly) {
      const html = buildEmailHtml(body, finalRows);

      await mailTransporter.sendMail({
        from: process.env.GMAIL_USER,
        to: COMPARATIVO_EMAIL_LIST.join(','),
        subject,
        text: `${body}\n\nTabela enviada no corpo do e-mail e em anexo.`,
        html,
        attachments: [
          {
            filename: fileName,
            content: buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });
    }

    const now = new Date().toISOString();

    await db.run(
      `
        UPDATE comparativos_fluxo
        SET email_enviado_para = ?,
            payload_json = ?,
            com_ofertas_json = ?,
            sem_ofertas_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        COMPARATIVO_EMAIL_LIST.join(','),
        JSON.stringify(payloadParts.payload),
        JSON.stringify(payloadParts.comOfertas),
        JSON.stringify(payloadParts.semOfertas),
        now,
        req.params.id,
      ]
    );

    await db.close();

    return res.json({
      success: true,
      message: downloadOnly
        ? 'Excel gerado para download.'
        : 'Tabela enviada por e-mail com HTML no corpo e Excel em anexo.',
      emailTo: COMPARATIVO_EMAIL_LIST,
      fileName,
      fileBase64: buffer.toString('base64'),
      rows: finalRows.map((row: any) => ({
        ...row.excel,
        changed: row.changed,
      })),
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao enviar tabela final:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao enviar tabela final.',
    });
  }
});

// =======================================================
// Criar/enviar comparativo para análise
// =======================================================
app.post('/api/comparativos/fluxo', async (req, res) => {
  await ensureComparativosFluxoTable();

  const {
    titulo,
    tipoComparativo,
    criadoPorId,
    criadoPorNome,
    enviadoPara,
    payload,
    comOfertas,
    semOfertas,
  } = req.body || {};

  const now = new Date().toISOString();
  const id = `CMP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    await db.run(
      `
        INSERT INTO comparativos_fluxo (
          id,
          titulo,
          tipo_comparativo,
          status,
          criado_por_id,
          criado_por_nome,
          enviado_para,
          payload_json,
          com_ofertas_json,
          sem_ofertas_json,
          created_at,
          updated_at,
          enviado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(titulo || `Comparativo ${tipoComparativo || ''}`).trim(),
        String(tipoComparativo || '').trim(),
        'EM_ANALISE',
        String(criadoPorId || '').trim(),
        String(criadoPorNome || '').trim(),
        String(enviadoPara || 'Sr Rufino').trim(),
        JSON.stringify(payload || {}),
        JSON.stringify(Array.isArray(comOfertas) ? comOfertas : []),
        JSON.stringify(Array.isArray(semOfertas) ? semOfertas : []),
        now,
        now,
        now,
      ]
    );

    const created = await db.get(`SELECT * FROM comparativos_fluxo WHERE id = ?`, [id]);
    await db.close();

    return res.status(201).json({
      success: true,
      message: 'Comparativo enviado para análise.',
      comparativo: {
        ...created,
        payload: safeJsonParse(created.payload_json, {}),
        comOfertas: safeJsonParse(created.com_ofertas_json, []),
        semOfertas: safeJsonParse(created.sem_ofertas_json, []),
      },
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao criar fluxo de comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao enviar comparativo para análise.',
    });
  }
});

// =======================================================
// Listar comparativos do fluxo
// status opcional: EM_ANALISE, RESPONDIDO, DEVOLVIDO
// =======================================================
app.get('/api/comparativos/fluxo', async (req, res) => {
  await ensureComparativosFluxoTable();

  const status = String(req.query.status || '').trim();
  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const rows = status
      ? await db.all(
          `SELECT * FROM comparativos_fluxo WHERE status = ? ORDER BY created_at DESC`,
          [status]
        )
      : await db.all(
          `SELECT * FROM comparativos_fluxo ORDER BY created_at DESC`
        );

    await db.close();

    return res.json({
      success: true,
      total: rows.length,
      comparativos: rows.map((row: any) => ({
        ...row,
        payload: safeJsonParse(row.payload_json, {}),
        comOfertas: safeJsonParse(row.com_ofertas_json, []),
        semOfertas: safeJsonParse(row.sem_ofertas_json, []),
      })),
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao listar fluxo de comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao listar comparativos.',
    });
  }
});

// =======================================================
// Buscar comparativo por ID
// =======================================================
app.get('/api/comparativos/fluxo/:id', async (req, res) => {
  await ensureComparativosFluxoTable();

  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    await db.close();

    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    return res.json({
      success: true,
      comparativo: {
        ...row,
        payload: safeJsonParse(row.payload_json, {}),
        comOfertas: safeJsonParse(row.com_ofertas_json, []),
        semOfertas: safeJsonParse(row.sem_ofertas_json, []),
      },
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao buscar comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao buscar comparativo.',
    });
  }
});

// =======================================================
// Marcar como respondido
// Somente CEO deve chamar pelo frontend
// =======================================================
app.put('/api/comparativos/fluxo/:id/respondido', async (req, res) => {
  await ensureComparativosFluxoTable();

  const now = new Date().toISOString();
  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    await db.run(
      `
        UPDATE comparativos_fluxo
        SET status = ?,
            updated_at = ?,
            respondido_em = ?,
            motivo_devolucao = NULL
        WHERE id = ?
      `,
      ['RESPONDIDO', now, now, req.params.id]
    );

    const updated = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    await db.close();

    return res.json({
      success: true,
      message: 'Comparativo marcado como respondido.',
      comparativo: {
        ...updated,
        payload: safeJsonParse(updated.payload_json, {}),
        comOfertas: safeJsonParse(updated.com_ofertas_json, []),
        semOfertas: safeJsonParse(updated.sem_ofertas_json, []),
      },
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao marcar como respondido:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao marcar como respondido.',
    });
  }
});

// =======================================================
// Devolver comparativo com motivo
// Somente CEO deve chamar pelo frontend
// =======================================================
app.put('/api/comparativos/fluxo/:id/devolver', async (req, res) => {
  await ensureComparativosFluxoTable();

  const motivo = String(req.body?.motivo || '').trim();

  if (!motivo) {
    return res.status(400).json({
      success: false,
      error: 'Informe o motivo da devolução.',
    });
  }

  const now = new Date().toISOString();
  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    await db.run(
      `
        UPDATE comparativos_fluxo
        SET status = ?,
            motivo_devolucao = ?,
            updated_at = ?,
            devolvido_em = ?
        WHERE id = ?
      `,
      ['DEVOLVIDO', motivo, now, now, req.params.id]
    );

    const updated = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    await db.close();

    return res.json({
      success: true,
      message: 'Comparativo devolvido.',
      comparativo: {
        ...updated,
        payload: safeJsonParse(updated.payload_json, {}),
        comOfertas: safeJsonParse(updated.com_ofertas_json, []),
        semOfertas: safeJsonParse(updated.sem_ofertas_json, []),
      },
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao devolver comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao devolver comparativo.',
    });
  }
});

// =======================================================
// Atualizar status do comparativo e salvar payload editado
// Usado pela tela de análise do Rufino
// =======================================================
app.put('/api/comparativos/fluxo/:id/status', async (req, res) => {
  await ensureComparativosFluxoTable();

  const status = String(req.body?.status || '').trim().toUpperCase();
  const motivoDevolucao = String(
    req.body?.motivoDevolucao || req.body?.motivo || ''
  ).trim();

  const userId = String(req.body?.userId || '').trim();

  if (!['EM_ANALISE', 'RESPONDIDO', 'DEVOLVIDO'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'Status inválido.',
    });
  }

  if (status === 'DEVOLVIDO' && !motivoDevolucao) {
    return res.status(400).json({
      success: false,
      error: 'Informe o motivo da devolução.',
    });
  }

  let db: any;
  const now = new Date().toISOString();

  try {
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;

    const userRole = String((user as any)?.role || '').toUpperCase();
    const userIsAdmin =
      (user as any)?.isAdmin === true ||
      Number((user as any)?.isAdmin) === 1;

    const isAllowed =
      !!user &&
      (
        userIsAdmin ||
        userRole === 'CEO' ||
        userRole === 'MASTER'
      );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        error: 'Usuário sem permissão para alterar o status do comparativo.',
      });
    }

    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    const payloadParts = getComparativoPayloadFromRequest(req.body, row);

    const respondidoEm = status === 'RESPONDIDO'
      ? now
      : row.respondido_em || null;

    const devolvidoEm = status === 'DEVOLVIDO'
      ? now
      : row.devolvido_em || null;

    const motivoFinal = status === 'DEVOLVIDO'
      ? motivoDevolucao
      : null;

    await db.run(
      `
        UPDATE comparativos_fluxo
        SET status = ?,
            payload_json = ?,
            com_ofertas_json = ?,
            sem_ofertas_json = ?,
            motivo_devolucao = ?,
            updated_at = ?,
            respondido_em = ?,
            devolvido_em = ?
        WHERE id = ?
      `,
      [
        status,
        JSON.stringify(payloadParts.payload),
        JSON.stringify(payloadParts.comOfertas),
        JSON.stringify(payloadParts.semOfertas),
        motivoFinal,
        now,
        respondidoEm,
        devolvidoEm,
        req.params.id,
      ]
    );

    const updated = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    await db.close();

    return res.json({
      success: true,
      message:
        status === 'RESPONDIDO'
          ? 'Comparativo marcado como respondido.'
          : status === 'DEVOLVIDO'
            ? 'Comparativo devolvido.'
            : 'Comparativo atualizado.',
      comparativo: {
        ...updated,
        payload: safeJsonParse(updated.payload_json, {}),
        comOfertas: safeJsonParse(updated.com_ofertas_json, []),
        semOfertas: safeJsonParse(updated.sem_ofertas_json, []),
      },
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao atualizar status do comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao atualizar status do comparativo.',
    });
  }
});

// =======================================================
// Enviar tabela final por e-mail e devolver base64 para download
// Usa payload atualizado, se o frontend enviar alterações
// =======================================================
app.post('/api/comparativos/fluxo/:id/send-table', async (req, res) => {
  await ensureComparativosFluxoTable();

  const to = String(req.body?.to || COMPARATIVO_EMAIL_DEFAULT).trim();
  let db: any;

  try {
    db = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

    const row = await db.get(
      `SELECT * FROM comparativos_fluxo WHERE id = ?`,
      [req.params.id]
    );

    if (!row) {
      await db.close();
      return res.status(404).json({
        success: false,
        error: 'Comparativo não encontrado.',
      });
    }

    if (row.status !== 'RESPONDIDO') {
      await db.close();
      return res.status(400).json({
        success: false,
        error: 'A tabela só pode ser enviada depois que o comparativo estiver respondido.',
      });
    }

    const payloadParts = getComparativoPayloadFromRequest(req.body, row);

    const rowForWorkbook = {
      ...row,
      payload_json: JSON.stringify(payloadParts.payload),
      com_ofertas_json: JSON.stringify(payloadParts.comOfertas),
      sem_ofertas_json: JSON.stringify(payloadParts.semOfertas),
    };

    const buffer = buildComparativoWorkbookBuffer(rowForWorkbook, payloadParts);
    const fileName = `${sanitizeFileName(row.titulo)}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    await mailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `Tabela de comparativo - ${row.titulo}`,
      text: `Segue em anexo a tabela final do comparativo "${row.titulo}".`,
      attachments: [
        {
          filename: fileName,
          content: buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });

    const now = new Date().toISOString();

    await db.run(
      `
        UPDATE comparativos_fluxo
        SET email_enviado_para = ?,
            payload_json = ?,
            com_ofertas_json = ?,
            sem_ofertas_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        to,
        JSON.stringify(payloadParts.payload),
        JSON.stringify(payloadParts.comOfertas),
        JSON.stringify(payloadParts.semOfertas),
        now,
        req.params.id,
      ]
    );

    await db.close();

    return res.json({
      success: true,
      message: 'Tabela enviada por e-mail e pronta para download.',
      emailTo: to,
      fileName,
      fileBase64: buffer.toString('base64'),
    });
  } catch (error: any) {
    try { if (db) await db.close(); } catch {}

    console.error('Erro ao enviar tabela do comparativo:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao enviar tabela.',
    });
  }
});

// Define a porta: Usa a do Render (process.env.PORT) ou a 3000 se for local
const PORT = process.env.PORT || 3000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ SERVIDOR RODANDO NA PORTA ${PORT}`);
});

