/**
 * Cost of one LLM call, computed the way OpenAI bills it.
 *
 * See https://platform.openai.com/docs/guides/prompt-caching ("Calculate input
 * cost"): cached and cache-write tokens are subsets of input, so ordinary input
 * is what remains after subtracting both, and each slice has its own rate.
 * Reasoning tokens are already inside the output count.
 */

import type { ServiceTier } from '../models/DocTidyModelPrice';

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface PriceRates {
  inputPer1M: number;
  cachedInputPer1M?: number | null;
  cacheWritePer1M?: number | null;
  outputPer1M: number;
  longContextThreshold?: number | null;
  longInputPer1M?: number | null;
  longCachedInputPer1M?: number | null;
  longCacheWritePer1M?: number | null;
  longOutputPer1M?: number | null;
}

export interface PricedModel extends PriceRates {
  model: string;
  serviceTier: ServiceTier;
}

const isRate = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function computeCostUsd(usage: TokenUsage, price: PriceRates): number {
  const long =
    isRate(price.longContextThreshold) &&
    price.longContextThreshold > 0 &&
    usage.inputTokens > price.longContextThreshold &&
    isRate(price.longInputPer1M);

  const input = long ? (price.longInputPer1M as number) : price.inputPer1M;
  const cachedRate = long ? price.longCachedInputPer1M : price.cachedInputPer1M;
  const writeRate = long ? price.longCacheWritePer1M : price.cacheWritePer1M;
  const outputRate = long ? price.longOutputPer1M : price.outputPer1M;

  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const writes = Math.min(usage.cacheWriteTokens, usage.inputTokens - cached);
  const ordinary = usage.inputTokens - cached - writes;

  const micros =
    ordinary * input +
    cached * (isRate(cachedRate) ? cachedRate : input) +
    writes * (isRate(writeRate) ? writeRate : input) +
    usage.outputTokens * (isRate(outputRate) ? outputRate : price.outputPer1M);

  return micros / 1_000_000;
}

/** Maps the `service_tier` a response echoes onto the pricing-page tier. */
export function normalizeServiceTier(tier: unknown): ServiceTier {
  switch (typeof tier === 'string' ? tier.toLowerCase() : '') {
    case 'flex':
      return 'flex';
    case 'batch':
      return 'batch';
    case 'priority':
    case 'fast':
      return 'fast';
    default:
      return 'standard';
  }
}

const SNAPSHOT_SUFFIX = /^-\d{4}-\d{2}-\d{2}$/;

/**
 * Exact model first, then a dated snapshot of a priced model
 * (`gpt-4o-mini-2024-07-18` → `gpt-4o-mini`). Any other suffix stays unpriced:
 * `gpt-5.5-pro` costs several times `gpt-5.5`, so guessing would under-report.
 * A tier with no row of its own falls back to Standard.
 */
export function findPrice<T extends PricedModel>(
  prices: T[],
  model: string,
  tier: ServiceTier
): T | null {
  const name = model.toLowerCase();
  const match = (candidates: T[]): T | null => {
    let snapshotOf: T | null = null;
    for (const price of candidates) {
      const priceModel = price.model.toLowerCase();
      if (priceModel === name) return price;
      if (name.startsWith(priceModel) && SNAPSHOT_SUFFIX.test(name.slice(priceModel.length))) {
        snapshotOf = price;
      }
    }
    return snapshotOf;
  };

  return (
    match(prices.filter((p) => p.serviceTier === tier)) ??
    (tier === 'standard' ? null : match(prices.filter((p) => p.serviceTier === 'standard')))
  );
}
