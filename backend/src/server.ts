import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
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
import clarkRoutes from './modules/clark/clark.routes'; //IMPORT ROTAS DA CLARK
import rhRoutes from './modules/rh/rh.routes'; 
import { google } from 'googleapis';
import { spawn } from 'child_process';
import os from 'os';
import { contractRoutes } from './modules/clark/contracts/contract.routes'; // A rota da nova IA de contrato - claude
import multer from 'multer';
import {
  analisarPrecosOnlineController,
  baixarRelatorioPrecosOnlineController,
} from './modules/clark/onlinePrices/onlinePrices.controller';



dotenv.config();

//Bloco para enviar as informações ao RH//
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '1EYs0wRUwLfMuDssbts6nSDocH35jhmeb';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID não configurado.');
}

if (!GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_SECRET não configurado.');
}

if (!GOOGLE_REDIRECT_URI) {
  throw new Error('GOOGLE_REDIRECT_URI não configurado.');
}

if (!GOOGLE_REFRESH_TOKEN) {
  throw new Error('GOOGLE_REFRESH_TOKEN não configurado.');
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({
  version: 'v3',
  auth: oauth2Client,
});

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const safeName = String(name || '').trim();

  if (!safeName) {
    throw new Error('Nome da pasta não informado.');
  }

  if (!parentId) {
    throw new Error(`Parent ID não informado para a pasta "${safeName}".`);
  }

  const escapedName = safeName.replace(/'/g, "\\'");

  const res = await drive.files.list({
    q: `name = '${escapedName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existingFolderId = res.data.files?.[0]?.id;

  if (existingFolderId) {
    return existingFolderId;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const createdFolderId = folder.data.id;

  if (!createdFolderId) {
    throw new Error(`Google Drive não retornou ID ao criar a pasta "${safeName}".`);
  }

  return createdFolderId;
}

function getRhMonthFolderName(date = new Date()): string {
  const month = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
  })
    .format(date)
    .toUpperCase();

  const year = date.getFullYear();

  return `${month} ${year}`;
}

function normalizeDriveFolderName(value: any, fallback: string): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  return text || fallback;
}

async function getOrCreateRhDrivePath(params: {
  storeName: string;
  collaboratorName: string;
}) {
  const monthName = getRhMonthFolderName();

  const safeStoreName = normalizeDriveFolderName(
    params.storeName,
    'LOJA NÃO INFORMADA'
  );

  const safeCollaboratorName = normalizeDriveFolderName(
    params.collaboratorName,
    'COLABORADOR NÃO INFORMADO'
  );

  const monthFolderId = await getOrCreateFolder(monthName, ROOT_FOLDER_ID);
  const storeFolderId = await getOrCreateFolder(safeStoreName, monthFolderId);
  const collaboratorFolderId = await getOrCreateFolder(
    safeCollaboratorName,
    storeFolderId
  );

  return {
    monthName,
    monthFolderId,
    storeFolderId,
    collaboratorFolderId,
  };
}

//////////////////////////// FIM DO BLOCO DO ENVIO DAS DOCUMENTAÇÕES AO RH   //////////////

//// BLOCO CLARK ANALITICA DE PREÇOS ////

const uploadOnlinePrices = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

/// BLOCO CLARK ANALITICA DE PREÇOS ////

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

if (process.env.NODE_ENV === 'production') {
  mailTransporter.verify()
    .then(() => console.log('📧 SMTP Gmail pronto para envio'))
    .catch((err) => {
      console.warn('⚠️ SMTP Gmail não validou no startup:', {
        code: err?.code,
        command: err?.command,
        message: err?.message,
      });
    });
} else {
  console.log('ℹ️ Verificação SMTP ignorada em ambiente local/dev.');
}
  

// --- CONFIGURAÇÃO CENTRALIZADA DE CAMINHOS (CORREÇÃO) ---
const ROOT_DIR = process.cwd(); 

// Define a pasta do banco (Render vs Local)
const DATABASE_DIR = process.env.RENDER 
    ? '/var/data'  // <--- Caminho fixo no banco de dados do render
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

const allowedOrigins = [
  'https://telefluxo.telecelcelular.com.br',
  'https://www.telefluxo.telecelcelular.com.br',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-User-Id'
  );
  res.header('Access-Control-Allow-Credentials', 'false');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-User-Id',
  ],
  credentials: false,
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use('/uploads', express.static(path.join(ROOT_DIR, 'uploads')));

if (process.env.RENDER) {
  app.use('/uploads/rh', express.static('/var/data/uploads/rh'));
}

// ============================================================================
// RECEBIMENTO CARTÃO / MOTOR STONE EM PYTHON
// ============================================================================

const recebimentoCartaoTempDir = path.join(os.tmpdir(), 'telefluxo-recebimento-cartao');

if (!fs.existsSync(recebimentoCartaoTempDir)) {
  fs.mkdirSync(recebimentoCartaoTempDir, { recursive: true });
}

const uploadRecebimentoCartao = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, recebimentoCartaoTempDir);
    },
    filename: (_req, file, cb) => {
      const originalName = file.originalname || 'base-stone.xlsx';
      const safeName = originalName.replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!['.xlsb', '.xlsx', '.xlsm'].includes(ext)) {
      cb(new Error('Envie uma planilha .xlsb, .xlsx ou .xlsm.'));
      return;
    }

    cb(null, true);
  },
});

function getPythonCommand(): string {
  return process.env.PYTHON_BIN || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function runStoneRecebimentoEngine(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ROOT_DIR, 'src', 'modules', 'finance', 'stone_recebimentos_engine.py');

    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Motor Python não encontrado em: ${scriptPath}`));
      return;
    }

    const child = spawn(getPythonCommand(), [scriptPath, filePath], {
      cwd: ROOT_DIR,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Motor Python finalizou com código ${code}.`));
        return;
      }

      try {
        const trimmed = stdout.trim();
        resolve(JSON.parse(trimmed));
      } catch (error: any) {
        reject(
          new Error(
            `Não foi possível ler o JSON do motor Python. ${error?.message || error}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`
          )
        );
      }
    });
  });
}

app.get('/api/financeiro/recebimento-cartao/ping', (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    modulo: 'Recebimento Cartão',
    motor: 'Python Stone',
    timestamp: new Date().toISOString(),
  });
});

type RecebimentoCartaoPersistido = {
  ok: boolean;
  generatedAt: string;
  persistedAt: string;
  processedBy?: string;
  fileName?: string;
  resumo?: any;
  mensal?: any[];
  diario?: any[];
  descartadas?: any[];
  meta?: any;
};

function normalizeRole(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

async function canAccessRecebimentoCartao(userId: string): Promise<boolean> {
  if (!userId || userId === 'undefined' || userId === 'null') return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return false;

  const role = normalizeRole(user.role);

  return Boolean(
    user.isAdmin ||
      ['ADMIN', 'ADM', 'CEO', 'DIRETOR', 'DIRETORIA', 'MASTER', 'SOCIO', 'SÓCIO'].includes(role)
  );
}

function getRecebimentoCartaoCacheDir(): string {
  const dir = path.join(DATABASE_DIR, 'financeiro');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRecebimentoCartaoCachePath(): string {
  return path.join(getRecebimentoCartaoCacheDir(), 'recebimento-cartao-cache.json');
}

function readRecebimentoCartaoCache(): RecebimentoCartaoPersistido | null {
  const cachePath = getRecebimentoCartaoCachePath();

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw) as RecebimentoCartaoPersistido;
  } catch (error) {
    console.warn('⚠️ Não consegui ler cache de recebimento cartão:', error);
    return null;
  }
}

function saveRecebimentoCartaoCache(payload: RecebimentoCartaoPersistido) {
  const cachePath = getRecebimentoCartaoCachePath();
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
}

function deleteRecebimentoCartaoCache() {
  const cachePath = getRecebimentoCartaoCachePath();

  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
}

app.get('/api/financeiro/recebimento-cartao/ultimo', async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || '');

    const allowed = await canAccessRecebimentoCartao(userId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Acesso permitido apenas para usuários administrativos.',
      });
    }

    const data = readRecebimentoCartaoCache();

    return res.json({
      ok: true,
      hasData: Boolean(data),
      data,
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar último recebimento cartão:', error);

    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro ao buscar último recebimento cartão.',
    });
  }
});

app.delete('/api/financeiro/recebimento-cartao/ultimo', async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || '');

    const allowed = await canAccessRecebimentoCartao(userId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Acesso permitido apenas para usuários administrativos.',
      });
    }

    deleteRecebimentoCartaoCache();

    return res.json({
      ok: true,
      message: 'Resultado de recebimento cartão apagado com sucesso.',
    });
  } catch (error: any) {
    console.error('❌ Erro ao apagar recebimento cartão:', error);

    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro ao apagar recebimento cartão.',
    });
  }
});

app.post(
  '/api/financeiro/recebimento-cartao/processar',
  uploadRecebimentoCartao.single('file'),
  async (req: Request, res: Response) => {
    let tempPath = '';

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhum arquivo foi enviado.',
        });
      }

      const userId = String(req.body?.userId || '');

      const allowed = await canAccessRecebimentoCartao(userId);

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          error: 'Acesso permitido apenas para usuários administrativos.',
        });
}

      const originalName = req.file.originalname || 'base-stone.xlsx';
      tempPath = req.file.path;

      console.log('📥 Recebimento Cartão - arquivo chegou no backend:', {
        originalName,
        size: req.file.size,
        mimetype: req.file.mimetype,
        tempPath,
      });

      const result = await runStoneRecebimentoEngine(tempPath);

      const persistedResult: RecebimentoCartaoPersistido = {
        ...result,
        ok: true,
        fileName: originalName,
        persistedAt: new Date().toISOString(),
        processedBy: userId,
      };

      saveRecebimentoCartaoCache(persistedResult);

      return res.json(persistedResult);

      
    } catch (error: any) {
      console.error('❌ Erro ao processar recebimento cartão:', error);

      return res.status(500).json({
        ok: false,
        error: error?.message || 'Erro ao processar recebimento de cartão.',
      });
    } finally {
      if (tempPath) {
        fs.promises.unlink(tempPath).catch(() => undefined);
      }
    }
  }
);

// --- REGISTRO DE ROTAS DOS MÓDULOS ---
app.use('/api/clark', clarkRoutes);
app.use('/api/contracts', contractRoutes); // Injeção do módulo de análise de contratos
app.use('/api/rh', rhRoutes); // Aproveitei para garantir que a rota RH (importada na linha 19) também esteja registrada

// ============================================================
// ✅ ROTAS DO HISTÓRICO ANUAL - CORRIGIDAS PARA FILTROS REAIS
// ============================================================

type AnnualStoreCompareRow = {
  ano: number;
  mes: number;
  loja: string;
  cnpj_empresa: string;
  regiao: string;
  venda_total: number;
  venda_qtd: number;
  seguro_total: number;
  seguro_qtd: number;
};

function annualIsoDate(value: any): string {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function annualSqlText(value: any): string {
  return String(value ?? '').replace(/'/g, "''");
}

function annualNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function annualNorm(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function annualStoreNameFromRow(row: any): string {
  const cnpj = String(row?.cnpj_empresa || row?.CNPJ_EMPRESA || '').replace(/\D/g, '');
  if (cnpj && LOJAS_MAP_GLOBAL[cnpj]) return LOJAS_MAP_GLOBAL[cnpj];

  const loja = String(row?.loja || row?.LOJA || '').trim();
  const lojaNorm = annualNorm(loja);
  return CORRECAO_NOMES_SERVER[lojaNorm] || loja || 'LOJA NÃO INFORMADA';
}

function annualRegionFromStore(loja: string, fallback = ''): string {
  const normalized = annualNorm(loja);

  const regionByStore: Record<string, string> = {
    'ARAGUAIA SHOPPING': 'GOIÁS',
    'BOULEVARD SHOPPING': 'DF',
    'BRASILIA SHOPPING': 'DF',
    'CONJUNTO NACIONAL': 'DF',
    'CONJUNTO NACIONAL QUIOSQUE': 'DF',
    'GOIANIA SHOPPING': 'GOIÁS',
    'IGUATEMI SHOPPING': 'DF',
    'JK SHOPPING': 'DF',
    'PARK SHOPPING': 'DF',
    'PATIO BRASIL': 'DF',
    'TAGUATINGA SHOPPING': 'DF',
    'TERRAÇO SHOPPING': 'DF',
    'TERRACO SHOPPING': 'DF',
    'TAGUATINGA SHOPPING QQ': 'DF',
    'UBERLÂNDIA SHOPPING': 'MINAS GERAIS',
    'UBERLANDIA SHOPPING': 'MINAS GERAIS',
    'UBERABA SHOPPING': 'MINAS GERAIS',
    'FLAMBOYANT SHOPPING': 'GOIÁS',
    'BURITI SHOPPING': 'GOIÁS',
    'PASSEIO DAS AGUAS': 'GOIÁS',
    'PORTAL SHOPPING': 'GOIÁS',
    'SHOPPING SUL': 'GOIÁS',
    'BURITI RIO VERDE': 'GOIÁS',
    'PARK ANAPOLIS': 'GOIÁS',
    'SHOPPING RECIFE': 'NORDESTE',
    'MANAIRA SHOPPING': 'NORDESTE',
    'IGUATEMI FORTALEZA': 'NORDESTE',
    'CD TAGUATINGA': 'CD',
  };

  return annualNorm(fallback) || regionByStore[normalized] || 'SEM REGIÃO';
}

async function annualTableExists(db: any, tableName: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    [tableName]
  );

  return Boolean(row?.name);
}

function annualLowerRows(rows: any[]) {
  return (rows || []).map((row: any) => {
    const out: any = {};
    Object.keys(row || {}).forEach((key) => {
      out[key.toLowerCase()] = row[key];
    });
    return out;
  });
}

async function buildAnnualStoreCompareRows(params: {
  userId: string;
  yearA: number;
  yearB: number;
  month: number;
}): Promise<AnnualStoreCompareRow[]> {
  if (!fs.existsSync(ANUAL_DB_PATH)) return [];

  const securityFilter = await getSalesFilter(params.userId, 'vendas');
  const yearFilter = ` AND ano IN (${Number(params.yearA)}, ${Number(params.yearB)}) `;
  const monthFilter = params.month >= 1 && params.month <= 12 ? ` AND mes = ${Number(params.month)} ` : '';

  const db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

  try {
    const hasRaw = await annualTableExists(db, 'vendas_anuais_raw');
    const hasAnnual = await annualTableExists(db, 'vendas_anuais');
    const hasInsurance = await annualTableExists(db, 'seguros_anuais');

    let salesRows: any[] = [];

    if (hasRaw) {
      salesRows = await db.all(`
        SELECT
          ano,
          mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(total_real, total_liquido, 0)) AS venda_total,
          SUM(COALESCE(qtd_real, quantidade, 0)) AS venda_qtd
        FROM vendas_anuais_raw
        WHERE ${securityFilter}
          ${yearFilter}
          ${monthFilter}
          AND ano > 0
          AND mes BETWEEN 1 AND 12
          AND (
            cancelado IS NULL OR
            UPPER(TRIM(CAST(cancelado AS TEXT))) NOT IN ('S', 'SIM', 'TRUE', '1', 'CANCELADO', 'CANCELADA')
          )
        GROUP BY ano, mes, COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'), COALESCE(cnpj_empresa, ''), COALESCE(NULLIF(regiao, ''), '')
      `);
    } else if (hasAnnual) {
      salesRows = await db.all(`
        SELECT
          CAST(substr(data_emissao, 1, 4) AS INTEGER) AS ano,
          CAST(substr(data_emissao, 6, 2) AS INTEGER) AS mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(total_liquido, 0)) AS venda_total,
          SUM(COALESCE(quantidade, 0)) AS venda_qtd
        FROM vendas_anuais
        WHERE ${securityFilter}
          AND CAST(substr(data_emissao, 1, 4) AS INTEGER) IN (${Number(params.yearA)}, ${Number(params.yearB)})
          ${params.month >= 1 && params.month <= 12 ? ` AND CAST(substr(data_emissao, 6, 2) AS INTEGER) = ${Number(params.month)} ` : ''}
        GROUP BY CAST(substr(data_emissao, 1, 4) AS INTEGER), CAST(substr(data_emissao, 6, 2) AS INTEGER), COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'), COALESCE(cnpj_empresa, ''), COALESCE(NULLIF(regiao, ''), '')
      `);
    }

    let insuranceRows: any[] = [];

    if (hasInsurance) {
      insuranceRows = await db.all(`
        SELECT
          ano,
          mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(premio, 0)) AS seguro_total,
          SUM(COALESCE(qtd, 0)) AS seguro_qtd
        FROM seguros_anuais
        WHERE ${securityFilter}
          ${yearFilter}
          ${monthFilter}
          AND ano > 0
          AND mes BETWEEN 1 AND 12
        GROUP BY ano, mes, COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'), COALESCE(cnpj_empresa, ''), COALESCE(NULLIF(regiao, ''), '')
      `);
    }

    const insuranceHasValue = (insuranceRows || []).some((row: any) => annualNumber(row.seguro_total) !== 0 || annualNumber(row.seguro_qtd) !== 0);

    if (!insuranceHasValue && hasRaw) {
      insuranceRows = await db.all(`
        SELECT
          ano,
          mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(total_real, total_liquido, 0)) AS seguro_total,
          SUM(COALESCE(qtd_real, quantidade, 0)) AS seguro_qtd
        FROM vendas_anuais_raw
        WHERE ${securityFilter}
          ${yearFilter}
          ${monthFilter}
          AND ano > 0
          AND mes BETWEEN 1 AND 12
          AND (
            UPPER(COALESCE(categoria_real, categoria, descricao, '')) LIKE '%SEGURO%'
            OR UPPER(COALESCE(descricao, '')) LIKE '%SEGURO%'
            OR UPPER(COALESCE(descricao, '')) LIKE '%PROTECAO%'
            OR UPPER(COALESCE(descricao, '')) LIKE '%PROTEÇÃO%'
            OR UPPER(COALESCE(descricao, '')) LIKE '%GARANTIA%'
          )
        GROUP BY ano, mes, COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'), COALESCE(cnpj_empresa, ''), COALESCE(NULLIF(regiao, ''), '')
      `);
    }

    const map = new Map<string, AnnualStoreCompareRow>();

    const getKey = (row: any) => {
      const ano = Number(row.ano || 0);
      const mes = Number(row.mes || 0);
      const loja = annualStoreNameFromRow(row);
      const cnpj = String(row.cnpj_empresa || '').replace(/\D/g, '');
      return `${ano}|${mes}|${cnpj || annualNorm(loja)}`;
    };

    const ensure = (row: any): AnnualStoreCompareRow => {
      const key = getKey(row);

      if (!map.has(key)) {
        const loja = annualStoreNameFromRow(row);

        map.set(key, {
          ano: Number(row.ano || 0),
          mes: Number(row.mes || 0),
          loja,
          cnpj_empresa: String(row.cnpj_empresa || '').replace(/\D/g, ''),
          regiao: annualRegionFromStore(loja, row.regiao),
          venda_total: 0,
          venda_qtd: 0,
          seguro_total: 0,
          seguro_qtd: 0,
        });
      }

      return map.get(key)!;
    };

    for (const row of salesRows || []) {
      const item = ensure(row);
      item.venda_total += annualNumber(row.venda_total);
      item.venda_qtd += annualNumber(row.venda_qtd);
    }

    for (const row of insuranceRows || []) {
      const item = ensure(row);
      item.seguro_total += annualNumber(row.seguro_total);
      item.seguro_qtd += annualNumber(row.seguro_qtd);
    }

    return Array.from(map.values())
      .filter((row) => row.ano && row.mes)
      .sort((a, b) => a.loja.localeCompare(b.loja) || a.ano - b.ano || a.mes - b.mes);
  } finally {
    await db.close().catch(() => undefined);
  }
}

app.get('/sales_anuais', async (req, res) => {
  let db: any;

  try {
    const userId = String(req.query.userId || '');
    const startDate = annualIsoDate(req.query.startDate);
    const endDate = annualIsoDate(req.query.endDate);
    const securityFilter = await getSalesFilter(userId, 'vendas');

    if (!fs.existsSync(ANUAL_DB_PATH)) {
      return res.json({ sales: [] });
    }

    db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const hasRaw = await annualTableExists(db, 'vendas_anuais_raw');
    const hasAnnual = await annualTableExists(db, 'vendas_anuais');

    let dateFilter = '';
    if (startDate) dateFilter += ` AND data_emissao >= '${annualSqlText(startDate)}' `;
    if (endDate) dateFilter += ` AND data_emissao <= '${annualSqlText(endDate)}' `;

    let salesRaw: any[] = [];

    if (hasRaw) {
      salesRaw = await db.all(`
        SELECT
          printf('%04d-%02d-01', ano, mes) AS data_emissao,
          ano,
          printf('%02d', mes) AS mes,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(NULLIF(descricao, ''), NULLIF(referencia, ''), 'PRODUTO NÃO INFORMADO') AS descricao,
          COALESCE(NULLIF(categoria_real, ''), NULLIF(categoria, ''), 'OUTROS') AS familia,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(total_real, total_liquido, 0)) AS total_liquido,
          SUM(COALESCE(qtd_real, quantidade, 0)) AS quantidade
        FROM vendas_anuais_raw
        WHERE ${securityFilter}
          AND ano > 0
          AND mes BETWEEN 1 AND 12
          ${dateFilter}
          AND (
            cancelado IS NULL OR
            UPPER(TRIM(CAST(cancelado AS TEXT))) NOT IN ('S', 'SIM', 'TRUE', '1', 'CANCELADO', 'CANCELADA')
          )
        GROUP BY
          ano,
          mes,
          COALESCE(cnpj_empresa, ''),
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'),
          COALESCE(NULLIF(descricao, ''), NULLIF(referencia, ''), 'PRODUTO NÃO INFORMADO'),
          COALESCE(NULLIF(categoria_real, ''), NULLIF(categoria, ''), 'OUTROS'),
          COALESCE(NULLIF(regiao, ''), '')
        HAVING ABS(SUM(COALESCE(total_real, total_liquido, 0))) > 0.01
            OR ABS(SUM(COALESCE(qtd_real, quantidade, 0))) > 0.001
        ORDER BY ano ASC, mes ASC, loja ASC, descricao ASC
      `);
    } else if (hasAnnual) {
      salesRaw = await db.all(`
        SELECT
          printf('%04d-%02d-01', CAST(substr(data_emissao, 1, 4) AS INTEGER), CAST(substr(data_emissao, 6, 2) AS INTEGER)) AS data_emissao,
          CAST(substr(data_emissao, 1, 4) AS INTEGER) AS ano,
          printf('%02d', CAST(substr(data_emissao, 6, 2) AS INTEGER)) AS mes,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(NULLIF(descricao, ''), 'PRODUTO NÃO INFORMADO') AS descricao,
          COALESCE(NULLIF(familia, ''), 'OUTROS') AS familia,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          SUM(COALESCE(total_liquido, 0)) AS total_liquido,
          SUM(COALESCE(quantidade, 0)) AS quantidade
        FROM vendas_anuais
        WHERE ${securityFilter}
          AND data_emissao IS NOT NULL
          ${dateFilter}
        GROUP BY
          CAST(substr(data_emissao, 1, 4) AS INTEGER),
          CAST(substr(data_emissao, 6, 2) AS INTEGER),
          COALESCE(cnpj_empresa, ''),
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'),
          COALESCE(NULLIF(descricao, ''), 'PRODUTO NÃO INFORMADO'),
          COALESCE(NULLIF(familia, ''), 'OUTROS'),
          COALESCE(NULLIF(regiao, ''), '')
        HAVING ABS(SUM(COALESCE(total_liquido, 0))) > 0.01
            OR ABS(SUM(COALESCE(quantidade, 0))) > 0.001
        ORDER BY ano ASC, mes ASC, loja ASC, descricao ASC
      `);
    }

    const sales = annualLowerRows(salesRaw).map((row: any) => {
      const loja = annualStoreNameFromRow(row);

      return {
        ...row,
        loja,
        regiao: annualRegionFromStore(loja, row.regiao),
      };
    });

    return res.json({ sales });
  } catch (e: any) {
    console.error('Erro /sales_anuais:', e);
    return res.status(500).json({ error: e.message || 'Erro ao buscar vendas anuais.' });
  } finally {
    if (db) await db.close().catch(() => undefined);
  }
});

// --- ROTAS DO AGENTE CLARK / PREÇOS ONLINE ---
app.get('/api/online-prices/ping', async (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    module: 'Preços Online',
    message: 'Rota de preços online ativa.',
  });
});

app.post(
  '/api/online-prices/analyze',
  uploadOnlinePrices.single('xlsx'),
  async (req: any, res: Response) => {
    return analisarPrecosOnlineController(req, res);
  }
);

app.get(
  '/api/online-prices/report/:fileName',
  async (req: any, res: Response) => {
    return baixarRelatorioPrecosOnlineController(req, res);
  }
);

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

app.put('/notifications/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = String(req.body?.userId || req.query.userId || '');

        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: 'ID de notificação inválido.' });
        }

        const result = await prisma.notification.updateMany({
            where: {
                id,
                ...(userId && userId !== 'undefined' && userId !== 'null' ? { userId } : {}),
            },
            data: { read: true },
        });

        if (result.count === 0) {
            return res.status(404).json({ error: 'Notificação não encontrada.' });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Erro ao marcar notificação como lida:', e);
        res.status(500).json({ error: 'Erro ao marcar notificação como lida.' });
    }
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
// 📦 VISÃO DETALHADA DE ESTOQUE - BASE CONFIÁVEL
// Rota usada pelo submenu "Visão Detalhada"
// Calcula estoque + vendas mês atual + vendas 60/90 dias no backend
// =======================================================

type EstoqueDetalhadoStoreAgg = {
  loja: string;
  regiao: string;
  estoque: number;
  vendasMes: number;
  vendas60: number;
  vendas90: number;
  giroDiario: number;
  coberturaDias: number | null;
};

type EstoqueDetalhadoProductAgg = {
  modelo: string;
  referencia: string;
  categoria: string;
  estoque: number;
  vendasMes: number;
  vendas60: number;
  vendas90: number;
  giroDiario: number;
  coberturaDias: number | null;
  stores: EstoqueDetalhadoStoreAgg[];
  debug: {
    matchedBy: string[];
    salesKeys: string[];
  };
};

const ESTOQUE_DETALHADO_STORE_REGIONS: Record<string, string> = {
  'ARAGUAIA SHOPPING': 'GOIÁS',
  'BOULEVARD SHOPPING': 'DF',
  'BRASILIA SHOPPING': 'DF',
  'CONJUNTO NACIONAL': 'DF',
  'CONJUNTO NACIONAL QUIOSQUE': 'DF',
  'GOIANIA SHOPPING': 'GOIÁS',
  'IGUATEMI SHOPPING': 'DF',
  'JK SHOPPING': 'DF',
  'PARK SHOPPING': 'DF',
  'PATIO BRASIL': 'DF',
  'TAGUATINGA SHOPPING': 'DF',
  'TERRAÇO SHOPPING': 'DF',
  'TAGUATINGA SHOPPING QQ': 'DF',
  'UBERLÂNDIA SHOPPING': 'MINAS GERAIS',
  'UBERABA SHOPPING': 'MINAS GERAIS',
  'FLAMBOYANT SHOPPING': 'GOIÁS',
  'BURITI SHOPPING': 'GOIÁS',
  'PASSEIO DAS AGUAS': 'GOIÁS',
  'PORTAL SHOPPING': 'GOIÁS',
  'SHOPPING SUL': 'GOIÁS',
  'BURITI RIO VERDE': 'GOIÁS',
  'PARK ANAPOLIS': 'GOIÁS',
  'SHOPPING RECIFE': 'NORDESTE',
  'MANAIRA SHOPPING': 'NORDESTE',
  'IGUATEMI FORTALEZA': 'NORDESTE',
  'CD TAGUATINGA': 'CD',
};

function estoqueDetalhadoNormalizeText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function estoqueDetalhadoNormalizeKey(value: any): string {
  return estoqueDetalhadoNormalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function estoqueDetalhadoToNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const n = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function estoqueDetalhadoDateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function estoqueDetalhadoAddDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function estoqueDetalhadoParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 86400000);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0);
    }

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    return estoqueDetalhadoParseDate(Number(s));
  }

  const onlyDate = s.split(' ')[0] ?? '';

  const br = onlyDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0, 0);
  }

  const brDash = onlyDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (brDash) {
    return new Date(Number(brDash[3]), Number(brDash[2]) - 1, Number(brDash[1]), 12, 0, 0, 0);
  }

  const iso = onlyDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function estoqueDetalhadoStoreName(row: any): string {
  const rawLoja =
    row?.loja ||
    row?.LOJA ||
    row?.nome_fantasia ||
    row?.NOME_FANTASIA ||
    row?.storeName ||
    row?.STORENAME ||
    '';

  const rawCnpj =
    row?.cnpj_empresa ||
    row?.CNPJ_EMPRESA ||
    row?.cnpj ||
    row?.CNPJ ||
    '';

  const cleanCnpj = String(rawCnpj || '').replace(/\D/g, '');

  if (cleanCnpj && LOJAS_MAP_GLOBAL[cleanCnpj]) {
    return LOJAS_MAP_GLOBAL[cleanCnpj];
  }

  const normalized = estoqueDetalhadoNormalizeText(rawLoja);
  return CORRECAO_NOMES_SERVER[normalized] || normalized || 'LOJA NÃO INFORMADA';
}

function estoqueDetalhadoGetAnnualDbPath(): string {
  const candidates = [
    ANUAL_DB_PATH,
    path.join(DATABASE_DIR, 'samsung_vendas_anual.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anuais.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anual.db'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || ANUAL_DB_PATH;
}

async function estoqueDetalhadoTableExists(db: any, tableName: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );

  return Boolean(row?.name);
}

function estoqueDetalhadoEnsureStore(
  product: EstoqueDetalhadoProductAgg,
  loja: string
): EstoqueDetalhadoStoreAgg {
  const safeLoja = loja || 'LOJA NÃO INFORMADA';

  let store = product.stores.find((item) => item.loja === safeLoja);

  if (!store) {
    store = {
      loja: safeLoja,
      regiao: ESTOQUE_DETALHADO_STORE_REGIONS[safeLoja] || 'OUTROS',
      estoque: 0,
      vendasMes: 0,
      vendas60: 0,
      vendas90: 0,
      giroDiario: 0,
      coberturaDias: null,
    };

    product.stores.push(store);
  }

  return store;
}

app.get('/api/estoque-visao-detalhada', async (req, res) => {
  let annualDb: any;
  let globalDb: any;

  try {
    const userId = String(req.query.userId || '');

    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const start60 = estoqueDetalhadoAddDays(now, -60);
    const start90 = estoqueDetalhadoAddDays(now, -90);

    const annualDbPath = estoqueDetalhadoGetAnnualDbPath();
    const securityFilter = await getSalesFilter(userId, 'vendas');

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;

    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'MASTER'];
    const canSeeAll = Boolean(
      user?.isAdmin || superRoles.includes(String(user?.role || '').toUpperCase())
    );

    const allowedStores = String(user?.allowedStores || '')
      .split(',')
      .map((item) =>
        estoqueDetalhadoNormalizeText(
          CORRECAO_NOMES_SERVER[estoqueDetalhadoNormalizeText(item)] || item
        )
      )
      .filter(Boolean);

    const stockRows = await prisma.stock.findMany({
      select: {
        cnpj: true,
        storeName: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        quantity: true,
      },
    });

    const productMap = new Map<string, EstoqueDetalhadoProductAgg>();
    const byReference = new Map<string, string>();
    const byDescription = new Map<string, string>();

    const getOrCreateProduct = (params: {
      productKey?: string;
      modelo: string;
      referencia?: string;
      categoria?: string;
      matchedBy: string;
      salesKey?: string;
    }): EstoqueDetalhadoProductAgg => {
      const referenciaKey = estoqueDetalhadoNormalizeKey(params.referencia || '');
      const descKey = estoqueDetalhadoNormalizeKey(params.modelo);

      const productKey =
        params.productKey ||
        byReference.get(referenciaKey) ||
        byDescription.get(descKey) ||
        descKey ||
        referenciaKey;

      let product = productMap.get(productKey);

      if (!product) {
        product = {
          modelo: params.modelo || params.referencia || 'PRODUTO NÃO INFORMADO',
          referencia: params.referencia || '',
          categoria: params.categoria || 'GERAL',
          estoque: 0,
          vendasMes: 0,
          vendas60: 0,
          vendas90: 0,
          giroDiario: 0,
          coberturaDias: null,
          stores: [],
          debug: {
            matchedBy: [],
            salesKeys: [],
          },
        };

        productMap.set(productKey, product);
      }

      if (!product.referencia && params.referencia) product.referencia = params.referencia;
      if ((!product.categoria || product.categoria === 'GERAL') && params.categoria) {
        product.categoria = params.categoria;
      }

      if (!product.debug.matchedBy.includes(params.matchedBy)) {
        product.debug.matchedBy.push(params.matchedBy);
      }

      if (params.salesKey && !product.debug.salesKeys.includes(params.salesKey)) {
        product.debug.salesKeys.push(params.salesKey);
      }

      if (referenciaKey) byReference.set(referenciaKey, productKey);
      if (descKey) byDescription.set(descKey, productKey);

      return product;
    };

    for (const stock of stockRows) {
      const loja = estoqueDetalhadoStoreName(stock);

      if (
        !canSeeAll &&
        allowedStores.length > 0 &&
        !allowedStores.includes(estoqueDetalhadoNormalizeText(loja))
      ) {
        continue;
      }

      const modelo = String(stock.description || '').trim();
      if (!modelo) continue;

      const referencia = String(stock.reference || stock.productCode || '').trim();
      const productKey =
        estoqueDetalhadoNormalizeKey(referencia) || estoqueDetalhadoNormalizeKey(modelo);

      const product = getOrCreateProduct({
        productKey,
        modelo,
        referencia,
        categoria: String(stock.category || 'GERAL').toUpperCase(),
        matchedBy: 'ESTOQUE',
      });

      const qty = estoqueDetalhadoToNumber(stock.quantity);

      product.estoque += qty;
      estoqueDetalhadoEnsureStore(product, loja).estoque += qty;
    }

    const addSale = (row: any, bucket: 'MES' | 'ANUAL') => {
      const date = estoqueDetalhadoParseDate(
        row.data_emissao || row.DATA_EMISSAO || row.data || row.DATA
      );

      if (!date) return;

      const qty = estoqueDetalhadoToNumber(
        row.qtd_real ??
          row.QTD_REAL ??
          row.quantidade ??
          row.QUANTIDADE ??
          row.qtd ??
          row.QTD ??
          1
      );

      if (!qty) return;

      const referencia = String(
        row.referencia || row.REFERENCIA || row.codigo_produto || row.CODIGO_PRODUTO || ''
      ).trim();

      const descricao = String(
        row.descricao || row.DESCRICAO || row.produto || row.PRODUTO || referencia || ''
      ).trim();

      if (!referencia && !descricao) return;

      const referenciaKey = estoqueDetalhadoNormalizeKey(referencia);
      const descKey = estoqueDetalhadoNormalizeKey(descricao);

      const productKey =
        byReference.get(referenciaKey) ||
        byDescription.get(descKey) ||
        referenciaKey ||
        descKey;

      const product = getOrCreateProduct({
        productKey,
        modelo: descricao || referencia,
        referencia,
        categoria: String(
          row.categoria_real ||
            row.CATEGORIA_REAL ||
            row.categoria ||
            row.CATEGORIA ||
            row.familia ||
            row.FAMILIA ||
            'GERAL'
        ).toUpperCase(),
        matchedBy: byReference.get(referenciaKey)
          ? 'REFERENCIA'
          : byDescription.get(descKey)
            ? 'DESCRICAO'
            : 'VENDA_SEM_ESTOQUE',
        salesKey: referenciaKey || descKey,
      });

      const loja = estoqueDetalhadoStoreName(row);
      const store = estoqueDetalhadoEnsureStore(product, loja);

      if (bucket === 'MES' && date >= startMonth && date <= now) {
        product.vendasMes += qty;
        store.vendasMes += qty;
      }

      if (bucket === 'ANUAL') {
        if (date >= start60 && date <= now) {
          product.vendas60 += qty;
          store.vendas60 += qty;
        }

        if (date >= start90 && date <= now) {
          product.vendas90 += qty;
          store.vendas90 += qty;
        }
      }
    };

    if (fs.existsSync(GLOBAL_DB_PATH)) {
      globalDb = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

      const hasDetailed = await estoqueDetalhadoTableExists(globalDb, 'vendas_detalhadas_imei');
      const hasLegacy = await estoqueDetalhadoTableExists(globalDb, 'vendas');

      if (hasDetailed) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            nome_fantasia AS loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            quantidade
          FROM vendas_detalhadas_imei
          WHERE ${securityFilter}
        `);

        rows.forEach((row: any) => addSale(row, 'MES'));
      } else if (hasLegacy) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            NULL AS loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade
          FROM vendas
          WHERE ${securityFilter}
        `);

        rows.forEach((row: any) => addSale(row, 'MES'));
      }

      await globalDb.close();
      globalDb = null;
    }

    if (fs.existsSync(annualDbPath)) {
      annualDb = await open({ filename: annualDbPath, driver: sqlite3.Database });

      const hasRaw = await estoqueDetalhadoTableExists(annualDb, 'vendas_anuais_raw');
      const hasAnnual = await estoqueDetalhadoTableExists(annualDb, 'vendas_anuais');

      if (hasRaw) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            categoria_real,
            quantidade,
            qtd_real,
            cancelado
          FROM vendas_anuais_raw
          WHERE COALESCE(cancelado, 'N') = 'N'
            AND ${securityFilter}
        `);

        rows.forEach((row: any) => addSale(row, 'ANUAL'));
      } else if (hasAnnual) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade
          FROM vendas_anuais
          WHERE ${securityFilter}
        `);

        rows.forEach((row: any) => addSale(row, 'ANUAL'));
      }

      await annualDb.close();
      annualDb = null;
    }

    const products = Array.from(productMap.values()).map((product) => {
      product.giroDiario = product.vendas90 > 0 ? product.vendas90 / 90 : 0;
      product.coberturaDias = product.giroDiario > 0 ? product.estoque / product.giroDiario : null;

      product.stores = product.stores
        .map((store) => ({
          ...store,
          giroDiario: store.vendas90 > 0 ? store.vendas90 / 90 : 0,
          coberturaDias: store.vendas90 > 0 ? store.estoque / (store.vendas90 / 90) : null,
        }))
        .sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.loja.localeCompare(b.loja));

      return product;
    });

    products.sort((a, b) => b.estoque - a.estoque || b.vendas90 - a.vendas90 || a.modelo.localeCompare(b.modelo));

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      periodo: {
        mesAtualInicio: estoqueDetalhadoDateToIso(startMonth),
        ultimos60Inicio: estoqueDetalhadoDateToIso(start60),
        ultimos90Inicio: estoqueDetalhadoDateToIso(start90),
        hoje: estoqueDetalhadoDateToIso(now),
      },
      sources: {
        estoque: 'Prisma Stock / dev.db',
        vendasMes: GLOBAL_DB_PATH,
        vendas60e90: annualDbPath,
      },
      total: products.length,
      products,
    });
  } catch (error: any) {
    console.error('Erro /api/estoque-visao-detalhada:', error);

    try {
      if (globalDb) await globalDb.close();
      if (annualDb) await annualDb.close();
    } catch {}

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao montar visão detalhada de estoque.',
    });
  }
});

// =======================================================
// ⚡ PAINEL DIRETORIA / ACESSO RÁPIDO DE APARELHOS
// Rota usada pelo submenu "Painel Diretoria > Acesso Rápido"
// Consolida: estoque atual + vendas do mês + vendas do ano
// Agrupa aparelhos por modelo base e deixa cores/variações no detalhe
// =======================================================

type AcessoRapidoVariacaoAgg = {
  id: string;
  modeloCompleto: string;
  referencia: string;
  categoria: string;
  cor: string;
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
};

type AcessoRapidoStoreAgg = {
  loja: string;
  regiao: string;
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
  variacoes: AcessoRapidoVariacaoAgg[];
};

type AcessoRapidoProductAgg = {
  id: string;
  modelo: string;
  referencia: string;
  categoria: string;
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
  lojasComEstoque: number;
  status: 'COM_ESTOQUE' | 'SEM_ESTOQUE' | 'SEM_GIRO_MES' | 'ALTO_GIRO';
  lojas: AcessoRapidoStoreAgg[];
  variacoes: AcessoRapidoVariacaoAgg[];
};

function acessoRapidoSearchKey(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .trim();
}

function acessoRapidoCleanName(value: any): string {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function acessoRapidoDetectColor(description: any): string {
  const text = estoqueDetalhadoNormalizeText(description);

  const colorMap: Record<string, string> = {
    JETBLACK: 'JetBlack',
    'JET BLACK': 'JetBlack',
    PRETO: 'Preto',
    BLACK: 'Preto',
    BRANCO: 'Branco',
    WHITE: 'Branco',
    ROSA: 'Rosa',
    PINK: 'Rosa',
    AZUL: 'Azul',
    BLUE: 'Azul',
    VERDE: 'Verde',
    GREEN: 'Verde',
    CINZA: 'Cinza',
    GRAY: 'Cinza',
    GREY: 'Cinza',
    GRAFITE: 'Grafite',
    GRAPHITE: 'Grafite',
    VIOLETA: 'Violeta',
    VIOLET: 'Violeta',
    LAVANDA: 'Lavanda',
    LAVENDER: 'Lavanda',
    AMARELO: 'Amarelo',
    YELLOW: 'Amarelo',
    VERMELHO: 'Vermelho',
    RED: 'Vermelho',
    BEGE: 'Bege',
    BEIGE: 'Bege',
    PRATA: 'Prata',
    SILVER: 'Prata',
    DOURADO: 'Dourado',
    GOLD: 'Dourado',
    CREME: 'Creme',
    CREAM: 'Creme',
    TITANIUM: 'Titânio',
    TITANIO: 'Titânio',
    TITÂNIO: 'Titânio',
  };

  const keys = Object.keys(colorMap).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    const keyNormalized = estoqueDetalhadoNormalizeText(key);
    const pattern = new RegExp(`(^|\\s|-)${keyNormalized.replace(/\s+/g, '\\s+')}(\\s|-|$)`, 'i');

    if (pattern.test(text)) {
      return colorMap[key] || 'Cor não identificada';
    }
  }

  return 'Cor não identificada';
}

function acessoRapidoBaseModel(description: any, reference?: any): string {
  let text = acessoRapidoCleanName(description);

  if (!text && reference) {
    text = acessoRapidoCleanName(reference);
  }

  if (!text) {
    return 'PRODUTO NÃO INFORMADO';
  }

  const colorWords = [
    // CORES COMPOSTAS PRIMEIRO
    'AZUL CLARO',
    'AZUL MARINHO',
    'LIGHT BLUE',
    'ICE BLUE',
    'NATURAL TITANIUM',
    'DESERT TITANIUM',
    'WHITE TITANIUM',
    'BLACK TITANIUM',
    'TITANIUM GRAY',

    // CORES SIMPLES
    'MARINHO',
    'NAVY',
    'JET BLACK',
    'JETBLACK',
    'PRETO',
    'BLACK',
    'BRANCO',
    'WHITE',
    'ROSA',
    'PINK',
    'AZUL',
    'BLUE',
    'VERDE',
    'GREEN',
    'CINZA',
    'GRAY',
    'GREY',
    'GRAFITE',
    'GRAPHITE',
    'VIOLETA',
    'VIOLET',
    'LAVANDA',
    'LAVENDER',
    'AMARELO',
    'YELLOW',
    'VERMELHO',
    'RED',
    'BEGE',
    'BEIGE',
    'PRATA',
    'SILVER',
    'DOURADO',
    'GOLD',
    'CREME',
    'CREAM',
    'TITANIUM',
    'TITANIO',
    'TITÂNIO',
    'NATURAL',
    'DESERT',
    'ULTRAMARINO'
  ];

  let base = ` ${text} `;

  for (const color of colorWords.sort((a, b) => b.length - a.length)) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    base = base.replace(
      new RegExp(`\\s${escaped}\\s*$`, 'i'),
      ' '
    );

    base = base.replace(
      new RegExp(`\\s${escaped}\\s`, 'gi'),
      ' '
    );
  }

  base = base
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .trim();

  return base || text;
}

function acessoRapidoMakeProductId(value: any): string {
  const normalized = acessoRapidoSearchKey(value);
  return normalized || `PRODUTO-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function acessoRapidoGetStatus(params: {
  quantidade: number;
  vendasMes: number;
  vendasAno: number;
}): 'COM_ESTOQUE' | 'SEM_ESTOQUE' | 'SEM_GIRO_MES' | 'ALTO_GIRO' {
  if (params.quantidade <= 0) return 'SEM_ESTOQUE';
  if (params.vendasMes <= 0 && params.vendasAno <= 0) return 'SEM_GIRO_MES';
  if (params.vendasMes >= 10) return 'ALTO_GIRO';
  return 'COM_ESTOQUE';
}

