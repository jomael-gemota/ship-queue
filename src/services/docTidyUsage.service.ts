import { Types, isValidObjectId } from 'mongoose';
import DocTidyModelPrice, { type IDocTidyModelPrice } from '../models/DocTidyModelPrice';
import DocTidyUsageEvent, {
  USAGE_PURPOSES,
  type UsagePurpose,
  type UsageProvider,
} from '../models/DocTidyUsageEvent';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyRule from '../models/DocTidyRule';
import { computeCostUsd, findPrice, normalizeServiceTier } from '../lib/tokenPricing';
import { broadcast } from './docTidyEvents';

/**
 * Records and prices every LLM call Doc Tidy makes, for the admin Token Usage
 * dashboard. See design-log/2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md.
 */

type LeanPrice = Pick<
  IDocTidyModelPrice,
  | 'model'
  | 'serviceTier'
  | 'inputPer1M'
  | 'cachedInputPer1M'
  | 'cacheWritePer1M'
  | 'outputPer1M'
  | 'longContextThreshold'
  | 'longInputPer1M'
  | 'longCachedInputPer1M'
  | 'longCacheWritePer1M'
  | 'longOutputPer1M'
> & { _id: Types.ObjectId };

/* ------------------------------------------------------------- prices */

let priceCache: LeanPrice[] | null = null;

async function loadPrices(): Promise<LeanPrice[]> {
  if (!priceCache) priceCache = (await DocTidyModelPrice.find({}).lean()) as LeanPrice[];
  return priceCache;
}

export function invalidatePriceCache(): void {
  priceCache = null;
}

/* ----------------------------------------------------------- workspace */

/** A job fires ~3–12 calls; caching its workspace avoids repeating the
 *  job → message → rule walk for each one. */
const workspaceByJob = new Map<string, string | null>();
const WORKSPACE_CACHE_MAX = 1000;

async function resolveWorkspaceForJob(jobId: string): Promise<string | null> {
  if (workspaceByJob.has(jobId)) return workspaceByJob.get(jobId) ?? null;

  let workspaceId: string | null = null;
  const job = await DocTidyParseJob.findById(jobId).select('workspaceId messageId').lean();
  if (job?.workspaceId) {
    workspaceId = String(job.workspaceId);
  } else if (job?.messageId) {
    const message = await DocTidyMessage.findById(job.messageId).select('ruleId').lean();
    if (message?.ruleId) {
      const rule = await DocTidyRule.findById(message.ruleId).select('workspaceId').lean();
      if (rule?.workspaceId) workspaceId = String(rule.workspaceId);
    }
  }

  if (workspaceByJob.size >= WORKSPACE_CACHE_MAX) {
    const oldest = workspaceByJob.keys().next().value;
    if (oldest !== undefined) workspaceByJob.delete(oldest);
  }
  workspaceByJob.set(jobId, workspaceId);
  return workspaceId;
}

/* ------------------------------------------------------------- live hint */

let hintTimer: ReturnType<typeof setTimeout> | null = null;
const HINT_DEBOUNCE_MS = 1500;

/** One data-free hint per burst: a job's calls arrive in quick succession and
 *  each dashboard refetch is an aggregation, so there is no point in one per call. */
function announceUsage(): void {
  if (hintTimer) return;
  hintTimer = setTimeout(() => {
    hintTimer = null;
    broadcast({ type: 'usage' });
  }, HINT_DEBOUNCE_MS);
  if (typeof hintTimer.unref === 'function') hintTimer.unref();
}

/* ------------------------------------------------------------- recording */

export interface UsageInput {
  jobId?: string | null;
  workspaceId?: string | null;
  purpose: UsagePurpose;
  provider: UsageProvider;
  model: string;
  serviceTier?: unknown;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  usageSource?: 'reported' | 'missing';
}

const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export async function recordUsage(input: UsageInput): Promise<void> {
  if (!USAGE_PURPOSES.includes(input.purpose)) return;

  const jobId = input.jobId && isValidObjectId(input.jobId) ? input.jobId : null;
  const workspaceId =
    input.workspaceId && isValidObjectId(input.workspaceId)
      ? input.workspaceId
      : jobId
        ? await resolveWorkspaceForJob(jobId)
        : null;

  const serviceTier = normalizeServiceTier(input.serviceTier);
  const usage = {
    inputTokens: count(input.inputTokens),
    cachedInputTokens: count(input.cachedInputTokens),
    cacheWriteTokens: count(input.cacheWriteTokens),
    outputTokens: count(input.outputTokens),
  };
  const model = (input.model || 'unknown').trim();
  const price = findPrice(await loadPrices(), model, serviceTier);

  await DocTidyUsageEvent.create({
    jobId,
    workspaceId,
    purpose: input.purpose,
    provider: input.provider === 'hermes' ? 'hermes' : 'openai',
    model,
    serviceTier,
    ...usage,
    reasoningTokens: count(input.reasoningTokens),
    usageSource: input.usageSource === 'missing' ? 'missing' : 'reported',
    costUsd: price ? computeCostUsd(usage, price) : 0,
    priced: Boolean(price),
    priceId: price?._id ?? null,
  });

  announceUsage();
}

/** Re-applies the current price table to every event in the range. */
export async function repriceRange(from: Date, to: Date): Promise<number> {
  invalidatePriceCache();
  const prices = await loadPrices();
  const cursor = DocTidyUsageEvent.find({ createdAt: { $gte: from, $lt: to } })
    .select('model serviceTier inputTokens cachedInputTokens cacheWriteTokens outputTokens')
    .lean()
    .cursor();

  type Op = Parameters<typeof DocTidyUsageEvent.bulkWrite>[0][number];
  let ops: Op[] = [];
  let updated = 0;
  const flush = async () => {
    if (ops.length === 0) return;
    await DocTidyUsageEvent.bulkWrite(ops, { ordered: false });
    updated += ops.length;
    ops = [];
  };

  for await (const event of cursor) {
    const price = findPrice(prices, event.model, event.serviceTier);
    ops.push({
      updateOne: {
        filter: { _id: event._id },
        update: {
          $set: {
            costUsd: price ? computeCostUsd(event, price) : 0,
            priced: Boolean(price),
            priceId: price?._id ?? null,
          },
        },
      },
    });
    if (ops.length >= 500) await flush();
  }
  await flush();

  if (updated > 0) announceUsage();
  return updated;
}
