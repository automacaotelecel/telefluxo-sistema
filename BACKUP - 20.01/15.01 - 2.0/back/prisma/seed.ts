import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // 1. Limpa usuários antigos para evitar duplicidade
  try {
      await prisma.user.deleteMany({}) 
      console.log('🧹 Banco limpo...')
  } catch (e) {
      console.log('O banco já estava limpo.')
  }

  // 2. Cria o Admin
  await prisma.user.create({
    data: {
      name: 'André (Admin)',
      email: 'admin@telefluxo.com',
      password: '123',         // Senha simples para começar
      role: 'CEO',
      department: 'Diretoria',
      isAdmin: true,           // <--- O segredo está aqui!
      status: 'active'
    },
  })
  console.log('✅ Usuario Admin criado com sucesso!')
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })