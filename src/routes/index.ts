import { Router } from 'express';
import authRoutes from './auth.routes';
import shipmentRoutes from './shipment.routes';
import orderRoutes from './order.routes';
import labelRoutes from './label.routes';
import settingsRoutes from './settings.routes';
import adminRoutes from './admin.routes';
import dropboxRoutes from './dropbox.routes';
import hhSportswearRoutes from './hhSportswear.routes';
import { attachHhBrand } from '../lib/hhBrand';

const router = Router();

router.use('/auth', authRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/orders', orderRoutes);
router.use('/labels', labelRoutes);
router.use('/settings', settingsRoutes);
router.use('/admin', adminRoutes);
router.use('/dropbox', dropboxRoutes);
router.use('/hh-sportswear', attachHhBrand('sportswear'), hhSportswearRoutes);
router.use('/hh-workwear', attachHhBrand('workwear'), hhSportswearRoutes);

export default router;
