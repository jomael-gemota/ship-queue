export type MatchMode = 'any' | 'all'

/** The kind of document a rule collects. Mirrors the enum on the rule model. */
export type DocumentType = 'order_confirmation' | 'invoice' | 'other'

export const DOCUMENT_TYPES: DocumentType[] = ['order_confirmation', 'invoice', 'other']

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  order_confirmation: 'Order Confirmation',
  invoice: 'Invoice',
  other: 'Other',
}

/** Shown under each option in the rule form's document type picker. */
export const DOCUMENT_TYPE_HINTS: Record<DocumentType, string> = {
  order_confirmation: 'Supplier acknowledgements of a placed order',
  invoice: 'Bills and statements to be paid',
  other: 'Anything that is neither of the above',
}

/** A distinct glyph per type, so a badge is recognisable before it is read. */
export const DOCUMENT_TYPE_ICONS: Record<DocumentType, string> = {
  order_confirmation:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  invoice:
    'M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  other:
    'M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z',
}

/** Rules and messages predating the field read as `other`. */
export function documentTypeOf(value?: DocumentType | null): DocumentType {
  return value && DOCUMENT_TYPES.includes(value) ? value : 'other'
}

/** A named extraction entry. Belongs to exactly one workspace. */
export interface DocTidyRule {
  _id: string
  /** The workspace this rule belongs to. */
  workspaceId?: string
  name: string
  description?: string
  enabled: boolean
  documentType: DocumentType

  fromAddresses: string[]
  /** Recipient/group addresses the message must have arrived under. */
  toAddresses: string[]
  subjectKeywords: string[]
  bodyKeywords: string[]
  excludeKeywords: string[]
  matchMode: MatchMode

  dateFrom?: string | null
  dateTo?: string | null
  lookbackDays?: number | null

  requireAttachment: boolean
  attachmentExtensions: string[]

  createdByName?: string
  lastRunAt?: string | null
  lastRunMatchCount?: number | null
  lastRunError?: string | null

  createdAt: string
  updatedAt: string
}

/** Editable shape used by the rule form — ids and run metadata excluded. */
export type DocTidyRuleInput = Omit<
  DocTidyRule,
  '_id' | 'createdAt' | 'updatedAt' | 'createdByName' | 'lastRunAt' | 'lastRunMatchCount' | 'lastRunError'
>

/** The blank rule the editor opens with. */
export const EMPTY_RULE: DocTidyRuleInput = {
  name: '',
  description: '',
  enabled: true,
  documentType: 'other',
  fromAddresses: [],
  toAddresses: [],
  subjectKeywords: [],
  bodyKeywords: [],
  excludeKeywords: [],
  matchMode: 'any',
  dateFrom: null,
  dateTo: null,
  lookbackDays: 30,
  requireAttachment: true,
  attachmentExtensions: [],
}

export interface DocTidyAttachment {
  filename: string
  mimeType: string
  size: number
  driveFileId?: string
  webViewLink?: string
  uploadError?: string
}

export interface DocTidyMessage {
  _id: string
  ruleId?: string
  ruleName?: string
  /** Copied from the rule at capture time; absent on older messages. */
  documentType?: DocumentType
  gmailMessageId: string
  threadId?: string
  from: string
  fromName?: string
  to: string[]
  subject: string
  snippet?: string
  /** Only returned by the detail endpoint. */
  bodyText?: string
  sentAt: string
  attachments: DocTidyAttachment[]
  hasAttachments: boolean
  extractedAt: string
  /** Parse state for this message's attachments, joined by the list endpoint. */
  parseJobs?: ParseJobSummary[]
}

