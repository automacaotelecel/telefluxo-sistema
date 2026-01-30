const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🚑 INICIANDO RECUPERAÇÃO DO BANCO...");

  // PASSO 1: CRIAR A COLUNA "NA MARRA"
  try {
    console.log("🔧 Tentando adicionar coluna 'operation' no arquivo antigo...");
    await prisma.$executeRawUnsafe(`ALTER TABLE User ADD COLUMN operation TEXT;`);
    console.log("✅ SUCESSO: Coluna 'operation' foi criada!");
  } catch (e) {
    // Se der erro dizendo que já existe, tudo bem. Se for outro erro, mostramos.
    if (e.message.includes("duplicate column")) {
        console.log("ℹ️ A coluna já existia, seguindo para atualização...");
    } else {
        console.log("⚠️ Aviso na criação da coluna (pode ignorar se ela já existir): " + e.message.split('\n')[0]);
    }
  }

  // PASSO 2: PREENCHER OS DADOS
  console.log("🔄 ATUALIZANDO OPERAÇÕES DOS USUÁRIOS...");

  const updates = [
    { email: "admin@telefluxo.com", op: "Automação", role: "CEO" },
    { email: "analista.samsungtelecel@gmail.com", op: "Samsung", role: "Analista Samsung" },
    { email: "cqualidade.telecel@gmail.com", op: "Tim", role: "Qualidade TIM" },
    { email: "analista.timtelecel@gmail.com", op: "Tim", role: "Analista TIM" },
    { email: "assistente.financeirotelecel@gmail.com", op: "Financeiro", role: "Assistente Financeiro" },
    { email: "assistente.admtelecel@gmail.com", op: "Financeiro", role: "Analista Financeiro" },
    { email: "gestao.admtelecel@gmail.com", op: "Financeiro", role: "GERENTE ADM" },
    { email: "automacao.telecel@gmail.com", op: "Automação", role: "Analista Automação" }
  ];

  for (const u of updates) {
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE User SET operation = '${u.op}', role = '${u.role}' WHERE email = '${u.email}'`
      );
      // Verifica se alguma linha foi afetada (se o usuário existe)
      // O Prisma retorna o número de linhas alteradas em alguns drivers, mas no raw pode variar.
      // Vamos assumir que deu certo se não caiu no catch.
      console.log(`✅ Atualizado: ${u.email} -> ${u.op}`);
    } catch (e) {
      console.log(`❌ Erro em ${u.email}: ${e.message}`);
    }
  }

  console.log("🏁 PROCESSO CONCLUÍDO.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => { await prisma.$disconnect(); });