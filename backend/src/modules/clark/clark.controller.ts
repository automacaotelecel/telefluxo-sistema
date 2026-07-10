import { Request, Response } from 'express';
import { processarPerguntaClark } from './clark.service';
import { limparMemoriaExecutivaClark, obterMemoriaExecutivaClark } from './brain/clarkExecutiveMemory.service';
import { ClarkHistoricoMensagem } from './clark.types';
import { gerarExcelUniversalClark } from './reports/excelUniversal.service';
import { validarAcessoAdmRequest } from '../security/adminAccess';

function normalizarHistorico(value: any): ClarkHistoricoMensagem[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .map((m) => ({
      role: m?.role === 'assistant' || m?.role === 'system' ? m.role : 'user',
      text: String(m?.text || m?.content || '').slice(0, 4000),
    }))
    .filter((m) => m.text.trim());
}

export async function perguntarClarkController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({
        ok: false,
        clark: acesso.error,
        error: acesso.error,
      });
    }

    const { userId, pergunta, historico } = req.body || {};

    if (!userId) {
      return res.status(400).json({
        ok: false,
        clark: 'Usuário não informado. Faça login novamente e tente consultar a Clark.',
        error: 'Usuário não informado.',
      });
    }

    if (!pergunta || !String(pergunta).trim()) {
      return res.status(400).json({
        ok: false,
        clark: 'Digite uma pergunta para a Clark.',
        error: 'Pergunta vazia.',
      });
    }

    const resultado = await processarPerguntaClark({
      userId: String(userId),
      pergunta: String(pergunta).trim(),
      historico: normalizarHistorico(historico),
    });

    return res.json(resultado);
  } catch (error: any) {
    console.error('❌ Erro na Clark:', error);

    return res.status(500).json({
      ok: false,
      clark:
        'Não consegui processar sua pergunta agora. Tive uma falha interna, e por segurança não vou inventar dados.',
      error: error?.message || 'Erro ao processar pergunta da Clark.',
      intencao: 'ajuda',
      modo: 'simples',
      periodo: { inicio: '', fim: '', descricao: '' },
      filtros: null,
      dados: null,
      resposta_origem: 'fallback',
    });
  }
}

export async function exportarRelatorioExcelClark(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({
        ok: false,
        error: acesso.error,
      });
    }

    const { pergunta, dados } = req.body || {};

    const buffer = await gerarExcelUniversalClark({
      titulo: 'Exportação Clark IA',
      pergunta: String(pergunta || ''),
      dados,
    });

    const fileName = `clark-exportacao-${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return res.send(buffer);
  } catch (error: any) {
    console.error('Erro ao gerar Excel universal da Clark:', error);

    return res.status(500).json({
      ok: false,
      error: 'Erro ao gerar Excel da Clark.',
      details: error?.message,
    });
  }
}


export async function obterMemoriaClarkController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({ ok: false, error: acesso.error });
    }

    const userId = String(req.query.userId || req.body?.userId || '').trim();

    if (!userId) {
      return res.status(400).json({ ok: false, error: 'Usuário não informado.' });
    }

    const memory = await obterMemoriaExecutivaClark(userId);
    return res.json({ ok: true, memory });
  } catch (error: any) {
    console.error('Erro ao consultar memória da Clark:', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Erro ao consultar memória da Clark.' });
  }
}

export async function limparMemoriaClarkController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({ ok: false, error: acesso.error });
    }

    const userId = String(req.query.userId || req.body?.userId || '').trim();

    if (!userId) {
      return res.status(400).json({ ok: false, error: 'Usuário não informado.' });
    }

    await limparMemoriaExecutivaClark(userId);
    return res.json({ ok: true, memory: null });
  } catch (error: any) {
    console.error('Erro ao limpar memória da Clark:', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Erro ao limpar memória da Clark.' });
  }
}

export async function gerarRelatorioExecutivoClarkController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({ ok: false, error: acesso.error });
    }

    const { userId, periodo, pergunta } = req.body || {};

    if (!userId) {
      return res.status(400).json({ ok: false, error: 'Usuário não informado.' });
    }

    const periodoTexto = String(periodo || '').trim() || 'este mês';
    const perguntaFinal = String(pergunta || '').trim() ||
      `Modo diretoria: gere um relatório executivo da operação no período ${periodoTexto}, com vendas, estoque, seguros, alertas, riscos e ações recomendadas. Ao final, disponibilize Excel.`;

    const resultado = await processarPerguntaClark({
      userId: String(userId),
      pergunta: perguntaFinal,
      historico: normalizarHistorico(req.body?.historico),
    });

    return res.json(resultado);
  } catch (error: any) {
    console.error('Erro ao gerar relatório executivo da Clark:', error);
    return res.status(500).json({
      ok: false,
      clark: 'Não consegui gerar o relatório executivo agora. Nenhum dado foi inventado.',
      error: error?.message || 'Erro ao gerar relatório executivo.',
    });
  }
}
