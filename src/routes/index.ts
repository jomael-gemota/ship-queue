import { Router } from 'express';
import authRoutes from './auth.routes';
import shipmentRoutes from './shipment.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/shipments', shipmentRoutes);

export default router;
