import { Router } from 'express';

import {
  getProductMasterCacheInfo,
  getProductMasterGroups,
  refreshProductMaster,
  resolveProductMaster,
} from './productMaster.service';
import {
  listProductMasterIssues,
  recordProductMasterIssue,
  resolveProductMasterIssue,
} from './productMasterIssues.service';

const router = Router();

router.get('/status', async (_req, res) => {
  try {
    res.json({ success: true, ...getProductMasterCacheInfo() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

router.post('/refresh', async (_req, res) => {
  try {
    const current = await refreshProductMaster();
    res.json({
      success: true,
      ...getProductMasterCacheInfo(),
      rows: current.rows.length,
      groups: current.groups.length,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

router.get('/lookup', async (req, res) => {
  try {
    const resolution = await resolveProductMaster({
      productCode: req.query.productCode,
      barcode: req.query.barcode,
      sku: req.query.sku,
      reference: req.query.reference,
      description: req.query.description,
      source: String(req.query.source || 'API_LOOKUP'),
    });

    if (resolution.status !== 'MASTER') {
      await recordProductMasterIssue({
        source: String(req.query.source || 'API_LOOKUP'),
        productCode: req.query.productCode,
        barcode: req.query.barcode,
        sku: req.query.sku,
        reference: req.query.reference,
        description: req.query.description,
        status: resolution.status === 'FALLBACK'
          ? 'FALLBACK'
          : resolution.status === 'AMBIGUOUS'
            ? 'AMBIGUOUS'
            : 'UNMAPPED',
        telefluxoCode: resolution.telefluxoCode,
        matchBy: resolution.matchBy,
        details: resolution.message,
      });
    }

    res.json({ success: true, resolution });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

router.get('/issues', async (req, res) => {
  try {
    const issues = await listProductMasterIssues({
      includeResolved: String(req.query.includeResolved || '') === 'true',
      limit: Number(req.query.limit || 200),
    });

    res.json({ success: true, issues });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

router.put('/issues/:id/resolve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: 'ID inválido.' });
  }

  try {
    await resolveProductMasterIssue(id);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

router.get('/groups', async (_req, res) => {
  try {
    const groups = await getProductMasterGroups();
    res.json({ success: true, groups });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

export default router;
