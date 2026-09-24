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

const API_KEY   = process.env.CHANNEL_PRECISION_API_KEY   ?? '';
const CLIENT_ID = process.env.CHANNEL_PRECISION_CLIENT_ID ?? '';
const BASE_URL  = 'https://api.dc.app.channelprecision.com/v1';

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
 * Fetch the most-recently-updated DC cost for a given SKU.
 * Returns `null` if the API is not configured, the SKU is not found, or the
 * request fails.
 */
export async function fetchDcCogs(sku: string): Promise<CostResult | null> {
  if (!API_KEY || !CLIENT_ID) return null;
  if (!sku?.trim()) return null;

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
      timeout: 10_000,
    });

    const data = res.data;
    if (!data || data.total === 0 || !Array.isArray(data.items)) return null;

    const matching = data.items.filter((item) => item.sku === sku.trim());
    if (matching.length === 0) return null;

    // Pick the most recently updated entry (mirrors btcostWorker's sort logic).
    const sorted = [...matching].sort((a: BtCostItem, b: BtCostItem) => {
      const aDate = a.updated ? new Date(a.updated).getTime() : 0;
      const bDate = b.updated ? new Date(b.updated).getTime() : 0;
      return bDate - aDate;
    });

    const item = sorted[0];
    return {
      cost: item.cost != null ? String(item.cost) : '',
      msrp: item.mspr != null ? String(item.mspr) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Populate DC COGS for every record in an import batch that does not yet have
 * a value.  Runs in the background (fire-and-forget); callers should NOT await
 * this unless they explicitly want to block on it.
 *
 * Processes SKUs in parallel with a concurrency of 5, with a 150 ms gap
 * between batches to avoid hammering the upstream API.
 */
export async function populateCogsForBatch(importBatchId: string): Promise<void> {
  if (!API_KEY || !CLIENT_ID) return;

  try {
    // Fetch all records in the batch that still need COGS.
    const records = await DocTidyOrderImport.find({
      importBatchId,
      dcCogs: null,
    }).lean();

    if (records.length === 0) return;

    // Deduplicate SKUs so we call the API once per unique value.
    const uniqueSkus = [...new Set(records.map((r) => r.orderSku).filter(Boolean))];

    const cogsMap = new Map<string, CostResult | null>();

    // Process in batches of 5 (concurrency limit).
    const BATCH_SIZE = 5;
    for (let i = 0; i < uniqueSkus.length; i += BATCH_SIZE) {
      const batch = uniqueSkus.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((sku) => fetchDcCogs(sku)));
      batch.forEach((sku, idx) => cogsMap.set(sku, results[idx]));

      // Small courtesy delay between batches.
      if (i + BATCH_SIZE < uniqueSkus.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Persist the results — one bulk-write per unique SKU.
    const bulkOps = uniqueSkus.map((sku) => {
      const result = cogsMap.get(sku);
      return {
        updateMany: {
          filter: { importBatchId, orderSku: sku },
          update: {
            $set: {
              dcCogs:   result ? result.cost || 'n/a' : 'n/a',
              dcMsrp:   result ? result.msrp || '' : '',
              dcCogsAt: new Date(),
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      await DocTidyOrderImport.bulkWrite(bulkOps);
    }
  } catch (err) {
    console.error('[dcCogs] Background population failed:', err);
  }
}
