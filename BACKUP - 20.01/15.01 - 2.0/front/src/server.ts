import express, { Request, Response } from 'express';
import cors from 'cors'; 
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

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

// --- LOGIN ---
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

// ==========================================
// GESTÃO DE USUÁRIOS (EQUIPE)
// ==========================================

// LISTAR
app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ include: { manager: true, staff: true }, orderBy: { name: 'asc' } });
        res.json(users);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar equipe" }); }
});

// CRIAR
app.post('/users', async (req, res) => {
    const { name, email, password, role, department, isAdmin, managerId } = req.body;
    try {
        const newUser = await prisma.user.create({
            data: {
                name: String(name),
                email: String(email).trim(),
                password: String(password),
                role: String(role),
                department: String(department),
                isAdmin: Boolean(isAdmin),
                managerId: managerId || null,
                status: "active"
            }
        });
        res.status(201).json(newUser);
    } catch (e) { res.status(500).json({ error: "Erro ao criar usuário." }); }
});

// 🔥 NOVA ROTA: EDITAR USUÁRIO
app.put('/users/:id', async (req, res) => {
    const { name, email, role, department, isAdmin, managerId, password } = req.body;
    try {
        // Prepara os dados. Só altera a senha se o usuário digitou algo novo.
        const updateData: any = {
            name: String(name),
            email: String(email).trim(),
            role: String(role),
            department: String(department),
            isAdmin: Boolean(isAdmin),
            managerId: managerId || null,
        };
        if (password && password.trim() !== "") {
            updateData.password = password;
        }

        const updatedUser = await prisma.user.update({
            where: { id: req.params.id },
            data: updateData
        });
        res.json(updatedUser);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao atualizar usuário." }); 
    }
});

