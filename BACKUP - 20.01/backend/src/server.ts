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

// ======================================================================
// 1. ROTA DE LOGIN (O QUE ESTAVA FALTANDO)
// ======================================================================
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findFirst({
            where: { 
                email: String(email),
                password: String(password) 
            },
            include: { manager: true, staff: true } // Importante para saber se é gestor
        });

        if (user) {
            res.json(user);
        } else {
            res.status(401).json({ error: "E-mail ou senha incorretos." });
        }
    } catch (e) {
        res.status(500).json({ error: "Erro no servidor." });
    }
});

// ======================================================================
// 2. DEMAIS ROTAS
// ======================================================================

// USUÁRIOS
app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({ include: { manager: true, staff: true } });
        res.json(users);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar equipe" }); }
});

// TAREFAS
app.get('/tasks', async (req, res) => {
    const { user: userName, viewMode } = req.query;
    try {
        const currentUser = await prisma.user.findFirst({ 
            where: { name: String(userName) },
            include: { staff: true } 
        });
        
        if (!currentUser) return res.json([]);

        let scopeFilter: any = {};
        if (currentUser.isAdmin) {
            scopeFilter = {}; 
        } else if (currentUser.staff.length > 0) {
            const staffNames = currentUser.staff.map(s => s.name);
            scopeFilter = {
                OR: [
                    { user: String(userName) },
                    { user: { in: staffNames } },
                    { history: { some: { user: String(userName) } } }
                ]
            };
        } else {
            scopeFilter = { 
                OR: [
                    { user: String(userName) }, 
                    { history: { some: { user: String(userName) } } }
                ] 
            };
        }

        let statusFilter: any = {};
        if (viewMode === 'completed') {
            statusFilter = { status: 'done' };
        } else if (viewMode === 'mine') {
             statusFilter = { 
                AND: [
                    { status: { not: 'done' } },
                    { user: String(userName) }
                ]
            };
        } else {
            statusFilter = { status: { not: 'done' } };
        }

        const finalFilter = { AND: [ scopeFilter, statusFilter ] };
        
        const tasks = await prisma.task.findMany({ where: finalFilter, include: { history: true }, orderBy: { createdAt: 'desc' } });
        res.json(tasks);
    } catch (e) { res.status(500).json({ error: "Erro tasks" }); }
});

// CRIAÇÃO DE TAREFA
app.post('/tasks', async (req, res) => {
    const { title, responsible, priority, deadline, creatorName } = req.body;
    try {
        const newTask = await prisma.task.create({
            data: {
                id: `TASK-${Date.now()}`,
                title: String(title),
                user: String(responsible),
                status: "pending",
                priority: String(priority),
                deadline: String(deadline),
                history: { create: { user: String(creatorName), text: "Iniciou o fluxo", type: "system", date: new Date().toLocaleString() } }
            }
        });
        const target = await prisma.user.findFirst({ where: { name: String(responsible) } });
        if (target) await prisma.notification.create({ data: { userId: target.id, text: `Nova demanda: ${title}` } });
        res.status(201).json(newTask);
    } catch (e) { res.status(500).json({ error: "Erro create" }); }
});

// UPLOAD
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

// ATUALIZAÇÃO
app.put('/tasks/:id', async (req, res) => {
    const { status, user, comment, currentUser, actionType } = req.body;
    try {
        const currentTask = await prisma.task.findUnique({ where: { id: req.params.id } });
        if (currentTask?.status === 'done' && status !== 'pending') return res.status(400).json({ error: "Demanda finalizada." });

        const updated = await prisma.task.update({ where: { id: req.params.id }, data: { status: status || undefined, user: user || undefined, history: { create: { user: currentUser, text: comment || `Ação: ${actionType}`, type: 'message', date: new Date().toLocaleString() } } } });
        if (user && user !== currentUser) { const target = await prisma.user.findFirst({ where: { name: user } }); if (target) await prisma.notification.create({ data: { userId: target.id, text: `Repasse: ${updated.title}` } }); }
        res.json(updated);
    } catch (e) { res.status(500).json({ error: "Erro update" }); }
});

// EXCLUSÃO
app.delete('/tasks/:id', async (req, res) => {
    try { await prisma.task.update({ where: { id: req.params.id }, data: { history: { deleteMany: {} } } }); await prisma.task.delete({ where: { id: req.params.id } }); res.json({ message: "Deletado" }); } catch (e) { res.status(500).json({ error: "Erro delete" }); }
});

// NOTIFICAÇÕES
app.get('/notifications', async (req, res) => {
    try { const userId = String(req.query.userId); const notes = await prisma.notification.findMany({ where: { userId: userId, read: false } as any }); res.json(notes); } catch (e) { res.json([]); }
});

// AGENDA
app.get('/agenda', async (req, res) => { const { userId, date } = req.query; try { const events = await prisma.agendaEvent.findMany({ where: { userId: String(userId), date: String(date) } }); res.json(events); } catch (e) { res.json([]); } });
app.post('/agenda', async (req, res) => { const { userId, title, date } = req.body; try { const newEvent = await prisma.agendaEvent.create({ data: { userId, title, date } }); res.json(newEvent); } catch (e) { res.status(500).json({ error: "Erro" }); } });
app.put('/agenda/:id', async (req, res) => { const { completed } = req.body; try { const updated = await prisma.agendaEvent.update({ where: { id: req.params.id }, data: { completed: completed } }); res.json(updated); } catch (e) { res.status(500).json({ error: "Erro" }); } });
app.delete('/agenda/:id', async (req, res) => { try { await prisma.agendaEvent.delete({ where: { id: req.params.id } }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Erro" }); } });

// DASHBOARD GESTÃO
app.get('/manager-stats', async (req, res) => {
    const { managerName } = req.query;
    try {
        const currentUser = await prisma.user.findFirst({ where: { name: String(managerName) }, include: { staff: true } });
        if (!currentUser) return res.json([]);
        let usersToAnalyze: string[] = [];
        let tasks: any[] = [];
        if (currentUser.isAdmin) {
            const allUsers = await prisma.user.findMany(); usersToAnalyze = allUsers.map(u => u.name); tasks = await prisma.task.findMany();
        } else if (currentUser.staff.length > 0) {
            usersToAnalyze = currentUser.staff.map(s => s.name); tasks = await prisma.task.findMany({ where: { user: { in: usersToAnalyze } } });
        } else { return res.json([]); }
        const report = usersToAnalyze.map(userName => {
            const userTasks = tasks.filter(t => t.user === userName);
            const total = userTasks.length;
            const done = userTasks.filter(t => t.status === 'done').length;
            const efficiency = total > 0 ? Math.round((done / total) * 100) : 0;
            return { name: userName, total, done, efficiency };
        });
        report.sort((a, b) => b.done - a.done);
        res.json(report);
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

app.listen(3000, '0.0.0.0', () => console.log("✅ SERVIDOR TELEFLUXO 7.1 - LOGIN CORRIGIDO"));