import { Router } from 'express';
import {
  getShipments,
  getShipmentById,
  createShipment,
  updateShipment,
  deleteShipment,
} from '../controllers/shipment.controller';

const router = Router();

router.get('/', getShipments);
router.get('/:id', getShipmentById);
router.post('/', createShipment);
router.put('/:id', updateShipment);
router.delete('/:id', deleteShipment);

export default router;
