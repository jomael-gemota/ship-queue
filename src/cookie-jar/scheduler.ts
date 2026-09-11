import { Cron } from 'croner';
import CookieJar from '../models/CookieJar';
import { getFetcher } from './registry';
import { executeCookieJar, markUnknownFetcher, truncateError } from './run';

const CONFIG_POLL_MS = 30_000;

interface BoundJob {
  cron: string;
  job: Cron;
}

const bound = new Map<string, BoundJob>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopJob(key: string): void {
  const current = bound.get(key);
  if (!current) return;
  current.job.stop();
  bound.delete(key);
  console.log(`[cookie-jar] Stopped ${key}`);
}

function startJob(key: string, cron: string): void {
  stopJob(key);

  const fetcher = getFetcher(key);
  if (!fetcher) {
    console.warn(`[cookie-jar] No fetcher registered for key "${key}"`);
    return;
  }

  const job = new Cron(
    cron,
    {
      timezone: 'UTC',
      mode: '5-part',
      protect: true,
      catch: (err) => {
        console.error(`[cookie-jar] ${key} unhandled cron error:`, err);
      },
    },
    () => {
      void executeCookieJar(key);
    }
  );

  bound.set(key, { cron, job });
  console.log(`[cookie-jar] Scheduled ${key} (${cron} UTC)`);

  // Don't wait a full cron cycle after (re)bind — same idea as the order-sync
  // scheduler's post-boot run. Overlap is still guarded in executeCookieJar.
  setTimeout(() => {
    void executeCookieJar(key);
  }, 5_000);
}

async function markInvalidCron(key: string, cron: string, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const message = `Invalid cron "${cron}": ${reason}`;
  const doc = await CookieJar.findOne({ key }).select('lastError');
  if (doc?.lastError === message) return;
  await CookieJar.updateOne({ key }, { $set: { lastError: truncateError(message) } });
}

export async function reconcileCookieJars(): Promise<void> {
  const rows = await CookieJar.find().select('key enabled cron');
  const seen = new Set<string>();

  for (const row of rows) {
    seen.add(row.key);

    if (!row.enabled) {
      stopJob(row.key);
      continue;
    }

    if (!getFetcher(row.key)) {
      stopJob(row.key);
      await markUnknownFetcher(row.key);
      continue;
    }

    const current = bound.get(row.key);
    if (current && current.cron === row.cron) {
      continue;
    }

    try {
      startJob(row.key, row.cron);
    } catch (err) {
      stopJob(row.key);
      await markInvalidCron(row.key, row.cron, err);
      console.error(`[cookie-jar] Failed to schedule ${row.key}:`, err);
    }
  }

  for (const key of Array.from(bound.keys())) {
    if (!seen.has(key)) {
      stopJob(key);
    }
  }
}

export async function startCookieJarScheduler(): Promise<void> {
  await reconcileCookieJars();

  pollTimer = setInterval(() => {
    reconcileCookieJars().catch((err) => {
      console.error('[cookie-jar] Config poll failed:', err);
    });
  }, CONFIG_POLL_MS);

  console.log(`[cookie-jar] Watching DB config every ${CONFIG_POLL_MS / 1000}s`);
}

export function stopCookieJarScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const key of Array.from(bound.keys())) {
    stopJob(key);
  }
}
