import { Request } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function extrairUserIdRequest(req: Request): string {
  return String(req.body?.userId || req.query?.userId || req.headers['x-user-id'] || '').trim();
}

export function usuarioEhAdm(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase();
  const isAdmin = user?.isAdmin === true || Number(user?.isAdmin) === 1;
  return role === 'ADM' || role === 'ADMIN' || isAdmin;
}

export async function validarAcessoAdmPorUserId(userId: string): Promise<{
  allowed: boolean;
  status: number;
  error: string;
  user?: any;
}> {
  if (!userId || userId === 'undefined' || userId === 'null') {
    return {
      allowed: false,
      status: 401,
      error: 'Usuário não informado. Faça login novamente.',
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      allowed: false,
      status: 401,
      error: 'Usuário não encontrado. Faça login novamente.',
    };
  }

  if (!usuarioEhAdm(user)) {
    return {
      allowed: false,
      status: 403,
      error: 'Acesso permitido apenas para usuários ADM.',
      user,
    };
  }

  return {
    allowed: true,
    status: 200,
    error: '',
    user,
  };
}

export async function validarAcessoAdmRequest(req: Request) {
  return validarAcessoAdmPorUserId(extrairUserIdRequest(req));
}
