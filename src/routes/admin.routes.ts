import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listUsers, updateUserPermissions, deleteUser } from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/users', listUsers);
router.patch('/users/:id/permissions', updateUserPermissions);
router.delete('/users/:id', deleteUser);

export default router;
