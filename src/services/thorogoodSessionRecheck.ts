import { BulkOrderHealthBusyError, runBulkOrderHealthCheck } from './bulkOrderHealth';
import { HhB2bHealthBusyError, runHhB2bHealthCheck } from './hhB2bHealth';

const LOG = '[thorogood-session]';

/**
 * Dropship and bulk both read the Thorogood B2B jar. A scheduled check can
 * reject the cookie that is about to be replaced; this runs after the new
 * cookie is stored so that result does not stay stale.
 */
export async function recheckThorogoodSessionsAfterJar(): Promise<void> {
  await recheck('dropship', () => runHhB2bHealthCheck('thorogood'));
  await recheck('bulk', () => runBulkOrderHealthCheck());
}

async function recheck(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HhB2bHealthBusyError || err instanceof BulkOrderHealthBusyError) {
      console.log(`${LOG} Skipping ${label} session check — one is already running`);
      return;
    }
    console.error(`${LOG} ${label} session check failed`, err);
  }
}
