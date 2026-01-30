import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Apaga usuários antigos se existirem para não dar erro de duplicidade
  await prisma.user.deleteMany({}) 

  await prisma.user.create({
    data: {
      name: 'André',
      email: 'admin@telefluxo.com',
      password: '123',
      role: 'CEO',
      department: 'Diretoria',
      isAdmin: true,
      status: 'active'
    },
  })
  console.log('Usuario Admin criado!')
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect())