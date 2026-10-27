/**
 * DC Cost of Goods Sold — Channel Precision bt_costs API
 *
 * Thin wrapper around the same API used by the sm-tool btcostWorker.
 * Credentials are read from environment variables so they stay out of source.
 *
 * Required env vars:
 *   CHANNEL_PRECISION_API_KEY     — the Authorization header value
 *   CHANNEL_PRECISION_CLIENT_ID   — the x-ps-client-id header value
 */
import axios from 'axios';
import DocTidyOrderImport from '../models/DocTidyOrderImport';
import { broadcast } from './docTidyEvents';

const API_KEY   = process.env.CHANNEL_PRECISION_API_KEY   ?? '';
const CLIENT_ID = process.env.CHANNEL_PRECISION_CLIENT_ID ?? '';
const BASE_URL  = 'https://api.dc.app.channelprecision.com/v1';

/** `s` is a fuzzy search over ~2M cost rows and is routinely slow. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A SKU recorded as not found ('n/a') is looked up again after this long. */
const NOT_FOUND_RETRY_MS = 3 * 60 * 1000;

/** How often the background scheduler retries rows still missing a cost. */
const RETRY_EVERY_MS = 3 * 60 * 1000;

/** Shape of one item returned by the bt_costs endpoint. */
interface BtCostItem {
  sku: string;
  cost: number | string;
  /** Note: field is deliberately misspelled `mspr` in the upstream API. */
  mspr?: number | string;
  brand?: { secondary_brand_name?: string };
  updated?: string;
}

interface BtCostResponse {
  total: number;
  items: BtCostItem[];
}

export interface CostResult {
  cost: string;
  msrp: string;
}

/**
 * `not_found` is a definitive answer from the API; `error` (timeout, 5xx, bad
 * credentials) says nothing about the SKU and must not be recorded as 'n/a'.
 */
export type CogsLookup =
  | { status: 'found'; result: CostResult }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/** Fetch the most-recently-updated DC cost for a given SKU. */
