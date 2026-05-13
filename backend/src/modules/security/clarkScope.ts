import { PrismaClient } from '@prisma/client';

import {
  ClarkFiltros,
  ClarkUserScope,
  CORRECAO_NOMES_SERVER,
  LOJAS_MAP_GLOBAL,
} from '../clark/clark.types';

import {
  cnpjLimpoClark,
  normalizarLojaClark,
  resolverNomeLojaClark,
} from '../intent/extractFilters';

const prisma = new PrismaClient();

function getCnpjByName(storeName: string): string | null {
  let cleanName = normalizarLojaClark(storeName);

  const nomeCorrigido = CORRECAO_NOMES_SERVER[cleanName];

  if (nomeCorrigido) {
    cleanName = normalizarLojaClark(nomeCorrigido);
  }

  for (const [cnpj, name] of Object.entries(LOJAS_MAP_GLOBAL)) {
    if (normalizarLojaClark(name) === cleanName) {
      return cnpj;
    }
  }

  return null;
}

export async function obterEscopoUsuarioClark(
  userId: string
): Promise<ClarkUserScope> {
  try {
    // Ambiente controlado de diretoria: por padrão a Clark vê todos os dados.
    // Para voltar a restringir por usuário/loja, defina CLARK_FULL_ACCESS=false no .env.
    const fullAccess = String(process.env.CLARK_FULL_ACCESS ?? 'true').toLowerCase() !== 'false';
    if (fullAccess) {
      return {
        isSuperUser: true,
        allowedStoreNames: [],
        allowedCnpjs: [],
      };
    }

    if (!userId || userId === 'undefined' || userId === 'null') {
      return {
        isSuperUser: false,
        allowedStoreNames: [],
        allowedCnpjs: [],
      };
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return {
        isSuperUser: false,
        allowedStoreNames: [],
        allowedCnpjs: [],
      };
    }

    const superRoles = [
      'CEO',
      'DIRETOR',
      'ADM',
      'ADMIN',
      'GESTOR',
      'SÓCIO',
      'SOCIO',
      'MASTER',
    ];

    const role = String((user as any).role || '').toUpperCase();
    const isAdmin = Boolean((user as any).isAdmin);

    const isSuperUser = isAdmin || superRoles.includes(role);

    if (isSuperUser) {
      return {
        isSuperUser: true,
        allowedStoreNames: [],
        allowedCnpjs: [],
      };
    }

    const allowedStoresRaw = String((user as any).allowedStores || '')
      .split(',')
      .map((s) => normalizarLojaClark(s))
      .filter(Boolean);

    const allowedStoreNames = allowedStoresRaw.map((store) => {
      const corrigida = CORRECAO_NOMES_SERVER[store];
      return corrigida ? normalizarLojaClark(corrigida) : store;
    });

    const allowedCnpjs = allowedStoreNames
      .map((store) => getCnpjByName(store))
      .filter((cnpj): cnpj is string => Boolean(cnpj));

    return {
      isSuperUser: false,
      allowedStoreNames,
      allowedCnpjs,
    };
  } catch (error) {
    console.error('❌ Erro ao obter escopo da Clark:', error);

    return {
      isSuperUser: false,
      allowedStoreNames: [],
      allowedCnpjs: [],
    };
  }
}

export function rowPermitidaClark(row: any, scope: ClarkUserScope) {
  if (scope.isSuperUser) return true;

  const cnpj = cnpjLimpoClark(row?.cnpj_empresa || row?.cnpj || '');
  const loja = normalizarLojaClark(
    row?.loja || row?.storeName || row?.nome_fantasia || ''
  );

  if (cnpj && scope.allowedCnpjs.includes(cnpj)) return true;

  if (loja && scope.allowedStoreNames.length) {
    return scope.allowedStoreNames.some((permitida) => {
      return loja === permitida || loja.includes(permitida) || permitida.includes(loja);
    });
  }

  return false;
}

export function rowCorrespondeLojaFiltroClark(
  row: any,
  filtros: ClarkFiltros
) {
  if (!filtros.cnpjLoja && !filtros.lojaCanonica) return true;

  const rowCnpj = cnpjLimpoClark(row?.cnpj_empresa || row?.cnpj || '');

  if (filtros.cnpjLoja && rowCnpj === filtros.cnpjLoja) {
    return true;
  }

  const lojaLinha = normalizarLojaClark(resolverNomeLojaClark(row));
  const lojaFiltro = normalizarLojaClark(
    filtros.lojaCanonica || filtros.lojaOriginal || ''
  );

  if (!lojaFiltro) return true;

  return (
    lojaLinha === lojaFiltro ||
    lojaLinha.includes(lojaFiltro) ||
    lojaFiltro.includes(lojaLinha)
  );
}

export function categoriaEstoqueConfereClark(
  categoriaItem: any,
  filtros: ClarkFiltros
) {
  if (!filtros.aliasesCategoria.length) return true;

  const categoriaNormalizada = String(categoriaItem || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return filtros.aliasesCategoria.some((alias) => {
    const aliasNormalizado = String(alias || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return (
      categoriaNormalizada === aliasNormalizado ||
      categoriaNormalizada.includes(aliasNormalizado) ||
      aliasNormalizado.includes(categoriaNormalizada)
    );
  });
}