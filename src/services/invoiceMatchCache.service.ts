/**
 * Invoice Match Cache
 *
 * When a parse job completes, this service:
 *   1. Extracts the PO # and line items from the job's jsonOutput — once per
 *      invoice for spreadsheet batch files (`invoices[]`).
 *   2. Finds every DocTidyOrderImport in the same workspace whose poNumber +
 *      orderSku normalise-match the invoice data.
 *   3. Appends a cache entry to `matchedInvoices[]` on each matching order
 *      import (pull-then-push so re-parses replace, not duplicate, an entry).
 *
 * This means the Invoice Audit table only ever needs to query
 * DocTidyOrderImport — it never has to load all parse jobs to do client-side
 * matching, keeping the table fast as the parse-job collection grows.
 *
 * Multiple invoices can match the same order line (split-shipment case).
 * The frontend aggregates all entries in `matchedInvoices[]` for display.
 */

import { Types } from 'mongoose';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyOrderImport, { type IMatchedInvoice } from '../models/DocTidyOrderImport';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyRule from '../models/DocTidyRule';
import { tableSearchScopes } from './docTidyTables.service';

/* ─────────────────────────── field-extraction helpers ─────────────────── */

/** Mirror of the frontend normForMatch — lowercase, strip separators. */
function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/[\s#_-]+/g, '');
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Keys that carry the buyer's PO number, in priority order. Customer PO Number
 * and Customer Reference are treated as the PO for every workspace.
 *
 * Must stay identical to `PO_NUMBER_FIELD_KEYS` in `frontend/src/types/docTidy.ts`.
 */
export const PO_NUMBER_KEYS = [
  'po_number', 'purchase_order_number', 'po_no', 'po',
  'customer_po_number', 'customer_po_no', 'customer_po',
  'cust_po_number', 'cust_po_no', 'cust_po',
  'customer_purchase_order', 'customer_purchase_order_number',
  'your_po', 'your_po_number', 'buyer_po', 'client_po',
  'customer_reference_number', 'customer_reference', 'customer_ref_no', 'customer_ref',
  'cust_ref', 'your_reference', 'your_ref',
  'purchase_order', 'order_number', 'order_no',
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The object itself, then its plain-object children (e.g. `totals`), then any
 * `tables` array the agent emitted, so a top-level key always outranks a
 * grouped one.
 */
function searchScopes(obj: Record<string, unknown>): Record<string, unknown>[] {
  return [obj, ...Object.values(obj).filter(isObject), ...tableSearchScopes(obj)];
}

/**
 * Pull the first non-empty scalar from a JSON object by candidate keys, in
 * priority order. Keys match after lowercasing and stripping every
 * non-alphanumeric character, so camelCase, snake_case and printed labels
 * (`Customer PO #`) are equivalent.
 *
 * Must stay identical to `extractJsonField` in `frontend/src/types/docTidy.ts`,
 * or a row's cached and fallback Invoice Audit values will disagree.
 */
function extractField(obj: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!isObject(obj)) return '';
  for (const scope of searchScopes(obj)) {
    for (const key of keys) {
      const target = normKey(key);
      for (const [k, v] of Object.entries(scope)) {
        if (normKey(k) !== target) continue;
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      }
    }
  }
  return '';
}

/** Pull a non-empty array from a JSON object, searched the same way as `extractField`. */
function extractArray(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): Record<string, unknown>[] {
  if (!isObject(obj)) return [];
  for (const scope of searchScopes(obj)) {
    for (const key of keys) {
      const target = normKey(key);
      for (const [k, v] of Object.entries(scope)) {
        if (normKey(k) === target && Array.isArray(v) && v.length > 0) {
          return v as Record<string, unknown>[];
        }
      }
    }
  }
  return [];
}

/* ─────────────────────────── workspace resolver ───────────────────────── */

/**
 * Resolve the workspace ObjectId for a parse job.
 *
 * - PDF-import jobs carry `workspaceId` directly.
 * - Email jobs are linked via: message → rule → workspace.
 *
 * Returns null if the job cannot be associated with a workspace (e.g. it was
 * created before workspaces existed).
 */
async function resolveWorkspaceId(job: {
  source?: string;
  workspaceId?: Types.ObjectId;
  messageId: Types.ObjectId;
}): Promise<Types.ObjectId | null> {
  if (job.workspaceId) return job.workspaceId;

  const message = await DocTidyMessage.findById(job.messageId).select('ruleId').lean();
  if (!message?.ruleId) return null;

  const rule = await DocTidyRule.findById(message.ruleId).select('workspaceId').lean();
  return rule?.workspaceId ?? null;
}

/* ────────────────────────── cache-building logic ──────────────────────── */

/**
 * Given a completed parse job, build the `matchedInvoices` cache for all order
 * imports in the same workspace that match by PO # (and optionally by SKU for
 * the line-item fields).
 *
 * Uses an idempotent pull-then-push strategy so re-parsing a job replaces its
 * existing entry in `matchedInvoices[]` rather than duplicating it.
 *
 * Returns the number of order-import documents updated.
 */
export async function writeMatchCacheForJob(jobId: string): Promise<number> {
  if (!Types.ObjectId.isValid(jobId)) return 0;

  const job = await DocTidyParseJob.findById(jobId)
    .select('jsonOutput workspaceId messageId source driveFileId status')
    .lean();

  if (!job || job.status !== 'completed' || !job.jsonOutput) return 0;

  const invoices = invoiceDocuments(job.jsonOutput as Record<string, unknown>)
    .filter((inv) => norm(extractField(inv, ...PO_NUMBER_KEYS)));
  if (invoices.length === 0) return 0;

  const workspaceId = await resolveWorkspaceId(job);
  if (!workspaceId) return 0;

  // Fetch every order import once and filter in JS so we can reuse `norm()`.
  const candidates = await DocTidyOrderImport.find({ workspaceId }).select('_id poNumber orderSku').lean();

  const matched = invoices.flatMap((inv) =>
    cachesForInvoice(inv, job._id as Types.ObjectId, job.driveFileId ?? undefined, candidates)
  );
  if (matched.length === 0) return 0;

  // An order can match several invoices of one batch file (split shipment), so
  // all of this job's entries for an order are replaced together.
  const byOrder = new Map<string, { id: Types.ObjectId; caches: IMatchedInvoice[] }>();
  for (const { id, cache } of matched) {
    const entry = byOrder.get(String(id)) ?? { id, caches: [] };
    entry.caches.push(cache);
    byOrder.set(String(id), entry);
  }

  // Step 1: remove any prior entries for this job (idempotent re-parse support).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pullOps: any[] = [...byOrder.values()].map(({ id }) => ({
    updateOne: {
      filter: { _id: id },
      update: { $pull: { matchedInvoices: { jobId: job._id } } },
    },
  }));
  await DocTidyOrderImport.bulkWrite(pullOps);

  // Step 2: append the fresh cache entries for this job.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pushOps: any[] = [...byOrder.values()].map(({ id, caches }) => ({
    updateOne: {
      filter: { _id: id },
      update: { $push: { matchedInvoices: { $each: caches } } },
    },
  }));
  const result = await DocTidyOrderImport.bulkWrite(pushOps);
  return result.modifiedCount;
}

