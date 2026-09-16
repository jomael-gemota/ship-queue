import DocTidyRule from '../models/DocTidyRule';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { isExtractionRunning, runEnabledRules } from './docTidy.service';

/**
 * Polls the connected mailbox so matching mail is captured without anyone
 * pressing a button. Mirrors `syncScheduler`: one interval, `unref()`ed, and a
 * tick is skipped rather than queued while a run is still in flight.
 *
 * Ticks pass `skipKnown` so the cost of a poll is one `messages.list` per rule
 * plus a fetch only for mail we have never seen.
 */

const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 5;
const STARTUP_DELAY_MS = 8_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastPollAt: Date | null = null;
let lastImportAt: Date | null = null;
let lastError: string | null = null;

function intervalMs(): number {
  const raw = Number(process.env.DOC_TIDY_POLL_INTERVAL_SECONDS);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_SECONDS;
  return Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)) * 1000;
}

/**
 * Re-reads the config and rules on every tick instead of caching them, so
 * connecting the mailbox or enabling a rule takes effect without a restart.
 */
async function tick(): Promise<void> {
  if (isExtractionRunning()) return;

  try {
    const config = await getDocTidyConfigDoc(true);
    if (!config.gmailRefreshToken) return;

    const enabledCount = await DocTidyRule.countDocuments({ enabled: true });
    if (enabledCount === 0) return;

    lastPollAt = new Date();
    const result = await runEnabledRules({ skipKnown: true });
    if (!result) return;

    if (result.imported > 0) {
      lastImportAt = new Date();
      console.log(`[DocTidyPoller] Imported ${result.imported} new message(s)`);
    }

    const failed = result.results.filter((r) => r.error);
    lastError = failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join(' · ') : null;
  } catch (err) {
    // Never let a bad tick kill the interval; the next one retries.
    lastError = (err as Error).message;
    console.error('[DocTidyPoller] Poll failed:', lastError);
  }
}

export function getPollerStatus(): {
  enabled: boolean;
  intervalSeconds: number;
  lastPollAt: Date | null;
  lastImportAt: Date | null;
  lastError: string | null;
} {
  return {
    enabled: timer !== null,
    intervalSeconds: Math.round(intervalMs() / 1000),
    lastPollAt,
    lastImportAt,
    lastError,
  };
}

export function startDocTidyPoller(): void {
  stopDocTidyPoller();

  const ms = intervalMs();
  timer = setInterval(() => {
    void tick();
  }, ms);

  if (typeof timer.unref === 'function') timer.unref();

  // Catch up on anything that arrived while the server was down, but let the
  // rest of boot settle first.
  setTimeout(() => void tick(), STARTUP_DELAY_MS);

  console.log(`[DocTidyPoller] Watching mailbox — every ${Math.round(ms / 1000)}s`);
}

export function stopDocTidyPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
