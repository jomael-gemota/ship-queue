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
    /** Messages in the workspace that have at least one completed parse job. */
    parsedCount: number
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
  /** Whether the background poller is actively fetching emails right now. */
  pollerRunning?: boolean
  /** ISO timestamp of the last completed poll cycle on the server. */
  lastPollAt?: string | null
  /** ISO timestamp of the last time the poller successfully imported messages. */
  lastImportAt?: string | null
  /** Error message from the last failed poll, or null if the last poll succeeded. */
  lastPollError?: string | null
}

/** Result of running a single rule. */
export interface RunRuleResult {
  matched: number
  imported: number
  updated: number
  attachmentsUploaded: number
  attachmentErrors: number
  duplicatesMerged: number
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
  type:
    | 'imported'
    | 'ping'
    | 'connected'
    | 'parse_status'
    | 'parse_progress'
    | 'worker_status'
    | 'poll_status'
    | 'ui_prefs'
    /** DC COGS were written for `workspaceId`; the Invoice Audit table refetches. */
    | 'dc_cogs'
    /** Token usage was recorded; the admin usage dashboard refetches. */
    | 'usage'
  imported?: number
  /** For `poll_status`: whether the background poller is actively fetching. */
  pollerRunning?: boolean
  /** For `poll_status`: last poll error message, or null on success. */
  pollError?: string | null
  /** For `poll_status`: ISO timestamp of the last successful import. */
  lastImportAt?: string | null
  /** For `parse_status`, so a table can move one chip without refetching.
   *  For `parse_progress`, which running job `step`/`snippet` describe. */
  parseJobId?: string
  parseStatus?: ParseJobStatus
  /** For `parse_progress`: how far along a running job is, and what it is doing.
   *  Multiplexed here so a table watching many jobs needs one connection. */
  step?: number
  snippet?: string
  /** For `worker_status`: whether the Python worker is currently connected. */
  workerOnline?: boolean
  /**
   * For `ui_prefs`: the workspace whose preferences were updated.
   * Clients filter events to the currently active workspace.
   */
  workspaceId?: string
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
  /** Where this job originated — present on jobs created after 2026-09-22. */
  source?: 'email' | 'pdf-import'
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
  /** The agent's tables at correction time. Absent on corrections saved before it was recorded. */
  originalTables?: AgentTable[]
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
 * A Gmail OAuth source connected to a specific workspace.
 * Refresh tokens are never included by the API.
 */
export interface DocTidyEmailSource {
  _id: string
  workspaceId: string
  /** Optional friendly label, e.g. "Brand A mailbox". */
  label?: string
  emailAddress?: string
  gmailAccountPicture?: string
  gmailConnectedAt?: string
  gmailConnectedByName?: string
  createdAt: string
  updatedAt: string
}

/**
 * An SPS Commerce OAuth source connected to a specific workspace.
 * Refresh / access tokens are never included by the API.
 */
export interface DocTidySpsSource {
  _id: string
  workspaceId: string
  /** Optional friendly label, e.g. "Brand A SPS account". */
  label?: string
  spsAccountId?: string
  spsAccountEmail?: string
  spsConnectedAt?: string
  spsConnectedByName?: string
  createdAt: string
  updatedAt: string
}

/** A document file entry from the SPS Transaction API v5 directory listing. */
export interface SpsDocumentRecord {
  /** Filename, e.g. "PO584615-1-v7.7-BulkImport.xml" */
  filename: string
  /** Full download URL */
  downloadUrl: string
  /** Document-type directory (PO, IN, etc.) */
  docType: string
  /** File size in bytes (when provided) */
  size?: number
  /** ISO timestamp when the file appeared in the queue (when provided) */
  createdAt?: string
  rawData?: unknown
}

export interface SpsDocumentsResponse {
  data: SpsDocumentRecord[]
  nextCursor?: string | null
  /** Mailbox folder that was listed ("out", "testout", …); null for a top-level listing. */
  dataDir?: string | null
}

/** @deprecated Renamed to SpsDocumentRecord */
export type SpsInvoiceRecord = SpsDocumentRecord
/** @deprecated Renamed to SpsDocumentsResponse */
export type SpsInvoicesResponse = SpsDocumentsResponse

/**
 * A structured EDI transaction record, parsed from a raw Transaction API file.
 * All the same fields that the SPS Fulfillment Monitor shows — extracted from
 * the EDI file content rather than from a proprietary internal API.
 */
export interface SpsTransaction {
  filename: string
  downloadUrl: string
  /** EDI transaction set code: "810", "856", "850", etc. */
  transactionSet: string
  /** Human-readable label: "Invoice (810)", "Ship Notice / ASN (856)", etc. */
  transactionLabel: string
  /** Invoice #, ASN #, or PO # (the primary document identifier) */
  documentNumber: string
  /** Purchase order number */
  poNumber: string
  /** Trading partner / vendor name */
  senderName: string
  /** EDI interchange sender ID */
  senderId: string
  /** Buyer / receiver name */
  receiverName: string
  /** Document date as YYYY-MM-DD */
  documentDate: string
  size?: number
  createdAt?: string
  /** Set when the file content could not be fully parsed */
  parseError?: string
}

export interface SpsTransactionsResponse {
  data: SpsTransaction[]
  nextCursor?: string | null
  dataDir?: string | null
}

/**
 * A named workspace that owns a set of filter rules (one-to-many via
 * `rule.workspaceId`). Rules are managed from within the workspace.
 */
export interface DocTidyWorkspace {
  _id: string
  name: string
  /** The organization this workspace belongs to, if any. */
  organizationId?: string
  createdByName?: string
  /**
   * Controls how order imports are matched and which columns are shown by default.
   * `full` (default) — all import fields, PO + SKU matching.
   * `header-only`    — only PO # is required; PO-level matching; line-item columns hidden.
   */
  importMode?: 'full' | 'header-only'
  /** Per-workspace Gmail sources. Populated on demand by fetching /email-sources. */
  emailSources?: DocTidyEmailSource[]
  /** Per-workspace SPS Commerce sources. Populated on demand by fetching /sps-sources. */
  spsSources?: DocTidySpsSource[]
  /**
   * Number of Gmail OAuth sources connected to this workspace.
   * Injected by the list endpoint; absent on individually-fetched workspaces.
   */
  emailSourceCount?: number
  /**
   * Number of SPS Commerce OAuth sources connected to this workspace.
   * Injected by the list endpoint; absent on individually-fetched workspaces.
   */
  spsSourceCount?: number
  createdAt: string
  updatedAt: string
}

/* ──────────────────────────────────── Doc Tidy Organizations ── */

/**
 * A named container for workspaces with an explicit member list.
 * Only members (and all admins) can view the workspaces inside an organization.
 * Workspaces with no organizationId are "unassigned" and visible to all users.
 */
export interface DocTidyOrganization {
  _id: string
  name: string
  /** IDs of users who can view workspaces inside this organization. */
  memberUserIds: string[]
  createdByName?: string
  createdAt: string
  updatedAt: string
  /** Computed by the API: true when the current user is an admin or a listed member. */
  hasAccess?: boolean
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

/**
 * One Invoice Audit row's worth of a parse job. A spreadsheet batch file holds
 * several invoices, so its job yields one of these per invoice, each with that
 * invoice as `jsonOutput`. `_id` stays the real job id.
 */
export interface InvoiceRowJob extends ParseJobListItem {
  rowKey: string
  /** Position and count within a batch file; absent for single-invoice jobs. */
  invoiceIndex?: number
  invoiceCount?: number
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
  | 'lesd'
  | 'customerName'
  | 'purchasedDate'
  | 'status'
  | 'orderId'
  | 'processedDate'
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
  | 'parsedAt'
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
  /** Center-align header and cell (overrides numeric right-align). */
  center?: boolean
  /** Render cell value in monospace. */
  mono?: boolean
  /** SVG path `d` attribute rendered as a 14 × 14 icon in the column header. */
  iconPath?: string
  /**
   * When set, the icon is rendered with `fill={iconColor}` instead of stroke.
   * Use for brand/logo SVG paths (e.g. Amazon orange "#FF9900").
   */
  iconColor?: string
  /** Image URL rendered as a 14 × 14 icon in the column header (takes priority over iconPath). */
  iconSrc?: string
}

/** Declared in the default display order (Actions is a fixed column rendered before these). */
// ─── Shared icon path constants ────────────────────────────────────────────
export const AUDIT_COL_ICON = {
  amazon: 'M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726-1.53.406-3.045.61-4.516.61-2.265 0-4.41-.396-6.435-1.187-2.02-.794-3.82-1.91-5.43-3.35-.1-.074-.15-.15-.15-.22 0-.047.02-.09.05-.13zm6.565-6.218c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045-.195-.166-.375-.332-.526-.496l-.31-.347c-.06-.074-.166-.21-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02zm9.162 7.027c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5.55-.133 1.09-.222 1.612-.24.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.09.228.09.39v.15c0 .51-.14 1.11-.415 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z',
  tag:          'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L9.568 3z M6 6h.008v.008H6V6z',
  hash:         'M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5',
  barcode:      'M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z',
  stack:        'M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3',
  dollar:       'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  calendar:     'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
  clock:        'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  user:         'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z',
  checkCircle:  'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  document:     'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  exclamation:  'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
} as const

export const INVOICE_AUDIT_COLUMNS: InvoiceAuditColumn[] = [
  { id: 'processedDate',      section: 'order',    label: 'Processed Date',  description: 'Date the order was processed (from the imported order file)',      defaultVisible: true,                center: true,   iconPath: AUDIT_COL_ICON.calendar    },
  { id: 'poNumber',           section: 'order',    label: 'PO #',            description: 'Purchase order number from the imported order file',               defaultVisible: true,  mono: true,                 iconPath: AUDIT_COL_ICON.tag         },
  { id: 'orderId',            section: 'order',    label: 'Order ID',        description: 'Order ID from the imported order file',                            defaultVisible: true,  mono: true,                 iconPath: AUDIT_COL_ICON.hash        },
  { id: 'discrepancy',        section: 'computed', label: 'Discrepancy',     description: 'Flags mismatches: Order SKU vs Invoice SKU, Order Qty vs Invoice Qty', defaultVisible: true, center: true,            iconPath: AUDIT_COL_ICON.exclamation },
  { id: 'invoiceNumber',      section: 'invoice',  label: 'Invoice #',       description: 'Invoice number from the matched invoice',                          defaultVisible: true,  mono: true,                 iconPath: AUDIT_COL_ICON.tag         },
  { id: 'terms',              section: 'invoice',  label: 'Terms',           description: 'Payment terms (e.g. Net 30) from the matched invoice',             defaultVisible: true,                             iconPath: AUDIT_COL_ICON.document    },
  { id: 'invoiceDate',        section: 'invoice',  label: 'Invoice Date',    description: 'Date printed on the matched invoice',                              defaultVisible: true,                             iconPath: AUDIT_COL_ICON.calendar    },
  { id: 'orderSku',           section: 'order',    label: 'Order SKU',       description: 'SKU as it appears in the imported order file',                     defaultVisible: true,  mono: true,                 iconPath: AUDIT_COL_ICON.barcode     },
  { id: 'invoiceSku',         section: 'invoice',  label: 'Invoice SKU',     description: 'SKU extracted from the matched invoice line item',                 defaultVisible: true,  mono: true,                 iconPath: AUDIT_COL_ICON.barcode     },
  { id: 'orderQty',           section: 'order',    label: 'Order Qty',       description: 'Quantity ordered (from the imported order file)',                  defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.stack       },
  { id: 'invoiceQty',         section: 'invoice',  label: 'Invoice Qty',     description: 'Quantity on the matched invoice line item',                        defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.stack       },
  { id: 'itemCost',           section: 'invoice',  label: 'Item Cost',       description: 'Unit price / item cost from the matched invoice line item',        defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'dcCogs',             section: 'invoice',  label: 'DC COGS',         description: 'Distribution center cost of goods sold, from Data Central',        defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'discountedCostPct',  section: 'invoice',  label: 'Disc. Cost/%',    description: 'Discounted unit price and discount percentage from the invoice',   defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'lesd',               section: 'order',    label: 'LESD',            description: 'Latest Expected Ship Date from the imported order file',            defaultVisible: true,                center: true, iconPath: AUDIT_COL_ICON.calendar    },
  { id: 'customerName',       section: 'order',    label: 'Customer Name',   description: 'Customer name from the imported order file',                       defaultVisible: true,                             iconPath: AUDIT_COL_ICON.user        },
  { id: 'purchasedDate',      section: 'order',    label: 'Purchased Date',  description: 'Date the order was purchased (from the imported order file)',      defaultVisible: true,                center: true, iconPath: AUDIT_COL_ICON.calendar    },
  { id: 'status',             section: 'order',    label: 'Status',          description: 'Order status from the imported order file',                        defaultVisible: true,                center: true, iconPath: AUDIT_COL_ICON.checkCircle },
  { id: 'dropshipFee',        section: 'invoice',  label: 'DS Fee',          description: 'Dropship fee extracted from the matched invoice',                  defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'miscCharges',        section: 'invoice',  label: 'Misc. Charges',   description: 'Miscellaneous charges extracted from the matched invoice',         defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'totalCost',          section: 'invoice',  label: 'Total Cost',      description: 'Total line cost including tax and dropship fees',                  defaultVisible: true,  numeric: true, center: true, iconPath: AUDIT_COL_ICON.dollar      },
  { id: 'parsedAt',           section: 'invoice',  label: 'Parsed',          description: 'Date the Tidy Agent last parsed and matched this invoice',           defaultVisible: true,                center: true, iconPath: AUDIT_COL_ICON.clock       },
]

/** Default order mirrors the declaration order in INVOICE_AUDIT_COLUMNS. */
export const DEFAULT_AUDIT_COL_ORDER: InvoiceAuditColumnId[] = INVOICE_AUDIT_COLUMNS.map((c) => c.id)

/** Default order mirrors the declaration order in WORKSPACE_EMAIL_COLUMNS. */
export const DEFAULT_EMAIL_COL_ORDER: WorkspaceEmailColumnId[] = WORKSPACE_EMAIL_COLUMNS.map((c) => c.id)

/**
 * v6 key — bumped from v5 when the default column set was revised and Order ID /
 * Processed Date were added (2026-10-28). Old preferences are ignored so every
 * workspace starts from the new defaults.
 *
 * The key is workspace-scoped: `<base>.<workspaceId>` so changing
 * visibility in Workspace A never touches Workspace B's preferences.
 */
const AUDIT_COL_STORAGE_KEY_BASE = 'docTidy.invoiceAudit.columns.v6'

function auditColStorageKey(workspaceId: string): string {
  return `${AUDIT_COL_STORAGE_KEY_BASE}.${workspaceId}`
}

/**
 * Column visibility overrides applied to `header-only` workspaces.
 * Only PO #, Invoice #, Invoice Date, Terms, Total Cost and Parsed are shown;
 * everything else is hidden.
 */
const HEADER_ONLY_COLUMN_OVERRIDES: Partial<Record<InvoiceAuditColumnId, boolean>> = {
  // Order columns — hide all except poNumber
  orderSku:          false,
  orderQty:          false,
  lesd:              false,
  customerName:      false,
  purchasedDate:     false,
  status:            false,
  orderId:           false,
  processedDate:     false,
  // Invoice columns — show only invoiceDate, invoiceNumber, terms, totalCost
  invoiceSku:        false,
  itemCost:          false,
  dcCogs:            false,
  invoiceQty:        false,
  discountedCostPct: false,
  dropshipFee:       false,
  miscCharges:       false,
  // Computed
  discrepancy:       false,
}

/** Load per-column visibility for a workspace from localStorage, falling back to defaults.
 *
 * @param workspaceId  The workspace whose saved preference to load.
 * @param importMode   When `'header-only'`, only the five core header columns
 *                     (PO #, Invoice #, Invoice Date, Terms, Total Cost) are
 *                     visible by default so the table is uncluttered for
 *                     teams that only import PO numbers.
 */
export function loadAuditColumnVisibility(
  workspaceId: string,
  importMode?: 'full' | 'header-only',
): Record<InvoiceAuditColumnId, boolean> {
  const defaults = Object.fromEntries(
    INVOICE_AUDIT_COLUMNS.map((c) => [c.id, c.defaultVisible])
  ) as Record<InvoiceAuditColumnId, boolean>

  // Apply header-only overrides to the base defaults.
  const modeDefaults: Record<InvoiceAuditColumnId, boolean> = importMode === 'header-only'
    ? { ...defaults, ...HEADER_ONLY_COLUMN_OVERRIDES }
    : defaults

  try {
    const raw = localStorage.getItem(auditColStorageKey(workspaceId))
    if (!raw) return modeDefaults
    const stored = JSON.parse(raw) as Partial<Record<InvoiceAuditColumnId, boolean>>
    // Merge stored preferences on top of mode-aware defaults.
    return { ...modeDefaults, ...stored }
  } catch {
    return modeDefaults
  }
}

/** Persist column visibility for a workspace to localStorage. */
export function saveAuditColumnVisibility(
  visibility: Record<InvoiceAuditColumnId, boolean>,
  workspaceId: string,
): void {
  try {
    localStorage.setItem(auditColStorageKey(workspaceId), JSON.stringify(visibility))
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

const normJsonKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Keys that carry the buyer's PO number, in priority order. Customer PO Number
 * and Customer Reference are treated as the PO for every workspace.
 *
 * Must stay identical to `PO_NUMBER_KEYS` in `src/services/invoiceMatchCache.service.ts`.
 */
export const PO_NUMBER_FIELD_KEYS = [
  'po_number', 'purchase_order_number', 'po_no', 'po',
  'customer_po_number', 'customer_po_no', 'customer_po',
  'cust_po_number', 'cust_po_no', 'cust_po',
  'customer_purchase_order', 'customer_purchase_order_number',
  'your_po', 'your_po_number', 'buyer_po', 'client_po',
  'customer_reference_number', 'customer_reference', 'customer_ref_no', 'customer_ref',
  'cust_ref', 'your_reference', 'your_ref',
  'purchase_order', 'order_number', 'order_no',
]

const isJsonObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const JSON_TABLE_LABEL_HEADERS = new Set(['field', 'label', 'key', 'name', 'attribute'])

/**
 * When the agent put document fields inside a `tables` array: one object of
 * key/value-table labels → values, and one of grid-table titles → row objects.
 * Mirrors `tableSearchScopes` in `src/services/docTidyTables.service.ts`.
 */
function jsonTableScopes(json: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(json.tables)) return []
  const fields: Record<string, unknown> = {}
  const grids: Record<string, unknown> = {}
  for (const table of json.tables) {
    if (!isJsonObject(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) continue
    const columns = table.columns as string[]
    const rows = table.rows as unknown[][]
    const isKeyValue =
      columns.length === 2 &&
      JSON_TABLE_LABEL_HEADERS.has(String(columns[0]).toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (isKeyValue) {
      for (const row of rows) {
        const label = String(row[0] ?? '').trim()
        if (label && !(label in fields)) fields[label] = row[1]
      }
    } else if (typeof table.title === 'string' && table.title) {
      grids[table.title] = rows.map((row) =>
        Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null]))
      )
    }
  }
  return [fields, grids]
}

/**
 * The object itself, then its plain-object children (e.g. `totals`), then any
 * `tables` array the agent emitted, so a top-level key always outranks a
 * grouped one.
 */
function jsonSearchScopes(json: Record<string, unknown>): Record<string, unknown>[] {
  return [json, ...Object.values(json).filter(isJsonObject), ...jsonTableScopes(json)]
}

/**
 * Extract a scalar value from a free-form AI JSON output, trying multiple
 * common field-name variants in priority order. Keys are normalised to
 * lowercase with every non-alphanumeric character (`_`, `-`, spaces, `#`, `.`)
 * stripped before comparison.
 *
 * Must stay identical to `extractField` in `src/services/invoiceMatchCache.service.ts`,
 * or a row's cached and fallback Invoice Audit values will disagree.
 */
export function extractJsonField(
  json: Record<string, unknown> | null | undefined,
  ...candidates: string[]
): string {
  if (!isJsonObject(json)) return ''
  for (const scope of jsonSearchScopes(json)) {
    for (const key of candidates) {
      const target = normJsonKey(key)
      for (const [k, v] of Object.entries(scope)) {
        if (normJsonKey(k) !== target) continue
        if (typeof v === 'string' && v.trim()) return v.trim()
        if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      }
    }
  }
  return ''
}

/**
 * The invoices in a job's output: each element of `invoices[]` for a
 * spreadsheet batch file, otherwise the output itself.
 *
 * Must stay identical to `invoiceDocuments` in `src/services/invoiceMatchCache.service.ts`.
 */
export function invoiceDocuments(json: Record<string, unknown>): Record<string, unknown>[] {
  const invoices = Array.isArray(json.invoices) ? json.invoices.filter(isJsonObject) : []
  return invoices.length > 0 ? invoices : [json]
}

/** Expands spreadsheet batch jobs into one row-job per invoice; other jobs pass through. */
export function expandInvoiceJobs(jobs: ParseJobListItem[]): InvoiceRowJob[] {
  return jobs.flatMap((job) => {
    const docs = isJsonObject(job.jsonOutput) ? invoiceDocuments(job.jsonOutput) : []
    if (docs.length === 0 || docs[0] === job.jsonOutput) return [{ ...job, rowKey: job._id }]
    return docs.map((doc, i) => ({
      ...job,
      jsonOutput: doc,
      rowKey: `${job._id}:${i}`,
      invoiceIndex: i,
      invoiceCount: docs.length,
    }))
  })
}

/**
 * Extract an array value (e.g. line_items) from the JSON output, searched the
 * same way as `extractJsonField`. Returns an empty array if none is found.
 */
export function extractJsonArray(
  json: Record<string, unknown> | null | undefined,
  ...candidates: string[]
): Record<string, unknown>[] {
  if (!isJsonObject(json)) return []
  for (const scope of jsonSearchScopes(json)) {
    for (const key of candidates) {
      const target = normJsonKey(key)
      for (const [k, v] of Object.entries(scope)) {
        if (normJsonKey(k) === target && Array.isArray(v) && v.length > 0) {
          return v as Record<string, unknown>[]
        }
      }
    }
  }
  return []
}

/* ─────────────────────────── (Legacy) Line Item Column types ─ removed ── */
// Superseded by the redesigned InvoiceAuditColumnId set (2026-09-24).
/** @deprecated Use the new InvoiceAuditColumnId variants instead. */
export type LineItemColumnId = never

/* ──────────────────────────────────────── Order Imports ── */

export interface DcCogsHistoryEntry {
  cost: string
  msrp: string
  recordedAt: string
  /** `stored` = the cost Doc Tidy held before history tracking began. */
  source: 'dc_lookup' | 'stored'
}

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
  lesd: string
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
  /** Every DC COGS value this SKU has held, newest first. */
  dcCogsHistory?: DcCogsHistoryEntry[]
  /**
   * Inline invoice match cache — written by the server the moment a matching
   * parse job completes.  When present the audit table reads these fields
   * directly instead of loading all parse jobs for client-side matching.
   */
  /**
   * Cached invoice match (legacy singular field — kept for backward compat).
   * Prefer `matchedInvoices` when present.
   * @deprecated Read `matchedInvoices` instead; this field is only present on
   * rows cached before the split-invoice aggregation feature.
   */
  matchedInvoice?: MatchedInvoiceCache | null
  /**
   * All invoice matches for this order line — one entry per distinct parse job
   * whose PO # + SKU matched.  Written by the server cache service; populated
   * by a Resync for legacy rows that only have `matchedInvoice`.
   */
  matchedInvoices?: MatchedInvoiceCache[]
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
  /** `'customer'` = billed under a sibling order's PO; absent = direct PO match. */
  matchedBy?: 'po' | 'customer'
  /** PO # printed on the invoice; only set when `matchedBy === 'customer'`. */
  invoicePo?: string
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

export type PdfImportColumnId = 'imported' | 'importedBy' | 'size' | 'filename' | 'parseStatus'

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
  {
    id: 'parseStatus',
    label: 'Tidy Agent',
    iconPath: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z',
  },
]

export const DEFAULT_PDF_IMPORT_COL_ORDER: PdfImportColumnId[] = PDF_IMPORT_COLUMNS.map((c) => c.id)

/* ──────────────────────────────────────── Direct PDF Imports ── */

/** Slim parse job summary returned inline on PDF import list rows. */
export interface PdfImportParseJob {
  _id: string
  status: ParseJobStatus
  error?: string | null
  completedAt?: string | null
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

