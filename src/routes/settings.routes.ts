import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSettings, updateSettings, listFolders, disconnectDrive } from '../controllers/settings.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getSettings);
router.put('/', updateSettings);
router.get('/drive/folders', listFolders);
router.delete('/drive', disconnectDrive);

export default router;
