import { Request } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CLARK_DIRECTOR_ROLES = new Set([
  'CEO',
  'DIRETOR',
  'DIRETORIA',
]);

function normalizarRole(value: any): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

export function extrairUserIdRequest(req: Request): string {
  return String(
    req.body?.userId ||
      req.query?.userId ||
      req.headers['x-user-id'] ||
      ''
  ).trim();
}

/**
 * A Clark é uma ferramenta executiva e deve ser acessada somente pela diretoria.
 * isAdmin, isoladamente, NÃO concede acesso à Clark.
 */
export function usuarioEhDiretoriaClark(user: any): boolean {
  return CLARK_DIRECTOR_ROLES.has(normalizarRole(user?.role));
}

export async function validarAcessoDiretoriaClarkPorUserId(
  userId: string
): Promise<{
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

  if (!usuarioEhDiretoriaClark(user)) {
    return {
      allowed: false,
      status: 403,
      error: 'Acesso à Clark é exclusivo da Diretoria.',
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

export async function validarAcessoDiretoriaClarkRequest(req: Request) {
  return validarAcessoDiretoriaClarkPorUserId(extrairUserIdRequest(req));
}