function acessoRapidoEnsureLoja(
  product: AcessoRapidoProductAgg,
  loja: string
): AcessoRapidoStoreAgg {
  const safeLoja = loja || 'LOJA NÃO INFORMADA';

  let store = product.lojas.find((item) => item.loja === safeLoja);

  if (!store) {
    store = {
      loja: safeLoja,
      regiao: ESTOQUE_DETALHADO_STORE_REGIONS[safeLoja] || 'OUTROS',
      quantidade: 0,
      vendasMes: 0,
      vendasAno: 0,
      variacoes: [],
    };

    product.lojas.push(store);
  }

  return store;
}

function acessoRapidoEnsureVariacao(
  lista: AcessoRapidoVariacaoAgg[],
  params: {
    modeloCompleto: string;
    referencia: string;
    categoria: string;
    cor: string;
  }
): AcessoRapidoVariacaoAgg {
  const id = acessoRapidoSearchKey(`${params.modeloCompleto} ${params.referencia} ${params.cor}`);

  let variacao = lista.find((item) => item.id === id);

  if (!variacao) {
    variacao = {
      id,
      modeloCompleto: params.modeloCompleto,
      referencia: params.referencia,
      categoria: params.categoria,
      cor: params.cor,
      quantidade: 0,
      vendasMes: 0,
      vendasAno: 0,
    };

    lista.push(variacao);
  }

  return variacao;
}

