import { triggerSync, isSyncRunning } from '../controllers/order.controller';
import { getSyncConfigDoc } from '../models/SyncConfig';

let timer: ReturnType<typeof setInterval> | null = null;

// Mirrors the currently-applied DB config so the API can report what the
// scheduler is actually doing right now.
let runtime: { enabled: boolean; intervalMs: number } = {
  enabled: false,
  intervalMs: 5 * 60 * 1000,
};

function clearTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * (Re)configures the background scheduler in place. Safe to call at runtime —
 * e.g. when an admin changes the interval or toggles auto-sync — without
 * restarting the server. Reuses the same `triggerSync()` guard as the HTTP
 * endpoint so a tick is skipped while any sync is already running.
 */
export function applySyncConfig(config: { enabled: boolean; intervalMs: number }): void {
  runtime = { enabled: config.enabled, intervalMs: config.intervalMs };
  clearTimer();

  if (!config.enabled) {
    console.log('[SyncScheduler] Auto-sync disabled');
    return;
  }

  timer = setInterval(() => {
    if (isSyncRunning()) {
      console.log('[SyncScheduler] Skipping tick — a sync is already running');
      return;
    }
    console.log('[SyncScheduler] Triggering scheduled sync');
    triggerSync();
  }, config.intervalMs);

  // Don't let the interval keep the process alive on its own.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log(`[SyncScheduler] Auto-sync enabled — every ${Math.round(config.intervalMs / 1000)}s`);
}

export function getSchedulerRuntime(): { enabled: boolean; intervalMs: number } {
  return { ...runtime };
}

/**
 * Loads the persisted config and starts the scheduler. Called once on server
 * boot. Also kicks off one sync shortly after startup so a freshly (re)started
 * server doesn't wait a full interval before its first sync.
 */
export async function startSyncScheduler(): Promise<void> {
  try {
    const doc = await getSyncConfigDoc();
    applySyncConfig({ enabled: doc.enabled, intervalMs: doc.intervalMs });
  } catch (err) {
    console.error('[SyncScheduler] Failed to load sync config:', err);
    return;
  }

  setTimeout(() => {
    if (runtime.enabled && !isSyncRunning()) {
      console.log('[SyncScheduler] Running initial sync after startup');
      triggerSync();
    }
  }, 10_000);
}

export function stopSyncScheduler(): void {
  clearTimer();
}
