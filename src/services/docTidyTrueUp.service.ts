import DocTidyModelPrice from '../models/DocTidyModelPrice';
import DocTidyUsageEvent from '../models/DocTidyUsageEvent';
import DocTidyBilledRemainder from '../models/DocTidyBilledRemainder';
import { computeListCostUsd, isModelOrSnapshot, type PriceRates } from '../lib/tokenPricing';
import {
  DAY_MS,
  adminKey,
  fetchDailyCompletionUsage,
  fetchDailyCosts,
  type CompletionUsageLine,
  type CostLine,
} from '../lib/openaiAdmin';
import { announceUsage, invalidatePriceCache, repriceRange } from './docTidyUsage.service';

/**
 * Calibrates and trues up alias models (rows with `upstreamModel`, i.e. Hermes)
 * against OpenAI's actual bill. See
 * design-log/2026-10-10-hermes-cost-calibration-and-daily-true-up.md.
 */

const WINDOW_DAYS = 7;
/** OpenAI's figures for a day usually settle within a few hours of midnight UTC. */
const SETTLE_MS = 6 * 3_600_000;
const RUN_EVERY_MS = 3_600_000;
const FIRST_RUN_DELAY_MS = 60_000;

export interface TrueUpDay {
  day: string;
  model: string;
  status: 'trued-up' | 'skipped';
  reason?: string;
  billedUsd: number;
  trackedBilledUsd: number;
  untrackedUsd: number;
  trackedShare: number;
  trackedCalls: number;
}

export interface TrueUpCalibration {
  model: string;
  upstreamModel: string;
  calibrationFactor: number | null;
  billedUsd: number;
  listUsd: number;
}

export interface TrueUpResult {
  configured: boolean;
  ranAt: string;
  calibrations: TrueUpCalibration[];
  days: TrueUpDay[];
  error?: string;
}

let lastResult: TrueUpResult | null = null;
let inFlight: Promise<TrueUpResult> | null = null;

export function lastTrueUp(): TrueUpResult | null {
  return lastResult;
}

const startOfUtcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Base list rates only: the Usage API has no per-call sizes, so long-context
 *  rates can't be applied to its side, and both sides must be weighed alike. */
const listWeight = (input: number, output: number, rates: PriceRates): number =>
  (input * rates.inputPer1M + output * rates.outputPer1M) / 1_000_000;

interface Alias extends PriceRates {
  _id: unknown;
  model: string;
  upstreamModel: string;
}

async function trueUpDay(
  dayMs: number,
  alias: Alias,
  billedUsd: number,
  upstreamListUsd: number
): Promise<TrueUpDay> {
  const base = {
    day: isoDay(dayMs),
    model: alias.model,
    billedUsd,
    trackedBilledUsd: 0,
    untrackedUsd: 0,
    trackedShare: 0,
    trackedCalls: 0,
  };

  const events = await DocTidyUsageEvent.find({
    model: alias.model,
    createdAt: { $gte: new Date(dayMs), $lt: new Date(dayMs + DAY_MS) },
  })
    .select('inputTokens cachedInputTokens cacheWriteTokens outputTokens')
    .lean();

  if (billedUsd <= 0 || upstreamListUsd <= 0) {
    return {
      ...base,
      trackedCalls: events.length,
      status: 'skipped',
      reason:
        events.length > 0
          ? `OpenAI shows no ${alias.upstreamModel} ${billedUsd <= 0 ? 'cost' : 'usage'} for this day — check OPENAI_USAGE_API_KEY_IDS and upstreamModel`
          : 'No usage',
    };
  }

  let trackedList = 0;
  let weightSum = 0;
  const weights = events.map((event) => {
    trackedList += listWeight(event.inputTokens, event.outputTokens, alias);
    const weight = computeListCostUsd(event, alias);
    weightSum += weight;
    return weight;
  });

  const trackedShare = Math.min(1, trackedList / upstreamListUsd);
  const trackedBilledUsd = billedUsd * trackedShare;

  if (events.length > 0 && weightSum > 0) {
    type Op = Parameters<typeof DocTidyUsageEvent.bulkWrite>[0][number];
    const ops: Op[] = events.map((event, i) => ({
      updateOne: {
        filter: { _id: event._id },
        update: {
          $set: {
            costUsd: (trackedBilledUsd * weights[i]) / weightSum,
            listCostUsd: weights[i],
            costBasis: 'billed',
          },
        },
      },
    }));
    for (let i = 0; i < ops.length; i += 500) {
      await DocTidyUsageEvent.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }

  const row = {
    ...base,
    trackedBilledUsd,
    untrackedUsd: billedUsd - trackedBilledUsd,
    trackedShare,
    trackedCalls: events.length,
  };
  await DocTidyBilledRemainder.updateOne(
    { day: new Date(dayMs), model: alias.model },
    {
      $set: {
        upstreamModel: alias.upstreamModel,
        billedUsd,
        trackedBilledUsd,
        untrackedUsd: row.untrackedUsd,
        trackedShare,
        trackedCalls: events.length,
      },
    },
    { upsert: true }
  );
  return { ...row, status: 'trued-up' };
}

function sumByDay<T extends { dayMs: number }>(
  lines: T[],
  include: (line: T) => boolean,
  value: (line: T) => number
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    if (!include(line)) continue;
    const day = startOfUtcDay(line.dayMs);
    totals.set(day, (totals.get(day) ?? 0) + value(line));
  }
  return totals;
}

