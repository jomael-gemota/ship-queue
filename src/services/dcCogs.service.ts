/**
 * DC Cost of Goods Sold — Channel Precision pf/lookup/items API
 *
 * Looks up every order SKU in one exact-match batch request and keeps stored
 * costs in sync with Data Central, recording each change in
 * DocTidyDcCogsHistory. See design-log/2026-10-28-dc-cogs-batch-lookup-and-history.md.
 *
 * Required env vars:
 *   CHANNEL_PRECISION_API_KEY     — the Authorization header value
 *   CHANNEL_PRECISION_CLIENT_ID   — the x-ps-client-id header value
 */
import axios from 'axios';
import DocTidyOrderImport from '../models/DocTidyOrderImport';
import DocTidyDcCogsHistory, { type IDocTidyDcCogsHistory } from '../models/DocTidyDcCogsHistory';
import { broadcast } from './docTidyEvents';

const API_KEY   = process.env.CHANNEL_PRECISION_API_KEY   ?? '';
const CLIENT_ID = process.env.CHANNEL_PRECISION_CLIENT_ID ?? '';
const LOOKUP_URL = 'https://api.dc.app.channelprecision.com/v1/pf/lookup/items';

/** The endpoint rejects more than 1000 item_ids per request. */
const LOOKUP_CHUNK = 1000;
const REQUEST_TIMEOUT_MS = 60_000;

/** How often the background scheduler re-syncs every SKU. */
const SYNC_EVERY_MS = 3 * 60 * 1000;

/** Entries attached to each order-import row in list responses. */
const HISTORY_LIMIT = 20;

interface PfLookupItem {
  sku?: string | null;
  cost?: number | string | null;
  /** Note: field is deliberately misspelled `mspr` in the upstream API. */
  mspr?: number | string | null;
}

export interface CostResult {
  cost: string;
  msrp: string;
}

export function normSku(sku: string): string {
  return sku.trim().toUpperCase();
}

function sameCost(a: string | null | undefined, b: string): boolean {
  return a != null && a !== '' && Number(a) === Number(b);
}

/**
 * Live DC costs for `skus`, keyed by normSku. SKUs DC does not know are absent.
 * Throws when a request fails, so callers can tell "not found" from "unknown".
 */
