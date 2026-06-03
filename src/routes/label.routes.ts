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
  refreshBatchItems,
  preflightBatch,
  createBatchLabels,
  deleteBatch,
} from '../controllers/label.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getLabels);
router.get('/batches', getBatches);
router.get('/batches/:id/items', getBatchItems);
router.post('/batches/:id/refresh', refreshBatchItems);
router.get('/:id/pdf', getLabelPdf);

// Label creation requires explicit permission
router.post('/prepare', requireLabelPermission, prepareLabels);
router.post('/create', requireLabelPermission, createLabels);
router.post('/batches', requireLabelPermission, draftBatch);
router.post('/batches/:id/preflight', requireLabelPermission, preflightBatch);
router.post('/batches/:id/create', requireLabelPermission, createBatchLabels);
router.delete('/batches/:id', deleteBatch);

export default router;
