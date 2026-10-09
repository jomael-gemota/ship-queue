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
  bulkDeleteMessages,
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
  deleteParseJob,
  bulkDeleteParseJobs,
} from '../controllers/docTidyParse.controller';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../controllers/docTidyWorkspace.controller';
import {
  listEmailSources,
  deleteEmailSource,
} from '../controllers/docTidyEmailSource.controller';
import {
  listSpsSources,
  deleteSpsSource,
  querySpsDocuments,
  getSpsDocumentContent,
  queryTransactions,
} from '../controllers/docTidySpsSource.controller';
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listUsersForOrg,
} from '../controllers/docTidyOrganization.controller';
import {
  pdfUpload,
  listPdfImports,
  uploadPdfImports,
  sendPdfImportToAgent,
  deletePdfImport,
  bulkDeletePdfImports,
} from '../controllers/docTidyPdfImport.controller';
import {
  orderImportUpload,
  listOrderImports,
  uploadOrderImports,
  deleteOrderImport,
  deleteOrderImportBatch,
  bulkDeleteOrderImports,
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
router.post('/messages/bulk-delete', bulkDeleteMessages);

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
router.delete('/parse-jobs/:id', deleteParseJob);
router.post('/parse-jobs/bulk-delete', bulkDeleteParseJobs);
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

// Per-workspace email sources — list is accessible to all authenticated users;
// connect is handled in auth.routes.ts (any authenticated user);
// delete is open to any authenticated user (they manage their own workspace sources).
router.get('/workspaces/:workspaceId/email-sources', listEmailSources);
router.delete('/workspaces/:workspaceId/email-sources/:sourceId', deleteEmailSource);

// Per-workspace SPS Commerce sources — same access-control pattern as email sources.
// Connect is handled in auth.routes.ts (GET /auth/sps/workspaces/:workspaceId/connect).
router.get('/workspaces/:workspaceId/sps-sources', listSpsSources);
router.delete('/workspaces/:workspaceId/sps-sources/:sourceId', deleteSpsSource);
// Transaction API v5 document queue: list files + download individual EDI XML.
router.get('/workspaces/:workspaceId/sps-sources/:sourceId/documents', querySpsDocuments);
router.get('/workspaces/:workspaceId/sps-sources/:sourceId/documents/:docType/:filename', getSpsDocumentContent);
// Parsed transaction records: download + parse EDI files, return structured rows.
router.get('/workspaces/:workspaceId/sps-sources/:sourceId/transactions', queryTransactions);

// Organizations — any auth user may list; only admins may create/modify/delete.
router.get('/organizations', listOrganizations);
router.get('/organizations/users', requireAdmin, listUsersForOrg);
router.post('/organizations', requireAdmin, createOrganization);
router.put('/organizations/:id', requireAdmin, updateOrganization);
router.delete('/organizations/:id', requireAdmin, deleteOrganization);

// Direct PDF uploads — any authenticated user may upload/manage their imports.
router.get('/pdf-imports', listPdfImports);
router.post('/pdf-imports', pdfUpload.array('files'), uploadPdfImports);
router.post('/pdf-imports/:id/parse', sendPdfImportToAgent);
router.delete('/pdf-imports/:id', deletePdfImport);
router.post('/pdf-imports/bulk-delete', bulkDeletePdfImports);

// Order imports (CSV/XLSX) — primary data source for the Invoice Audit table.
router.get('/order-imports', listOrderImports);
router.post('/order-imports', orderImportUpload.single('file'), uploadOrderImports);
// Re-trigger DC COGS lookup for all pending rows in a workspace.
router.post('/order-imports/workspace/:workspaceId/refresh-cogs', refreshCogsForWorkspace);
// Rebuild the inline invoice match cache for all uncached rows in a workspace.
router.post('/order-imports/workspace/:workspaceId/rebuild-match-cache', rebuildMatchCache);
router.delete('/order-imports/batch/:batchId', deleteOrderImportBatch);
router.post('/order-imports/bulk-delete', bulkDeleteOrderImports);
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
