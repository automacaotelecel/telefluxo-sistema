import { Request, Response } from 'express';
import { pdfExtractorService } from './pdfExtractor.service';
import { contractAgentService, ContractChatTurn } from './contractAgent.service';
import { validarAcessoDiretoriaClarkRequest } from '../../security/adminAccess';

export const MAX_CONTRACT_FILES = 5;
export const MAX_CONTRACT_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_CONTRACT_TEXT_CHARS = 150_000;
const MAX_QUESTION_CHARS = 2500;

function getFiles(req: Request): Express.Multer.File[] {
  if (!req.files || Array.isArray(req.files)) return req.file ? [req.file] : [];
  return [...(req.files.pdfs || []), ...(req.files.pdf || [])];
}

function parseChatHistory(value: unknown): ContractChatTurn[] {
  if (!value) return [];
  if (typeof value !== 'string' || value.length > 12_000) throw new Error('Histórico de conversa inválido.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('O histórico da conversa não está em JSON válido.');
  }
  if (!Array.isArray(parsed) || parsed.length > 12) {
    throw new Error('Histórico de conversa excede o limite permitido.');
  }
  const turns: ContractChatTurn[] = [];
  for (const entry of parsed) {
    if (!entry || (entry.role !== 'user' && entry.role !== 'assistant') ||
        typeof entry.text !== 'string' || entry.text.length > 1800) {
      throw new Error('O histórico contém mensagens inválidas.');
    }
    if (entry.text.trim()) turns.push({ role: entry.role, text: entry.text.trim() });
  }
  return turns.slice(-6);
}

export class ContractController {
  public async analyze(req: Request, res: Response): Promise<void> {
    try {
      const acesso = await validarAcessoDiretoriaClarkRequest(req);
      if (!acesso.allowed) {
        res.status(acesso.status).json({ success: false, error: acesso.error });
        return;
      }

      const files = getFiles(req);
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      if (!files.length || files.length > MAX_CONTRACT_FILES) {
        res.status(400).json({ success: false, error: `Selecione entre 1 e ${MAX_CONTRACT_FILES} contratos PDF.` });
        return;
      }
      if (!question || question.length > MAX_QUESTION_CHARS) {
        res.status(400).json({ success: false, error: `A pergunta deve ter de 1 a ${MAX_QUESTION_CHARS} caracteres.` });
        return;
      }
      const bytes = files.reduce((sum, f) => sum + f.size, 0);
      if (bytes > MAX_CONTRACT_TOTAL_BYTES) {
        res.status(413).json({ success: false, error: 'O conjunto de contratos excede 30 MB. Remova um ou mais PDFs.' });
        return;
      }
      const names = new Set<string>();
      for (const file of files) {
        const uniqueName = file.originalname.trim().toLowerCase();
        if (!uniqueName || names.has(uniqueName)) {
          res.status(400).json({ success: false, error: 'Cada PDF deve ter um nome diferente para permitir citações inequívocas.' });
          return;
        }
        names.add(uniqueName);
        // Não confiar apenas na extensão/MIME enviados pelo navegador.
        if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
          res.status(400).json({ success: false, error: `"${file.originalname}" não é um arquivo PDF válido.` });
          return;
        }
      }

      let history: ContractChatTurn[];
      try {
        history = parseChatHistory(req.body?.history);
      } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      const documents: { name: string; text: string }[] = [];
      let totalChars = 0;
      for (const file of files) {
        let extracted: string;
        try {
          extracted = await pdfExtractorService.extractTextFromBuffer(file.buffer);
        } catch {
          res.status(422).json({
            success: false,
            error: `Não consegui extrair texto de "${file.originalname}". Verifique se o PDF possui texto selecionável (PDFs digitalizados precisam de OCR).`,
          });
          return;
        }
        totalChars += extracted.length;
        if (totalChars > MAX_CONTRACT_TEXT_CHARS) {
          res.status(413).json({
            success: false,
            error: 'O conjunto de contratos tem mais texto do que o limite seguro desta análise (150 mil caracteres). Separe em grupos menores. Nenhum texto foi cortado silenciosamente.',
          });
          return;
        }
        documents.push({ name: file.originalname.replace(/[\r\n<>]/g, '').trim(), text: extracted });
      }

      console.info(`[ContractController] Análise autorizada de ${documents.length} PDF(s), ${totalChars} caracteres.`);
      const answer = await contractAgentService.analyzeContract({ documents, userQuestion: question, history });
      res.json({
        success: true,
        answer,
        documents: documents.map((d) => ({ name: d.name, characters: d.text.length })),
      });
    } catch (error: any) {
      console.error('[ContractController] Falha na análise:', error);
      res.status(500).json({ success: false, error: error?.message || 'Erro interno na análise de contratos.' });
    }
  }
}

export const contractController = new ContractController();
