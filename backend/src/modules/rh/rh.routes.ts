import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

const ROOT_DIR = process.cwd();
const RH_UPLOAD_DIR = path.join(ROOT_DIR, 'uploads', 'rh');

const DOCUMENT_TYPES = new Set([
  'vale_transporte',
  'vale_alimentacao',
  'folha_ponto',
  'documentos_gerais',
]);

const INITIAL_RH_COLLABORATORS: Array<{ loja: string; nome: string }> = [
  {
    "loja": "UBERLÂNDIA",
    "nome": "MARIANA MARQUES FERREIRA"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "FERNANDA ALVES GARCIA"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "PEDRO HENRIQUE QUEIROZ ARAUJO"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "HELENA MARIA LIMA FREITAS"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "PATRICIA RENATA AOKI"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "LUCAS FERNANDO SANTOS DA SILVA"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "JHONATAS AMARAL CARVALHO"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "MATHEUS LIRA LEAL"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "DIEGO DE ASSIS BLANDIM"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "EVERTON CARVALHO DE SOUZA"
  },
  {
    "loja": "UBERABA",
    "nome": "THAMYRES GONCALVES RODRIGUES DE ANDRADE"
  },
  {
    "loja": "UBERABA",
    "nome": "SCARLLET ROSENDO CAVALCANTE"
  },
  {
    "loja": "UBERABA",
    "nome": "JEANDERSON MORAIS DOS SANTOS"
  },
  {
    "loja": "UBERABA",
    "nome": "DANIEL SANTOS FERREIRA"
  },
  {
    "loja": "UBERABA",
    "nome": "EVELLYN VICTORIA DOS SANTOS"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "BIANCA CAMARA LIMA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "VITORIA DOS SANTOS MELO"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "MATHEUS FERNANDO RODRIGUES DE SOUZA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "THAIS DE JESUS MENEZES"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "VANESSA CRISTINA LISBOA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "ARTUR CAMARGO REMIGIO"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "EVANDRO DE SOUZA"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "ALAN BATISTA DOS SANTOS"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "LUA RODRIGUES DE SOUSA"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "JANINE SILVA DORNELAS"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "CESAR AUGUSTO VIEIRA DE SOUSA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "CARLOS ALBERTO SOUZA SILVA JUNIOR"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "JHONATA LIMA DA SILVA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "DANIELE DA SILVA GONZAGA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "JOAO PAULO VALE TORRES"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "CRISTIANO SOARES SILVA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "ADRIANE MUNIZ SILVA"
  },
  {
    "loja": "PATIO BRASIL",
    "nome": "HYAN ALVES CARVALHO"
  },
  {
    "loja": "PATIO BRASIL",
    "nome": "MARCUS VINICIUS DA COSTA LOPES"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "RANIELE FERNANDES DE SOUZA"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "WALISSON ARAUJO PIRES"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "GUILHERME AZEVEDO COSTA"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "THALISSON DE SOUSA PAULO"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "LUCAS GUILHERME DE BRITO FERREIRA"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "ANA PAULA QUEIROZ"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "VINICIUS LUIZ OLIVEIRA BRITO"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "MATHEUS INACIO DINIZ DA SILVA"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "MATHEUS CAVALCANTE SANTOS OLIVEIRA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "ALESSANDRO TOLENTINO VIEIRA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "NAIR MENDES DA SILVA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "RODRIGO GOMES ARANHA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "JUAN GONÇALVES DIAS"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "MARCUS VINICIUS NOVAES SOUZA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "THIAGO CABRAL MARTINS"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "LUIZ FERNANDO MOREIRA DA SILVA"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "DENILSON DA MOTA DE SOUSA"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "MAYLLA SANTOS GOMES"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "VICTOR DO NASCIMENTO GERMANO"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "HENRIQUE MARDOCHEU PERIM GUIMARAES"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "ARMANDO BERNARDES DUARTE"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "Gustavo Pereira da Silva"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "Maria Eduarda Bomfim de Sales"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "AURELIEN LOPES DE FARIAS"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "WELLINGTON GOMES DA SILVA"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "HENRIQUE JUNIO FIGUEIREDO CATALDI"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "ANDERSON DA COSTA SILVA"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "MARCELO FELIX DOS SANTOS"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "JORGE HENRIQUE MARTINS SANTOS CHAVES"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "SILVIO PITA HIPPERTT"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "DANIEL ALVES DE SOUZA"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "DIONATA SILVA QUEIROZ FERNANDES"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "HELIO GEOVANE PEREIRA DE ARAUJO"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "GUSTAVO SANTANA DOS SANTOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "ANTONIO LUCAS SILVA CARVALHO"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "ANDERSON ALVES CAMPOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "EDUARDO OLIVEIRA LEMOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "RYAN MESQUITA SILVA"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "ERICK SULLIVAN CATÚLIO DOS SANTOS"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "JOSE HENRIQUE FERNANDES NERIS"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "VITOR GABRIEL BASILIO VIEIRA"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "HALAN ARAUJO FEITOSA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "ELCIAS EBER GOMES DA SILVA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "MARIA APARECIDA DA CRUZ"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "LUCAS DA SILVA FERREIRA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "FABIO MARTINS CRUZ DOS SANTOS"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ANA CLARA GONÇALVES DE ALMEIDA"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ARTHUR SANTOS ABREU"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "EDUARDO ALVES MARINHO"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ITALO GUSTAVO BASILIO VIEIRA"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "LUCAS FELISBERTO PEREIRA"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "HEITOR ROBERTO VILELA GIELOW"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "ANA VITORIA DINIZ DOS ANJOS"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "REVILTON DA SILVA"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "DJHON MAICON DA PAIXAO SANTOS"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "Lucas Eduardo Dos Santos Lauriano"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "DAVI BARROS DA SILVA"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "HELDER LOPES BARBOSA SANTANA"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "JOAO VICTOR DA SILVA GOMES"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "WILLIAN GABRIEL VIEIRA DA SILVA"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "EDUARDO CARVALHO VIANA"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "JOSE VITOR GOMES DE MORAIS"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "YURE MOREIRA DA SILVA SANTOS"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "VITOR HUGO DE JESUS ROCHA"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "LUANA DA SILVA PEREIRA"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "BRUNO MARQUES A. BARBOSA NASCIMENTO"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "FERNANDA DE SOUZA CAMELO CALDAS"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "JENNIFFER DE ASSIS FAUSTINO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "POLLYANNA MARIA DE ALMEIDA PERNAMBUCO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "ELTON JOSE DA SILVA PINO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "WIBSON DA SILVA CAVALCANTE"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "MIRELA MARIA EZAQUIEL DA SILVA"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "JOSIVAN RODRIGUES DE FRANÇA"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "ZELIO MARCOLINO RICARDO"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "Luis Felipe da Silva Freitas"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "Thales Eduardo de Souza Mostre"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "VIVIANE LAYS DA SILVA CASTRO"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "CARLA ISABEL DE OLIVEIRA VIEIRA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "LIGIANE RODRIGUES DE SOUSA TEMOTEO"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "FRANCISCO ALISSON RODRIGUES LIMA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "JIM MORRISON OLIVEIRA ALLEN MAIA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "JOÃO BATISTA DA SILVA FILHO"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "FRANCISCO LUCIO DE FREITAS SANTOS"
  }
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function sanitizeFilename(value: string): string {
  const ext = path.extname(value || '').toLowerCase();
  const base = path.basename(value || 'arquivo', ext);

  const safeBase = normalizeText(base)
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'ARQUIVO';

  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeBase}${ext}`;
}

async function ensureInitialRhCollaborators() {
  const count = await prisma.rhCollaborator.count();
  if (count > 0) return;

  for (const item of INITIAL_RH_COLLABORATORS) {
    const name = String(item.nome || '').trim();
    const storeName = String(item.loja || '').trim();

    if (!name || !storeName) {
      continue;
    }

    await prisma.rhCollaborator.upsert({
      where: {
        name_storeName: {
          name,
          storeName,
        },
      },
      update: {},
      create: {
        name,
        storeName,
      },
    });
  }
}

async function getCurrentUser(req: Request) {
  const headerUserId = String(req.headers['x-user-id'] || '').trim();
  const queryUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const userId = headerUserId || queryUserId || bodyUserId;

  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
  });
}

function isAdminRhUser(user: any): boolean {
  const role = normalizeText(user?.role);
  return Boolean(user?.isAdmin) || ['CEO', 'DIRETOR', 'ADM'].includes(role);
}

function isStoreUser(user: any): boolean {
  return normalizeText(user?.role) === 'LOJA';
}

function getUserStores(user: any): string[] {
  const values = [
    user?.allowedStores,
    user?.operation,
    user?.name,
  ];

  return values
    .flatMap((value) => String(value || '').split(','))
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function canStoreAccessCollaborator(user: any, collaborator: { storeName: string }): boolean {
  if (!isStoreUser(user)) return true;

  const userStores = getUserStores(user);
  const collaboratorStore = normalizeText(collaborator.storeName);

  return userStores.includes(collaboratorStore);
}

function getFileUrl(req: Request, relativePath: string): string {
  const host = req.get('host');
  const protocol = req.protocol;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^uploads\//, '');
  return `${protocol}://${host}/uploads/${normalized}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const dir = path.join(RH_UPLOAD_DIR, year, month);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, sanitizeFilename(file.originalname));
  },
});