// EXCLUIR USUÁRIO
app.delete('/users/:id', async (req, res) => {
    try { await prisma.user.delete({ where: { id: req.params.id } }); res.json({ message: "Usuário removido" }); } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

// ==========================================
// GESTÃO DE TAREFAS
// ==========================================

// LISTAR COM FILTROS
app.get('/tasks', async (req, res) => {
    const { user: userName, viewMode } = req.query;
    const mode = String(viewMode);
    try {
        const currentUser = await prisma.user.findFirst({ where: { name: String(userName) }, include: { staff: true } });
        if (!currentUser) return res.json([]);

        let scopeFilter: any = {};
        if (mode.startsWith('mine_')) scopeFilter = { user: String(userName) };
        else {
            if (currentUser.isAdmin) scopeFilter = {};
            else if (currentUser.staff.length > 0) {
                const staffNames = currentUser.staff.map(s => s.name);
                scopeFilter = { OR: [{ user: String(userName) }, { user: { in: staffNames } }, { history: { some: { user: String(userName) } } }] };
            } else {
                scopeFilter = { OR: [{ user: String(userName) }, { history: { some: { user: String(userName) } } }] };
            }
        }

        let statusFilter: any = {};
        if (mode === 'completed') {
             statusFilter = {}; // Histórico Geral traz tudo
        } 
        else if (mode.endsWith('_pending')) statusFilter = { status: 'pending' };
        else if (mode.endsWith('_doing')) statusFilter = { status: 'doing' };
        else if (mode.endsWith('_done')) statusFilter = { status: 'done' };
        else {
             statusFilter = { status: { not: 'done' } }; 
        }

        const tasks = await prisma.task.findMany({ 
            where: { AND: [scopeFilter, statusFilter] }, 
            include: { history: true }, 
            orderBy: { createdAt: 'desc' } 
        });
        res.json(tasks);
    } catch (e) { res.status(500).json({ error: "Erro tasks" }); }
});

// BUSCAR UMA TAREFA (Correção do histórico sumindo)
app.get('/tasks/:id', async (req, res) => {
    try {
        const task = await prisma.task.findUnique({
            where: { id: req.params.id },
            include: { history: true }
        });
        res.json(task);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar tarefa" }); }
});

// CRIAR TAREFA (Com Upload e Descrição)
app.post('/tasks', upload.single('file'), async (req: any, res: Response) => {
    const { title, responsible, priority, deadline, creatorName, description } = req.body;
    const file = req.file;
    try {
        const historyEntries: any[] = [{ user: String(creatorName), text: "Iniciou o fluxo", type: "system", date: new Date().toLocaleString() }];
        if (description && description.trim() !== "") historyEntries.push({ user: String(creatorName), text: String(description), type: "message", date: new Date().toLocaleString() });
        if (file) historyEntries.push({ user: String(creatorName), text: `Anexou na criação: ${file.originalname}`, type: 'file', fileName: file.originalname, fileUrl: `http://172.34.0.47:3000/uploads/${file.filename}`, date: new Date().toLocaleString() });

        const newTask = await prisma.task.create({
            data: {
                id: `TASK-${Date.now()}`,
                title: String(title),
                user: String(responsible),
                status: "pending",
                priority: String(priority),
                deadline: String(deadline),
                history: { create: historyEntries }
            }
        });
        const target = await prisma.user.findFirst({ where: { name: String(responsible) } });
        if (target) await prisma.notification.create({ data: { userId: target.id, text: `Nova demanda: ${title}` } });
        res.status(201).json(newTask);
    } catch (e) { res.status(500).json({ error: "Erro create" }); }
});

// ATUALIZAR TAREFA
app.put('/tasks/:id', async (req, res) => {
    const { status, user, comment, currentUser, actionType } = req.body;
    try {
        const currentTask = await prisma.task.findUnique({ where: { id: req.params.id } });
        if (currentTask?.status === 'done' && status !== 'pending' && actionType !== 'reopen') return res.status(400).json({ error: "Demanda finalizada." });

        let historyText = comment;
        if (actionType === 'start_progress') historyText = "Iniciou a tratativa desta demanda.";
        if (actionType === 'finish') historyText = comment || "Finalizou a demanda.";

        const updated = await prisma.task.update({ where: { id: req.params.id }, data: { status: status || undefined, user: user || undefined, history: { create: { user: currentUser, text: historyText || `Ação: ${actionType}`, type: 'message', date: new Date().toLocaleString() } } } });
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro update" }); }
});

// 🔥 NOVA ROTA: EXCLUIR TAREFA (Limpa histórico antes)
app.delete('/tasks/:id', async (req, res) => {
    try { 
        await prisma.task.update({ 
            where: { id: req.params.id }, 
            data: { history: { deleteMany: {} } } // Apaga o histórico primeiro
        }); 
        await prisma.task.delete({ where: { id: req.params.id } }); 
        res.json({ message: "Deletado" }); 
    } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

// UPLOAD DENTRO DA TAREFA
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

// --- OUTROS ---
app.get('/notifications', async (req, res) => { try { const userId = String(req.query.userId); const notes = await prisma.notification.findMany({ where: { userId: userId, read: false } as any }); res.json(notes); } catch (e) { res.json([]); } });
app.get('/agenda', async (req, res) => { const { userId, date } = req.query; try { const events = await prisma.agendaEvent.findMany({ where: { userId: String(userId), date: String(date) } }); res.json(events); } catch (e) { res.json([]); } });
app.post('/agenda', async (req, res) => { const { userId, title, date } = req.body; try { const newEvent = await prisma.agendaEvent.create({ data: { userId, title, date } }); res.json(newEvent); } catch (e) { res.status(500).json({ error: "Erro" }); } });
app.put('/agenda/:id', async (req, res) => { const { completed } = req.body; try { const updated = await prisma.agendaEvent.update({ where: { id: req.params.id }, data: { completed: completed } }); res.json(updated); } catch (e) { res.status(500).json({ error: "Erro" }); } });
app.delete('/agenda/:id', async (req, res) => { try { await prisma.agendaEvent.delete({ where: { id: req.params.id } }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Erro" }); } });
app.get('/manager-stats', async (req, res) => { const { managerName } = req.query; try { const currentUser = await prisma.user.findFirst({ where: { name: String(managerName) }, include: { staff: true } }); if (!currentUser) return res.json([]); let usersToAnalyze: string[] = []; let tasks: any[] = []; if (currentUser.isAdmin) { const allUsers = await prisma.user.findMany(); usersToAnalyze = allUsers.map(u => u.name); tasks = await prisma.task.findMany(); } else if (currentUser.staff.length > 0) { usersToAnalyze = currentUser.staff.map(s => s.name); tasks = await prisma.task.findMany({ where: { user: { in: usersToAnalyze } } }); } else { return res.json([]); } const report = usersToAnalyze.map(userName => { const userTasks = tasks.filter(t => t.user === userName); const total = userTasks.length; const done = userTasks.filter(t => t.status === 'done').length; const efficiency = total > 0 ? Math.round((done / total) * 100) : 0; return { name: userName, total, done, efficiency }; }); report.sort((a, b) => b.done - a.done); res.json(report); } catch (e) { res.status(500).json({ error: "Erro stats" }); } });

app.listen(3000, '0.0.0.0', () => console.log("✅ SERVIDOR 8.5 - ADMIN TOTAL ONLINE"));