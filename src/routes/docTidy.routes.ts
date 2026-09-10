import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  runRuleById,
  runAllRules,
  getMessages,
  getMessageById,
  streamEvents,
  getConfig,
  updateConfig,
  disconnectMailbox,
  listConfigFolders,
} from '../controllers/docTidy.controller';

const router = Router();

router.use(requireAuth);

// Extraction rules are shared team-wide; any signed-in user may manage them.
router.get('/rules', listRules);
router.post('/rules', createRule);
router.put('/rules/:id', updateRule);
router.delete('/rules/:id', deleteRule);

router.post('/rules/:id/run', runRuleById);
router.post('/run', runAllRules);

router.get('/messages', getMessages);
router.get('/messages/:id', getMessageById);

// Long-lived SSE stream: tells open results tables when to refetch.
router.get('/stream', streamEvents);

// The mailbox connection and attachment destination are admin-managed.
router.get('/config', getConfig);
router.put('/config', requireAdmin, updateConfig);
router.delete('/config/mailbox', requireAdmin, disconnectMailbox);
router.get('/config/folders', requireAdmin, listConfigFolders);

export default router;
