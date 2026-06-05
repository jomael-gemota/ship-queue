import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  getSettings,
  updateSettings,
  listFolders,
  disconnectDrive,
  disconnectDropbox,
  getSyncConfig,
  updateSyncConfig,
} from '../controllers/settings.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getSettings);
router.put('/', updateSettings);
router.get('/drive/folders', listFolders);
router.delete('/drive', disconnectDrive);
router.delete('/dropbox', disconnectDropbox);

router.get('/sync', getSyncConfig);
router.put('/sync', requireAdmin, updateSyncConfig);

export default router;
