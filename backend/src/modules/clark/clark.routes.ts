import { Router } from 'express';
import {
  perguntarClarkController,
  exportarRelatorioExcelClark,
  obterMemoriaClarkController,
  limparMemoriaClarkController,
  gerarRelatorioExecutivoClarkController,
} from './clark.controller';

const router = Router();

router.post('/perguntar', perguntarClarkController);
router.get('/memory', obterMemoriaClarkController);
router.delete('/memory', limparMemoriaClarkController);
router.post('/relatorio/executivo', gerarRelatorioExecutivoClarkController);
router.post('/relatorio/excel', exportarRelatorioExcelClark);

export default router;