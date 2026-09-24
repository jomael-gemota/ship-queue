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
  deleteMessage,
  streamEvents,
  getConfig,
  updateConfig,
  disconnectMailbox,
  listConfigFolders,
  getUiPrefs,
  putUiPrefs,
} from '../controllers/docTidy.controller';
import {
  getWorkerStatus,
  parseAttachment,
  rerunParseJob,
  abortParseJob,
  getParseJob,
  streamParseJob,
  setParseJobVendor,
  listJobCorrections,
  createJobCorrection,
  listCorrections,
  deleteCorrection,
  listVendors,
  upsertVendor,
  removeVendorSample,
  deleteVendor,
  listParseJobs,
} from '../controllers/docTidyParse.controller';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../controllers/docTidyWorkspace.controller';
import {
  pdfUpload,
  listPdfImports,
  uploadPdfImports,
  sendPdfImportToAgent,
  deletePdfImport,
} from '../controllers/docTidyPdfImport.controller';
import {
  orderImportUpload,
  listOrderImports,
  uploadOrderImports,
  deleteOrderImport,
  deleteOrderImportBatch,
  refreshCogsForWorkspace,
  rebuildMatchCache,
} from '../controllers/docTidyOrderImport.controller';

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
router.delete('/messages/:id', deleteMessage);

// Long-lived SSE stream: tells open results tables when to refetch.
router.get('/stream', streamEvents);

// Agent parsing. One job per attachment, run by the worker on the Hermes box.
router.get('/worker/status', getWorkerStatus);
router.post('/messages/:id/attachments/:index/parse', parseAttachment);
router.get('/parse-jobs', listParseJobs);
router.get('/parse-jobs/:id', getParseJob);
router.post('/parse-jobs/:id/rerun', rerunParseJob);
router.post('/parse-jobs/:id/abort', abortParseJob);
router.post('/parse-jobs/:id/vendor', setParseJobVendor);
// Per-job SSE: the agent's reasoning as it is produced.
router.get('/parse-jobs/:id/stream', streamParseJob);

// The learning loop.
router.get('/parse-jobs/:id/corrections', listJobCorrections);
router.post('/parse-jobs/:id/corrections', createJobCorrection);
router.get('/corrections', listCorrections);
router.delete('/corrections/:id', deleteCorrection);

router.get('/vendors', listVendors);
router.post('/vendors', upsertVendor);
router.post('/vendors/:name/samples/remove', removeVendorSample);
router.delete('/vendors/:name', deleteVendor);

// Invoice Audit workspaces — team-wide, any signed-in user may manage them.
router.get('/workspaces', listWorkspaces);
router.post('/workspaces', createWorkspace);
router.put('/workspaces/:id', updateWorkspace);
router.delete('/workspaces/:id', deleteWorkspace);

// Direct PDF uploads — any authenticated user may upload/manage their imports.
router.get('/pdf-imports', listPdfImports);
router.post('/pdf-imports', pdfUpload.array('files'), uploadPdfImports);
router.post('/pdf-imports/:id/parse', sendPdfImportToAgent);
router.delete('/pdf-imports/:id', deletePdfImport);

// Order imports (CSV/XLSX) — primary data source for the Invoice Audit table.
router.get('/order-imports', listOrderImports);
router.post('/order-imports', orderImportUpload.single('file'), uploadOrderImports);
// Re-trigger DC COGS lookup for all pending rows in a workspace.
router.post('/order-imports/workspace/:workspaceId/refresh-cogs', refreshCogsForWorkspace);
// Rebuild the inline invoice match cache for all uncached rows in a workspace.
router.post('/order-imports/workspace/:workspaceId/rebuild-match-cache', rebuildMatchCache);
router.delete('/order-imports/batch/:batchId', deleteOrderImportBatch);
router.delete('/order-imports/:id', deleteOrderImport);

// The mailbox connection and attachment destination are admin-managed.
router.get('/config', getConfig);
router.put('/config', requireAdmin, updateConfig);
router.delete('/config/mailbox', requireAdmin, disconnectMailbox);
router.get('/config/folders', requireAdmin, listConfigFolders);

// Shared UI preferences (column orders). Any authenticated user may read/write.
router.get('/ui-prefs', getUiPrefs);
router.put('/ui-prefs', putUiPrefs);

export default router;
