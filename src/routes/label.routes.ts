import { Router } from 'express';
import { requireAuth, requireLabelPermission } from '../middleware/auth';
import {
  prepareLabels,
  createLabels,
  getLabels,
  getLabelPdf,
  draftBatch,
  getBatches,
  getBatchItems,
  getBatchLabelsZip,
  refreshBatchItems,
  updateBatchShipDate,
  preflightBatch,
  createBatchLabels,
  deleteBatch,
  updateLabelItem,
  recreateLabelItem,
  preflightLabelItem,
} from '../controllers/label.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getLabels);
router.get('/batches', getBatches);
router.get('/batches/:id/items', getBatchItems);
router.get('/batches/:id/labels.zip', getBatchLabelsZip);
router.post('/batches/:id/refresh', refreshBatchItems);
router.get('/:id/pdf', getLabelPdf);

// Label creation requires explicit permission
router.post('/prepare', requireLabelPermission, prepareLabels);
router.post('/create', requireLabelPermission, createLabels);
router.post('/batches', requireLabelPermission, draftBatch);
router.patch('/batches/:id/ship-date', requireLabelPermission, updateBatchShipDate);
router.post('/batches/:id/preflight', requireLabelPermission, preflightBatch);
router.post('/batches/:id/create', requireLabelPermission, createBatchLabels);
router.patch('/:id', requireLabelPermission, updateLabelItem);
router.post('/:id/preflight', requireLabelPermission, preflightLabelItem);
router.post('/:id/recreate', requireLabelPermission, recreateLabelItem);
router.delete('/batches/:id', deleteBatch);

export default router;