app.get('/api/diretoria/acesso-rapido-aparelhos', async (req, res) => {
  let globalDb: any;
  let annualDb: any;

  try {
    const userId = String(req.query.userId || '');

    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    const role = estoqueDetalhadoNormalizeText(user.role);
    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'SOCIO', 'MASTER'];

    const canSeeAll = Boolean(user.isAdmin || superRoles.includes(role));

    if (!canSeeAll) {
      return res.status(403).json({
        success: false,
        error: 'Acesso permitido apenas para diretoria/administradores.',
      });
    }

    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const startYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);

    const startMonthIso = estoqueDetalhadoDateToIso(startMonth);
    const startYearIso = estoqueDetalhadoDateToIso(startYear);
    const todayIso = estoqueDetalhadoDateToIso(now);

    const securityFilter = await getSalesFilter(userId, 'vendas');
    const annualDbPath = estoqueDetalhadoGetAnnualDbPath();

    const productMap = new Map<string, AcessoRapidoProductAgg>();
    const byReference = new Map<string, string>();
    const byDescription = new Map<string, string>();
    const byBaseModel = new Map<string, string>();

    const getOrCreateProduct = (params: {
      modeloCompleto: string;
      referencia?: string;
      categoria?: string;
    }): AcessoRapidoProductAgg => {
      const modeloCompleto = acessoRapidoCleanName(params.modeloCompleto || params.referencia || 'PRODUTO NÃO INFORMADO');
      const referencia = acessoRapidoCleanName(params.referencia || '');
      const categoria = acessoRapidoCleanName(params.categoria || 'GERAL').toUpperCase();

      const modeloBase = acessoRapidoBaseModel(modeloCompleto, referencia);
      const baseKey = acessoRapidoSearchKey(modeloBase);
      const referenceKey = acessoRapidoSearchKey(referencia);
      const descriptionKey = acessoRapidoSearchKey(modeloCompleto);

      const mapKey =
        byBaseModel.get(baseKey) ||
        byReference.get(referenceKey) ||
        byDescription.get(descriptionKey) ||
        baseKey ||
        referenceKey ||
        descriptionKey ||
        acessoRapidoMakeProductId(modeloBase);

      let product = productMap.get(mapKey);

      if (!product) {
        product = {
          id: mapKey,
          modelo: modeloBase,
          referencia,
          categoria,
          quantidade: 0,
          vendasMes: 0,
          vendasAno: 0,
          lojasComEstoque: 0,
          status: 'SEM_ESTOQUE',
          lojas: [],
          variacoes: [],
        };

        productMap.set(mapKey, product);
      }

      if (!product.referencia && referencia) product.referencia = referencia;
      if ((!product.categoria || product.categoria === 'GERAL') && categoria) product.categoria = categoria;

      if (baseKey) byBaseModel.set(baseKey, mapKey);
      if (referenceKey) byReference.set(referenceKey, mapKey);
      if (descriptionKey) byDescription.set(descriptionKey, mapKey);

      return product;
    };

    const stockRows = await prisma.stock.findMany({
      select: {
        cnpj: true,
        storeName: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        quantity: true,
      },
    });

    for (const stock of stockRows) {
      const modeloCompleto = acessoRapidoCleanName(stock.description || '');
      if (!modeloCompleto) continue;

      const loja = estoqueDetalhadoStoreName(stock);
      const referencia = acessoRapidoCleanName(stock.reference || stock.productCode || '');
      const categoria = acessoRapidoCleanName(stock.category || 'GERAL').toUpperCase();
      const quantidade = estoqueDetalhadoToNumber(stock.quantity);
      const cor = acessoRapidoDetectColor(modeloCompleto);

      const product = getOrCreateProduct({
        modeloCompleto,
        referencia,
        categoria,
      });

      const store = acessoRapidoEnsureLoja(product, loja);

      product.quantidade += quantidade;
      store.quantidade += quantidade;

      const productVariation = acessoRapidoEnsureVariacao(product.variacoes, {
        modeloCompleto,
        referencia,
        categoria,
        cor,
      });

      const storeVariation = acessoRapidoEnsureVariacao(store.variacoes, {
        modeloCompleto,
        referencia,
        categoria,
        cor,
      });

      productVariation.quantidade += quantidade;
      storeVariation.quantidade += quantidade;
    }

    const addSale = (row: any, origem: 'MES' | 'ANO') => {
      const date = estoqueDetalhadoParseDate(
        row.data_emissao || row.DATA_EMISSAO || row.data || row.DATA
      );

      if (!date) return;

      const quantidade = estoqueDetalhadoToNumber(
        row.qtd_real ??
          row.QTD_REAL ??
          row.quantidade ??
          row.QUANTIDADE ??
          row.qtd ??
          row.QTD ??
          0
      );

      if (!quantidade) return;

      const referencia = acessoRapidoCleanName(
        row.referencia ||
          row.REFERENCIA ||
          row.codigo_produto ||
          row.CODIGO_PRODUTO ||
          row.familia ||
          row.FAMILIA ||
          ''
      );

      const descricao = acessoRapidoCleanName(
        row.descricao ||
          row.DESCRICAO ||
          row.produto ||
          row.PRODUTO ||
          referencia ||
          ''
      );

      if (!referencia && !descricao) return;

      const referenceKey = acessoRapidoSearchKey(referencia);
      const descriptionKey = acessoRapidoSearchKey(descricao);
      const baseKey = acessoRapidoSearchKey(acessoRapidoBaseModel(descricao, referencia));

      const productKey =
        byReference.get(referenceKey) ||
        byDescription.get(descriptionKey) ||
        byBaseModel.get(baseKey) ||
        baseKey ||
        referenceKey ||
        descriptionKey;

      const product =
        productKey && productMap.get(productKey)
          ? productMap.get(productKey)!
          : getOrCreateProduct({
              modeloCompleto: descricao || referencia,
              referencia,
              categoria: acessoRapidoCleanName(
                row.categoria_real ||
                  row.CATEGORIA_REAL ||
                  row.categoria ||
                  row.CATEGORIA ||
                  row.familia ||
                  row.FAMILIA ||
                  'GERAL'
              ).toUpperCase(),
            });

      const loja = estoqueDetalhadoStoreName(row);
      const store = acessoRapidoEnsureLoja(product, loja);
      const cor = acessoRapidoDetectColor(descricao);

      const productVariation = acessoRapidoEnsureVariacao(product.variacoes, {
        modeloCompleto: descricao || referencia,
        referencia,
        categoria: product.categoria,
        cor,
      });

      const storeVariation = acessoRapidoEnsureVariacao(store.variacoes, {
        modeloCompleto: descricao || referencia,
        referencia,
        categoria: product.categoria,
        cor,
      });

      if (origem === 'MES') {
        if (date >= startMonth && date <= now) {
          product.vendasMes += quantidade;
          store.vendasMes += quantidade;
          productVariation.vendasMes += quantidade;
          storeVariation.vendasMes += quantidade;
        }

        return;
      }

      if (origem === 'ANO') {
        if (date >= startYear && date <= now) {
          product.vendasAno += quantidade;
          store.vendasAno += quantidade;
          productVariation.vendasAno += quantidade;
          storeVariation.vendasAno += quantidade;
        }
      }
    };

    if (fs.existsSync(GLOBAL_DB_PATH)) {
      globalDb = await open({
        filename: GLOBAL_DB_PATH,
        driver: sqlite3.Database,
      });

      const hasDetailed = await estoqueDetalhadoTableExists(globalDb, 'vendas_detalhadas_imei');
      const hasLegacy = await estoqueDetalhadoTableExists(globalDb, 'vendas');

      if (hasDetailed) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            nome_fantasia AS loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            quantidade
          FROM vendas_detalhadas_imei
          WHERE ${securityFilter}
            AND data_emissao >= ?
            AND data_emissao <= ?
        `, [startMonthIso, todayIso]);

        rows.forEach((row: any) => addSale(row, 'MES'));
      } else if (hasLegacy) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            NULL AS loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade
          FROM vendas
          WHERE ${securityFilter}
            AND data_emissao >= ?
            AND data_emissao <= ?
        `, [startMonthIso, todayIso]);

        rows.forEach((row: any) => addSale(row, 'MES'));
      }

      await globalDb.close();
      globalDb = null;
    }

    if (fs.existsSync(annualDbPath)) {
      annualDb = await open({
        filename: annualDbPath,
        driver: sqlite3.Database,
      });

      const hasRaw = await estoqueDetalhadoTableExists(annualDb, 'vendas_anuais_raw');
      const hasAnnual = await estoqueDetalhadoTableExists(annualDb, 'vendas_anuais');

      if (hasRaw) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            categoria_real,
            qtd_real,
            quantidade
          FROM vendas_anuais_raw
          WHERE ${securityFilter}
            AND data_emissao >= ?
            AND data_emissao <= ?
        `, [startYearIso, todayIso]);

        rows.forEach((row: any) => addSale(row, 'ANO'));
      } else if (hasAnnual) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            familia AS referencia,
            familia AS descricao,
            familia AS categoria,
            quantidade
          FROM vendas_anuais
          WHERE ${securityFilter}
            AND data_emissao >= ?
            AND data_emissao <= ?
        `, [startYearIso, todayIso]);

        rows.forEach((row: any) => addSale(row, 'ANO'));
      }

      await annualDb.close();
      annualDb = null;
    }

    let produtos = Array.from(productMap.values()).map((product) => {
      product.variacoes = product.variacoes
        .map((variacao) => ({
          ...variacao,
          quantidade: Number(variacao.quantidade.toFixed(2)),
          vendasMes: Number(variacao.vendasMes.toFixed(2)),
          vendasAno: Number(variacao.vendasAno.toFixed(2)),
        }))
        .filter((variacao) => variacao.quantidade > 0 || variacao.vendasMes > 0 || variacao.vendasAno > 0)
        .sort((a, b) => b.quantidade - a.quantidade || a.cor.localeCompare(b.cor));

      product.lojas = product.lojas
        .map((loja) => ({
          ...loja,
          quantidade: Number(loja.quantidade.toFixed(2)),
          vendasMes: Number(loja.vendasMes.toFixed(2)),
          vendasAno: Number(loja.vendasAno.toFixed(2)),
          variacoes: loja.variacoes
            .map((variacao) => ({
              ...variacao,
              quantidade: Number(variacao.quantidade.toFixed(2)),
              vendasMes: Number(variacao.vendasMes.toFixed(2)),
              vendasAno: Number(variacao.vendasAno.toFixed(2)),
            }))
            .filter((variacao) => variacao.quantidade > 0 || variacao.vendasMes > 0 || variacao.vendasAno > 0)
            .sort((a, b) => b.quantidade - a.quantidade || a.cor.localeCompare(b.cor)),
        }))
        .filter((loja) => loja.quantidade > 0 || loja.vendasMes > 0 || loja.vendasAno > 0)
        .sort((a, b) => b.quantidade - a.quantidade || b.vendasMes - a.vendasMes || a.loja.localeCompare(b.loja));

      product.quantidade = Number(product.quantidade.toFixed(2));
      product.vendasMes = Number(product.vendasMes.toFixed(2));
      product.vendasAno = Number(product.vendasAno.toFixed(2));
      product.lojasComEstoque = product.lojas.filter((loja) => loja.quantidade > 0).length;

      product.status = acessoRapidoGetStatus({
        quantidade: product.quantidade,
        vendasMes: product.vendasMes,
        vendasAno: product.vendasAno,
      });

      return product;
    });

    produtos.sort((a, b) =>
      b.quantidade - a.quantidade ||
      b.vendasMes - a.vendasMes ||
      b.vendasAno - a.vendasAno ||
      a.modelo.localeCompare(b.modelo)
    );

    const resumo = {
      modelos: produtos.length,
      modelosComEstoque: produtos.filter((item) => item.quantidade > 0).length,
      modelosVendidosMes: produtos.filter((item) => item.vendasMes > 0).length,
      quantidade: Number(produtos.reduce((acc, item) => acc + item.quantidade, 0).toFixed(2)),
      vendasMes: Number(produtos.reduce((acc, item) => acc + item.vendasMes, 0).toFixed(2)),
      vendasAno: Number(produtos.reduce((acc, item) => acc + item.vendasAno, 0).toFixed(2)),
      lojas: Array.from(
        new Set(
          produtos.flatMap((item) =>
            item.lojas
              .filter((loja) => loja.quantidade > 0)
              .map((loja) => loja.loja)
          )
        )
      ).length,
    };

    const filtros = {
      categorias: Array.from(new Set(produtos.map((item) => item.categoria).filter(Boolean))).sort(),
      lojas: Array.from(new Set(produtos.flatMap((item) => item.lojas.map((loja) => loja.loja)).filter(Boolean))).sort(),
      status: ['COM_ESTOQUE', 'SEM_ESTOQUE', 'SEM_GIRO_MES', 'ALTO_GIRO'],
    };

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      periodo: {
        mesInicio: startMonthIso,
        anoInicio: startYearIso,
        hoje: todayIso,
      },
      sources: {
        estoque: 'Prisma Stock / dev.db',
        vendasMes: GLOBAL_DB_PATH,
        vendasAno: annualDbPath,
      },

      // Contrato usado pelo frontend atual
      resumo,
      filtros,
      produtos,

      // Compatibilidade com versões anteriores
      cards: resumo,
      filters: filtros,
      products: produtos,
      total: produtos.length,
    });
  } catch (error: any) {
    console.error('Erro /api/diretoria/acesso-rapido-aparelhos:', error);

    try {
      if (globalDb) await globalDb.close();
      if (annualDb) await annualDb.close();
    } catch {}

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao montar acesso rápido de aparelhos.',
    });
  }
});