export interface DocTidyMessagesResponse {
  data: DocTidyMessage[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

export interface DocTidyConfig {
  mailboxConnected: boolean
  mailboxEmail: string | null
  connectedAt: string | null
  connectedByName: string | null
  driveFolderId: string | null
  driveFolderName: string | null
  /** How often the background poller checks the mailbox (seconds). */
  pollerIntervalSeconds?: number | null
  /** ISO timestamp of the last completed poll cycle on the server. */
  lastPollAt?: string | null
}

/** Result of running a single rule. */
export interface RunRuleResult {
  matched: number
  imported: number
  updated: number
  attachmentsUploaded: number
  attachmentErrors: number
  query: string
}

export interface RunAllResult {
  results: {
    ruleId: string
    name: string
    matched?: number
    imported?: number
    error?: string
  }[]
}

/** Pushed over `/doc-tidy/stream` when the server stores new messages. */
export interface DocTidyEvent {
  type: 'imported' | 'ping' | 'connected' | 'parse_status' | 'worker_status' | 'ui_prefs'
  imported?: number
  /** For `parse_status`, so a table can move one chip without refetching. */
  parseJobId?: string
  parseStatus?: ParseJobStatus
  /** For `worker_status`: whether the Python worker is currently connected. */
  workerOnline?: boolean
  /**
   * For `ui_prefs`: updated column orders broadcast to all open clients so
   * every tab reflects the change immediately.
   */
  auditColumnOrder?: string[]
  wsEmailColumnOrder?: string[]
  pdfImportColOrder?: string[]
  at?: string
}

export const PAGE_SIZE_OPTIONS = [500, 1000, 2000, 5000]

/* ------------------------------------------------------------ agent parsing */

export type ParseJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export const PARSE_STATUS_LABELS: Record<ParseJobStatus, string> = {
  pending: 'Queued',
  processing: 'Parsing',
  completed: 'Parsed',
  failed: 'Failed',
}

/** In flight, so the UI should keep a stream open and animate the chip. */
export function isParseRunning(status?: ParseJobStatus | null): boolean {
  return status === 'pending' || status === 'processing'
}

/** What the messages list carries per attachment, without the transcript. */
export interface ParseJobSummary {
  _id: string
  messageId: string
  attachmentIndex: number
  status: ParseJobStatus
  error?: string | null
  completedAt?: string | null
  vendorName?: string | null
  vendorNeedsSetup?: boolean
}

/** A table the agent produced from the extracted JSON, for the Tables tab. */
export interface AgentTable {
  title?: string
  columns: string[]
  rows: (string | number | boolean | null)[][]
}

export interface TableOutput {
  tables: AgentTable[]
}

export interface DocTidyParseJob extends ParseJobSummary {
  filename: string
  driveFileId?: string
  /** The agent's full transcript. Empty until the first token arrives. */
  thinking: string
  jsonOutput?: Record<string, unknown> | null
  tableOutput?: TableOutput | null
  documentTextSample?: string
  requestedByName?: string
  createdAt: string
  updatedAt: string
}

export type CorrectionMode = 'json' | 'tabular'

export interface DocTidyCorrection {
  _id: string
  parseJobId: string
  filename: string
  vendorName: string | null
  originalOutput?: Record<string, unknown> | null
  correctedOutput: Record<string, unknown>
  mode?: CorrectionMode
  correctedTables?: AgentTable[]
  note?: string
  createdByName?: string
  createdAt: string
}

export interface DocTidyVendor {
  _id: string
  /** The workspace this vendor belongs to. */
  workspaceId?: string
  name: string
  normalizedName: string
  skuSamples: string[]
  skuSample?: string | null
  createdByName?: string
  /** How much this vendor has actually taught the agent. */
  correctionCount: number
  createdAt: string
  updatedAt: string
}

/** Events on `/doc-tidy/parse-jobs/:id/stream`. */
export interface ParseStreamEvent {
  type: 'connected' | 'thinking' | 'output' | 'status' | 'done' | 'error'
  content?: string
  status?: ParseJobStatus
  message?: string
  json?: Record<string, unknown> | null
  table?: TableOutput | null
}

/** Every sample the agent should anchor on, including the legacy single field. */
export function vendorSamples(vendor: DocTidyVendor): string[] {
  const samples = [...(vendor.skuSamples ?? [])]
  if (vendor.skuSample) samples.push(vendor.skuSample)
  return [...new Set(samples)]
}

/**
 * Canonical key for matching a correction to a vendor.
 *
 * Must stay identical to `normalizeVendorName()` in `src/models/DocTidyVendor.ts`
 * and `normalize_vendor_name()` in `worker/sku.py`. If this diverges, the UI
 * groups corrections differently from how the worker scopes retrieval — which is
 * the exact failure the grouping exists to expose.
 */
export function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/* ──────────────────────────────────────────── Invoice Workspaces ── */

/**
 * A named workspace that owns a set of filter rules (one-to-many via
 * `rule.workspaceId`). Rules are managed from within the workspace.
 */
export interface DocTidyWorkspace {
  _id: string
  name: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}

/* ──────────────────────────────── Workspace Emails column types ── */

/**
 * Draggable column ids for the Workspace Emails table.
 * The fixed checkbox (first) and actions (last) columns are not included.
 */
export type WorkspaceEmailColumnId =
  | 'received'
  | 'from'
  | 'to'
  | 'subject'
  | 'documentType'
  | 'rule'
  | 'attachments'

export interface WorkspaceEmailColumn {
  id: WorkspaceEmailColumnId
  label: string
  iconPath: string
}

export const WORKSPACE_EMAIL_COLUMNS: WorkspaceEmailColumn[] = [
  {
    id: 'received',
    label: 'Received',
    iconPath: 'M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z',
  },
  {
    id: 'from',
    label: 'From',
    iconPath: 'M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207',
  },
  {
    id: 'to',
    label: 'To',
    iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    id: 'subject',
    label: 'Subject',
    iconPath: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
  {
    id: 'documentType',
    label: 'Document type',
    iconPath: 'M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    id: 'rule',
    label: 'Rule',
    iconPath: 'M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z',
  },
  {
    id: 'attachments',
    label: 'Attachments',
    iconPath: 'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
  },
]

/* ─────────────────────────────────────────────── Invoice Audit ── */

/** A completed parse job as returned by `GET /doc-tidy/parse-jobs`. */
export interface ParseJobListItem {
  _id: string
  messageId: string
  attachmentIndex: number
  filename: string
  driveFileId?: string
  status: ParseJobStatus
  jsonOutput?: Record<string, unknown> | null
  tableOutput?: { tables: AgentTable[] } | null
  vendorName?: string | null
  vendorNeedsSetup?: boolean
  error?: string | null
  requestedByName?: string
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  /** Where this job originated. Present on jobs created after 2026-09-22. */
  source?: 'email' | 'pdf-import'
}

export interface ParseJobsResponse {
  data: ParseJobListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

/** All column ids available in the redesigned Invoice Audit table (v2). */
export type InvoiceAuditColumnId =
  // ── Order import fields ──
  | 'poNumber'
  | 'orderSku'
  | 'orderQty'
  | 'customerName'
  | 'purchasedDate'
  | 'status'
  // ── Invoice fields (from parsed PDFs) ──
  | 'invoiceSku'
  | 'invoiceDate'
  | 'invoiceNumber'
  | 'terms'
  | 'itemCost'
  | 'dcCogs'
  | 'invoiceQty'
  | 'discountedCostPct'
  | 'dropshipFee'
  | 'miscCharges'
  | 'totalCost'
  // ── Computed ──
  | 'discrepancy'

/** Which logical section a column belongs to (used by the settings drawer). */
export type InvoiceAuditColumnSection = 'order' | 'invoice' | 'computed'

export interface InvoiceAuditColumn {
  id: InvoiceAuditColumnId
  label: string
  description: string
  defaultVisible: boolean
  section: InvoiceAuditColumnSection
  /** Right-align header and cell; apply tabular-nums. */
  numeric?: boolean
  /** Render cell value in monospace. */
  mono?: boolean
}

export const INVOICE_AUDIT_COLUMNS: InvoiceAuditColumn[] = [
  // ── Order fields ──
  { id: 'poNumber',           section: 'order',    label: 'PO #',            description: 'Purchase order number from the imported order file',               defaultVisible: true,  mono: true    },
  { id: 'orderSku',           section: 'order',    label: 'Order SKU',       description: 'SKU as it appears in the imported order file',                     defaultVisible: true,  mono: true    },
  { id: 'orderQty',           section: 'order',    label: 'Order Qty',       description: 'Quantity ordered (from the imported order file)',                  defaultVisible: true,  numeric: true },
  { id: 'customerName',       section: 'order',    label: 'Customer Name',   description: 'Customer name from the imported order file',                       defaultVisible: true                 },
  { id: 'purchasedDate',      section: 'order',    label: 'Purchased Date',  description: 'Date the order was purchased (from the imported order file)',      defaultVisible: true                 },
  { id: 'status',             section: 'order',    label: 'Status',          description: 'Order status from the imported order file',                        defaultVisible: true                 },
  // ── Invoice fields ──
  { id: 'invoiceSku',         section: 'invoice',  label: 'Invoice SKU',                       description: 'SKU extracted from the matched invoice line item',                 defaultVisible: true,  mono: true   },
  { id: 'invoiceDate',        section: 'invoice',  label: 'Invoice Date',                      description: 'Date printed on the matched invoice',                              defaultVisible: true               },
  { id: 'invoiceNumber',      section: 'invoice',  label: 'Invoice #',                         description: 'Invoice number from the matched invoice',                          defaultVisible: true,  mono: true   },
  { id: 'terms',              section: 'invoice',  label: 'Terms',                             description: 'Payment terms (e.g. Net 30) from the matched invoice',             defaultVisible: false              },
  { id: 'itemCost',           section: 'invoice',  label: 'Item Cost',                         description: 'Unit price / item cost from the matched invoice line item',        defaultVisible: true,  numeric: true },
  { id: 'dcCogs',             section: 'invoice',  label: 'DC COGS',                           description: 'Distribution center cost of goods sold (future source)',           defaultVisible: false, numeric: true },
  { id: 'invoiceQty',         section: 'invoice',  label: 'Invoice Qty',                       description: 'Quantity on the matched invoice line item',                        defaultVisible: true,  numeric: true },
  { id: 'discountedCostPct',  section: 'invoice',  label: 'Disc. Cost/%',                      description: 'Discounted unit price and discount percentage from the invoice',   defaultVisible: true,  numeric: true },
  { id: 'dropshipFee',        section: 'invoice',  label: 'DS Fee',                            description: 'Dropship fee extracted from the matched invoice',                  defaultVisible: false, numeric: true },
  { id: 'miscCharges',        section: 'invoice',  label: 'Misc. Charges',                     description: 'Miscellaneous charges extracted from the matched invoice',         defaultVisible: false, numeric: true },
  { id: 'totalCost',          section: 'invoice',  label: 'Total Cost',                        description: 'Total line cost including tax and dropship fees',                  defaultVisible: true,  numeric: true },
  // ── Computed ──
  { id: 'discrepancy',        section: 'computed', label: 'Discrepancy',                       description: 'Flags mismatches: Order SKU vs Invoice SKU, Order Qty vs Invoice Qty', defaultVisible: true },
]

/** Default order mirrors the declaration order in INVOICE_AUDIT_COLUMNS. */
export const DEFAULT_AUDIT_COL_ORDER: InvoiceAuditColumnId[] = INVOICE_AUDIT_COLUMNS.map((c) => c.id)

/** Default order mirrors the declaration order in WORKSPACE_EMAIL_COLUMNS. */
export const DEFAULT_EMAIL_COL_ORDER: WorkspaceEmailColumnId[] = WORKSPACE_EMAIL_COLUMNS.map((c) => c.id)

/**
 * v3 key — bumped from v2 when Customer Name, Purchased Date and Status were
 * added (2026-09-25).  Old v2 preferences are ignored so new columns appear in
 * their correct positions rather than being appended at the far right.
 */
const AUDIT_COL_STORAGE_KEY = 'docTidy.invoiceAudit.columns.v3'

/** Load per-column visibility from localStorage, falling back to defaults. */
export function loadAuditColumnVisibility(): Record<InvoiceAuditColumnId, boolean> {
  const defaults = Object.fromEntries(
    INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c.defaultVisible])
  ) as Record<InvoiceAuditColumnId, boolean>

  try {
    const raw = localStorage.getItem(AUDIT_COL_STORAGE_KEY)
    if (!raw) return defaults
    const stored = JSON.parse(raw) as Partial<Record<InvoiceAuditColumnId, boolean>>
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

/** Persist column visibility to localStorage. */
export function saveAuditColumnVisibility(visibility: Record<InvoiceAuditColumnId, boolean>): void {
  try {
    localStorage.setItem(AUDIT_COL_STORAGE_KEY, JSON.stringify(visibility))
  } catch {
    // localStorage can be blocked in some environments — silently ignore.
  }
}

const AUDIT_COLLAPSED_WEEKS_KEY = 'docTidy.invoiceAudit.collapsedWeeks'

/** Load the set of collapsed week-start keys from localStorage. */
export function loadCollapsedWeeks(): Set<string> {
  try {
    const raw = localStorage.getItem(AUDIT_COLLAPSED_WEEKS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

/** Persist the set of collapsed week-start keys to localStorage. */
export function saveCollapsedWeeks(keys: Set<string>): void {
  try {
    localStorage.setItem(AUDIT_COLLAPSED_WEEKS_KEY, JSON.stringify(Array.from(keys)))
  } catch {
    // localStorage can be blocked in some environments — silently ignore.
  }
}

/**
 * Extract a scalar value from a free-form AI JSON output, trying multiple
 * common field-name variants. Keys are normalised to lowercase with all
 * separators (`_`, `-`, spaces) stripped before comparison.
 */
export function extractJsonField(
  json: Record<string, unknown> | null | undefined,
  ...candidates: string[]
): string {
  if (!json) return ''
  const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]+/g, '')
  for (const key of candidates) {
    const target = norm(key)
    for (const [k, v] of Object.entries(json)) {
      if (norm(k) !== target) continue
      if (v === null || v === undefined) continue
      if (typeof v === 'string') return v.trim()
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      if (Array.isArray(v)) return '' // arrays handled separately
      return ''
    }
  }
  return ''
}

/**
 * Extract an array value (e.g. line_items) from the JSON output.
 * Returns an empty array if not found or not an array.
 */
export function extractJsonArray(
  json: Record<string, unknown> | null | undefined,
  ...candidates: string[]
): Record<string, unknown>[] {
  if (!json) return []
  const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]+/g, '')
  for (const key of candidates) {
    const target = norm(key)
    for (const [k, v] of Object.entries(json)) {
      if (norm(k) !== target) continue
      if (Array.isArray(v)) return v as Record<string, unknown>[]
    }
  }
  return []
}

/* ─────────────────────────── (Legacy) Line Item Column types ─ removed ── */
// Superseded by the redesigned InvoiceAuditColumnId set (2026-09-24).
/** @deprecated Use the new InvoiceAuditColumnId variants instead. */
export type LineItemColumnId = never

/* ──────────────────────────────────────── Order Imports ── */

/**
 * One order-line record imported from a CSV or XLSX file.
 * These are the **primary rows** in the Invoice Audit table.
 */
export interface DocTidyOrderImport {
  _id: string
  workspaceId: string
  /** Groups all rows from the same file upload. */
  importBatchId: string
  processedDate: string
  poNumber: string
  purchasedDate: string
  customerName: string
  orderId: string
  orderSku: string
  orderQty: string
  status: string
  importedByUserId?: string
  importedByName?: string
  /**
   * DC cost of goods sold from the Channel Precision API.
   * `null`  = not yet fetched
   * `"n/a"` = fetched, SKU not found
   * Any other string = the cost value
   */
  dcCogs?: string | null
  dcMsrp?: string | null
  dcCogsAt?: string | null
  /**
   * Inline invoice match cache — written by the server the moment a matching
   * parse job completes.  When present the audit table reads these fields
   * directly instead of loading all parse jobs for client-side matching.
   */
  matchedInvoice?: MatchedInvoiceCache | null
  createdAt: string
  updatedAt: string
}

/** Mirror of IMatchedInvoice from the backend model. */
export interface MatchedInvoiceCache {
  jobId: string
  driveFileId?: string
  invoiceSku?: string
  invoiceDate?: string
  invoiceNumber?: string
  terms?: string
  itemCost?: string
  invoiceQty?: string
  discountedPrice?: string
  discountPct?: string
  dropshipFee?: string
  miscCharges?: string
  totalCost?: string
  cachedAt: string
}

export interface OrderImportsResponse {
  data: DocTidyOrderImport[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
}

/* ──────────────────────────────────────── Direct PDF Imports ── */

/**
 * A PDF file uploaded directly by a user for Tidy Agent parsing,
 * outside the email-capture flow.
 */
/* ────────────────────────────────── PDF Import columns ── */

export type PdfImportColumnId = 'imported' | 'importedBy' | 'size' | 'filename'

export interface PdfImportColumn {
  id: PdfImportColumnId
  label: string
  iconPath: string
  align?: 'left' | 'right'
}

export const PDF_IMPORT_COLUMNS: PdfImportColumn[] = [
  {
    id: 'imported',
    label: 'Imported',
    iconPath: 'M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z',
  },
  {
    id: 'importedBy',
    label: 'Imported By',
    iconPath: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'size',
    label: 'Size',
    iconPath: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    align: 'right',
  },
  {
    id: 'filename',
    label: 'Filename',
    iconPath: 'M9 12h6m-6 4h4m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
]

export const DEFAULT_PDF_IMPORT_COL_ORDER: PdfImportColumnId[] = PDF_IMPORT_COLUMNS.map((c) => c.id)

/* ──────────────────────────────────────── Direct PDF Imports ── */

/** Slim parse job summary returned inline on PDF import list rows. */
export interface PdfImportParseJob {
  _id: string
  status: ParseJobStatus
  error?: string | null
}

export interface PdfImport {
  _id: string
  workspaceId: string
  filename: string
  /** File size in bytes. */
  size: number
  /** GridFS file id (opaque to the frontend). */
  pdfFileId: string
  /** Drive file id if the PDF was successfully mirrored to the Drive folder. */
  driveFileId?: string | null
  /** Drive web-view link for the mirrored file. */
  driveWebViewLink?: string | null
  /** Populated once the import has been sent to the Tidy Agent. */
  parseJobId?: string | null
  /**
   * Inline parse job summary populated by the list endpoint.
   * Present when `parseJobId` is set.
   */
  parseJob?: PdfImportParseJob | null
  uploadedByUserId?: string
  uploadedByName?: string
  createdAt: string
  updatedAt: string
}

