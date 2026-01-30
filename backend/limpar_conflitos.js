const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🧹 LIMPANDO TABELAS CONFLITANTES...");

  try {
    // Apaga a tabela antiga de Comentários (que mudou de nome)
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS Comment;`);
    console.log("✅ Tabela 'Comment' removida.");

    // Apaga a tabela de Notificações (que estava com erro de ID)
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS Notification;`);
    console.log("✅ Tabela 'Notification' removida.");

    // Apaga a tabela TaskHistory se ela já tiver sido criada pela metade
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS TaskHistory;`);
    console.log("✅ Tabela 'TaskHistory' limpa.");
    
  } catch (e) {
    console.error("Erro ao limpar:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();