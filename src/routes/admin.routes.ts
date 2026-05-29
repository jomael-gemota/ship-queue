import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listUsers, updateUserPermissions } from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/users', listUsers);
router.patch('/users/:id/permissions', updateUserPermissions);

export default router;
