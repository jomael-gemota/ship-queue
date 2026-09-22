import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  createGroup,
  deleteGroup,
  deleteOrder,
  exportGroup,
  getGroup,
  getScSyncStatus,
  importGroup,
  listGroups,
  rerunGroupScSync,
  rerunOrderScSync,
  rerunGroupCartDraft,
  rerunOrderCartDraft,
  rerunGroupCartVerify,
  rerunOrderCartVerify,
  compareGroupCart,
  compareOrderCart,
  placeGroupCart,
  placeOrderCart,
  updateGroupNotes,
  updateOrderNotes,
} from '../controllers/hhSportswear.controller';
import { getHhB2bConfig, updateHhB2bConfig } from '../controllers/hhB2bConfig.controller';

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

function handleImportUpload(req: Request, res: Response, next: NextFunction): void {
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

router.get('/', listGroups);
router.post('/', createGroup);
router.post('/import', handleImportUpload, importGroup);
router.get('/config', getHhB2bConfig);
router.patch('/config', updateHhB2bConfig);
router.get('/sc-sync', getScSyncStatus);
router.post('/:groupId/sc-sync', rerunGroupScSync);
router.post('/:groupId/orders/:orderId/sc-sync', rerunOrderScSync);
router.post('/:groupId/cart-draft', rerunGroupCartDraft);
router.post('/:groupId/orders/:orderId/cart-draft', rerunOrderCartDraft);
router.post('/:groupId/cart-verify', rerunGroupCartVerify);
router.post('/:groupId/orders/:orderId/cart-verify', rerunOrderCartVerify);
router.post('/:groupId/cart-compare', compareGroupCart);
router.post('/:groupId/orders/:orderId/cart-compare', compareOrderCart);
router.post('/:groupId/place', placeGroupCart);
router.post('/:groupId/orders/:orderId/place', placeOrderCart);
router.get('/:groupId/export', exportGroup);
router.get('/:groupId', getGroup);
router.patch('/:groupId', updateGroupNotes);
router.patch('/:groupId/orders/:orderId', updateOrderNotes);
router.delete('/:groupId', deleteGroup);
router.delete('/:groupId/orders/:orderId', deleteOrder);

export default router;
