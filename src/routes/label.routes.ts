import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  prepareLabels,
  createLabels,
  getLabels,
  getLabelPdf,
} from '../controllers/label.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getLabels);
router.post('/prepare', prepareLabels);
router.post('/create', createLabels);
router.get('/:id/pdf', getLabelPdf);

export default router;
