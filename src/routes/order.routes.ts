import { Router } from 'express';
import { syncOrders, getOrders, getSyncStatus } from '../controllers/order.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', getOrders);
router.get('/sync-status', getSyncStatus);
router.post('/sync', syncOrders);

export default router;
