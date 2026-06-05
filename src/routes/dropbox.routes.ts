import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listFolders, extractLinks, extractLinksStream, savePreferences } from '../controllers/dropbox.controller';

const router = Router();

router.use(requireAuth);

router.get('/folders', listFolders);
router.post('/links', extractLinks);
router.post('/links/stream', extractLinksStream);
router.put('/preferences', savePreferences);

export default router;