const uploadRhDocument = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);

    if (allowedMimes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Tipo de arquivo inválido. Envie PDF ou imagem.'));
  },
});

function buildEmptyDocs() {
  return {
    vale_transporte: { status: 'pendente' },
    vale_alimentacao: { status: 'pendente' },
    folha_ponto: { status: 'pendente' },
    documentos_gerais: { status: 'pendente' },
  };
}

function mapCollaboratorToFrontend(collaborator: any) {
  const docs: any = buildEmptyDocs();

  for (const doc of collaborator.documents || []) {
    docs[doc.documentType] = {
      status: 'enviado',
      fileName: doc.originalName || doc.fileName,
      uploadedAt: doc.uploadedAt,
      url: doc.fileUrl,
    };
  }

  return {
    id: collaborator.id,
    loja: collaborator.storeName,
    nome: collaborator.name,
    docs,
  };
}

router.get('/colaboradores', async (req: Request, res: Response) => {
  try {
    await ensureInitialRhCollaborators();

    const user = await getCurrentUser(req);
    const where: any = { active: true };

    if (isStoreUser(user)) {
      const stores = getUserStores(user);

      if (stores.length === 0) {
        return res.json([]);
      }

      const allCollaborators = await prisma.rhCollaborator.findMany({
        where,
        include: { documents: true },
        orderBy: [{ storeName: 'asc' }, { name: 'asc' }],
      });

      return res.json(
        allCollaborators
          .filter((collaborator) => stores.includes(normalizeText(collaborator.storeName)))
          .map(mapCollaboratorToFrontend)
      );
    }

    const collaborators = await prisma.rhCollaborator.findMany({
      where,
      include: { documents: true },
      orderBy: [{ storeName: 'asc' }, { name: 'asc' }],
    });

    return res.json(collaborators.map(mapCollaboratorToFrontend));
  } catch (error: any) {
    console.error('Erro GET /api/rh/colaboradores:', error);
    return res.status(500).json({ error: error.message || 'Erro ao listar colaboradores do RH.' });
  }
});

