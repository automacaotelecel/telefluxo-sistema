import { Router } from 'express';
import {
  perguntarClarkController,
  exportarRelatorioExcelClark,
} from './clark.controller';

const router = Router();

router.post('/perguntar', perguntarClarkController);
router.post('/relatorio/excel', exportarRelatorioExcelClark);

export default router;