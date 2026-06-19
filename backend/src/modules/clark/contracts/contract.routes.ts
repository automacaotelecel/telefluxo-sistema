import { Router } from 'express';
import multer from 'multer';
import { contractController } from './contract.controller';

const contractRoutes = Router();

// Configuração de Segurança do Multer
const upload = multer({
  storage: multer.memoryStorage(), // Mantém na RAM, não salva no disco do servidor
  limits: {
    fileSize: 10 * 1024 * 1024, // Limite de 10 Megabytes por PDF (proteção de RAM)
  },
  fileFilter: (req, file, cb) => {
    // Filtro rigoroso: garante que apenas PDFs sejam processados
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas arquivos PDF são permitidos.'));
    }
  },
});

// Rota POST: /api/contracts/analyze
// Espera um form-data com um campo 'pdf' (arquivo) e um campo 'question' (texto)
contractRoutes.post(
  '/analyze',
  upload.single('pdf'),
  contractController.analyze.bind(contractController)
);

export { contractRoutes };