router.patch('/colaboradores/:id/loja', async (req: Request, res: Response) => {
  try {
    const collaboratorId = String(req.params.id || '').trim();

    if (!collaboratorId) {
      return res.status(400).json({ error: 'ID do colaborador não informado.' });
    }

    const user = await getCurrentUser(req);

    if (!isAdminRhUser(user)) {
      return res.status(403).json({ error: 'Apenas administradores podem mover colaboradores.' });
    }

    const loja = String(req.body?.loja || '').trim();

    if (!loja) {
      return res.status(400).json({ error: 'Informe a loja de destino.' });
    }

    const collaborator = await prisma.rhCollaborator.update({
      where: { id: collaboratorId },
      data: { storeName: loja },
      include: { documents: true },
    });

    return res.json(mapCollaboratorToFrontend(collaborator));
  } catch (error: any) {
    console.error('Erro PATCH /api/rh/colaboradores/:id/loja:', error);
    return res.status(500).json({ error: error.message || 'Erro ao mover colaborador.' });
  }
});

router.delete('/colaboradores/:id', async (req: Request, res: Response) => {
  try {
    const collaboratorId = String(req.params.id || '').trim();

    if (!collaboratorId) {
      return res.status(400).json({ error: 'ID do colaborador não informado.' });
    }

    const user = await getCurrentUser(req);

    if (!isAdminRhUser(user)) {
      return res.status(403).json({ error: 'Apenas administradores podem excluir colaboradores.' });
    }

    await prisma.rhCollaborator.update({
      where: { id: collaboratorId },
      data: { active: false },
    });

    return res.json({ ok: true });
  } catch (error: any) {
    console.error('Erro DELETE /api/rh/colaboradores/:id:', error);
    return res.status(500).json({ error: error.message || 'Erro ao excluir colaborador.' });
  }
});

