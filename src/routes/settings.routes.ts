import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSettings, updateSettings, listFolders } from '../controllers/settings.controller';

const router = Router();

router.use(requireAuth);

router.get('/', getSettings);
router.put('/', updateSettings);
router.get('/drive/folders', listFolders);

export default router;
