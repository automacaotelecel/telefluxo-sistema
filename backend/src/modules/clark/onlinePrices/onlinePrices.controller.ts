import fs from 'fs';
import { Request, Response } from 'express';
import { validarAcessoAdmRequest } from '../../security/adminAccess';
import { analisarPrecosOnline, getOnlinePricesReportPath } from './onlinePricesAgent.service';

function parseOptionalPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function analisarPrecosOnlineController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({
        ok: false,
        error: acesso.error,
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        ok: false,
        error: 'Nenhuma planilha foi enviada. Envie um arquivo Excel .xlsx, .xls ou .xlsm.',
      });
    }

    const userId = String(req.body?.userId || req.headers['x-user-id'] || '').trim();
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'Usuário não informado.',
      });
    }

    const resultado = await analisarPrecosOnline({
      userId,
      fileBuffer: file.buffer,
      originalName: file.originalname,
      maxModels: parseOptionalPositiveInt(req.body?.maxModels),
      maxStores: parseOptionalPositiveInt(req.body?.maxStores),
      forceFullRun: String(req.body?.forceFullRun || '').toLowerCase() === 'true',
    });

    return res.json(resultado);
  } catch (error: any) {
    console.error('[Preços Online] Erro ao analisar planilha:', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro ao executar o agente de preços online.',
    });
  }
}

export async function baixarRelatorioPrecosOnlineController(req: Request, res: Response) {
  try {
    const acesso = await validarAcessoAdmRequest(req);

    if (!acesso.allowed) {
      return res.status(acesso.status).json({ ok: false, error: acesso.error });
    }

    const fileName = String(req.params.fileName || '').trim();
    const fullPath = getOnlinePricesReportPath(fileName);

    if (!fileName || !fs.existsSync(fullPath)) {
      return res.status(404).json({ ok: false, error: 'Relatório não encontrado ou expirado.' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(fullPath);
  } catch (error: any) {
    console.error('[Preços Online] Erro ao baixar relatório:', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Erro ao baixar relatório de preços online.',
    });
  }
}
