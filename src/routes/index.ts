import { Router } from 'express';
import shipmentRoutes from './shipment.routes';

const router = Router();

router.use('/shipments', shipmentRoutes);

export default router;
