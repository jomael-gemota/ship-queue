import DocTidyRule from '../models/DocTidyRule';
import { getDocTidyConfigDoc } from '../models/DocTidyConfig';
import { isExtractionRunning, runEnabledRules, getExtractionStatus } from './docTidy.service';

/**
 * Polls the connected mailbox so matching mail is captured without anyone
 * pressing a button. Mirrors `syncScheduler`: one interval, `unref()`ed, and a
 * tick is skipped rather than queued while a run is still in flight.
 *
 * Ticks pass `skipKnown` so the cost of a poll is one `messages.list` per rule
 * plus a fetch only for mail we have never seen.
 *
 * Broadcasting of `poll_status` SSE events is handled inside `runEnabledRules`
 * so that both the automated poller and manual "run all" triggers are covered.
 */

const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 5;
const STARTUP_DELAY_MS = 8_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastPollAt: Date | null = null;

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

    if (result && result.imported > 0) {
      console.log(`[DocTidyPoller] Imported ${result.imported} new message(s)`);
    }
  } catch (err) {
    // Never let a bad tick kill the interval; the next one retries.
    console.error('[DocTidyPoller] Poll failed:', (err as Error).message);
  }
}

export function getPollerStatus(): {
  enabled: boolean;
  intervalSeconds: number;
  isPolling: boolean;
  lastPollAt: Date | null;
  lastImportAt: Date | null;
  lastError: string | null;
} {
  const { lastImportAt, lastError } = getExtractionStatus();
  return {
    enabled: timer !== null,
    intervalSeconds: Math.round(intervalMs() / 1000),
    isPolling: isExtractionRunning(),
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
