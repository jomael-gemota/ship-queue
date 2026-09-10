export type MatchMode = 'any' | 'all'

/** A named extraction entry. Shared team-wide. */
export interface DocTidyRule {
  _id: string
  name: string
  description?: string
  enabled: boolean

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

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]
