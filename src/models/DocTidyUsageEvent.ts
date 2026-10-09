import { Schema, model, Types } from 'mongoose';
import { SERVICE_TIERS, type ServiceTier } from './DocTidyModelPrice';

export type UsagePurpose =
  | 'extraction'
  | 'table'
  | 'narration'
  | 'embedding'
  | 'correction-embedding';
export const USAGE_PURPOSES: UsagePurpose[] = [
  'extraction',
  'table',
  'narration',
  'embedding',
  'correction-embedding',
];

export type UsageProvider = 'openai' | 'hermes';

export type CostBasis = 'exact' | 'estimated' | 'billed';

/**
 * One billed LLM call, with the token counts the provider reported and the cost
 * computed from the price row that applied at the time.
 *
 * `cachedInputTokens` and `cacheWriteTokens` are subsets of `inputTokens`, as in
 * OpenAI's usage object. Cost is snapshotted so editing a price never silently
 * rewrites history; the dashboard's re-price action does that explicitly.
 *
 * The organization is deliberately not stored: it is resolved from the
 * workspace at query time, so moving a workspace moves its history with it.
 *
 * A plain interface, like `IDocTidyModelPrice`, for the same `model` collision.
 */
export interface IDocTidyUsageEvent {
  jobId?: Types.ObjectId | null;
  workspaceId?: Types.ObjectId | null;
  purpose: UsagePurpose;
  provider: UsageProvider;
  model: string;
  serviceTier: ServiceTier;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  usageSource: 'reported' | 'missing';
  costUsd: number;
  /**
   * `exact` — priced from the call's own usage. `estimated` — an alias such as
   * `hermes-agent` that hides the cache split: list cost × calibration factor.
   * `billed` — replaced by its share of OpenAI's actual bill for that day.
   */
  costBasis: CostBasis;
  /** Every input token at the full input rate; the weight used to split a day's bill. */
  listCostUsd: number;
  priced: boolean;
  priceId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const tokenCount = { type: Number, default: 0, min: 0 };

const DocTidyUsageEventSchema = new Schema<IDocTidyUsageEvent>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'DocTidyParseJob', default: null },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'DocTidyWorkspace', default: null },
    purpose: { type: String, enum: USAGE_PURPOSES, required: true },
    provider: { type: String, enum: ['openai', 'hermes'], required: true },
    model: { type: String, required: true },
    serviceTier: { type: String, enum: SERVICE_TIERS, default: 'standard' },
    inputTokens: tokenCount,
    cachedInputTokens: tokenCount,
    cacheWriteTokens: tokenCount,
    outputTokens: tokenCount,
    reasoningTokens: tokenCount,
    usageSource: { type: String, enum: ['reported', 'missing'], default: 'reported' },
    costUsd: { type: Number, default: 0 },
    costBasis: { type: String, enum: ['exact', 'estimated', 'billed'], default: 'exact' },
    listCostUsd: { type: Number, default: 0 },
    priced: { type: Boolean, default: false },
    priceId: { type: Schema.Types.ObjectId, ref: 'DocTidyModelPrice', default: null },
  },
  { timestamps: true, collection: 'doctidy_usage_events' }
);

DocTidyUsageEventSchema.index({ createdAt: -1 });
DocTidyUsageEventSchema.index({ workspaceId: 1, createdAt: -1 });

export default model<IDocTidyUsageEvent>('DocTidyUsageEvent', DocTidyUsageEventSchema);
