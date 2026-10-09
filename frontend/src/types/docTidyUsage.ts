/** Admin token usage & cost dashboard — mirrors `docTidyUsage.controller.ts`. */

export type ServiceTier = 'standard' | 'flex' | 'batch' | 'fast'
export const SERVICE_TIERS: ServiceTier[] = ['standard', 'flex', 'batch', 'fast']

export type UsagePurpose =
  | 'extraction'
  | 'table'
  | 'narration'
  | 'embedding'
  | 'correction-embedding'

export const USAGE_PURPOSE_LABELS: Record<UsagePurpose, string> = {
  extraction: 'Extraction',
  table: 'Table view',
  narration: 'Narration',
  embedding: 'Correction lookup',
  'correction-embedding': 'Correction save',
}

export interface UsageSums {
  costUsd: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  calls: number
  unpricedCalls: number
  missingUsageCalls: number
  jobs: number
}

export interface WorkspaceUsage extends UsageSums {
  workspaceId: string | null
  name: string
  deleted?: boolean
}

export interface OrganizationUsage extends UsageSums {
  organizationId: string | null
  name: string
  workspaces: WorkspaceUsage[]
}

export interface UsageBreakdownRow extends Omit<UsageSums, 'jobs'> {
  purpose: UsagePurpose
  provider: 'openai' | 'hermes'
  model: string
  serviceTier: ServiceTier
  priced: boolean
}

export interface UsageDailyRow {
  date: string
  costUsd: number
  tokens: number
  calls: number
}

export interface UsageSummary {
  range: { from: string; to: string }
  totals: UsageSums
  organizations: OrganizationUsage[]
  breakdown: UsageBreakdownRow[]
  daily: UsageDailyRow[]
}

export interface ModelPrice {
  _id: string
  model: string
  serviceTier: ServiceTier
  inputPer1M: number
  cachedInputPer1M?: number | null
  cacheWritePer1M?: number | null
  outputPer1M: number
  longContextThreshold?: number | null
  longInputPer1M?: number | null
  longCachedInputPer1M?: number | null
  longCacheWritePer1M?: number | null
  longOutputPer1M?: number | null
  notes?: string
  updatedByName?: string
  updatedAt?: string
}

export type Reconciliation =
  | { configured: false }
  | {
      configured: true
      filteredByApiKey: boolean
      from: string
      to: string
      currency: string
      billedUsd: number
      recordedUsd: number
      recordedCalls: number
      lineItems: Array<{ lineItem: string; amount: number }>
      fetchedAt: string
    }
