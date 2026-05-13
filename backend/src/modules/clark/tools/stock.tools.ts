import { ClarkToolResult } from '../agent/clarkAgent.types';
import { ClarkToolContext } from './clarkTools.types';

import {
  consultarLojasProdutoEstoqueClark,
  consultarRankingEstoqueProdutosClark,
} from '../../executors/stock.executor';

import { resolveProductRequest } from '../../productResolver/productResolver.service';
import { extractColor, extractStorage, getBaseModelFamily, normalizeProductText } from '../../productDictionary/productDictionary.utils';

function textoProdutoPrincipal(args: Record<string, any>, ctx?: ClarkToolContext) {
  const raw = String(
    args.query ||
      args.product ||
      args.produto ||
      args.termoProduto ||
      args.originalQuestion ||
      ctx?.pergunta ||
      ''
  ).trim();

  if (!raw) return '';

  // Prioridade máxima para texto entre aspas: “Galaxy A56 128GB Preto”.
  const quoted = raw.match(/["“”']([^"“”']{3,120})["“”']/);
  if (quoted?.[1]) return quoted[1].trim();

  let clean = raw
    .replace(/contexto recente da conversa:[\s\S]*?pergunta atual do usuário:/i, '')
    .replace(/me\s+liste\s+as\s+lojas\s+que\s+(t[eê]m|possuem)\s+/i, '')
    .replace(/quais\s+lojas\s+(t[eê]m|possuem)\s+/i, '')
    .replace(/onde\s+est[aã]o\s+as\s+(pe[cç]as|unidades|aparelhos)\s+do\s+produto\s*/i, '')
    .replace(/onde\s+tem\s+/i, '')
    .replace(/em\s+estoque/gi, '')
    .replace(/na\s+categoria\s+[a-z0-9çãõáéíóúâêô\s]+$/i, '')
    .replace(/categoria\s+[a-z0-9çãõáéíóúâêô\s]+$/i, '')
    .replace(/qual\s+produto\s+(voc[eê]\s+)?deseja\s+buscar\??/i, '')
    .trim();

  // Se ainda veio muito contexto, tenta pegar a primeira ocorrência de um padrão de produto.
  const normalized = normalizeProductText(clean);
  const match = normalized.match(/(GALAXY\s+(?:S\d{2}\s*(?:ULTRA|PLUS|FE)?|A\d{2}|M\d{2}|Z\s?(?:FLIP|FOLD)\s?\d?)\s*(?:5G)?\s*(?:64|128|256|512)?\s?GB?\s*(?:PRETO|BLACK|JETBLACK|CINZA|GRAFITE|AZUL|VERDE|VIOLETA|BRANCO|PRATA)?)/i);
  if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();

  return clean;
}

function montarFiltrosEstoque(args: Record<string, any>, ctx?: ClarkToolContext) {
  const category = args.category || args.categoria || args.productCategory || 'SMARTPHONES';
  const rawQuery = textoProdutoPrincipal(args, ctx);

  const inferredFamily = args.family || getBaseModelFamily(rawQuery) || null;
  const inferredStorage = args.storage || extractStorage(rawQuery) || null;
  const inferredColor = args.color || extractColor(rawQuery) || null;
  const inferredModel = args.model || (inferredFamily ? String(inferredFamily).replace(/^GALAXY\s+/i, '') : null);

  const aliasesCategoria =
    String(category || '').toUpperCase().includes('SMART')
      ? [
          'SMARTPHONE',
          'SMARTPHONES',
          'APARELHO',
          'APARELHOS',
          'CELULAR',
          'CELULARES',
        ]
      : [];

  const perguntaTemProduto = Boolean(
    inferredFamily ||
      inferredStorage ||
      inferredColor ||
      /\b(GALAXY|SM-[A-Z0-9]|S\d{2}|A\d{2}|M\d{2}|Z\s?FLIP|Z\s?FOLD|TAB\s?S)\b/i.test(rawQuery)
  );

  const produtoPlanejado = perguntaTemProduto
    ? {
        raw: rawQuery || null,
        family: inferredFamily,
        model: inferredModel,
        storage: inferredStorage,
        color: inferredColor,
        category: category || null,
      }
    : null;

  const termoProduto = [
    rawQuery,
    inferredFamily,
    inferredModel,
    inferredStorage,
    inferredColor,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const tokensProduto = termoProduto
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          'GALAXY',
          'SAMSUNG',
          'MODELO',
          'MODELOS',
          'PRODUTO',
          'PRODUTOS',
          'LOJAS',
          'ESTOQUE',
          'CATEGORIA',
          'SMARTPHONES',
          'SMARTPHONE',
        ].includes(token)
    );

  return {
    limite: Number(args.limit || 10),

    categoriaOriginal: category || undefined,
    categoriaCanonica: category || undefined,
    aliasesCategoria,

    termoProduto,
    tokensProduto,

    produtoPlanejado,

    lojaOriginal: undefined,
    lojaCanonica: undefined,
    cnpjLoja: undefined,

    detalharPorLoja: Boolean(args.includeStores ?? true),
    detalharPorVendedor: false,
    detalharPorCategoria: false,
    detalharPorMes: false,
  };
}

export async function toolResolverProduto(
  args: Record<string, any>,
  ctx: ClarkToolContext
): Promise<ClarkToolResult> {
  try {
    const rawQuery = textoProdutoPrincipal(args, ctx);
    const family = args.family || getBaseModelFamily(rawQuery) || null;
    const storage = args.storage || extractStorage(rawQuery) || null;
    const color = args.color || extractColor(rawQuery) || null;
    const model = args.model || (family ? String(family).replace(/^GALAXY\s+/i, '') : null);

    const query = [
      rawQuery,
      family,
      model,
      storage,
      color,
      args.category,
    ]
      .filter(Boolean)
      .join(' ');

    const result = await resolveProductRequest({
      query,
      productPlan: {
        raw: rawQuery || null,
        family,
        model,
        storage,
        color,
        category: args.category || args.categoria || null,
      },
    });

    return {
      tool: 'resolver_produto',
      ok: true,
      args,
      result,
    };
  } catch (error: any) {
    return {
      tool: 'resolver_produto',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao resolver produto.',
    };
  }
}

export async function toolConsultarEstoqueProduto(
  args: Record<string, any>,
  ctx: ClarkToolContext
): Promise<ClarkToolResult> {
  try {
    const filtros = montarFiltrosEstoque({
      ...args,
      limit: args.limit || 50,
    }, ctx);

    const result = await consultarLojasProdutoEstoqueClark(ctx.userId, filtros);

    return {
      tool: 'consultar_estoque_produto',
      ok: true,
      args,
      result,
    };
  } catch (error: any) {
    return {
      tool: 'consultar_estoque_produto',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao consultar estoque do produto.',
    };
  }
}

export async function toolConsultarRankingEstoque(
  args: Record<string, any>,
  ctx: ClarkToolContext
): Promise<ClarkToolResult> {
  try {
    const filtros = montarFiltrosEstoque({
      category: args.category || args.categoria || 'SMARTPHONES',
      limit: args.limit || 10,
      includeStores: args.includeStores ?? true,
    }, ctx);

    const result = await consultarRankingEstoqueProdutosClark(
      ctx.userId,
      filtros
    );

    return {
      tool: 'consultar_ranking_estoque',
      ok: true,
      args,
      result,
    };
  } catch (error: any) {
    return {
      tool: 'consultar_ranking_estoque',
      ok: false,
      args,
      result: null,
      error: error?.message || 'Erro ao consultar ranking de estoque.',
    };
  }
}