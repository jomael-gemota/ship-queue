import { Router } from 'express';
import authRoutes from './auth.routes';
import shipmentRoutes from './shipment.routes';
import orderRoutes from './order.routes';
import labelRoutes from './label.routes';
import settingsRoutes from './settings.routes';
import adminRoutes from './admin.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/orders', orderRoutes);
router.use('/labels', labelRoutes);
router.use('/settings', settingsRoutes);
router.use('/admin', adminRoutes);

export default router;