// =======================================================
// 🚨 CENTRAL DE ALERTAS INTELIGENTES - TELEFLUXO
// =======================================================

type SmartAlertSeverity = 'critica' | 'alta' | 'media' | 'baixa';
type SmartAlertModule = 'estoque' | 'vendas' | 'remanejamento' | 'operacao';

type SmartAlertMetric = {
  label: string;
  value: string | number;
  helper?: string;
};

type SmartAlert = {
  id: string;
  type: string;
  severity: SmartAlertSeverity;
  status: 'aberto';
  title: string;
  description: string;
  module: SmartAlertModule;
  createdAt: string;
  store?: string;
  product?: string;
  category?: string;
  metric?: SmartAlertMetric;
  action?: string;
  details?: Record<string, any>;
};

type SmartStoreProductAgg = {
  key: string;
  product: string;
  reference: string;
  category: string;
  store: string;
  region: string;
  stock: number;
  stockValue: number;
  salesMonth: number;
  sales30: number;
  sales60: number;
  sales90: number;
  previous30: number;
};

type SmartProductNetworkAgg = {
  key: string;
  product: string;
  reference: string;
  category: string;
  stock: number;
  stockValue: number;
  salesMonth: number;
  sales30: number;
  sales60: number;
  sales90: number;
  previous30: number;
  stores: SmartStoreProductAgg[];
};

function smartAlertsNormalizeText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function smartAlertsNormalizeKey(value: any): string {
  return smartAlertsNormalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function smartAlertsToNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function smartAlertsParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const copy = new Date(value);
    copy.setHours(12, 0, 0, 0);
    return copy;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 90000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + value * 86400000);
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0);
    }

    const direct = new Date(value);
    return Number.isNaN(direct.getTime()) ? null : direct;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return smartAlertsParseDate(Number(raw));
  }

  const onlyDate = raw.split(' ')[0] ?? '';

  const brSlash = onlyDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brSlash) {
    return new Date(Number(brSlash[3] ?? 0), Number(brSlash[2] ?? 1) - 1, Number(brSlash[1] ?? 1), 12, 0, 0, 0);
  }

  const brDash = onlyDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (brDash) {
    return new Date(Number(brDash[3] ?? 0), Number(brDash[2] ?? 1) - 1, Number(brDash[1] ?? 1), 12, 0, 0, 0);
  }

  const iso = onlyDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1] ?? 0), Number(iso[2] ?? 1) - 1, Number(iso[3] ?? 1), 12, 0, 0, 0);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function smartAlertsAddDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function smartAlertsStoreName(row: any): string {
  const rawCnpj = String(row?.cnpj_empresa || row?.CNPJ_EMPRESA || row?.cnpj || row?.CNPJ || '').replace(/\D/g, '');
  if (rawCnpj && LOJAS_MAP_GLOBAL[rawCnpj]) return LOJAS_MAP_GLOBAL[rawCnpj];

  const rawStore = row?.loja || row?.LOJA || row?.storeName || row?.STORENAME || row?.nome_fantasia || row?.NOME_FANTASIA || '';
  const normalized = smartAlertsNormalizeText(rawStore);

  return CORRECAO_NOMES_SERVER[normalized] || normalized || 'LOJA NÃO INFORMADA';
}

function smartAlertsRegionByStore(store: string): string {
  const normalized = smartAlertsNormalizeText(store);
  const regionMap: Record<string, string> = {
    'ARAGUAIA SHOPPING': 'GOIÁS',
    'BOULEVARD SHOPPING': 'DF',
    'BRASILIA SHOPPING': 'DF',
    'CONJUNTO NACIONAL': 'DF',
    'CONJUNTO NACIONAL QUIOSQUE': 'DF',
    'GOIANIA SHOPPING': 'GOIÁS',
    'IGUATEMI SHOPPING': 'DF',
    'JK SHOPPING': 'DF',
    'PARK SHOPPING': 'DF',
    'PATIO BRASIL': 'DF',
    'TAGUATINGA SHOPPING': 'DF',
    'TERRAÇO SHOPPING': 'DF',
    'TAGUATINGA SHOPPING QQ': 'DF',
    'UBERLÂNDIA SHOPPING': 'MINAS GERAIS',
    'UBERABA SHOPPING': 'MINAS GERAIS',
    'FLAMBOYANT SHOPPING': 'GOIÁS',
    'BURITI SHOPPING': 'GOIÁS',
    'PASSEIO DAS AGUAS': 'GOIÁS',
    'PORTAL SHOPPING': 'GOIÁS',
    'SHOPPING SUL': 'GOIÁS',
    'BURITI RIO VERDE': 'GOIÁS',
    'PARK ANAPOLIS': 'GOIÁS',
    'SHOPPING RECIFE': 'NORDESTE',
    'MANAIRA SHOPPING': 'NORDESTE',
    'IGUATEMI FORTALEZA': 'NORDESTE',
    'CD TAGUATINGA': 'CD',
  };

  return regionMap[normalized] || 'OUTROS';
}

async function smartAlertsTableExists(db: any, tableName: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );

  return Boolean(row?.name);
}

function smartAlertsAnnualDbPath(): string {
  const candidates = [
    ANUAL_DB_PATH,
    path.join(DATABASE_DIR, 'samsung_vendas_anual.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anuais.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anual.db'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || ANUAL_DB_PATH;
}

function smartAlertsBuildId(parts: Array<string | number>): string {
  return parts
    .map((part) => smartAlertsNormalizeKey(part))
    .filter(Boolean)
    .join('-')
    .slice(0, 180);
}

function smartAlertsCoverageDays(stock: number, sales90: number): number | null {
  if (sales90 <= 0) return null;
  return stock / (sales90 / 90);
}

function smartAlertsFormatDays(days: number | null): string {
  if (days === null) return 'sem giro';
  return `${Math.round(days)} dias`;
}

function smartAlertsAddAlert(alerts: SmartAlert[], alert: SmartAlert) {
  alerts.push(alert);
}

app.get('/api/intelligent-alerts', async (req, res) => {
  let globalDb: any;
  let annualDb: any;

  try {
    const userId = String(req.query.userId || '');

    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    const role = smartAlertsNormalizeText(user.role);
    const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'SÓCIO', 'SOCIO', 'MASTER'];
    const canSeeAll = Boolean(user.isAdmin || superRoles.includes(role));

    const allowedStores = String(user.allowedStores || '')
      .split(',')
      .map((store) => smartAlertsNormalizeText(CORRECAO_NOMES_SERVER[smartAlertsNormalizeText(store)] || store))
      .filter(Boolean);

    const canUseStore = (store: string) => {
      if (canSeeAll) return true;
      if (allowedStores.length === 0) return false;
      return allowedStores.includes(smartAlertsNormalizeText(store));
    };

    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const start30 = smartAlertsAddDays(now, -30);
    const start60 = smartAlertsAddDays(now, -60);
    const start90 = smartAlertsAddDays(now, -90);
    const startPrevious30 = smartAlertsAddDays(now, -60);
    const endPrevious30 = smartAlertsAddDays(now, -31);

    const productMap = new Map<string, SmartProductNetworkAgg>();
    const storeProductMap = new Map<string, SmartStoreProductAgg>();
    const byReference = new Map<string, string>();
    const byDescription = new Map<string, string>();

    const getProduct = (params: {
      key?: string;
      product: string;
      reference?: string;
      category?: string;
    }): SmartProductNetworkAgg => {
      const referenceKey = smartAlertsNormalizeKey(params.reference || '');
      const descriptionKey = smartAlertsNormalizeKey(params.product);
      const key = params.key || byReference.get(referenceKey) || byDescription.get(descriptionKey) || referenceKey || descriptionKey;

      let product = productMap.get(key);

      if (!product) {
        product = {
          key,
          product: params.product || params.reference || 'PRODUTO NÃO INFORMADO',
          reference: params.reference || '',
          category: params.category || 'GERAL',
          stock: 0,
          stockValue: 0,
          salesMonth: 0,
          sales30: 0,
          sales60: 0,
          sales90: 0,
          previous30: 0,
          stores: [],
        };

        productMap.set(key, product);
      }

      if (!product.reference && params.reference) product.reference = params.reference;
      if ((!product.category || product.category === 'GERAL') && params.category) product.category = params.category;

      if (referenceKey) byReference.set(referenceKey, key);
      if (descriptionKey) byDescription.set(descriptionKey, key);

      return product;
    };

    const getStoreProduct = (product: SmartProductNetworkAgg, store: string): SmartStoreProductAgg => {
      const normalizedStore = smartAlertsNormalizeText(store);
      const storeKey = `${product.key}::${normalizedStore}`;
      let storeProduct = storeProductMap.get(storeKey);

      if (!storeProduct) {
        storeProduct = {
          key: product.key,
          product: product.product,
          reference: product.reference,
          category: product.category,
          store: normalizedStore || 'LOJA NÃO INFORMADA',
          region: smartAlertsRegionByStore(normalizedStore),
          stock: 0,
          stockValue: 0,
          salesMonth: 0,
          sales30: 0,
          sales60: 0,
          sales90: 0,
          previous30: 0,
        };

        storeProductMap.set(storeKey, storeProduct);
        product.stores.push(storeProduct);
      }

      return storeProduct;
    };

    const stockRows = await prisma.stock.findMany({
      select: {
        storeName: true,
        cnpj: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        quantity: true,
        costPrice: true,
        averageCost: true,
      },
    });

    for (const stock of stockRows) {
      const store = smartAlertsStoreName(stock);
      if (!canUseStore(store)) continue;

      const productName = String(stock.description || '').trim();
      if (!productName) continue;

      const reference = String(stock.reference || stock.productCode || '').trim();
      const category = String(stock.category || 'GERAL').toUpperCase();
      const key = smartAlertsNormalizeKey(reference) || smartAlertsNormalizeKey(productName);

      const product = getProduct({
        key,
        product: productName,
        reference,
        category,
      });

      const storeProduct = getStoreProduct(product, store);
      const quantity = smartAlertsToNumber(stock.quantity);
      const unitCost = smartAlertsToNumber(stock.averageCost || stock.costPrice);
      const value = quantity * unitCost;

      product.stock += quantity;
      product.stockValue += value;
      storeProduct.stock += quantity;
      storeProduct.stockValue += value;
    }

    const addSale = (row: any, source: 'global' | 'annual') => {
      const date = smartAlertsParseDate(row.data_emissao || row.DATA_EMISSAO || row.data || row.DATA);
      if (!date) return;

      const store = smartAlertsStoreName(row);
      if (!canUseStore(store)) return;

      const quantity = smartAlertsToNumber(
        row.qtd_real ??
          row.QTD_REAL ??
          row.quantidade ??
          row.QUANTIDADE ??
          row.qtd ??
          row.QTD ??
          1
      );

      if (!quantity) return;

      const reference = String(
        row.referencia ||
          row.REFERENCIA ||
          row.codigo_produto ||
          row.CODIGO_PRODUTO ||
          row.productCode ||
          row.PRODUCTCODE ||
          ''
      ).trim();

      const productName = String(
        row.descricao ||
          row.DESCRICAO ||
          row.produto ||
          row.PRODUTO ||
          reference ||
          ''
      ).trim();

      if (!reference && !productName) return;

      const referenceKey = smartAlertsNormalizeKey(reference);
      const descriptionKey = smartAlertsNormalizeKey(productName);
      const productKey = byReference.get(referenceKey) || byDescription.get(descriptionKey) || referenceKey || descriptionKey;

      const product = getProduct({
        key: productKey,
        product: productName || reference,
        reference,
        category: String(row.categoria || row.CATEGORIA || row.categoria_real || row.CATEGORIA_REAL || row.familia || row.FAMILIA || 'GERAL').toUpperCase(),
      });

      const storeProduct = getStoreProduct(product, store);

      if (date >= startMonth && date <= now) {
        product.salesMonth += quantity;
        storeProduct.salesMonth += quantity;
      }

      if (source === 'annual') {
        if (date >= start30 && date <= now) {
          product.sales30 += quantity;
          storeProduct.sales30 += quantity;
        }

        if (date >= start60 && date <= now) {
          product.sales60 += quantity;
          storeProduct.sales60 += quantity;
        }

        if (date >= start90 && date <= now) {
          product.sales90 += quantity;
          storeProduct.sales90 += quantity;
        }

        if (date >= startPrevious30 && date <= endPrevious30) {
          product.previous30 += quantity;
          storeProduct.previous30 += quantity;
        }
      }
    };

    if (fs.existsSync(GLOBAL_DB_PATH)) {
      globalDb = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });

      if (await smartAlertsTableExists(globalDb, 'vendas_detalhadas_imei')) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            nome_fantasia AS loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            quantidade
          FROM vendas_detalhadas_imei
        `);

        rows.forEach((row: any) => addSale(row, 'global'));
      } else if (await smartAlertsTableExists(globalDb, 'vendas')) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            NULL AS loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade
          FROM vendas
        `);

        rows.forEach((row: any) => addSale(row, 'global'));
      }

      await globalDb.close();
      globalDb = null;
    }

    const annualDbPath = smartAlertsAnnualDbPath();

    if (fs.existsSync(annualDbPath)) {
      annualDb = await open({ filename: annualDbPath, driver: sqlite3.Database });

      if (await smartAlertsTableExists(annualDb, 'vendas_anuais_raw')) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            categoria_real,
            quantidade,
            qtd_real,
            cancelado
          FROM vendas_anuais_raw
          WHERE COALESCE(cancelado, 'N') = 'N'
        `);

        rows.forEach((row: any) => addSale(row, 'annual'));
      } else if (await smartAlertsTableExists(annualDb, 'vendas_anuais')) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade
          FROM vendas_anuais
        `);

        rows.forEach((row: any) => addSale(row, 'annual'));
      }

      await annualDb.close();
      annualDb = null;
    }

    const alerts: SmartAlert[] = [];
    const createdAt = new Date().toISOString();

    const storeProducts = Array.from(storeProductMap.values());
    const products = Array.from(productMap.values());

    const storeProductsWithDemand = storeProducts
      .filter((item) => item.sales90 > 0 || item.salesMonth > 0 || item.stock > 0)
      .map((item) => ({
        ...item,
        coverageDays: smartAlertsCoverageDays(item.stock, item.sales90),
        avgDailySales: item.sales90 > 0 ? item.sales90 / 90 : 0,
      }));

    for (const item of storeProductsWithDemand) {
      const coverageDays = item.coverageDays;

      if (item.stock <= 0 && item.sales90 >= 2) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['stockout', item.store, item.key]),
          type: 'stockout_produto_loja',
          severity: 'critica',
          status: 'aberto',
          title: `${item.product} zerado em ${item.store}`,
          description: `A loja vendeu ${item.sales90} unidade(s) nos últimos 90 dias, mas está sem estoque físico do produto.`,
          module: 'estoque',
          store: item.store,
          product: item.product,
          category: item.category,
          metric: {
            label: 'Estoque',
            value: 0,
            helper: `${item.sales90} venda(s) nos últimos 90 dias`,
          },
          action: `Priorizar reposição ou remanejamento para ${item.store}.`,
          createdAt,
          details: {
            vendas90: item.sales90,
            vendas60: item.sales60,
            vendasMes: item.salesMonth,
            coberturaDias: 0,
          },
        });

        continue;
      }

      if (coverageDays !== null && coverageDays <= 7 && item.sales90 >= 2) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['ruptura-critica', item.store, item.key]),
          type: 'risco_ruptura_critico',
          severity: 'critica',
          status: 'aberto',
          title: `Risco crítico de ruptura em ${item.store}`,
          description: `${item.product} tem cobertura estimada de apenas ${smartAlertsFormatDays(coverageDays)} na loja.`,
          module: 'estoque',
          store: item.store,
          product: item.product,
          category: item.category,
          metric: {
            label: 'Cobertura',
            value: smartAlertsFormatDays(coverageDays),
            helper: `${item.stock} em estoque / ${item.sales90} venda(s) em 90 dias`,
          },
          action: `Enviar estoque para ${item.store} antes da ruptura.`,
          createdAt,
          details: {
            estoque: item.stock,
            vendas90: item.sales90,
            giroDiario: item.avgDailySales,
          },
        });
      } else if (coverageDays !== null && coverageDays <= 15 && item.sales90 >= 3) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['ruptura-alta', item.store, item.key]),
          type: 'risco_ruptura_alto',
          severity: 'alta',
          status: 'aberto',
          title: `Baixa cobertura em ${item.store}`,
          description: `${item.product} tem cobertura aproximada de ${smartAlertsFormatDays(coverageDays)}.`,
          module: 'estoque',
          store: item.store,
          product: item.product,
          category: item.category,
          metric: {
            label: 'Cobertura',
            value: smartAlertsFormatDays(coverageDays),
            helper: `${item.stock} em estoque / ${item.sales90} venda(s) em 90 dias`,
          },
          action: 'Avaliar reposição ou remanejamento preventivo.',
          createdAt,
          details: {
            estoque: item.stock,
            vendas90: item.sales90,
            giroDiario: item.avgDailySales,
          },
        });
      }

      if (coverageDays !== null && coverageDays >= 150 && item.stock >= 4) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['excesso', item.store, item.key]),
          type: 'excesso_estoque_loja',
          severity: coverageDays >= 240 ? 'alta' : 'media',
          status: 'aberto',
          title: `Possível excesso de estoque em ${item.store}`,
          description: `${item.product} possui cobertura estimada de ${smartAlertsFormatDays(coverageDays)}.`,
          module: 'estoque',
          store: item.store,
          product: item.product,
          category: item.category,
          metric: {
            label: 'Cobertura',
            value: smartAlertsFormatDays(coverageDays),
            helper: `${item.stock} em estoque / ${item.sales90} venda(s) em 90 dias`,
          },
          action: 'Avaliar remanejamento para lojas com maior giro.',
          createdAt,
          details: {
            estoque: item.stock,
            vendas90: item.sales90,
            valorEstoque: item.stockValue,
          },
        });
      }

      if (item.stock >= 3 && item.sales90 === 0) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['parado', item.store, item.key]),
          type: 'estoque_sem_giro',
          severity: item.stock >= 8 ? 'alta' : 'media',
          status: 'aberto',
          title: `Estoque sem giro em ${item.store}`,
          description: `${item.product} possui ${item.stock} unidade(s) em estoque e nenhuma venda nos últimos 90 dias.`,
          module: 'estoque',
          store: item.store,
          product: item.product,
          category: item.category,
          metric: {
            label: 'Estoque sem giro',
            value: item.stock,
            helper: '0 venda nos últimos 90 dias',
          },
          action: 'Analisar preço, exposição, campanha ou remanejamento.',
          createdAt,
          details: {
            estoque: item.stock,
            vendas90: item.sales90,
            valorEstoque: item.stockValue,
          },
        });
      }
    }

    for (const product of products) {
      const origins = product.stores
        .map((storeItem) => ({
          ...storeItem,
          coverageDays: smartAlertsCoverageDays(storeItem.stock, storeItem.sales90),
        }))
        .filter((storeItem) => storeItem.stock >= 3 && (storeItem.coverageDays === null || storeItem.coverageDays >= 90))
        .sort((a, b) => b.stock - a.stock);

      const destinations = product.stores
        .map((storeItem) => ({
          ...storeItem,
          coverageDays: smartAlertsCoverageDays(storeItem.stock, storeItem.sales90),
        }))
        .filter((storeItem) => {
          if (storeItem.sales90 < 2) return false;
          if (storeItem.stock <= 0) return true;
          return storeItem.coverageDays !== null && storeItem.coverageDays <= 15;
        })
        .sort((a, b) => {
          const covA = a.coverageDays ?? 0;
          const covB = b.coverageDays ?? 0;
          return covA - covB || b.sales90 - a.sales90;
        });

      if (origins.length === 0 || destinations.length === 0) continue;

      const origin = origins[0];
      const destination = destinations[0];

      if (!origin || !destination || origin.store === destination.store) continue;

      const suggestedQty = Math.max(1, Math.min(5, Math.floor(origin.stock / 2)));

      smartAlertsAddAlert(alerts, {
        id: smartAlertsBuildId(['remanejamento', product.key, origin.store, destination.store]),
        type: 'oportunidade_remanejamento',
        severity: destination.stock <= 0 ? 'alta' : 'media',
        status: 'aberto',
        title: `Remanejamento sugerido: ${product.product}`,
        description: `${destination.store} tem baixa cobertura e ${origin.store} possui estoque com maior folga.`,
        module: 'remanejamento',
        store: destination.store,
        product: product.product,
        category: product.category,
        metric: {
          label: 'Sugestão',
          value: `${suggestedQty} un.`,
          helper: `${origin.store} → ${destination.store}`,
        },
        action: `Remanejar até ${suggestedQty} unidade(s) de ${origin.store} para ${destination.store}.`,
        createdAt,
        details: {
          origem: origin.store,
          destino: destination.store,
          estoqueOrigem: origin.stock,
          estoqueDestino: destination.stock,
          vendas90Destino: destination.sales90,
          coberturaDestino: destination.coverageDays,
        },
      });
    }

    const storeSales = new Map<string, { store: string; sales30: number; previous30: number }>();

    for (const item of storeProductsWithDemand) {
      const key = smartAlertsNormalizeText(item.store);
      const current = storeSales.get(key) || { store: item.store, sales30: 0, previous30: 0 };
      current.sales30 += item.sales30;
      current.previous30 += item.previous30;
      storeSales.set(key, current);
    }

    for (const store of Array.from(storeSales.values())) {
      if (store.previous30 < 10) continue;

      const dropPercent = ((store.previous30 - store.sales30) / store.previous30) * 100;

      if (dropPercent >= 35) {
        smartAlertsAddAlert(alerts, {
          id: smartAlertsBuildId(['queda-vendas', store.store]),
          type: 'queda_vendas_loja',
          severity: dropPercent >= 50 ? 'alta' : 'media',
          status: 'aberto',
          title: `Queda de vendas em ${store.store}`,
          description: `A loja caiu ${Math.round(dropPercent)}% nos últimos 30 dias em comparação aos 30 dias anteriores.`,
          module: 'vendas',
          store: store.store,
          metric: {
            label: 'Queda',
            value: `${Math.round(dropPercent)}%`,
            helper: `${store.previous30} → ${store.sales30} unidade(s)`,
          },
          action: 'Verificar campanha, exposição, escala da equipe e estoque dos produtos de maior giro.',
          createdAt,
          details: {
            vendas30: store.sales30,
            vendasPeriodoAnterior: store.previous30,
          },
        });
      }
    }

    const sortedAlerts = alerts
      .sort((a, b) => {
        const severityScore: Record<SmartAlertSeverity, number> = {
          critica: 4,
          alta: 3,
          media: 2,
          baixa: 1,
        };

        const severityDiff = severityScore[b.severity] - severityScore[a.severity];
        if (severityDiff !== 0) return severityDiff;

        const moduleOrder: Record<SmartAlertModule, number> = {
          remanejamento: 4,
          estoque: 3,
          vendas: 2,
          operacao: 1,
        };

        return moduleOrder[b.module] - moduleOrder[a.module];
      })
      .slice(0, 250);

    const summary = {
      total: sortedAlerts.length,
      criticas: sortedAlerts.filter((alert) => alert.severity === 'critica').length,
      altas: sortedAlerts.filter((alert) => alert.severity === 'alta').length,
      medias: sortedAlerts.filter((alert) => alert.severity === 'media').length,
      baixas: sortedAlerts.filter((alert) => alert.severity === 'baixa').length,
      estoque: sortedAlerts.filter((alert) => alert.module === 'estoque').length,
      vendas: sortedAlerts.filter((alert) => alert.module === 'vendas').length,
      remanejamento: sortedAlerts.filter((alert) => alert.module === 'remanejamento').length,
    };

    return res.json({
      success: true,
      generatedAt: createdAt,
      summary,
      alerts: sortedAlerts,
      sources: {
        estoque: 'Prisma Stock / dev.db',
        vendasMes: GLOBAL_DB_PATH,
        vendasHistoricas: annualDbPath,
      },
      meta: {
        produtosAnalisados: products.length,
        produtosLojaAnalisados: storeProducts.length,
        escopo: canSeeAll ? 'todos' : allowedStores.join(', '),
      },
    });
  } catch (error: any) {
    console.error('Erro /api/intelligent-alerts:', error);

    try {
      if (globalDb) await globalDb.close();
      if (annualDb) await annualDb.close();
    } catch {}

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao gerar alertas inteligentes.',
    });
  }
});