export async function fetchDcCogs(sku: string): Promise<CogsLookup> {
  if (!sku?.trim()) return { status: 'not_found' };

  try {
    const res = await axios.get<BtCostResponse>(`${BASE_URL}/bt_costs`, {
      params: { limit: 50, page: 1, s: sku.trim() },
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        authorization: API_KEY,
        'x-ps-client-id': CLIENT_ID,
        Referer: 'https://dc.channelprecision.com/',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const data = res.data;
    if (!data || data.total === 0 || !Array.isArray(data.items)) return { status: 'not_found' };

    // Normalise both sides before comparing so "ABC-123" and "abc-123" are
    // treated as the same SKU.  The upstream `s` search parameter is fuzzy,
    // so the response may contain SKUs that differ only in case or whitespace.
    const skuNorm = sku.trim().toUpperCase();
    const matching = data.items.filter(
      (item) => typeof item.sku === 'string' && item.sku.trim().toUpperCase() === skuNorm,
    );
    if (matching.length === 0) return { status: 'not_found' };

    // Pick the most recently updated entry (mirrors btcostWorker's sort logic).
    const sorted = [...matching].sort((a: BtCostItem, b: BtCostItem) => {
      const aDate = a.updated ? new Date(a.updated).getTime() : 0;
      const bDate = b.updated ? new Date(b.updated).getTime() : 0;
      return bDate - aDate;
    });

    const item = sorted[0];
    if (item.cost == null || item.cost === '') return { status: 'not_found' };
    return {
      status: 'found',
      result: { cost: String(item.cost), msrp: item.mspr != null ? String(item.mspr) : '' },
    };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

/** Rows that still need a cost: never fetched, or not found long enough ago to retry. */
function needsCogsClause(): Record<string, unknown> {
  return {
    $or: [
      { dcCogs: null },
      { dcCogs: 'n/a', $or: [{ dcCogsAt: null }, { dcCogsAt: { $lt: new Date(Date.now() - NOT_FOUND_RETRY_MS) } }] },
    ],
  };
}

/** Scopes currently being populated, so overlapping triggers do not stack API calls. */
const running = new Set<string>();

/**
 * Fills DC COGS for rows in `scope` that need one. Rows that already hold a
 * cost are never touched. SKUs whose cost is already stored on any row are
 * filled from that row instead of calling the API; the rest are looked up 5 at
 * a time. A failed lookup leaves the row as it was so it is retried later.
 *
 * Resolves `true` when the pass stopped because the DC API is unavailable.
 */
async function _populateCogs(scopeKey: string, scope: Record<string, unknown>): Promise<boolean> {
  if (!API_KEY || !CLIENT_ID) {
    console.warn('[dcCogs] Skipping COGS population — CHANNEL_PRECISION_API_KEY or CHANNEL_PRECISION_CLIENT_ID is not configured.');
    return false;
  }
  if (running.has(scopeKey)) return false;
  running.add(scopeKey);

  let apiUnavailable = false;
  try {
    const records = await DocTidyOrderImport.find({ ...scope, ...needsCogsClause() })
      .select('orderSku workspaceId')
      .lean();
    if (records.length === 0) return false;

    const uniqueSkus = [...new Set(records.map((r) => r.orderSku).filter(Boolean))];
    const lookups = new Map<string, CogsLookup>();

    const known = await DocTidyOrderImport.find({
      orderSku: { $in: uniqueSkus },
      dcCogs: { $nin: [null, 'n/a'] },
    })
      .sort({ dcCogsAt: -1 })
      .select('orderSku dcCogs dcMsrp')
      .lean();
    for (const row of known) {
      if (!lookups.has(row.orderSku) && row.dcCogs) {
        lookups.set(row.orderSku, { status: 'found', result: { cost: row.dcCogs, msrp: row.dcMsrp ?? '' } });
      }
    }

    const toFetch = uniqueSkus.filter((sku) => !lookups.has(sku));
    const BATCH_SIZE = 5;
    let errors = 0;
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((sku) => fetchDcCogs(sku)));
      batch.forEach((sku, idx) => lookups.set(sku, results[idx]));

      const batchErrors = results.filter((r) => r.status === 'error');
      errors += batchErrors.length;
      // A whole batch failing means the API is down or timing out; the
      // remaining SKUs would only fail the same way.
      if (batchErrors.length === batch.length) {
        apiUnavailable = true;
        console.warn(
          `[dcCogs] DC API unavailable (${(batchErrors[0] as { message: string }).message}); ` +
          `${toFetch.length - i - batch.length} SKU(s) left pending for the next run.`
        );
        break;
      }

      if (i + BATCH_SIZE < toFetch.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (errors > 0) console.warn(`[dcCogs] ${errors} lookup(s) failed and were left pending.`);

    const now = new Date();
    const bulkOps = [...lookups.entries()].flatMap(([sku, lookup]) => {
      if (lookup.status === 'error') return [];
      return [{
        updateMany: {
          // The dcCogs guard ensures a stored cost is never overwritten.
          filter: { ...scope, orderSku: sku, dcCogs: { $in: [null, 'n/a'] } } as Record<string, unknown>,
          update: {
            $set: lookup.status === 'found'
              ? { dcCogs: lookup.result.cost, dcMsrp: lookup.result.msrp, dcCogsAt: now }
              : { dcCogs: 'n/a', dcMsrp: '', dcCogsAt: now },
          },
        },
      }];
    });

    if (bulkOps.length > 0) {
      await DocTidyOrderImport.bulkWrite(bulkOps);
      for (const workspaceId of new Set(records.map((r) => String(r.workspaceId)))) {
        broadcast({ type: 'dc_cogs', workspaceId });
      }
    }
  } finally {
    running.delete(scopeKey);
  }
  return apiUnavailable;
}

/**
 * Populate DC COGS for every record in an import batch that does not yet have
 * a value.  Runs in the background (fire-and-forget); callers should NOT await
 * this unless they explicitly want to block on it.
 */
export async function populateCogsForBatch(importBatchId: string): Promise<void> {
  try {
    await _populateCogs(`batch:${importBatchId}`, { importBatchId });
  } catch (err) {
    console.error('[dcCogs] Background population failed (batch):', err);
  }
}

/**
 * Populate DC COGS for every record in a workspace that has never been fetched,
 * or was not found more than NOT_FOUND_RETRY_MS ago. Rows with a cost are left
 * alone. Runs in the background (fire-and-forget).
 */
export async function populateCogsForWorkspace(workspaceId: string): Promise<void> {
  try {
    await _populateCogs(`workspace:${workspaceId}`, { workspaceId });
  } catch (err) {
    console.error('[dcCogs] Background population failed (workspace):', err);
  }
}

/** Number of rows in a workspace that the next population pass would look up. */
export async function countRowsNeedingCogs(workspaceId: string): Promise<number> {
  return DocTidyOrderImport.countDocuments({ workspaceId, ...needsCogsClause() });
}

let retryTicking = false;

/** One scheduler pass: populate every workspace that has rows missing a cost. */
async function retryTick(): Promise<void> {
  if (retryTicking) return;
  retryTicking = true;
  try {
    const workspaceIds = await DocTidyOrderImport.distinct('workspaceId', needsCogsClause());
    for (const workspaceId of workspaceIds) {
      // Other workspaces would hit the same outage; wait for the next tick.
      if (await _populateCogs(`workspace:${workspaceId}`, { workspaceId })) break;
    }
  } catch (err) {
    console.error('[dcCogs] Scheduled retry failed:', err);
  } finally {
    retryTicking = false;
  }
}

/**
 * Retries rows still missing a DC COGS every RETRY_EVERY_MS, so costs appear in
 * the Invoice Audit table without anyone having to reopen it.
 */
export function startDcCogsRetryScheduler(): void {
  if (!API_KEY || !CLIENT_ID) {
    console.warn('[dcCogs] Retry scheduler not started — Channel Precision credentials are not configured.');
    return;
  }
  setInterval(() => void retryTick(), RETRY_EVERY_MS).unref();
  console.log(`[dcCogs] Retrying missing DC COGS every ${Math.round(RETRY_EVERY_MS / 1000)}s`);
}
