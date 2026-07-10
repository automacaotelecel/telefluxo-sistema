import { Request, Response } from 'express';
import { pdfExtractorService } from './pdfExtractor.service';
import { contractAgentService } from './contractAgent.service';
import { validarAcessoAdmRequest } from '../../security/adminAccess';

export class ContractController {
  public async analyze(req: Request, res: Response): Promise<void> {
    try {
      const acesso = await validarAcessoAdmRequest(req);

      if (!acesso.allowed) {
        res.status(acesso.status).json({
          success: false,
          error: acesso.error,
        });
        return;
      }

      const file = req.file;
      const question = req.body.question;

      // 1. Validações de entrada
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo PDF foi enviado.' });
        return;
      }

      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'A pergunta é obrigatória para analisar o contrato.' });
        return;
      }

      // 2. Extração de Texto em Memória
      console.info(`[ContractController] Extraindo texto do arquivo: ${file.originalname}`);
      const contractText = await pdfExtractorService.extractTextFromBuffer(file.buffer);

      // 3. Análise via Claude AI
      console.info(`[ContractController] Enviando análise para o Claude. Pergunta: "${question}"`);
      const aiResponse = await contractAgentService.analyzeContract({
        contractText,
        userQuestion: question,
      });

      // 4. Retorno limpo para o Frontend
      res.status(200).json({
        success: true,
        answer: aiResponse,
      });
      
    } catch (error: any) {
      console.error('[ContractController] Erro na rota de análise de contrato:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Erro interno ao processar a análise do contrato.',
      });
    }
  }
}

export const contractController = new ContractController();