// =======================================================
// 🔁 REMANEJAMENTO COM APROVAÇÃO - PASSO 4
// Cole este bloco no backend/src/server.ts depois da rota
// /api/intelligent-alerts e antes da rota /sales.
// =======================================================

type RemapPriority = 'critica' | 'alta' | 'media' | 'baixa';
type RemapStatus = 'solicitado' | 'aprovado' | 'em_separacao' | 'enviado' | 'recebido' | 'cancelado';

type RemapStoreProductAgg = {
  key: string;
  product: string;
  reference: string;
  category: string;
  store: string;
  stock: number;
  sales90: number;
  coverageDays: number | null;
};

type RemapSuggestion = {
  id: string;
  product: string;
  reference: string;
  category: string;
  fromStore: string;
  toStore: string;
  suggestedQty: number;
  priority: RemapPriority;
  reason: string;
  originStock: number;
  originSales90: number;
  originCoverageDays: number | null;
  destinationStock: number;
  destinationSales90: number;
  destinationCoverageDays: number | null;
  networkStock: number;
  networkSales90: number;
  createdFrom: 'engine';
};

function remapNormalizeText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function remapNormalizeKey(value: any): string {
  return remapNormalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function remapToNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const n = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function remapAddDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function remapParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 86400000);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0);
    }

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    return remapParseDate(Number(s));
  }

  const onlyDate = s.split(' ')[0] ?? '';

  const br = onlyDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0, 0);
  }

  const brDash = onlyDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (brDash) {
    return new Date(Number(brDash[3]), Number(brDash[2]) - 1, Number(brDash[1]), 12, 0, 0, 0);
  }

  const iso = onlyDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function remapStoreName(row: any): string {
  const rawLoja =
    row?.loja ||
    row?.LOJA ||
    row?.nome_fantasia ||
    row?.NOME_FANTASIA ||
    row?.storeName ||
    row?.STORENAME ||
    '';

  const rawCnpj =
    row?.cnpj_empresa ||
    row?.CNPJ_EMPRESA ||
    row?.cnpj ||
    row?.CNPJ ||
    '';

  const cleanCnpj = String(rawCnpj || '').replace(/\D/g, '');

  if (cleanCnpj && LOJAS_MAP_GLOBAL[cleanCnpj]) {
    return LOJAS_MAP_GLOBAL[cleanCnpj];
  }

  const normalized = remapNormalizeText(rawLoja);
  return CORRECAO_NOMES_SERVER[normalized] || normalized || 'LOJA NÃO INFORMADA';
}

