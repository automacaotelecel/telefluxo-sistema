import express, { Request, Response } from 'express';
import cors from 'cors'; 
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import crypto from 'crypto'; 
import csv from 'csv-parser';

const app = express();
const prisma = new PrismaClient();

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

app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static('uploads'));

// ==========================================
// 1. SISTEMA OPERACIONAL (USUÁRIOS E LOGIN)
// ==========================================

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findFirst({
            where: { email: String(email).trim(), password: String(password).trim() },
            include: { manager: true, staff: true }
        });
        if (user) res.json(user);
        else res.status(401).json({ error: "E-mail ou senha incorretos." });
    } catch (e) { res.status(500).json({ error: "Erro no servidor." }); }
});

app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ include: { manager: true, staff: true }, orderBy: { name: 'asc' } });
        res.json(users);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar equipe" }); }
});

app.post('/users', async (req, res) => {
    const { name, email, password, role, department, operation, isAdmin, managerId } = req.body;
    try {
        const id = crypto.randomUUID(); 
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;

        await prisma.$executeRawUnsafe(
            `INSERT INTO User (id, name, email, password, role, department, operation, isAdmin, status, managerId) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            id, String(name), String(email).trim(), String(password), String(role), String(department), opValue, adminVal, managerId || null
        );

        res.status(201).json({ id, name, message: "Criado com sucesso" });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao criar usuário." }); 
    }
});

app.put('/users/:id', async (req, res) => {
    const { name, email, role, department, operation, isAdmin, managerId, password } = req.body;
    const userId = req.params.id;

    try {
        const opValue = operation || "Outros";
        const adminVal = isAdmin ? 1 : 0;

        if (password && password.trim() !== "") {
            await prisma.$executeRawUnsafe(
                `UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=?, password=? WHERE id=?`,
                name, email, role, department, opValue, adminVal, managerId || null, password, userId
            );
        } else {
            await prisma.$executeRawUnsafe(
                `UPDATE User SET name=?, email=?, role=?, department=?, operation=?, isAdmin=?, managerId=? WHERE id=?`,
                name, email, role, department, opValue, adminVal, managerId || null, userId
            );
        }
        
        const updated = await prisma.user.findUnique({ where: { id: userId } });
        res.json(updated);
    } catch (e) { 
        console.error("Erro no Update via SQL:", e);
        res.status(500).json({ error: "Erro ao atualizar no banco de dados." }); 
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
// 4. BI DE VENDAS (SAMSUNG)
// =======================================================

const DB_PATH = path.resolve(__dirname, '../../database/samsung_vendas.db');

app.get('/bi/summary', (req, res) => {
    if (!fs.existsSync(DB_PATH)) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
    const db = new sqlite3.Database(DB_PATH);
    const sql = `SELECT SUM(TOTAL_LIQUIDO) as total_vendas, SUM(QUANTIDADE) as total_pecas, COUNT(DISTINCT NOTA_FISCAL) as qtd_notas FROM vendas`;
    db.get(sql, [], (err, row: any) => {
        db.close();
        if (err) return res.json({ total_vendas: 0, total_pecas: 0, ticket_medio: 0 });
        const total = row?.total_vendas || 0;
        const pecas = row?.total_pecas || 0;
        const notas = row?.qtd_notas || 1;
        res.json({ total_vendas: total, total_pecas: pecas, ticket_medio: total / notas });
    });
});

app.get('/bi/chart', (req, res) => {
    if (!fs.existsSync(DB_PATH)) return res.json([]);
    const db = new sqlite3.Database(DB_PATH);
    const sql = `SELECT substr(DATA_EMISSAO, 1, 5) as dia, SUM(TOTAL_LIQUIDO) as valor FROM vendas GROUP BY DATA_EMISSAO ORDER BY substr(DATA_EMISSAO,7,4) || substr(DATA_EMISSAO,4,2) || substr(DATA_EMISSAO,1,2) DESC LIMIT 7`;
    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows ? rows.reverse() : []);
    });
});

app.get('/bi/ranking', (req, res) => {
    if (!fs.existsSync(DB_PATH)) return res.json([]);
    const db = new sqlite3.Database(DB_PATH);
    const sql = `SELECT NOME_VENDEDOR as nome, SUM(TOTAL_LIQUIDO) as total FROM vendas WHERE NOME_VENDEDOR IS NOT NULL GROUP BY NOME_VENDEDOR ORDER BY total DESC LIMIT 5`;
    db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return res.json([]);
        res.json(rows || []);
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
app.get('/finance', async (req, res) => {
    try {
        const titles = await prisma.finance.findMany({
            orderBy: { dueDate: 'asc' }
        });
        res.json(titles);
    } catch (e) { res.status(500).json({ error: "Erro ao carregar financeiro." }); }
});

// Criar Novo Título (Conforme Planilha)
app.post('/finance', async (req, res) => {
    const { supplier, description, category, unit, issueDate, dueDate, value } = req.body;
    try {
        const title = await prisma.finance.create({
            data: {
                supplier,
                description,
                category,
                unit,
                issueDate: new Date(issueDate),
                dueDate: new Date(dueDate),
                value: parseFloat(value)
            }
        });
        res.json(title);
    } catch (e) { res.status(500).json({ error: "Erro ao salvar título." }); }
});

// ==========================================
// 9. IMPORTAÇÃO FINANCEIRA - VERSÃO FINAL 🛡️
// ==========================================

app.delete('/finance/all', async (req, res) => {
    try {
        // O comando deleteMany sem filtros apaga TUDO da tabela
        await prisma.finance.deleteMany();
        res.json({ message: "Banco financeiro limpo com sucesso!" });
    } catch (e) {
        console.error("Erro ao limpar banco:", e);
        res.status(500).json({ error: "Erro ao tentar limpar os dados." });
    }
});

app.post('/finance/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Arquivo não enviado." });
  const results: any[] = [];

  // Função interna para converter DD/MM/YYYY para Objeto Date
  const parseDateBR = (str: string) => {
    if (!str) return new Date();
    const parts = str.trim().split('/');
    if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return new Date(str);
  };

  // Função interna para limpar o valor "R$ 1.234,56"
  const parseCurrencyBR = (val: string) => {
    if (!val) return 0;
    let clean = val.replace('R$', '').replace(/\s/g, '');
    if (clean.includes(',') && clean.includes('.')) clean = clean.replace(/\./g, '').replace(',', '.');
    else clean = clean.replace(',', '.');
    return parseFloat(clean) || 0;
  };

  fs.createReadStream(req.file.path)
    .pipe(csv({ separator: ';' })) // <--- Força o uso do ponto e vírgula
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        const formattedData = results.map(row => {
          // Limpa espaços de todos os cabeçalhos
          const cleanRow: any = {};
          Object.keys(row).forEach(key => cleanRow[key.trim()] = row[key]);

          return {
            supplier: String(cleanRow['FORNECEDOR'] || 'Não informado'),
            description: String(cleanRow['DESCRIÇÃO'] || cleanRow['DESCRIÃ‡ÃƒO'] || ''),
            category: String(cleanRow['TIPO DE DESPESA'] || 'Geral'),
            unit: String(cleanRow['LOJA'] || 'Matriz'),
            issueDate: parseDateBR(cleanRow['DATA DA NF']),
            dueDate: parseDateBR(cleanRow['VENCIMENTO']),
            value: parseCurrencyBR(cleanRow['VALOR']),
            status: 'PENDENTE'
          };
        });

        await prisma.finance.createMany({ data: formattedData });
        fs.unlinkSync(req.file!.path);
        res.json({ message: `Sucesso! ${formattedData.length} títulos importados.` });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro interno ao processar o arquivo." });
      }
    });
});

app.put('/finance/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        const updated = await prisma.finance.update({
            where: { id: req.params.id },
            data: { status: status }
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar status" }); }
});

// Rota de Alertas Críticos (Títulos que vencem em até 3 dias)
app.get('/finance/alerts', async (req, res) => {
    try {
        const today = new Date();
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(today.getDate() + 3);

        const alerts = await prisma.finance.findMany({
            where: {
                status: 'PENDENTE',
                dueDate: {
                    lte: threeDaysFromNow // Menor ou igual a 3 dias para frente
                }
            },
            orderBy: { dueDate: 'asc' }
        });
        res.json(alerts);
    } catch (e) { res.status(500).json({ error: "Erro nos alertas" }); }
});

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

// Rota para Criar Títulos (Manual, Recorrente ou Parcelado)
app.post('/finance', async (req, res) => {
  const { 
    supplier, description, category, unit, value, 
    issueDate, dueDate, installments, isRecurring 
  } = req.body;

  try {
    const groupId = crypto.randomUUID();
    const entries = [];
    const baseDate = new Date(dueDate);
    
    // Define quantas vezes o loop vai rodar
    // Se for recorrente, projetamos 12 meses. Se parcelado, o número de parcelas.
    const loops = isRecurring ? 12 : (Math.max(1, parseInt(installments) || 1));

    for (let i = 0; i < loops; i++) {
      const currentDueDate = new Date(baseDate);
      currentDueDate.setMonth(baseDate.getMonth() + i); // Soma os meses

      entries.push({
        supplier,
        description: isRecurring ? `${description} (Mês ${i+1})` : (loops > 1 ? `${description} (${i+1}/${loops})` : description),
        category,
        unit,
        value: parseFloat(value),
        issueDate: new Date(issueDate),
        dueDate: currentDueDate,
        isRecurring: !!isRecurring,
        totalInstallments: loops,
        currentInstallment: i + 1,
        groupId: groupId,
        status: 'PENDENTE'
      });
    }

    await prisma.finance.createMany({ data: entries });
    res.json({ message: "Registro(s) criado(s) com sucesso!" });
  } catch (e) {
    res.status(500).json({ error: "Erro ao criar registro financeiro." });
  }
});

// 1. EDITAR UM TÍTULO ESPECÍFICO
app.put('/finance/:id', async (req, res) => {
    try {
        const updated = await prisma.finance.update({
            where: { id: req.params.id },
            data: req.body
        });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro ao editar título." }); }
});

// 2. EXCLUIR UMA SÉRIE INTEIRA (GRUPO)
app.delete('/finance/group/:groupId', async (req, res) => {
    try {
        await prisma.finance.deleteMany({ where: { groupId: req.params.groupId } });
        res.json({ message: "Série removida com sucesso!" });
    } catch (e) { res.status(500).json({ error: "Erro ao remover grupo." }); }
});

app.listen(3000, '0.0.0.0', () => console.log("✅ SERVIDOR 8.9.2 - SUCESSO TOTAL!"));