export async function lookupDcCogs(skus: string[]): Promise<Map<string, CostResult>> {
  const costs = new Map<string, CostResult>();
  for (let i = 0; i < skus.length; i += LOOKUP_CHUNK) {
    const res = await axios.post<{ items?: PfLookupItem[] }>(
      LOOKUP_URL,
      { item_type: 'SKU', domain: 'amazon.com', use_cache: false, item_ids: skus.slice(i, i + LOOKUP_CHUNK) },
      {
        headers: {
          accept: 'application/json',
          authorization: API_KEY,
          'x-ps-client-id': CLIENT_ID,
          Referer: 'https://dc.channelprecision.com/',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    // A SKU listed under several ASINs comes back once per ASIN; keep the first with a cost.
    for (const item of res.data.items ?? []) {
      if (typeof item.sku !== 'string' || item.cost == null || item.cost === '') continue;
      const key = normSku(item.sku);
      if (!costs.has(key)) {
        costs.set(key, { cost: String(item.cost), msrp: item.mspr != null ? String(item.mspr) : '' });
      }
    }
  }
  return costs;
}

let syncing = false;
let syncQueued = false;

/**
 * Brings every order-import row's DC COGS in line with Data Central:
 * missing costs are filled, changed costs are updated and recorded in history,
 * and SKUs DC does not know are marked 'n/a' only if they have no cost yet.
 * A failed lookup writes nothing, so a stored cost never disappears.
 *
 * Only one sync runs at a time; a call made during a sync queues one more.
 */
export async function syncDcCogs(): Promise<void> {
  if (!API_KEY || !CLIENT_ID) {
    console.warn('[dcCogs] Skipping COGS sync — CHANNEL_PRECISION_API_KEY or CHANNEL_PRECISION_CLIENT_ID is not configured.');
    return;
  }
  if (syncing) {
    syncQueued = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncQueued = false;
      await syncOnce();
    } while (syncQueued);
  } catch (err) {
    console.error('[dcCogs] Sync failed; stored costs left unchanged:', (err as Error).message);
  } finally {
    syncing = false;
  }
}

async function syncOnce(): Promise<void> {
  const records = await DocTidyOrderImport.find({ orderSku: { $nin: ['', null] } })
    .select('orderSku dcCogs dcMsrp dcCogsAt workspaceId')
    .lean();
  if (records.length === 0) return;

  const bySku = new Map<string, typeof records>();
  for (const r of records) {
    const key = normSku(r.orderSku);
    if (!key) continue;
    bySku.set(key, [...(bySku.get(key) ?? []), r]);
  }

  const rawSkus = [...new Set(records.map((r) => r.orderSku.trim()).filter(Boolean))];
  const live = await lookupDcCogs(rawSkus);

  const lastHistory = new Map<string, IDocTidyDcCogsHistory>();
  const latest = await DocTidyDcCogsHistory.aggregate<{ _id: string; doc: IDocTidyDcCogsHistory }>([
    { $match: { sku: { $in: [...bySku.keys()] } } },
    { $sort: { recordedAt: -1 } },
    { $group: { _id: '$sku', doc: { $first: '$$ROOT' } } },
  ]);
  for (const { _id, doc } of latest) lastHistory.set(_id, doc);

  const now = new Date();
  const historyInserts: Partial<IDocTidyDcCogsHistory>[] = [];
  const bulkOps: Parameters<typeof DocTidyOrderImport.bulkWrite>[0] = [];
  const touchedWorkspaces = new Set<string>();

  for (const [sku, rows] of bySku) {
    const variants = [...new Set(rows.map((r) => r.orderSku))];
    const result = live.get(sku);

    if (!result) {
      const unfetched = rows.filter((r) => r.dcCogs == null);
      if (unfetched.length) {
        bulkOps.push({
          updateMany: {
            filter: { orderSku: { $in: variants }, dcCogs: null },
            update: { $set: { dcCogs: 'n/a', dcMsrp: '', dcCogsAt: now } },
          },
        });
        unfetched.forEach((r) => touchedWorkspaces.add(String(r.workspaceId)));
      }
      continue;
    }

    const last = lastHistory.get(sku);
    if (!last) {
      // First time this SKU is tracked: seed whatever cost Doc Tidy already held.
      const stored = rows
        .filter((r) => r.dcCogs && r.dcCogs !== 'n/a')
        .sort((a, b) => (b.dcCogsAt?.getTime() ?? 0) - (a.dcCogsAt?.getTime() ?? 0))[0];
      if (stored && !sameCost(stored.dcCogs, result.cost)) {
        historyInserts.push({
          sku, cost: stored.dcCogs!, msrp: stored.dcMsrp ?? '', recordedAt: stored.dcCogsAt ?? now, source: 'stored',
        });
      }
      historyInserts.push({
        sku, cost: result.cost, msrp: result.msrp,
        recordedAt: stored && sameCost(stored.dcCogs, result.cost) ? stored.dcCogsAt ?? now : now,
        source: 'dc_lookup',
      });
    } else if (!sameCost(last.cost, result.cost)) {
      historyInserts.push({ sku, cost: result.cost, msrp: result.msrp, recordedAt: now, source: 'dc_lookup' });
    }

    const stale = rows.filter((r) => !sameCost(r.dcCogs, result.cost) || (r.dcMsrp ?? '') !== result.msrp);
    if (stale.length) {
      bulkOps.push({
        updateMany: {
          filter: { _id: { $in: stale.map((r) => r._id) } },
          update: { $set: { dcCogs: result.cost, dcMsrp: result.msrp, dcCogsAt: now } },
        },
      });
      stale.forEach((r) => touchedWorkspaces.add(String(r.workspaceId)));
    }
  }

  if (historyInserts.length) await DocTidyDcCogsHistory.insertMany(historyInserts);
  if (bulkOps.length) await DocTidyOrderImport.bulkWrite(bulkOps);
  for (const workspaceId of touchedWorkspaces) broadcast({ type: 'dc_cogs', workspaceId });
}

/** Number of rows in a workspace without a DC cost yet. */
export async function countRowsNeedingCogs(workspaceId: string): Promise<number> {
  return DocTidyOrderImport.countDocuments({ workspaceId, dcCogs: { $in: [null, 'n/a'] } });
}

export interface DcCogsHistoryEntry {
  cost: string;
  msrp: string;
  recordedAt: Date;
  source: 'dc_lookup' | 'stored';
}

/** Cost history (newest first) for each SKU, keyed by normSku. */
export async function getDcCogsHistory(skus: string[]): Promise<Map<string, DcCogsHistoryEntry[]>> {
  const keys = [...new Set(skus.filter(Boolean).map(normSku))];
  const history = new Map<string, DcCogsHistoryEntry[]>();
  if (!keys.length) return history;

  const docs = await DocTidyDcCogsHistory.find({ sku: { $in: keys } })
    .sort({ recordedAt: -1 })
    .select('sku cost msrp recordedAt source')
    .lean();
  for (const d of docs) {
    const list = history.get(d.sku) ?? [];
    if (list.length < HISTORY_LIMIT) list.push({ cost: d.cost, msrp: d.msrp, recordedAt: d.recordedAt, source: d.source });
    history.set(d.sku, list);
  }
  return history;
}

/** Keeps DC COGS in sync every SYNC_EVERY_MS, even when nobody has the app open. */
export function startDcCogsRetryScheduler(): void {
  if (!API_KEY || !CLIENT_ID) {
    console.warn('[dcCogs] Sync scheduler not started — Channel Precision credentials are not configured.');
    return;
  }
  setInterval(() => void syncDcCogs(), SYNC_EVERY_MS).unref();
  console.log(`[dcCogs] Syncing DC COGS every ${Math.round(SYNC_EVERY_MS / 1000)}s`);
}
