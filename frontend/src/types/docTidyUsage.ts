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
  /** The part of `costUsd` that is a calibrated Hermes estimate, not yet trued up. */
  estimatedCostUsd: number
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
  /** Billed spend the daily true-up couldn't match to a tracked call. */
  untracked?: boolean
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
  /** Includes `untrackedUsd`. */
  costUsd: number
  untrackedUsd: number
  tokens: number
  calls: number
}

export interface UsageSummary {
  range: { from: string; to: string }
  /** `costUsd` includes `untrackedUsd`. */
  totals: UsageSums
  organizations: OrganizationUsage[]
  breakdown: UsageBreakdownRow[]
  daily: UsageDailyRow[]
  untrackedUsd: number
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
  /** Set on an alias such as `hermes-agent`: the OpenAI model it really calls. */
  upstreamModel?: string | null
  calibrationFactor?: number | null
  calibratedAt?: string | null
  notes?: string
  updatedByName?: string
  updatedAt?: string
}

export interface TrueUpDay {
  day: string
  model: string
  status: 'trued-up' | 'skipped'
  reason?: string
  billedUsd: number
  trackedBilledUsd: number
  untrackedUsd: number
  trackedShare: number
  trackedCalls: number
}

export interface TrueUpResult {
  configured: boolean
  ranAt: string
  calibrations: Array<{
    model: string
    upstreamModel: string
    calibrationFactor: number | null
    billedUsd: number
    listUsd: number
  }>
  days: TrueUpDay[]
  error?: string
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
      /** Includes `untrackedUsd`. */
      recordedUsd: number
      untrackedUsd: number
      recordedCalls: number
      lineItems: Array<{ lineItem: string; amount: number }>
      fetchedAt: string
      calibrations: Array<{
        model: string
        upstreamModel: string
        calibrationFactor: number | null
        calibratedAt: string | null
      }>
      lastTrueUp: TrueUpResult | null
    }
