import { Request, Response } from 'express';
import { processarPerguntaClark } from './clark.service';
import { ClarkHistoricoMensagem } from './clark.types';
import { gerarExcelRelatorioClark } from './reports/excelReport.service';

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
    const { periodo, dados } = req.body || {};

    const buffer = await gerarExcelRelatorioClark({
      titulo: 'Relatório Executivo Clark',
      periodo,
      resumo: dados?.resumo,
      vendasPorLoja: dados?.vendasPorLoja,
      vendasPorVendedor: dados?.vendasPorVendedor,
      estoqueDestaque: dados?.estoqueDestaque,
      segurosPorLoja: dados?.segurosPorLoja,
      segurosPorVendedor: dados?.segurosPorVendedor,
      recomendacoes: dados?.recomendacoes,
    });

    const fileName = `relatorio-clark-${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return res.send(buffer);
  } catch (error: any) {
    console.error('Erro ao gerar Excel da Clark:', error);

    return res.status(500).json({
      ok: false,
      error: 'Erro ao gerar Excel da Clark.',
      details: error?.message,
    });
  }
}