function remapAnnualDbPath(): string {
  const candidates = [
    ANUAL_DB_PATH,
    path.join(DATABASE_DIR, 'samsung_vendas_anual.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anuais.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anual.db'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || ANUAL_DB_PATH;
}

async function remapTableExists(db: any, tableName: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );

  return Boolean(row?.name);
}

async function remapEnsureTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS RemanejamentoSolicitacao (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      reference TEXT,
      category TEXT,
      fromStore TEXT NOT NULL,
      toStore TEXT NOT NULL,
      requestedQty REAL NOT NULL DEFAULT 0,
      approvedQty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'solicitado',
      priority TEXT NOT NULL DEFAULT 'media',
      reason TEXT,
      metricsJson TEXT,
      createdById TEXT,
      createdByName TEXT,
      approvedById TEXT,
      approvedByName TEXT,
      lastActionById TEXT,
      lastActionByName TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      approvedAt TEXT,
      sentAt TEXT,
      receivedAt TEXT,
      cancelledAt TEXT
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_remanejamento_status
    ON RemanejamentoSolicitacao(status)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_remanejamento_lojas
    ON RemanejamentoSolicitacao(fromStore, toStore)
  `);
}

function remapIsSuperUser(user: any): boolean {
  const role = remapNormalizeText(user?.role);
  const superRoles = ['CEO', 'DIRETOR', 'ADM', 'ADMIN', 'GESTOR', 'GERENTE', 'SOCIO', 'SÓCIO', 'MASTER'];
  return Boolean(user?.isAdmin || superRoles.includes(role));
}

function remapAllowedStores(user: any): string[] {
  return String(user?.allowedStores || '')
    .split(',')
    .map((store) => remapNormalizeText(CORRECAO_NOMES_SERVER[remapNormalizeText(store)] || store))
    .filter(Boolean);
}

function remapCanSeeStore(user: any, store: string): boolean {
  if (remapIsSuperUser(user)) return true;
  const allowed = remapAllowedStores(user);
  if (allowed.length === 0) return false;
  return allowed.includes(remapNormalizeText(store));
}

function remapCanSeeFlow(user: any, fromStore: string, toStore: string): boolean {
  return remapCanSeeStore(user, fromStore) || remapCanSeeStore(user, toStore);
}

function remapPriority(destinationStock: number, destinationCoverage: number | null, destinationSales90: number): RemapPriority {
  if (destinationStock <= 0 && destinationSales90 > 0) return 'critica';
  if (destinationCoverage !== null && destinationCoverage <= 7) return 'critica';
  if (destinationCoverage !== null && destinationCoverage <= 15) return 'alta';
  if (destinationCoverage !== null && destinationCoverage <= 30) return 'media';
  return 'baixa';
}

function remapRecommendedQty(origin: RemapStoreProductAgg, destination: RemapStoreProductAgg): number {
  const originDailySales = origin.sales90 / 90;
  const destinationDailySales = destination.sales90 / 90;

  const originSafetyStock = Math.max(1, Math.ceil(originDailySales * 20));
  const destinationTargetStock = Math.max(2, Math.ceil(destinationDailySales * 20));

  const originExcess = Math.max(0, Math.floor(origin.stock - originSafetyStock));
  const destinationNeed = Math.max(0, Math.ceil(destinationTargetStock - destination.stock));

  if (destination.stock <= 0 && destination.sales90 > 0) {
    return Math.max(1, Math.min(originExcess, Math.max(2, destinationNeed), 6));
  }

  return Math.max(0, Math.min(originExcess, destinationNeed, 5));
}

async function remapGenerateSuggestionsForUser(user: any): Promise<RemapSuggestion[]> {
  let annualDb: any;

  const now = new Date();
  now.setHours(12, 0, 0, 0);

  const start90 = remapAddDays(now, -90);
  const annualDbPath = remapAnnualDbPath();
  const securityFilter = await getSalesFilter(String(user?.id || ''), 'vendas');

  const productStoreMap = new Map<string, RemapStoreProductAgg>();
  const byReference = new Map<string, string>();
  const byDescription = new Map<string, string>();

  const getStoreProduct = (params: {
    productKey?: string;
    product: string;
    reference?: string;
    category?: string;
    store: string;
  }): RemapStoreProductAgg => {
    const referenceKey = remapNormalizeKey(params.reference || '');
    const descriptionKey = remapNormalizeKey(params.product);
    const productKey =
      params.productKey ||
      byReference.get(referenceKey) ||
      byDescription.get(descriptionKey) ||
      referenceKey ||
      descriptionKey;

    const store = remapNormalizeText(params.store || 'LOJA NÃO INFORMADA');
    const key = `${productKey}::${store}`;

    let item = productStoreMap.get(key);

    if (!item) {
      item = {
        key: productKey,
        product: params.product || params.reference || 'PRODUTO NÃO INFORMADO',
        reference: params.reference || '',
        category: params.category || 'GERAL',
        store,
        stock: 0,
        sales90: 0,
        coverageDays: null,
      };

      productStoreMap.set(key, item);
    }

    if (!item.reference && params.reference) item.reference = params.reference;
    if ((!item.category || item.category === 'GERAL') && params.category) item.category = params.category;

    if (referenceKey) byReference.set(referenceKey, productKey);
    if (descriptionKey) byDescription.set(descriptionKey, productKey);

    return item;
  };

  const stockRows = await prisma.stock.findMany({
    select: {
      cnpj: true,
      storeName: true,
      productCode: true,
      reference: true,
      description: true,
      category: true,
      quantity: true,
    },
  });

  for (const stock of stockRows) {
    const store = remapStoreName(stock);

    if (!remapCanSeeStore(user, store)) {
      continue;
    }

    const product = String(stock.description || '').trim();
    if (!product) continue;

    const reference = String(stock.reference || stock.productCode || '').trim();
    const productKey = remapNormalizeKey(reference) || remapNormalizeKey(product);

    const item = getStoreProduct({
      productKey,
      product,
      reference,
      category: String(stock.category || 'GERAL').toUpperCase(),
      store,
    });

    item.stock += remapToNumber(stock.quantity);
  }

  const addSale = (row: any) => {
    const date = remapParseDate(row.data_emissao || row.DATA_EMISSAO || row.data || row.DATA);
    if (!date || date < start90 || date > now) return;

    const store = remapStoreName(row);
    if (!remapCanSeeStore(user, store)) return;

    const qty = remapToNumber(
      row.qtd_real ??
        row.QTD_REAL ??
        row.quantidade ??
        row.QUANTIDADE ??
        row.qtd ??
        row.QTD ??
        1
    );

    if (!qty) return;

    const reference = String(
      row.referencia || row.REFERENCIA || row.codigo_produto || row.CODIGO_PRODUTO || ''
    ).trim();

    const product = String(
      row.descricao || row.DESCRICAO || row.produto || row.PRODUTO || reference || ''
    ).trim();

    if (!reference && !product) return;

    const referenceKey = remapNormalizeKey(reference);
    const descriptionKey = remapNormalizeKey(product);
    const productKey = byReference.get(referenceKey) || byDescription.get(descriptionKey) || referenceKey || descriptionKey;

    const item = getStoreProduct({
      productKey,
      product: product || reference,
      reference,
      category: String(row.categoria_real || row.CATEGORIA_REAL || row.categoria || row.CATEGORIA || row.familia || row.FAMILIA || 'GERAL').toUpperCase(),
      store,
    });

    item.sales90 += qty;
  };

  if (fs.existsSync(annualDbPath)) {
    annualDb = await open({ filename: annualDbPath, driver: sqlite3.Database });

    const hasRaw = await remapTableExists(annualDb, 'vendas_anuais_raw');
    const hasAnnual = await remapTableExists(annualDb, 'vendas_anuais');

    if (hasRaw) {
      const rows = await annualDb.all(`
        SELECT
          data_emissao,
          cnpj_empresa,
          loja,
          referencia,
          codigo_produto,
          descricao,
          categoria,
          categoria_real,
          quantidade,
          qtd_real,
          cancelado
        FROM vendas_anuais_raw
        WHERE COALESCE(cancelado, 'N') = 'N'
          AND ${securityFilter}
      `);

      rows.forEach((row: any) => addSale(row));
    } else if (hasAnnual) {
      const rows = await annualDb.all(`
        SELECT
          data_emissao,
          cnpj_empresa,
          loja,
          familia AS referencia,
          descricao,
          familia AS categoria,
          quantidade
        FROM vendas_anuais
        WHERE ${securityFilter}
      `);

      rows.forEach((row: any) => addSale(row));
    }

    await annualDb.close();
    annualDb = null;
  }

  const items = Array.from(productStoreMap.values()).map((item) => {
    item.coverageDays = item.sales90 > 0 ? item.stock / (item.sales90 / 90) : null;
    return item;
  });

  const groupedByProduct = new Map<string, RemapStoreProductAgg[]>();

  for (const item of items) {
    if (!groupedByProduct.has(item.key)) groupedByProduct.set(item.key, []);
    groupedByProduct.get(item.key)?.push(item);
  }

  const suggestions: RemapSuggestion[] = [];

  for (const [, storeItems] of groupedByProduct.entries()) {
    const networkStock = storeItems.reduce((sum, item) => sum + item.stock, 0);
    const networkSales90 = storeItems.reduce((sum, item) => sum + item.sales90, 0);

    if (networkStock <= 1 || networkSales90 <= 0) continue;

    const origins = storeItems
      .filter((item) => {
        const coverage = item.coverageDays;
        return item.stock >= 2 && (item.sales90 === 0 || coverage === null || coverage >= 45);
      })
      .sort((a, b) => {
        const ac = a.coverageDays ?? 9999;
        const bc = b.coverageDays ?? 9999;
        return bc - ac || b.stock - a.stock;
      });

    const destinations = storeItems
      .filter((item) => {
        const coverage = item.coverageDays;
        return item.sales90 > 0 && (item.stock <= 0 || (coverage !== null && coverage <= 30));
      })
      .sort((a, b) => {
        const ap = remapPriority(a.stock, a.coverageDays, a.sales90);
        const bp = remapPriority(b.stock, b.coverageDays, b.sales90);
        const order: Record<RemapPriority, number> = { critica: 4, alta: 3, media: 2, baixa: 1 };
        return order[bp] - order[ap] || a.stock - b.stock;
      });

    for (const destination of destinations) {
      const origin = origins.find((candidate) => candidate.store !== destination.store);
      if (!origin) continue;

      const qty = remapRecommendedQty(origin, destination);
      if (qty <= 0) continue;

      const priority = remapPriority(destination.stock, destination.coverageDays, destination.sales90);
      const reason =
        destination.stock <= 0
          ? `${destination.store} está sem estoque, mas vendeu ${destination.sales90} un. nos últimos 90 dias. ${origin.store} tem estoque disponível para remanejamento.`
          : `${destination.store} está com cobertura baixa (${Math.round(destination.coverageDays || 0)} dias). ${origin.store} tem cobertura superior e pode abastecer sem ficar descoberta.`;

      const rawId = `${origin.key}-${origin.store}-${destination.store}-${qty}`;
      const id = crypto.createHash('md5').update(rawId).digest('hex');

      suggestions.push({
        id,
        product: destination.product || origin.product,
        reference: destination.reference || origin.reference,
        category: destination.category || origin.category || 'GERAL',
        fromStore: origin.store,
        toStore: destination.store,
        suggestedQty: qty,
        priority,
        reason,
        originStock: origin.stock,
        originSales90: origin.sales90,
        originCoverageDays: origin.coverageDays,
        destinationStock: destination.stock,
        destinationSales90: destination.sales90,
        destinationCoverageDays: destination.coverageDays,
        networkStock,
        networkSales90,
        createdFrom: 'engine',
      });
    }
  }

  suggestions.sort((a, b) => {
    const order: Record<RemapPriority, number> = { critica: 4, alta: 3, media: 2, baixa: 1 };
    return order[b.priority] - order[a.priority] || b.destinationSales90 - a.destinationSales90;
  });

  return suggestions.slice(0, 250);
}

function remapDbRowToRequest(row: any) {
  let metrics: any = {};

  try {
    metrics = row.metricsJson ? JSON.parse(row.metricsJson) : {};
  } catch {
    metrics = {};
  }

  const result: any = {
    id: row.id,
    product: row.product,
    reference: row.reference || '',
    category: row.category || 'GERAL',
    fromStore: row.fromStore,
    toStore: row.toStore,
    requestedQty: remapToNumber(row.requestedQty),
    approvedQty: remapToNumber(row.approvedQty),
    status: row.status,
    priority: row.priority,
    reason: row.reason || '',
    metrics,
    createdByName: row.createdByName || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (row.approvedByName) result.approvedByName = row.approvedByName;
  if (row.lastActionByName) result.lastActionByName = row.lastActionByName;
  if (row.approvedAt) result.approvedAt = row.approvedAt;
  if (row.sentAt) result.sentAt = row.sentAt;
  if (row.receivedAt) result.receivedAt = row.receivedAt;
  if (row.cancelledAt) result.cancelledAt = row.cancelledAt;

  return result;
}

app.get('/api/remanejamento-aprovacao/sugestoes', async (req, res) => {
  try {
    await remapEnsureTable();

    const userId = String(req.query.userId || '');

    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    const suggestions = await remapGenerateSuggestionsForUser(user);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      total: suggestions.length,
      suggestions,
    });
  } catch (error: any) {
    console.error('Erro /api/remanejamento-aprovacao/sugestoes:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao gerar sugestões de remanejamento.',
    });
  }
});

app.get('/api/remanejamento-aprovacao/solicitacoes', async (req, res) => {
  try {
    await remapEnsureTable();

    const userId = String(req.query.userId || '');

    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT *
      FROM RemanejamentoSolicitacao
      ORDER BY
        CASE status
          WHEN 'solicitado' THEN 1
          WHEN 'aprovado' THEN 2
          WHEN 'em_separacao' THEN 3
          WHEN 'enviado' THEN 4
          WHEN 'recebido' THEN 5
          WHEN 'cancelado' THEN 6
          ELSE 7
        END,
        datetime(createdAt) DESC
    `);

    const requests = rows
      .map((row) => remapDbRowToRequest(row))
      .filter((item) => remapCanSeeFlow(user, item.fromStore, item.toStore));

    return res.json({
      success: true,
      total: requests.length,
      requests,
    });
  } catch (error: any) {
    console.error('Erro /api/remanejamento-aprovacao/solicitacoes:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao listar solicitações de remanejamento.',
    });
  }
});

app.post('/api/remanejamento-aprovacao/solicitacoes', async (req, res) => {
  try {
    await remapEnsureTable();

    const { userId, suggestion } = req.body || {};
    const safeUserId = String(userId || '');

    if (!safeUserId || safeUserId === 'undefined' || safeUserId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: safeUserId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    if (!suggestion || typeof suggestion !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Sugestão inválida.',
      });
    }

    const fromStore = remapNormalizeText(suggestion.fromStore);
    const toStore = remapNormalizeText(suggestion.toStore);

    if (!fromStore || !toStore || fromStore === toStore) {
      return res.status(400).json({
        success: false,
        error: 'Origem e destino inválidos.',
      });
    }

    if (!remapCanSeeFlow(user, fromStore, toStore)) {
      return res.status(403).json({
        success: false,
        error: 'Usuário sem acesso às lojas deste remanejamento.',
      });
    }

    const product = String(suggestion.product || '').trim();
    const reference = String(suggestion.reference || '').trim();
    const category = String(suggestion.category || 'GERAL').trim();
    const requestedQty = Math.max(1, Math.round(remapToNumber(suggestion.suggestedQty)));
    const priority = ['critica', 'alta', 'media', 'baixa'].includes(String(suggestion.priority))
      ? String(suggestion.priority)
      : 'media';

    if (!product || requestedQty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Produto ou quantidade inválida.',
      });
    }

    const openDuplicate = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT id
        FROM RemanejamentoSolicitacao
        WHERE product = ?
          AND COALESCE(reference, '') = ?
          AND fromStore = ?
          AND toStore = ?
          AND status NOT IN ('recebido', 'cancelado')
        LIMIT 1
      `,
      product,
      reference,
      fromStore,
      toStore
    );

    if (openDuplicate.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Já existe uma solicitação aberta para este produto entre essas lojas.',
      });
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const createdByName = String(user.name || user.email || 'Usuário');

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO RemanejamentoSolicitacao (
          id,
          product,
          reference,
          category,
          fromStore,
          toStore,
          requestedQty,
          approvedQty,
          status,
          priority,
          reason,
          metricsJson,
          createdById,
          createdByName,
          lastActionById,
          lastActionByName,
          createdAt,
          updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      product,
      reference,
      category,
      fromStore,
      toStore,
      requestedQty,
      requestedQty,
      'solicitado',
      priority,
      String(suggestion.reason || ''),
      JSON.stringify(suggestion),
      safeUserId,
      createdByName,
      safeUserId,
      createdByName,
      nowIso,
      nowIso
    );

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM RemanejamentoSolicitacao WHERE id = ? LIMIT 1`,
      id
    );

    return res.status(201).json({
      success: true,
      data: remapDbRowToRequest(rows[0]),
    });
  } catch (error: any) {
    console.error('Erro POST /api/remanejamento-aprovacao/solicitacoes:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao criar solicitação de remanejamento.',
    });
  }
});

app.patch('/api/remanejamento-aprovacao/solicitacoes/:id/status', async (req, res) => {
  try {
    await remapEnsureTable();

    const id = String(req.params.id || '');
    const { userId, status } = req.body || {};
    const safeUserId = String(userId || '');
    const nextStatus = String(status || '') as RemapStatus;

    const validStatuses: RemapStatus[] = ['solicitado', 'aprovado', 'em_separacao', 'enviado', 'recebido', 'cancelado'];

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Solicitação não informada.',
      });
    }

    if (!safeUserId || safeUserId === 'undefined' || safeUserId === 'null') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não informado.',
      });
    }

    if (!validStatuses.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Status inválido.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: safeUserId } });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado.',
      });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM RemanejamentoSolicitacao WHERE id = ? LIMIT 1`,
      id
    );

    const current = rows[0];

    if (!current) {
      return res.status(404).json({
        success: false,
        error: 'Solicitação não encontrada.',
      });
    }

    if (!remapCanSeeFlow(user, current.fromStore, current.toStore)) {
      return res.status(403).json({
        success: false,
        error: 'Usuário sem acesso às lojas deste remanejamento.',
      });
    }

    const isSuper = remapIsSuperUser(user);

    if (nextStatus === 'aprovado' || nextStatus === 'cancelado') {
      if (!isSuper) {
        return res.status(403).json({
          success: false,
          error: 'Apenas gestão/diretoria pode aprovar ou cancelar remanejamentos.',
        });
      }
    }

    const transitionAllowed: Record<RemapStatus, RemapStatus[]> = {
      solicitado: ['aprovado', 'cancelado'],
      aprovado: ['em_separacao', 'cancelado'],
      em_separacao: ['enviado', 'cancelado'],
      enviado: ['recebido', 'cancelado'],
      recebido: [],
      cancelado: [],
    };

    const currentStatus = String(current.status || 'solicitado') as RemapStatus;

    if (!transitionAllowed[currentStatus]?.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        error: `Transição inválida: ${currentStatus} → ${nextStatus}.`,
      });
    }

    const nowIso = new Date().toISOString();
    const userName = String(user.name || user.email || 'Usuário');

    const setParts = [
      'status = ?',
      'updatedAt = ?',
      'lastActionById = ?',
      'lastActionByName = ?',
    ];
    const values: any[] = [nextStatus, nowIso, safeUserId, userName];

    if (nextStatus === 'aprovado') {
      setParts.push('approvedById = ?');
      setParts.push('approvedByName = ?');
      setParts.push('approvedAt = ?');
      values.push(safeUserId, userName, nowIso);
    }

    if (nextStatus === 'enviado') {
      setParts.push('sentAt = ?');
      values.push(nowIso);
    }

    if (nextStatus === 'recebido') {
      setParts.push('receivedAt = ?');
      values.push(nowIso);
    }

    if (nextStatus === 'cancelado') {
      setParts.push('cancelledAt = ?');
      values.push(nowIso);
    }

    values.push(id);

    await prisma.$executeRawUnsafe(
      `
        UPDATE RemanejamentoSolicitacao
        SET ${setParts.join(', ')}
        WHERE id = ?
      `,
      ...values
    );

    const updatedRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM RemanejamentoSolicitacao WHERE id = ? LIMIT 1`,
      id
    );

    return res.json({
      success: true,
      data: remapDbRowToRequest(updatedRows[0]),
    });
  } catch (error: any) {
    console.error('Erro PATCH /api/remanejamento-aprovacao/solicitacoes/:id/status:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao atualizar solicitação de remanejamento.',
    });
  }
});

// =======================================================
// 🧭 PAINEL DIRETORIA / RESUMO EXECUTIVO
// Acesso exclusivo ADM/isAdmin
// Cole este bloco depois das rotas de remanejamento e antes da rota /sales
// =======================================================

type ExecutiveStoreAgg = {
  loja: string;
  faturamentoMes: number;
  pecasMes: number;
  faturamento30: number;
  faturamento30Anterior: number;
  vendas90: number;
  estoque: number;
  valorEstoque: number;
  coberturaDias: number | null;
  status: 'saudavel' | 'atencao' | 'critico';
};

type ExecutiveProductAgg = {
  produto: string;
  referencia: string;
  categoria: string;
  faturamentoMes: number;
  pecasMes: number;
  faturamento30: number;
  vendas90: number;
  estoque: number;
  valorEstoque: number;
  coberturaDias: number | null;
};

type ExecutiveInsight = {
  id: string;
  tipo: 'risco' | 'oportunidade' | 'acao' | 'alerta';
  prioridade: 'critica' | 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  acao: string;
  loja?: string;
  produto?: string;
};

function execDashNormalizeText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function execDashNormalizeKey(value: any): string {
  return execDashNormalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function execDashToNumber(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;

  const numberValue = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function execDashAddDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function execDashDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function execDashParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const parsed = new Date(excelEpoch.getTime() + value * 86400000);
      return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0, 0);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return execDashParseDate(Number(text));
  }

  const onlyDate = text.split(' ')[0] ?? '';

  const br = onlyDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0, 0);
  }

  const brDash = onlyDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (brDash) {
    return new Date(Number(brDash[3]), Number(brDash[2]) - 1, Number(brDash[1]), 12, 0, 0, 0);
  }

  const iso = onlyDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function execDashStoreName(row: any): string {
  const rawCnpj = row?.cnpj_empresa || row?.CNPJ_EMPRESA || row?.cnpj || row?.CNPJ || row?.cnpjEmpresa || '';
  const cleanCnpj = String(rawCnpj || '').replace(/\D/g, '');

  if (cleanCnpj && LOJAS_MAP_GLOBAL[cleanCnpj]) {
    return LOJAS_MAP_GLOBAL[cleanCnpj];
  }

  const rawStore = row?.loja || row?.LOJA || row?.nome_fantasia || row?.NOME_FANTASIA || row?.storeName || row?.STORENAME || '';
  const normalized = execDashNormalizeText(rawStore);
  return CORRECAO_NOMES_SERVER[normalized] || normalized || 'LOJA NÃO INFORMADA';
}

function execDashProductLabel(row: any): string {
  return String(
    row?.descricao || row?.DESCRICAO || row?.produto || row?.PRODUTO || row?.description || row?.familia || row?.FAMILIA || 'PRODUTO NÃO INFORMADO'
  ).trim();
}

function execDashReference(row: any): string {
  return String(row?.referencia || row?.REFERENCIA || row?.codigo_produto || row?.CODIGO_PRODUTO || row?.productCode || row?.familia || '').trim();
}

function execDashCategory(row: any): string {
  return execDashNormalizeText(row?.categoria_real || row?.CATEGORIA_REAL || row?.categoria || row?.CATEGORIA || row?.category || row?.familia || 'GERAL');
}

async function execDashTableExists(db: any, tableName: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName],
  );

  return Boolean(row?.name);
}