/**
 * The invoices in a job's output: each element of `invoices[]` for a
 * spreadsheet batch file, otherwise the output itself.
 *
 * Must stay identical to `invoiceDocuments` in `frontend/src/types/docTidy.ts`.
 */
function invoiceDocuments(json: Record<string, unknown>): Record<string, unknown>[] {
  const invoices = Array.isArray(json.invoices) ? json.invoices.filter(isObject) : [];
  return invoices.length > 0 ? invoices : [json];
}

/** Cache entries for every order import matching one invoice by PO # (and SKU when present). */
function cachesForInvoice(
  json: Record<string, unknown>,
  jobId: Types.ObjectId,
  driveFileId: string | undefined,
  candidates: { _id: unknown; poNumber?: string; orderSku?: string }[],
): { id: Types.ObjectId; cache: IMatchedInvoice }[] {
  const jobPo = norm(extractField(json, ...PO_NUMBER_KEYS));

  // Extract document-level fields (same for every matched order from this invoice).
  const invoiceDate   = extractField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date');
  const invoiceNumber = extractField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice');
  const terms         = extractField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms');
  const docDropship   = extractField(json, 'dropship_fee', 'ds_fee', 'drop_ship_fee', 'dropship fee', 'dropship');
  const docMisc       = extractField(json, 'misc_charges', 'miscellaneous_charges', 'misc_fees', 'other_charges', 'misc', 'miscellaneous');
  const docTotal      = extractField(json, 'total_cost', 'total_costs', 'total', 'grand_total', 'total_amount', 'total_value', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'total_invoice');

  const lineItems = extractArray(json,
    'line_items', 'items', 'products', 'line items', 'lineItems', 'order_items', 'orderItems'
  );

  const matchedIds: { id: Types.ObjectId; cache: IMatchedInvoice }[] = [];

  for (const order of candidates) {
    if (norm(order.poNumber) !== jobPo) continue;

    // Find the line item whose SKU matches this order's SKU.
    const normSku = norm(order.orderSku);
    let matchedItem: Record<string, unknown> | null = null;

    if (lineItems.length > 0 && normSku) {
      for (const item of lineItems) {
        const itemSku = norm(
          extractField(item as Record<string, unknown>,
            'sku', 'part_number', 'part_no', 'item_code', 'product_code', 'sku_number'
          )
        );
        if (itemSku === normSku) {
          matchedItem = item as Record<string, unknown>;
          break;
        }
      }
      // If we have line items but none matched this SKU, skip (PO alone isn't enough).
      if (!matchedItem) continue;
    }

    const li = matchedItem;

    const cache: IMatchedInvoice = {
      jobId,
      driveFileId,
      invoiceDate,
      invoiceNumber,
      terms,
      invoiceSku:   li ? extractField(li, 'sku', 'part_number', 'part_no', 'item_code', 'product_code', 'sku_number') : undefined,
      itemCost:     li ? extractField(li, 'unit_price', 'price', 'rate', 'cost', 'unit_cost', 'item_cost', 'list_price') : undefined,
      invoiceQty:   li ? extractField(li, 'quantity', 'qty', 'units', 'ordered_quantity', 'order_qty') : undefined,
      discountedPrice: li ? extractField(li, 'discounted_price', 'sale_price', 'net_price', 'after_discount', 'final_price', 'net_unit_price', 'your_price') : undefined,
      discountPct:  li ? extractField(li, 'discount_percent', 'discount_pct', 'discount_rate', 'discount', 'disc_pct', 'disc') : undefined,
      dropshipFee:  (li ? extractField(li, 'dropship_fee', 'ds_fee', 'drop_ship_fee', 'dropship fee', 'dropship') : '') || docDropship || undefined,
      miscCharges:  (li ? extractField(li, 'misc_charges', 'miscellaneous_charges', 'misc_fees', 'other_charges', 'misc', 'miscellaneous') : '') || docMisc || undefined,
      totalCost:    (li ? extractField(li, 'total', 'line_total', 'subtotal', 'extended_price', 'total_cost', 'extended_amount', 'ext_price') : '') || docTotal || undefined,
      cachedAt: new Date(),
    };

    matchedIds.push({ id: order._id as Types.ObjectId, cache });
  }

  return matchedIds;
}

