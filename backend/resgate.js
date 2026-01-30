const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🚑 INICIANDO RESGATE E CORREÇÃO DO BANCO...");

  // 1. Tenta criar a coluna 'operation' na força bruta (se não existir)
  try {
    console.log("🔧 Tentando adicionar coluna 'operation' via SQL...");
    await prisma.$executeRawUnsafe(`ALTER TABLE User ADD COLUMN operation TEXT;`);
    console.log("✅ Coluna 'operation' criada com sucesso!");
  } catch (e) {
    console.log("ℹ️ A coluna provavelmente já existe ou deu erro irrelevante: " + e.message.split('\n')[0]);
  }

  // 2. Lista de Usuários Recuperados do seu Print (image_3e38a5.png)
  const users = [
    { name: "André (Admin)", email: "admin@telefluxo.com", role: "CEO", department: "Diretoria", operation: "Automação", isAdmin: true, managerId: null },
    { name: "DANILO CAVALCANTE", email: "analista.samsungtelecel@gmail.com", role: "Analista Samsung", department: "Geral", operation: "Samsung", isAdmin: false, managerId: null },
    { name: "BRENDA RODRIGUES", email: "cqualidade.telecel@gmail.com", role: "Qualidade TIM", department: "Geral", operation: "Tim", isAdmin: false, managerId: null },
    { name: "ELIZABETH COSTA", email: "analista.timtelecel@gmail.com", role: "Analista TIM", department: "Geral", operation: "Tim", isAdmin: false, managerId: null },
    { name: "DAMARIS", email: "assistente.financeirotelecel@gmail.com", role: "Assistente Financeiro", department: "Geral", operation: "Financeiro", isAdmin: false, managerId: null },
    { name: "BRUNA THAINA", email: "assistente.admtelecel@gmail.com", role: "Analista Financeiro", department: "Geral", operation: "Financeiro", isAdmin: false, managerId: null },
    { name: "IVONE ALVES", email: "gestao.admtelecel@gmail.com", role: "GERENTE ADM", department: "Geral", operation: "Financeiro", isAdmin: false, managerId: null }, // Ajuste se necessário
    { name: "ANDRE LUIS", email: "automacao.telecel@gmail.com", role: "Analista Automação", department: "Geral", operation: "Automação", isAdmin: false, managerId: null }
  ];

  console.log("👥 Restaurando equipe...");

  for (const u of users) {
    // Usamos SQL Puro para garantir que grave, ignorando qualquer erro de validação do Prisma antigo
    try {
        const id = `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const isAdminInt = u.isAdmin ? 1 : 0;
        
        // Verifica se já existe para não duplicar
        const exists = await prisma.$queryRawUnsafe(`SELECT id FROM User WHERE email = '${u.email}'`);
        
        if (exists.length === 0) {
            await prisma.$executeRawUnsafe(
                `INSERT INTO User (id, name, email, password, role, department, operation, isAdmin, status, managerId) 
                 VALUES ('${id}', '${u.name}', '${u.email}', '123', '${u.role}', '${u.department}', '${u.operation}', ${isAdminInt}, 'active', NULL)`
            );
            console.log(`✅ Restaurado: ${u.name}`);
        } else {
            console.log(`⚠️ Já existe: ${u.name}`);
        }
    } catch (err) {
        console.error(`❌ Erro ao restaurar ${u.name}:`, err.message);
    }
  }

  console.log("🏁 PROCESSO CONCLUÍDO. TENTE LOGAR NO SITE AGORA.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => { await prisma.$disconnect(); });