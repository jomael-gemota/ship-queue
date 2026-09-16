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

/** A named extraction entry. Shared team-wide. */
export interface DocTidyRule {
  _id: string
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
  type: 'imported' | 'ping' | 'connected' | 'parse_status'
  imported?: number
  /** For `parse_status`, so a table can move one chip without refetching. */
  parseJobId?: string
  parseStatus?: ParseJobStatus
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
