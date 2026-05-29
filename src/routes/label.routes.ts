import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  prepareLabels,
  createLabels,
  getLabels,
  getLabelPdf,
  draftBatch,
  getBatches,
  getBatchItems,
  createBatchLabels,
  deleteBatch,
} from '../controllers/label.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getLabels);
router.post('/prepare', prepareLabels);
router.post('/create', createLabels);

// Batch-oriented flow: draft → review → create + print
router.get('/batches', getBatches);
router.post('/batches', draftBatch);
router.get('/batches/:id/items', getBatchItems);
router.post('/batches/:id/create', createBatchLabels);
router.delete('/batches/:id', deleteBatch);

router.get('/:id/pdf', getLabelPdf);

export default router;
