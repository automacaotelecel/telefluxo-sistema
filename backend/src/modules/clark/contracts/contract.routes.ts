import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { contractController, MAX_CONTRACT_FILES } from './contract.controller';

const contractRoutes = Router();

// Em memória, sem escrever o PDF no disco. Os limites são validados também
// no controller, pois arquivos individuais válidos podem exceder o total.
export const MAX_CONTRACT_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_CONTRACT_FILES,
    fileSize: MAX_CONTRACT_FILE_BYTES,
    fields: 5,
    fieldSize: 12 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error('Envie apenas documentos PDF válidos (.pdf).'));
  },
});

// Aceita a nova lista "pdfs" e, por compatibilidade, o campo legado "pdf".
const receiveContracts = upload.fields([
  { name: 'pdfs', maxCount: MAX_CONTRACT_FILES },
  { name: 'pdf', maxCount: 1 },
]);

contractRoutes.post('/analyze', (req: Request, res: Response, next: NextFunction) => {
  receiveContracts(req, res, (error: any) => {
    if (!error) {
      next();
      return;
    }
    const tooLarge = error instanceof multer.MulterError &&
      ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_FIELD_VALUE'].includes(error.code);
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Cada contrato pode ter no máximo 10 MB.'
      : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
        ? `Envie no máximo ${MAX_CONTRACT_FILES} contratos PDF por análise.`
        : error.message || 'Não foi possível receber os contratos.';
    res.status(tooLarge ? 413 : 400).json({ success: false, error: message });
  });
}, contractController.analyze.bind(contractController));

export { contractRoutes };
