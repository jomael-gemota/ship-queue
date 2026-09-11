import CookieJar from '../models/CookieJar';
import { getFetcher } from './registry';

const MAX_ERROR_LEN = 1000;
const inFlight = new Set<string>();

export function truncateError(message: string): string {
  if (message.length <= MAX_ERROR_LEN) return message;
  return `${message.slice(0, MAX_ERROR_LEN)}…`;
}

export async function markUnknownFetcher(key: string): Promise<void> {
  const message = `No fetcher registered for key "${key}"`;
  const doc = await CookieJar.findOne({ key }).select('lastError');
  if (doc?.lastError === message) return;
  await CookieJar.updateOne({ key }, { $set: { lastError: message } });
}

/**
 * Runs a jar's fetcher and persists cookie / timestamps. Shared by the worker
 * cron and the Settings "Run now" endpoint so both paths write the same way.
 * Skips if this process already has that key in flight.
 */
export async function executeCookieJar(key: string): Promise<{ skipped: boolean }> {
  if (inFlight.has(key)) {
    console.log(`[cookie-jar] Skipping ${key} — already running`);
    return { skipped: true };
  }

  const fetcher = getFetcher(key);
  if (!fetcher) {
    await markUnknownFetcher(key);
    return { skipped: false };
  }

  inFlight.add(key);
  const startedAt = new Date();
  console.log(`[cookie-jar] Running ${key}`);

  try {
    const cookie = await fetcher();
    await CookieJar.updateOne(
      { key },
      {
        $set: {
          cookie,
          lastRunAt: startedAt,
          lastSuccessAt: new Date(),
          lastError: null,
        },
      }
    );
    console.log(`[cookie-jar] ${key} succeeded`);
  } catch (err) {
    const message = truncateError(err instanceof Error ? err.message : String(err));
    await CookieJar.updateOne(
      { key },
      {
        $set: {
          lastRunAt: startedAt,
          lastError: message,
        },
      }
    );
    console.error(`[cookie-jar] ${key} failed: ${message}`);
  } finally {
    inFlight.delete(key);
  }

  return { skipped: false };
}