async function run(now: number): Promise<TrueUpResult> {
  const result: TrueUpResult = {
    configured: Boolean(adminKey()),
    ranAt: new Date(now).toISOString(),
    calibrations: [],
    days: [],
  };
  if (!result.configured) return result;

  const aliases = (await DocTidyModelPrice.find({
    upstreamModel: { $nin: [null, ''] },
  }).lean()) as unknown as Alias[];
  if (aliases.length === 0) return result;

  const today = startOfUtcDay(now);
  const windowStart = today - (WINDOW_DAYS - 1) * DAY_MS;
  const windowEnd = today + DAY_MS;
  const [costs, usage]: [CostLine[], CompletionUsageLine[]] = await Promise.all([
    fetchDailyCosts(windowStart, windowEnd),
    fetchDailyCompletionUsage(windowStart, windowEnd),
  ]);

  const perAlias = aliases.map((alias) => {
    const billed = sumByDay(
      costs,
      (line) => isModelOrSnapshot(line.lineItem, alias.upstreamModel),
      (line) => line.amount
    );
    const upstreamList = sumByDay(
      usage,
      (line) => isModelOrSnapshot(line.model, alias.upstreamModel),
      (line) => listWeight(line.inputTokens, line.outputTokens, alias)
    );
    const billedUsd = [...billed.values()].reduce((a, b) => a + b, 0);
    const listUsd = [...upstreamList.values()].reduce((a, b) => a + b, 0);
    const calibrationFactor = billedUsd > 0 && listUsd > 0 ? billedUsd / listUsd : null;
    result.calibrations.push({
      model: alias.model,
      upstreamModel: alias.upstreamModel,
      calibrationFactor,
      billedUsd,
      listUsd,
    });
    return { alias, billed, upstreamList, calibrationFactor };
  });

  for (const { alias, calibrationFactor } of perAlias) {
    if (calibrationFactor === null) continue;
    await DocTidyModelPrice.updateOne(
      { _id: alias._id },
      { $set: { calibrationFactor, calibratedAt: new Date(now) } }
    );
  }
  invalidatePriceCache();
  await repriceRange(new Date(windowStart), new Date(windowEnd));

  for (const { alias, billed, upstreamList } of perAlias) {
    for (let day = windowStart; day + DAY_MS + SETTLE_MS <= now; day += DAY_MS) {
      result.days.push(
        await trueUpDay(day, alias, billed.get(day) ?? 0, upstreamList.get(day) ?? 0)
      );
    }
  }

  announceUsage();
  return result;
}

/** Idempotent; concurrent callers share the run in progress. */
export function runTrueUp(): Promise<TrueUpResult> {
  if (!inFlight) {
    inFlight = run(Date.now())
      .catch((error: unknown): TrueUpResult => ({
        configured: true,
        ranAt: new Date().toISOString(),
        calibrations: [],
        days: [],
        error: (error as Error).message,
      }))
      .then((result) => {
        lastResult = result;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function startTrueUpScheduler(): void {
  if (!adminKey()) {
    console.log('[doc-tidy usage] OPENAI_ADMIN_KEY not set: Hermes costs stay at list price');
    return;
  }
  const tick = () => {
    void runTrueUp().then((result) => {
      if (result.error) console.error('[doc-tidy usage] true-up failed:', result.error);
    });
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  setInterval(tick, RUN_EVERY_MS).unref();
}