/* ─────────────────── workspace-wide backfill (for Resync) ─────────────── */

/**
 * Re-run matching for every order import in a workspace. Intended to be called
 * when the Resync button is clicked — both to catch up rows that pre-date the
 * cache feature and to migrate legacy `matchedInvoice` rows to the new
 * `matchedInvoices[]` array.
 *
 * Runs in the background (fire-and-forget).
 */
export async function rebuildMatchCacheForWorkspace(workspaceId: string): Promise<void> {
  if (!Types.ObjectId.isValid(workspaceId)) return;

  try {
    // Collect all completed parse jobs that belong to this workspace.
    const wsOid = new Types.ObjectId(workspaceId);

    // PDF-import jobs are directly tagged; email jobs need the rule lookup.
    const wsRules = await DocTidyRule.find({ workspaceId: wsOid }).select('_id').lean();
    const wsMessages = wsRules.length > 0
      ? await DocTidyMessage.find({ ruleId: { $in: wsRules.map((r) => r._id) } })
          .select('_id').lean()
      : [];

    const jobFilter: Record<string, unknown> = {
      status: 'completed',
      jsonOutput: { $ne: null },
      $or: [
        { source: 'pdf-import', workspaceId: wsOid },
        ...(wsMessages.length > 0
          ? [{ messageId: { $in: wsMessages.map((m) => m._id) } }]
          : []),
      ],
    };

    const jobs = await DocTidyParseJob.find(jobFilter)
      .select('_id jsonOutput workspaceId messageId source driveFileId status')
      .lean();

    for (const job of jobs) {
      await writeMatchCacheForJob(String(job._id));
    }
  } catch (err) {
    console.error('[invoiceMatchCache] rebuildMatchCacheForWorkspace failed:', err);
  }
}
