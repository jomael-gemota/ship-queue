import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  createBulkOrder,
  deleteBulkOrder,
  getBulkOrder,
  getBulkOrderProductImage,
  checkBulkOrderShipmentItem,
  commitBulkOrderShipmentItems,
  getBulkOrderShipmentItems,
  importBulkOrderShipmentItems,
  listBulkOrders,
  previewBulkOrderShipmentItems,
  updateBulkOrder,
} from '../controllers/bulkOrder.controller';
import {
  checkBulkOrderSession,
  getBulkOrderCatalogs,
  getBulkOrderConfig,
  getBulkOrderShipTos,
  getBulkOrderSoldTos,
  testBulkOrderWebhook,
  updateBulkOrderConfig,
} from '../controllers/bulkOrderConfig.controller';

const router = Router();

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.csv')) {
      cb(null, true);
      return;
    }
    cb(new Error('Upload an .xlsx or .csv file.'));
  },
});

function handleItemUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: 'File is too large (max 5 MB).' });
      return;
    }
    const message = err instanceof Error ? err.message : 'Upload failed.';
    res.status(400).json({ message });
  });
}

router.use(requireAuth);

router.get('/resources/:resource', getBulkOrderProductImage);
router.get('/orders', listBulkOrders);
router.post('/orders', createBulkOrder);
router.get('/orders/:id/shipments/:shipmentIndex/items', getBulkOrderShipmentItems);
router.post('/orders/:id/shipments/:shipmentIndex/items/preview', handleItemUpload, previewBulkOrderShipmentItems);
router.post('/orders/:id/shipments/:shipmentIndex/items/check', checkBulkOrderShipmentItem);
router.post('/orders/:id/shipments/:shipmentIndex/items/commit', commitBulkOrderShipmentItems);
router.post('/orders/:id/shipments/:shipmentIndex/items', handleItemUpload, importBulkOrderShipmentItems);
router.get('/orders/:id', getBulkOrder);
router.patch('/orders/:id', updateBulkOrder);
router.delete('/orders/:id', deleteBulkOrder);
router.get('/config', getBulkOrderConfig);
router.get('/ship-tos', getBulkOrderShipTos);
router.get('/sold-tos', getBulkOrderSoldTos);
router.get('/catalogs', getBulkOrderCatalogs);
router.patch('/config', requireAdmin, updateBulkOrderConfig);
router.post('/config/session-check', requireAdmin, checkBulkOrderSession);
router.post('/config/webhook-test', requireAdmin, testBulkOrderWebhook);

export default router;