router.post(
  '/colaboradores/:id/documentos/:documentType',
  uploadRhDocument.single('file'),
  async (req: Request, res: Response) => {
    try {
      const collaboratorId = String(req.params.id || '').trim();
      const documentType = String(req.params.documentType || '').trim();

      if (!collaboratorId) {
        return res.status(400).json({ error: 'ID do colaborador não informado.' });
      }

      const user = await getCurrentUser(req);

      if (!DOCUMENT_TYPES.has(documentType)) {
        return res.status(400).json({ error: 'Tipo de documento inválido.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Arquivo não enviado.' });
      }

      const collaborator = await prisma.rhCollaborator.findUnique({
        where: { id: collaboratorId },
      });

      if (!collaborator || !collaborator.active) {
        return res.status(404).json({ error: 'Colaborador não encontrado.' });
      }

      if (!canStoreAccessCollaborator(user, collaborator)) {
        return res.status(403).json({ error: 'Essa loja não pode enviar documentos desse colaborador.' });
      }

      const relativePath = path.relative(path.join(ROOT_DIR, 'uploads'), req.file.path).replace(/\\/g, '/');
      const fileUrl = getFileUrl(req, relativePath);

      const previousDocument = await prisma.rhDocument.findUnique({
        where: {
          collaboratorId_documentType: {
            collaboratorId: collaborator.id,
            documentType,
          },
        },
      });

      const document = await prisma.rhDocument.upsert({
        where: {
          collaboratorId_documentType: {
            collaboratorId: collaborator.id,
            documentType,
          },
        },
        create: {
          collaboratorId: collaborator.id,
          documentType,
          fileName: req.file.filename,
          originalName: req.file.originalname,
          filePath: relativePath,
          fileUrl,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          uploadedById: user?.id || null,
          uploadedByName: user?.name || null,
          status: 'VALIDADO',
        },
        update: {
          fileName: req.file.filename,
          originalName: req.file.originalname,
          filePath: relativePath,
          fileUrl,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          uploadedById: user?.id || null,
          uploadedByName: user?.name || null,
          uploadedAt: new Date(),
          status: 'VALIDADO',
        },
      });

      if (previousDocument?.filePath && previousDocument.filePath !== relativePath) {
        const previousPath = path.join(ROOT_DIR, 'uploads', previousDocument.filePath);
        fs.promises.unlink(previousPath).catch(() => undefined);
      }

      return res.json({
        ok: true,
        url: document.fileUrl,
        document: {
          id: document.id,
          documentType: document.documentType,
          fileName: document.originalName || document.fileName,
          uploadedAt: document.uploadedAt,
          url: document.fileUrl,
          status: 'enviado',
        },
      });
    } catch (error: any) {
      console.error('Erro POST /api/rh/colaboradores/:id/documentos/:documentType:', error);
      return res.status(500).json({ error: error.message || 'Erro ao enviar documento.' });
    }
  }
);

router.post('/notificar-pendencias', async (req: Request, res: Response) => {
  try {
    const user = await getCurrentUser(req);

    if (!isAdminRhUser(user)) {
      return res.status(403).json({ error: 'Apenas administradores podem avisar lojas.' });
    }

    const loja = String(req.body?.loja || '').trim();
    const mensagem = String(req.body?.mensagem || '').trim();

    if (!loja || !mensagem) {
      return res.status(400).json({ error: 'Informe loja e mensagem.' });
    }

    const normalizedStore = normalizeText(loja);
    const users = await prisma.user.findMany({
      where: { role: 'LOJA', status: 'active' },
    });

    const targetUsers = users.filter((targetUser) => getUserStores(targetUser).includes(normalizedStore));

    for (const targetUser of targetUsers) {
      await prisma.notification.create({
        data: {
          userId: targetUser.id,
          text: mensagem,
        },
      });
    }

    return res.json({
      ok: true,
      notifiedUsers: targetUsers.length,
    });
  } catch (error: any) {
    console.error('Erro POST /api/rh/notificar-pendencias:', error);
    return res.status(500).json({ error: error.message || 'Erro ao avisar loja.' });
  }
});

export default router;
