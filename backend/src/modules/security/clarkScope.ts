import { PrismaClient } from '@prisma/client';

import {
  ClarkFiltros,
  ClarkUserScope,
} from '../clark/clark.types';

import {
  cnpjLimpoClark,
  normalizarLojaClark,
  resolverNomeLojaClark,
} from '../intent/extractFilters';
import { usuarioEhDiretoriaClark } from './adminAccess';

const prisma = new PrismaClient();

/**
 * Regra de negócio da Clark:
 * - somente Diretoria/CEO pode usar a IA;
 * - quando autorizada, a Clark sempre enxerga a rede inteira;
 * - allowedStores do usuário NÃO restringe a Clark.
 *
 * A autorização principal continua sendo aplicada nas rotas/controllers.
 * Esta função replica a regra no nível de dados para evitar qualquer vazamento
 * de escopo caso um serviço interno seja chamado fora do fluxo HTTP normal.
 */
export async function obterEscopoUsuarioClark(
  userId: string
): Promise<ClarkUserScope> {
  try {
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

    if (!user || !usuarioEhDiretoriaClark(user)) {
      return {
        isSuperUser: false,
        allowedStoreNames: [],
        allowedCnpjs: [],
      };
    }

    // Diretoria autorizada: visão global das 48 lojas.
    return {
      isSuperUser: true,
      allowedStoreNames: [],
      allowedCnpjs: [],
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