function execDashAnnualDbPath(): string {
  const candidates = [
    ANUAL_DB_PATH,
    path.join(DATABASE_DIR, 'samsung_vendas_anual.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anuais.db'),
    path.join(ROOT_DIR, 'database', 'samsung_vendas_anual.db'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || ANUAL_DB_PATH;
}

function execDashGetStore(map: Map<string, ExecutiveStoreAgg>, loja: string): ExecutiveStoreAgg {
  const safeLoja = loja || 'LOJA NÃO INFORMADA';
  const existing = map.get(safeLoja);
  if (existing) return existing;

  const created: ExecutiveStoreAgg = {
    loja: safeLoja,
    faturamentoMes: 0,
    pecasMes: 0,
    faturamento30: 0,
    faturamento30Anterior: 0,
    vendas90: 0,
    estoque: 0,
    valorEstoque: 0,
    coberturaDias: null,
    status: 'saudavel',
  };

  map.set(safeLoja, created);
  return created;
}

function execDashGetProduct(map: Map<string, ExecutiveProductAgg>, params: {
  produto: string;
  referencia: string;
  categoria: string;
}): ExecutiveProductAgg {
  const key = execDashNormalizeKey(params.referencia) || execDashNormalizeKey(params.produto);
  const safeKey = key || `PRODUTO_${map.size + 1}`;
  const existing = map.get(safeKey);

  if (existing) {
    if (!existing.referencia && params.referencia) existing.referencia = params.referencia;
    if ((!existing.categoria || existing.categoria === 'GERAL') && params.categoria) existing.categoria = params.categoria;
    return existing;
  }

  const created: ExecutiveProductAgg = {
    produto: params.produto || params.referencia || 'PRODUTO NÃO INFORMADO',
    referencia: params.referencia || '',
    categoria: params.categoria || 'GERAL',
    faturamentoMes: 0,
    pecasMes: 0,
    faturamento30: 0,
    vendas90: 0,
    estoque: 0,
    valorEstoque: 0,
    coberturaDias: null,
  };

  map.set(safeKey, created);
  return created;
}

function execDashCalculateCoverage(estoque: number, vendas90: number): number | null {
  if (!vendas90 || vendas90 <= 0) return null;
  return estoque / (vendas90 / 90);
}

function execDashStatus(store: ExecutiveStoreAgg): 'saudavel' | 'atencao' | 'critico' {
  if (store.pecasMes <= 0 && store.estoque > 0) return 'critico';
  if (store.coberturaDias !== null && store.coberturaDias <= 7) return 'critico';
  if (store.faturamento30Anterior > 0 && store.faturamento30 < store.faturamento30Anterior * 0.75) return 'atencao';
  if (store.coberturaDias !== null && store.coberturaDias <= 15) return 'atencao';
  if (store.coberturaDias === null && store.estoque > 15) return 'atencao';
  return 'saudavel';
}

function execDashCreateBriefing(params: {
  faturamentoMes: number;
  pecasMes: number;
  crescimento: number | null;
  topStores: ExecutiveStoreAgg[];
  risks: ExecutiveInsight[];
  opportunities: ExecutiveInsight[];
  actions: ExecutiveInsight[];
}) {
  const topStore = params.topStores[0]?.loja || 'sem loja líder definida';
  const crescimentoTexto = params.crescimento === null
    ? 'sem base segura de comparação com os 30 dias anteriores'
    : `${params.crescimento.toFixed(1).replace('.', ',')}% vs. os 30 dias anteriores`;

  const riskText = params.risks[0]?.descricao || 'não há risco crítico claro neste momento.';
  const actionText = params.actions[0]?.acao || params.opportunities[0]?.acao || 'manter acompanhamento diário de vendas, estoque e remanejamento.';

  return `A operação está com faturamento mensal de ${params.faturamentoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, totalizando ${params.pecasMes.toLocaleString('pt-BR')} peças vendidas no mês. A loja de maior destaque é ${topStore}. O desempenho recente está ${crescimentoTexto}. Principal ponto de atenção: ${riskText} Ação recomendada: ${actionText}`;
}

app.get('/api/painel-diretoria/resumo', async (req, res) => {
  let globalDb: any;
  let annualDb: any;

  try {
    const userId = String(req.query.userId || '').trim();

    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({ success: false, error: 'Usuário não informado.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
    }

    const role = execDashNormalizeText(user.role);
    const canAccess = role === 'ADM' || Boolean(user.isAdmin);

    if (!canAccess) {
      return res.status(403).json({ success: false, error: 'Painel Diretoria disponível apenas para usuários ADM.' });
    }

    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const start30 = execDashAddDays(now, -30);
    const start90 = execDashAddDays(now, -90);
    const startPrevious30 = execDashAddDays(now, -60);
    const endPrevious30 = execDashAddDays(now, -31);

    const storeMap = new Map<string, ExecutiveStoreAgg>();
    const productMap = new Map<string, ExecutiveProductAgg>();
    const seenStores = new Set<string>();
    const seenProducts = new Set<string>();

    const stockRows = await prisma.stock.findMany({
      select: {
        storeName: true,
        cnpj: true,
        productCode: true,
        reference: true,
        description: true,
        category: true,
        quantity: true,
        salePrice: true,
      },
    });

    for (const stock of stockRows) {
      const loja = execDashStoreName(stock);
      const produto = String(stock.description || '').trim() || 'PRODUTO NÃO INFORMADO';
      const referencia = String(stock.reference || stock.productCode || '').trim();
      const categoria = execDashCategory(stock);
      const quantidade = execDashToNumber(stock.quantity);
      const valorVenda = quantidade * execDashToNumber(stock.salePrice);

      const store = execDashGetStore(storeMap, loja);
      store.estoque += quantidade;
      store.valorEstoque += valorVenda;

      const product = execDashGetProduct(productMap, { produto, referencia, categoria });
      product.estoque += quantidade;
      product.valorEstoque += valorVenda;

      if (loja !== 'LOJA NÃO INFORMADA') seenStores.add(loja);
      seenProducts.add(execDashNormalizeKey(referencia) || execDashNormalizeKey(produto));
    }

    const addSale = (row: any) => {
      const date = execDashParseDate(row.data_emissao || row.DATA_EMISSAO || row.data || row.DATA);
      if (!date) return;

      const qty = execDashToNumber(row.qtd_real ?? row.QTD_REAL ?? row.quantidade ?? row.QUANTIDADE ?? row.qtd ?? row.QTD ?? 1);
      if (!qty) return;

      const total = execDashToNumber(row.total_liquido ?? row.TOTAL_LIQUIDO ?? row.valor_total ?? row.VALOR_TOTAL ?? row.total ?? row.TOTAL ?? row.preco ?? row.PRECO ?? 0);
      const loja = execDashStoreName(row);
      const produto = execDashProductLabel(row);
      const referencia = execDashReference(row);
      const categoria = execDashCategory(row);

      const store = execDashGetStore(storeMap, loja);
      const product = execDashGetProduct(productMap, { produto, referencia, categoria });

      if (date >= monthStart && date <= now) {
        store.faturamentoMes += total;
        store.pecasMes += qty;
        product.faturamentoMes += total;
        product.pecasMes += qty;
      }

      if (date >= start30 && date <= now) {
        store.faturamento30 += total;
        product.faturamento30 += total;
      }

      if (date >= startPrevious30 && date <= endPrevious30) {
        store.faturamento30Anterior += total;
      }

      if (date >= start90 && date <= now) {
        store.vendas90 += qty;
        product.vendas90 += qty;
      }
    };

    if (fs.existsSync(GLOBAL_DB_PATH)) {
      globalDb = await open({ filename: GLOBAL_DB_PATH, driver: sqlite3.Database });
      const hasDetailed = await execDashTableExists(globalDb, 'vendas_detalhadas_imei');
      const hasLegacy = await execDashTableExists(globalDb, 'vendas');

      if (hasDetailed) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            nome_fantasia AS loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            quantidade,
            total_liquido
          FROM vendas_detalhadas_imei
        `);
        rows.forEach(addSale);
      } else if (hasLegacy) {
        const rows = await globalDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            NULL AS loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade,
            total_liquido
          FROM vendas
        `);
        rows.forEach(addSale);
      }

      await globalDb.close();
      globalDb = null;
    }

    const annualPath = execDashAnnualDbPath();
    if (fs.existsSync(annualPath)) {
      annualDb = await open({ filename: annualPath, driver: sqlite3.Database });
      const hasRaw = await execDashTableExists(annualDb, 'vendas_anuais_raw');
      const hasAnnual = await execDashTableExists(annualDb, 'vendas_anuais');

      if (hasRaw) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            referencia,
            codigo_produto,
            descricao,
            categoria,
            categoria_real,
            quantidade,
            qtd_real,
            total_liquido,
            cancelado
          FROM vendas_anuais_raw
          WHERE COALESCE(cancelado, 'N') = 'N'
        `);
        rows.forEach(addSale);
      } else if (hasAnnual) {
        const rows = await annualDb.all(`
          SELECT
            data_emissao,
            cnpj_empresa,
            loja,
            familia AS referencia,
            descricao,
            familia AS categoria,
            quantidade,
            total_liquido
          FROM vendas_anuais
        `);
        rows.forEach(addSale);
      }

      await annualDb.close();
      annualDb = null;
    }

    const stores = Array.from(storeMap.values()).map((store) => {
      store.coberturaDias = execDashCalculateCoverage(store.estoque, store.vendas90);
      store.status = execDashStatus(store);
      return store;
    });

    const products = Array.from(productMap.values()).map((product) => {
      product.coberturaDias = execDashCalculateCoverage(product.estoque, product.vendas90);
      return product;
    });

    const faturamentoMes = stores.reduce((sum, item) => sum + item.faturamentoMes, 0);
    const pecasMes = stores.reduce((sum, item) => sum + item.pecasMes, 0);
    const faturamentoUltimos30 = stores.reduce((sum, item) => sum + item.faturamento30, 0);
    const faturamento30Anterior = stores.reduce((sum, item) => sum + item.faturamento30Anterior, 0);
    const vendasUltimos30 = products.reduce((sum, item) => sum + item.pecasMes, 0);
    const estoqueTotal = stores.reduce((sum, item) => sum + item.estoque, 0);
    const valorEstoque = stores.reduce((sum, item) => sum + item.valorEstoque, 0);
    const crescimentoVs30Anterior = faturamento30Anterior > 0
      ? ((faturamentoUltimos30 - faturamento30Anterior) / faturamento30Anterior) * 100
      : null;

    const topStores = stores
      .filter((item) => item.faturamentoMes > 0 || item.estoque > 0)
      .sort((a, b) => b.faturamentoMes - a.faturamentoMes)
      .slice(0, 8);

    const bottomStores = stores
      .filter((item) => item.estoque > 0 || item.pecasMes > 0)
      .sort((a, b) => {
        const statusRank: Record<'critico' | 'atencao' | 'saudavel', number> = { critico: 0, atencao: 1, saudavel: 2 };
        return statusRank[a.status] - statusRank[b.status] || a.faturamentoMes - b.faturamentoMes;
      })
      .slice(0, 8);

    const topProducts = products
      .filter((item) => item.faturamentoMes > 0 || item.vendas90 > 0)
      .sort((a, b) => b.faturamentoMes - a.faturamentoMes || b.pecasMes - a.pecasMes)
      .slice(0, 10);

    const risks: ExecutiveInsight[] = [];
    const opportunities: ExecutiveInsight[] = [];
    const actions: ExecutiveInsight[] = [];

    for (const product of products) {
      if (product.vendas90 > 0 && product.estoque <= 0) {
        risks.push({
          id: `risk-stockout-${risks.length + 1}`,
          tipo: 'risco',
          prioridade: 'critica',
          titulo: 'Produto com venda recente e estoque zerado',
          descricao: `${product.produto} vendeu ${product.vendas90.toLocaleString('pt-BR')} un. nos últimos 90 dias e está sem estoque atual.`,
          acao: 'Priorizar compra ou remanejamento imediato.',
          produto: product.produto,
        });
      } else if (product.coberturaDias !== null && product.coberturaDias <= 7) {
        risks.push({
          id: `risk-coverage-${risks.length + 1}`,
          tipo: 'risco',
          prioridade: 'alta',
          titulo: 'Baixa cobertura de produto',
          descricao: `${product.produto} tem cobertura estimada de ${product.coberturaDias.toFixed(0)} dias.`,
          acao: 'Verificar estoque no CD e lojas com excesso para remanejamento.',
          produto: product.produto,
        });
      } else if (product.estoque >= 20 && product.vendas90 <= 0) {
        opportunities.push({
          id: `opp-slow-${opportunities.length + 1}`,
          tipo: 'oportunidade',
          prioridade: 'media',
          titulo: 'Estoque parado ou baixo giro',
          descricao: `${product.produto} possui ${product.estoque.toLocaleString('pt-BR')} un. em estoque e não teve venda relevante nos últimos 90 dias.`,
          acao: 'Criar ação comercial, revisar preço ou redistribuir para lojas com demanda.',
          produto: product.produto,
        });
      }
    }

    for (const store of stores) {
      if (store.status === 'critico') {
        risks.push({
          id: `risk-store-${risks.length + 1}`,
          tipo: 'risco',
          prioridade: 'alta',
          titulo: 'Loja em atenção operacional',
          descricao: `${store.loja} está com ${store.estoque.toLocaleString('pt-BR')} un. em estoque, ${store.pecasMes.toLocaleString('pt-BR')} peças vendidas no mês e cobertura ${store.coberturaDias === null ? 'sem giro' : `${store.coberturaDias.toFixed(0)} dias`}.`,
          acao: 'Avaliar venda, mix de produtos, ruptura e necessidade de remanejamento.',
          loja: store.loja,
        });
      }
    }

    const suggestedRemapCount = products.filter((product) => {
      return product.coberturaDias !== null && product.coberturaDias <= 15 && product.vendas90 > 0;
    }).length;

    if (suggestedRemapCount > 0) {
      actions.push({
        id: 'action-remap-1',
        tipo: 'acao',
        prioridade: 'alta',
        titulo: 'Remanejamento recomendado',
        descricao: `${suggestedRemapCount.toLocaleString('pt-BR')} produtos apresentam baixa cobertura com venda recente.`,
        acao: 'Abrir o submenu Remanejamento e criar solicitações para os itens críticos.',
      });
    }

    const topStoreName = topStores[0]?.loja;
    if (topStoreName) {
      actions.push({
        id: 'action-top-store-1',
        tipo: 'acao',
        prioridade: 'media',
        titulo: 'Replicar boa performance',
        descricao: `${topStoreName} lidera o faturamento do mês.`,
        acao: 'Comparar mix, estoque e abordagem comercial com lojas em atenção.',
        loja: topStoreName,
      });
    }

    const kpis = {
      faturamentoMes,
      pecasMes,
      ticketMedio: pecasMes > 0 ? faturamentoMes / pecasMes : 0,
      vendasUltimos30,
      faturamentoUltimos30,
      faturamento30Anterior,
      crescimentoVs30Anterior,
      estoqueTotal,
      valorEstoque,
      lojasAtivas: seenStores.size || stores.filter((item) => item.loja !== 'LOJA NÃO INFORMADA').length,
      produtosAtivos: seenProducts.size || products.length,
      alertasCriticos: risks.filter((item) => item.prioridade === 'critica' || item.prioridade === 'alta').length,
      sugestoesRemanejamento: suggestedRemapCount,
    };

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      periodo: {
        mesInicio: execDashDateToIso(monthStart),
        hoje: execDashDateToIso(now),
        ultimos30Inicio: execDashDateToIso(start30),
        ultimos90Inicio: execDashDateToIso(start90),
      },
      kpis,
      topStores,
      bottomStores,
      topProducts,
      risks: risks.slice(0, 10),
      opportunities: opportunities.slice(0, 10),
      actions: actions.slice(0, 10),
      clarkBriefing: execDashCreateBriefing({
        faturamentoMes,
        pecasMes,
        crescimento: crescimentoVs30Anterior,
        topStores,
        risks,
        opportunities,
        actions,
      }),
    });
  } catch (error: any) {
    console.error('Erro /api/painel-diretoria/resumo:', error);

    try {
      if (globalDb) await globalDb.close();
      if (annualDb) await annualDb.close();
    } catch {}

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao montar Painel Diretoria.',
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
app.post(
  '/api/online-prices/analyze',
  uploadOnlinePrices.single('xlsx'),
  async (req: any, res: Response) => {
    return analisarPrecosOnlineController(req, res);
  }
);

app.get(
  '/api/online-prices/report/:fileName',
  async (req: any, res: Response) => {
    return baixarRelatorioPrecosOnlineController(req, res);
  }
);

// ============================================================
// ⚠️ ROTA DO HISTÓRICO ANUAL OTIMIZADA - COM FILTRO DE PERÍODO
// ============================================================
app.get('/sales_anuais', async (req, res) => {
  let db: any;

  try {
    const userId = String(req.query.userId || '');
    const startDateRaw = String(req.query.startDate || '').trim();
    const endDateRaw = String(req.query.endDate || '').trim();

    const securityFilter = await getSalesFilter(userId, 'vendas');

    const isValidIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

    const startDate = isValidIsoDate(startDateRaw) ? startDateRaw : '';
    const endDate = isValidIsoDate(endDateRaw) ? endDateRaw : '';

    let dateFilter = '';

    if (startDate && endDate) {
      dateFilter = ` AND data_emissao >= '${startDate}' AND data_emissao <= '${endDate}' `;
    } else if (startDate) {
      dateFilter = ` AND data_emissao >= '${startDate}' `;
    } else if (endDate) {
      dateFilter = ` AND data_emissao <= '${endDate}' `;
    }

    if (!fs.existsSync(ANUAL_DB_PATH)) {
      return res.json({ sales: [] });
    }

    db = await open({
      filename: ANUAL_DB_PATH,
      driver: sqlite3.Database,
    });

    const query = `
      SELECT
        MIN(data_emissao) as data_emissao,
        cnpj_empresa,
        loja,
        descricao,
        COALESCE(familia, 'OUTROS') as familia,
        COALESCE(regiao, '') as regiao,
        SUM(COALESCE(total_liquido, 0)) as total_liquido,
        SUM(COALESCE(quantidade, 0)) as quantidade
      FROM vendas_anuais
      WHERE ${securityFilter}
        AND data_emissao IS NOT NULL
        ${dateFilter}
      GROUP BY
        cnpj_empresa,
        loja,
        descricao,
        COALESCE(familia, 'OUTROS'),
        COALESCE(regiao, '')
      HAVING ABS(SUM(COALESCE(total_liquido, 0))) > 0.01
          OR ABS(SUM(COALESCE(quantidade, 0))) > 0.001
      ORDER BY data_emissao ASC
    `;

    console.log('🔍 Executando Query de Vendas Anuais:', {
      startDate,
      endDate,
    });

    const salesRaw = await db.all(query);

    return res.json({
      sales: normalizeKeys(salesRaw),
    });
  } catch (e: any) {
    console.error('Erro /sales_anuais:', e);

    return res.status(500).json({
      error: e.message || 'Erro ao buscar vendas anuais.',
    });
  } finally {
    if (db) {
      await db.close().catch(() => undefined);
    }
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
    const month = Number(req.query.month || 0);

    const rows = await buildAnnualStoreCompareRows({ userId, yearA, yearB, month });

    const byYear: Record<number, { venda_total: number; seguro_total: number; venda_qtd: number; seguro_qtd: number }> = {
      [yearA]: { venda_total: 0, seguro_total: 0, venda_qtd: 0, seguro_qtd: 0 },
      [yearB]: { venda_total: 0, seguro_total: 0, venda_qtd: 0, seguro_qtd: 0 },
    };

      for (const row of rows) {
    const ano = Number(row.ano || 0);

    if (!byYear[ano]) {
      byYear[ano] = {
        venda_total: 0,
        seguro_total: 0,
        venda_qtd: 0,
        seguro_qtd: 0,
      };
    }

  const item = byYear[ano];

  item.venda_total += Number(row.venda_total || 0);
  item.venda_qtd += Number(row.venda_qtd || 0);
  item.seguro_total += Number(row.seguro_total || 0);
  item.seguro_qtd += Number(row.seguro_qtd || 0);
}

    res.json({
      yearA,
      yearB,
      month,
      a: byYear[yearA] || { venda_total: 0, seguro_total: 0, venda_qtd: 0, seguro_qtd: 0 },
      b: byYear[yearB] || { venda_total: 0, seguro_total: 0, venda_qtd: 0, seguro_qtd: 0 },
    });
  } catch (e: any) {
    console.error('Erro /anuais/summary:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/anuais/lojas_compare', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const yearA = Number(req.query.yearA || 2025);
    const yearB = Number(req.query.yearB || 2026);
    const month = Number(req.query.month || 0);

    const rows = await buildAnnualStoreCompareRows({ userId, yearA, yearB, month });

    res.json({
      yearA,
      yearB,
      month,
      data: annualLowerRows(rows),
    });
  } catch (e: any) {
    console.error('Erro /anuais/lojas_compare:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/anuais/vendedores_compare', async (req, res) => {
  let db: any;

  try {
    const userId = String(req.query.userId || '');
    const yearA = Number(req.query.yearA || 2025);
    const yearB = Number(req.query.yearB || 2026);
    const month = Number(req.query.month || 0);
    const store = req.query.store ? annualNorm(req.query.store) : '';

    if (!fs.existsSync(ANUAL_DB_PATH)) {
      return res.json({ yearA, yearB, month, store, data: [] });
    }

    const securityFilter = await getSalesFilter(userId, 'vendas');
    const monthFilter = month >= 1 && month <= 12 ? ` AND mes = ${Number(month)} ` : '';
    const storeFilter = store ? ` AND UPPER(loja) = '${annualSqlText(store)}' ` : '';

    db = await open({ filename: ANUAL_DB_PATH, driver: sqlite3.Database });

    const hasAgg = await annualTableExists(db, 'agg_vendedores_mensal');
    const hasRaw = await annualTableExists(db, 'vendas_anuais_raw');

    let rows: any[] = [];

    if (hasAgg) {
      rows = await db.all(`
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
      `);
    }

    const hasUsefulAgg = rows.some((row: any) => annualNumber(row.venda_total) !== 0 || annualNumber(row.seguro_total) !== 0);

    if (!hasUsefulAgg && hasRaw) {
      rows = await db.all(`
        SELECT
          ano,
          mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA') AS loja,
          COALESCE(cnpj_empresa, '') AS cnpj_empresa,
          COALESCE(NULLIF(regiao, ''), '') AS regiao,
          COALESCE(NULLIF(nome_vendedor, ''), 'VENDEDOR NÃO INFORMADO') AS vendedor,
          SUM(COALESCE(total_real, total_liquido, 0)) AS venda_total,
          SUM(COALESCE(qtd_real, quantidade, 0)) AS venda_qtd,
          SUM(
            CASE
              WHEN UPPER(COALESCE(categoria_real, categoria, descricao, '')) LIKE '%SEGURO%'
                OR UPPER(COALESCE(descricao, '')) LIKE '%SEGURO%'
              THEN COALESCE(total_real, total_liquido, 0)
              ELSE 0
            END
          ) AS seguro_total,
          SUM(
            CASE
              WHEN UPPER(COALESCE(categoria_real, categoria, descricao, '')) LIKE '%SEGURO%'
                OR UPPER(COALESCE(descricao, '')) LIKE '%SEGURO%'
              THEN COALESCE(qtd_real, quantidade, 0)
              ELSE 0
            END
          ) AS seguro_qtd
        FROM vendas_anuais_raw
        WHERE ${securityFilter}
          AND ano IN (${yearA}, ${yearB})
          ${monthFilter}
          ${storeFilter}
        GROUP BY
          ano,
          mes,
          COALESCE(NULLIF(loja, ''), cnpj_empresa, 'LOJA NÃO INFORMADA'),
          COALESCE(cnpj_empresa, ''),
          COALESCE(NULLIF(regiao, ''), ''),
          COALESCE(NULLIF(nome_vendedor, ''), 'VENDEDOR NÃO INFORMADO')
        ORDER BY vendedor ASC, loja ASC, ano ASC
      `);
    }

    return res.json({
      yearA,
      yearB,
      month,
      store,
      data: annualLowerRows(rows).map((row: any) => {
        const loja = annualStoreNameFromRow(row);

        return {
          ...row,
          loja,
          regiao: annualRegionFromStore(loja, row.regiao),
        };
      }),
    });
  } catch (e: any) {
    console.error('Erro /anuais/vendedores_compare:', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (db) await db.close().catch(() => undefined);
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

 async function ensureRhCollaboratorExists(params: {
  id: string;
  name: string;
  store: string;
}) {
  const requestedId = String(params.id || '').trim();

  const name = String(params.name || requestedId)
    .replace(/\s+/g, ' ')
    .trim();

  const storeName = String(params.store || 'LOJA NÃO INFORMADA')
    .replace(/\s+/g, ' ')
    .trim();

  if (!requestedId) {
    throw new Error('ID do colaborador não informado.');
  }

  if (!name) {
    throw new Error('Nome do colaborador não informado.');
  }

  if (!storeName) {
    throw new Error('Loja do colaborador não informada.');
  }

  // 1. Primeiro tenta achar pelo ID que veio do frontend
  const existingById = await prisma.rhCollaborator.findUnique({
    where: { id: requestedId },
  });

  if (existingById) {
    return prisma.rhCollaborator.update({
      where: { id: existingById.id },
      data: {
        name,
        storeName,
        active: true,
      },
    });
  }

  // 2. Depois tenta achar pela chave única do Prisma: name + storeName
  const existingByNameStore = await prisma.rhCollaborator.findUnique({
    where: {
      name_storeName: {
        name,
        storeName,
      },
    },
  });

  if (existingByNameStore) {
    return prisma.rhCollaborator.update({
      where: { id: existingByNameStore.id },
      data: {
        name,
        storeName,
        active: true,
      },
    });
  }

  // 3. Se não existir, cria com o ID enviado pelo frontend
  return prisma.rhCollaborator.create({
    data: {
      id: requestedId,
      name,
      storeName,
      active: true,
    },
  });
} 

// ==========================================
// ROTAS DO BACKEND PARA DOCUMENTAÇÃO RH
// ==========================================

const RH_UPLOAD_DIR = process.env.RENDER
  ? '/var/data/uploads/rh'
  : path.join(ROOT_DIR, 'uploads', 'rh');

if (!fs.existsSync(RH_UPLOAD_DIR)) {
  fs.mkdirSync(RH_UPLOAD_DIR, { recursive: true });
}

// ==========================================
// HELPERS RH
// ==========================================

function normalizeRhText(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bSSG\b/g, '')
    .replace(/\bSAMSUNG\b/g, '')
    .replace(/\bLOJA\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function makeRhCollaboratorSlug(storeName: any, collaboratorName: any): string {
  return `${normalizeRhText(storeName)}-${normalizeRhText(collaboratorName)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function resolveRhPhysicalFile(fileNameOnDisk: string | null | undefined): string | null {
  if (!fileNameOnDisk) return null;

  const candidates = [
    path.join(RH_UPLOAD_DIR, fileNameOnDisk),
    path.join(ROOT_DIR, 'uploads', 'rh', fileNameOnDisk),
    path.join(process.cwd(), 'uploads', 'rh', fileNameOnDisk),
    path.join(__dirname, '..', 'uploads', 'rh', fileNameOnDisk),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function findRhDocumentSafe(params: {
  collaboratorId: string;
  docType: string;
}) {
  const collaboratorId = String(params.collaboratorId || '').trim();
  const docType = String(params.docType || '').trim();

  if (!collaboratorId || !docType) return null;

  const direct = await prisma.rhDocument.findUnique({
    where: {
      collaboratorId_documentType: {
        collaboratorId,
        documentType: docType,
      },
    },
    include: {
      collaborator: true,
    },
  });

  if (direct) return direct;

  const docs = await prisma.rhDocument.findMany({
    where: {
      documentType: docType,
    },
    include: {
      collaborator: true,
    },
  });

  return (
    docs.find((doc) => {
      const slug = makeRhCollaboratorSlug(
        doc.collaborator?.storeName,
        doc.collaborator?.name
      );

      return slug === collaboratorId;
    }) || null
  );
}

// ==========================================
// NOTIFICAR LOJA SOBRE PENDÊNCIAS
// ==========================================

app.post('/api/rh/notificar-pendencias', async (req, res) => {
  const { loja, mensagem } = req.body;

  try {
    if (!loja || !mensagem) {
      return res.status(400).json({
        success: false,
        error: 'Loja e mensagem são obrigatórios.',
      });
    }

    const storeUsers = await prisma.user.findMany({
      where: {
        OR: [
          { operation: String(loja) },
          { department: String(loja) },
          { allowedStores: { contains: String(loja) } },
        ],
      },
    });

    if (storeUsers.length > 0) {
      await prisma.notification.createMany({
        data: storeUsers.map((user) => ({
          userId: user.id,
          text: String(mensagem),
          read: false,
        })),
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notificação criada com sucesso.',
      totalNotificados: storeUsers.length,
    });
  } catch (error: any) {
    console.error('Erro na rota de notificar loja:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao notificar loja.',
    });
  }
});

// ==========================================
// CONFIGURAÇÃO DE UPLOAD DOS DOCUMENTOS RH
// ==========================================

const rhStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, RH_UPLOAD_DIR);
  },

  filename: (req, file, cb) => {
    const collaboratorId = String(req.params.collaboratorId || 'colaborador')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_');

    const documentType = String(req.params.documentType || 'documento')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_');

    const safeOriginalName = file.originalname
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_');

    cb(null, `${Date.now()}-${collaboratorId}-${documentType}-${safeOriginalName}`);
  },
});

const uploadRhDocument = multer({
  storage: rhStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

// ==========================================
// ENVIAR DOCUMENTO DO COLABORADOR
// ==========================================

app.post(
  '/api/rh/colaboradores/:collaboratorId/documentos/:documentType',
  uploadRhDocument.single('file'),
  async (req: any, res) => {
    try {
      const { collaboratorId, documentType } = req.params;
      const file = req.file;

      if (!collaboratorId || !documentType) {
        return res.status(400).json({
          success: false,
          error: 'Colaborador e tipo de documento são obrigatórios.',
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Nenhum arquivo enviado.',
        });
      }

      const rawStoreName = String(req.body.storeName || req.body.loja || '').trim();

      const rawCollaboratorName = String(
        req.body.collaboratorName || req.body.nome || ''
      ).trim();

      const collaborator = await ensureRhCollaboratorExists({
        id: String(collaboratorId),
        name: rawCollaboratorName || String(collaboratorId),
        store: rawStoreName || 'LOJA NÃO INFORMADA',
      });

      const dbCollaboratorId = collaborator.id;
      const fileUrl = `/uploads/rh/${file.filename}`;

      const savedDocument = await prisma.rhDocument.upsert({
        where: {
          collaboratorId_documentType: {
            collaboratorId: dbCollaboratorId,
            documentType: String(documentType),
          },
        },
        update: {
          status: 'ENVIADO',
          fileName: file.originalname,
          originalName: file.originalname,
          filePath: file.filename,
          fileUrl,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: req.body.userId ? String(req.body.userId) : null,
          uploadedByName: req.body.userName ? String(req.body.userName) : null,
          uploadedAt: new Date(),
        },
        create: {
          collaboratorId: dbCollaboratorId,
          documentType: String(documentType),
          status: 'ENVIADO',
          fileName: file.originalname,
          originalName: file.originalname,
          filePath: file.filename,
          fileUrl,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: req.body.userId ? String(req.body.userId) : null,
          uploadedByName: req.body.userName ? String(req.body.userName) : null,
          uploadedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        message: 'Documento enviado com sucesso.',
        collaboratorId: dbCollaboratorId,
        documentId: savedDocument.id,
        documentType: savedDocument.documentType,
        status: savedDocument.status,
        fileName: savedDocument.fileName,
        originalName: savedDocument.originalName,
        filePath: savedDocument.filePath,
        url: savedDocument.fileUrl,
      });
    } catch (error: any) {
      console.error('Erro ao enviar documento RH:', error);

      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao enviar documento RH.',
      });
    }
  }
);

// ==========================================
// BAIXAR DOCUMENTO RH
// ==========================================

app.get('/api/rh/baixar-documento', async (req, res) => {
  try {
    const collaboratorId = String(req.query.collaboratorId || '').trim();
    const docType = String(req.query.docType || '').trim();

    if (!collaboratorId || !docType) {
      return res.status(400).json({
        success: false,
        error: 'Colaborador e tipo de documento são obrigatórios.',
      });
    }

    const document = await findRhDocumentSafe({
      collaboratorId,
      docType,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado no banco.',
      });
    }

    const fullPath = resolveRhPhysicalFile(document.filePath || document.fileName);

    if (!fullPath) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo físico não encontrado na pasta de uploads.',
        filePath: path.join(RH_UPLOAD_DIR, document.filePath || document.fileName || ''),
      });
    }

    return res.download(
      fullPath,
      document.originalName || document.fileName || document.filePath || 'documento-rh'
    );
  } catch (error: any) {
    console.error('Erro ao baixar documento RH:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao baixar documento RH.',
    });
  }
});

