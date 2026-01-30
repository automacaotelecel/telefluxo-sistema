const sqlite3 = require('sqlite3').verbose();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');

async function main() {
    console.log("🕵️‍♂️ INICIANDO RESGATE DE HISTÓRICO...");

    // 1. Conectar ao Banco Antigo (Backup)
    const dbPath = path.resolve(__dirname, 'antigo.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error("❌ Erro ao abrir antigo.db. Verifique se o arquivo está na pasta backend.");
            process.exit(1);
        }
    });

    console.log("📂 Lendo dados do arquivo antigo...");

    // 2. Ler a tabela antiga 'Comment'
    db.all(`SELECT * FROM Comment`, [], async (err, rows) => {
        if (err) {
            console.error("❌ Erro ao ler tabela Comment (ou ela não existe no backup):", err.message);
            db.close();
            return;
        }

        console.log(`📦 Encontrados ${rows.length} registros de histórico. Migrando...`);

        // 3. Inserir na tabela nova 'TaskHistory'
        let sucesso = 0;
        let erro = 0;

        for (const row of rows) {
            try {
                // Verificamos se a tarefa ainda existe para não dar erro de orfandade
                const taskExists = await prisma.task.findUnique({ where: { id: row.taskId } });
                
                if (taskExists) {
                    await prisma.taskHistory.create({
                        data: {
                            text: row.text,
                            user: row.user,
                            date: row.date,
                            type: row.type,
                            taskId: row.taskId,
                            fileUrl: row.fileUrl,
                            fileName: row.fileName
                        }
                    });
                    sucesso++;
                    process.stdout.write("."); // Barra de progresso visual
                } else {
                    // Se a tarefa não existe mais, ignoramos o comentário
                    erro++;
                }
            } catch (e) {
                console.log(`\n⚠️ Erro ao importar registro: ${e.message}`);
                erro++;
            }
        }

        console.log(`\n\n🏁 FINALIZADO!`);
        console.log(`✅ Recuperados: ${sucesso}`);
        console.log(`🗑️ Ignorados (tarefa não existe): ${erro}`);
        
        db.close();
    });
}

main();