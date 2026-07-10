import { Router } from 'express';
import multer from 'multer';
import {
  analisarPrecosOnlineController,
  baixarRelatorioPrecosOnlineController,
} from './onlinePrices.controller';

const onlinePricesRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const allowedMime = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/octet-stream',
    ];

    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm') || allowedMime.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Formato inválido. Envie uma planilha Excel .xlsx, .xls ou .xlsm.'));
  },
});

onlinePricesRoutes.post('/analyze', upload.single('xlsx'), analisarPrecosOnlineController);
onlinePricesRoutes.get('/report/:fileName', baixarRelatorioPrecosOnlineController);

export { onlinePricesRoutes };