// ==========================================
// INVALIDAR / RECUSAR DOCUMENTO RH
// Ao recusar, remove arquivo local e apaga o registro do banco.
// Se já foi removido, retorna sucesso para não travar a tela.
// ==========================================

app.post('/api/rh/invalidar-documento', async (req, res) => {
  const { collaboratorId, docType } = req.body;

  try {
    if (!collaboratorId || !docType) {
      return res.status(400).json({
        success: false,
        error: 'Colaborador e tipo de documento são obrigatórios.',
      });
    }

    const document = await findRhDocumentSafe({
      collaboratorId: String(collaboratorId),
      docType: String(docType),
    });

    // Idempotente: se não existe mais, considera como já removido.
    // Isso evita erro quando o usuário clica duas vezes ou a tela ficou desatualizada.
    if (!document) {
      return res.json({
        success: true,
        alreadyRemoved: true,
        message: 'Documento já estava removido.',
      });
    }

    const fullPath = resolveRhPhysicalFile(
      document.filePath || document.fileName
    );

    if (fullPath && fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`🗑️ Arquivo RH excluído: ${fullPath}`);
      } catch (fileError) {
        console.warn('⚠️ Não consegui excluir arquivo físico RH:', fileError);
      }
    }

    await prisma.rhDocument.delete({
      where: {
        id: document.id,
      },
    });

    return res.json({
      success: true,
      message: 'Documento recusado e excluído com sucesso.',
      deletedDocumentId: document.id,
    });
  } catch (error: any) {
    console.error('Erro ao recusar/excluir documento RH:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao recusar/excluir documento RH.',
    });
  }
});

// ==========================================
// VALIDAR DOCUMENTO E ENVIAR PARA O GOOGLE DRIVE
// ==========================================

app.post('/api/rh/validar-documento', async (req, res) => {
  const { collaboratorId, docType, storeName, collaboratorName } = req.body;

  try {
    if (!collaboratorId || !docType || !storeName || !collaboratorName) {
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios ausentes para validar documento.',
        required: ['collaboratorId', 'docType', 'storeName', 'collaboratorName'],
      });
    }

    const document = await findRhDocumentSafe({
      collaboratorId: String(collaboratorId),
      docType: String(docType),
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento não encontrado no banco para validação.',
      });
    }

    const fullPath = resolveRhPhysicalFile(document.filePath || document.fileName);

    if (!fullPath) {
      return res.status(404).json({
        success: false,
        error: 'Arquivo físico não encontrado no servidor.',
        path: path.join(RH_UPLOAD_DIR, document.filePath || document.fileName || ''),
      });
    }

    const mesAtual = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
    })
      .format(new Date())
      .toUpperCase();

    const monthId = await getOrCreateFolder(mesAtual, ROOT_FOLDER_ID);
    const storeId = await getOrCreateFolder(String(storeName), monthId);
    const collabId = await getOrCreateFolder(String(collaboratorName), storeId);

    const driveUpload = await drive.files.create({
      requestBody: {
        name: document.originalName || document.fileName || document.filePath || 'documento-rh',
        parents: [collabId],
      },
      media: {
        mimeType: document.mimeType || 'application/octet-stream',
        body: fs.createReadStream(fullPath),
      },
      fields: 'id, name, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    await prisma.rhDocument.update({
      where: {
        id: document.id,
      },
      data: {
        status: 'VALIDADO',
      },
    });

    return res.json({
      success: true,
      message: 'Documento validado e enviado para o Google Drive.',
      driveFileId: driveUpload.data.id,
      driveFileName: driveUpload.data.name,
      driveViewLink: driveUpload.data.webViewLink,
      driveDownloadLink: driveUpload.data.webContentLink,
    });
  } catch (error: any) {
    console.error('Erro ao validar e subir para o Drive:', error);

    const message = String(error?.message || '');

    if (message.includes('Service Accounts do not have storage quota')) {
      return res.status(500).json({
        success: false,
        error:
          'A conta de serviço do Google não tem cota de armazenamento. Use uma pasta dentro de um Drive compartilhado ou troque para OAuth com uma conta Google real.',
      });
    }

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao validar e subir para o Drive.',
    });
  }
});

// ==========================================
// EXCLUIR COLABORADOR RH
// ==========================================

app.delete('/api/rh/colaboradores/:collaboratorId', async (req, res) => {
  try {
    const collaboratorId = String(req.params.collaboratorId || '').trim();

    if (!collaboratorId) {
      return res.status(400).json({
        success: false,
        error: 'ID do colaborador não informado.',
      });
    }

    let collaborator = await prisma.rhCollaborator.findUnique({
      where: {
        id: collaboratorId,
      },
      include: {
        documents: true,
      },
    });

    if (!collaborator) {
      const allCollaborators = await prisma.rhCollaborator.findMany({
        include: {
          documents: true,
        },
      });

      collaborator =
        allCollaborators.find((item) => {
          const slug = makeRhCollaboratorSlug(item.storeName, item.name);
          return slug === collaboratorId;
        }) || null;
    }

    if (!collaborator) {
      return res.status(404).json({
        success: false,
        error: 'Colaborador não encontrado.',
      });
    }

    for (const doc of collaborator.documents) {
      const fullPath = resolveRhPhysicalFile(doc.filePath || doc.fileName);

      if (fullPath && fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (fileError) {
          console.warn('Não consegui excluir arquivo físico RH:', fileError);
        }
      }
    }

    await prisma.rhCollaborator.delete({
      where: {
        id: collaborator.id,
      },
    });

    return res.json({
      success: true,
      message: 'Colaborador excluído com sucesso.',
      deletedId: collaborator.id,
    });
  } catch (error: any) {
    console.error('Erro ao excluir colaborador RH:', error);

    return res.status(500).json({
      success: false,
      error: error?.message || 'Erro ao excluir colaborador.',
    });
  }
});

// ROTA CLARK ANALISTA DE PREÇOS ONLINE ///

app.post(
  '/api/online-prices/analyze',
  uploadOnlinePrices.single('xlsx'),
  async (req: any, res) => {
    return analisarPrecosOnlineController(req, res);
  }
);

app.get(
  '/api/online-prices/report/:fileName',
  async (req: any, res) => {
    return baixarRelatorioPrecosOnlineController(req, res);
  }
);


// Define a porta: Usa a do Render (process.env.PORT) ou a 3000 se for local
const PORT = process.env.PORT || 3000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ SERVIDOR RODANDO NA PORTA ${PORT}`);
});

