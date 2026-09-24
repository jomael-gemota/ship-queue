/**
 * Invoice Match Cache
 *
 * When a parse job completes, this service:
 *   1. Extracts the PO # and line items from the job's jsonOutput.
 *   2. Finds every DocTidyOrderImport in the same workspace whose poNumber +
 *      orderSku normalise-match the invoice data.
 *   3. Writes a `matchedInvoice` subdocument onto each matching order import.
 *
 * This means the Invoice Audit table only ever needs to query
 * DocTidyOrderImport — it never has to load all parse jobs to do client-side
 * matching, keeping the table fast as the parse-job collection grows.
 */

import { Types } from 'mongoose';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyOrderImport, { type IMatchedInvoice } from '../models/DocTidyOrderImport';
import DocTidyMessage from '../models/DocTidyMessage';
import DocTidyRule from '../models/DocTidyRule';

/* ─────────────────────────── field-extraction helpers ─────────────────── */

/** Mirror of the frontend normForMatch — lowercase, strip separators. */
function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/[\s#_-]+/g, '');
}

/** Pull the first non-empty value from a JSON object by candidate keys. */
function extractField(obj: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const val = obj[key];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

/** Pull a line-items array from a JSON object by candidate keys. */
function extractArray(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): Record<string, unknown>[] {
  if (!obj || typeof obj !== 'object') return [];
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val) && val.length > 0) {
      return val as Record<string, unknown>[];
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
 * Given a completed parse job, build the `matchedInvoice` cache for all order
 * imports in the same workspace that match by PO # (and optionally by SKU for
 * the line-item fields).
 *
 * Returns the number of order-import documents updated.
 */
export async function writeMatchCacheForJob(jobId: string): Promise<number> {
  if (!Types.ObjectId.isValid(jobId)) return 0;

  const job = await DocTidyParseJob.findById(jobId)
    .select('jsonOutput workspaceId messageId source driveFileId status')
    .lean();

  if (!job || job.status !== 'completed' || !job.jsonOutput) return 0;

  const json = job.jsonOutput as Record<string, unknown>;

  // Extract PO # from the invoice JSON.
  const jobPo = norm(
    extractField(json,
      'po_number', 'purchase_order_number', 'po_no', 'po',
      'purchase_order', 'order_number', 'order_no'
    )
  );
  if (!jobPo) return 0;

  const workspaceId = await resolveWorkspaceId(job);
  if (!workspaceId) return 0;

  // Extract document-level fields (same for every matched order from this invoice).
  const invoiceDate   = extractField(json, 'invoice_date', 'date', 'billing_date', 'bill_date', 'invoice date');
  const invoiceNumber = extractField(json, 'invoice_number', 'invoice_no', 'invoice_num', 'inv_number', 'inv_no', 'invoice#', 'invoice');
  const terms         = extractField(json, 'payment_terms', 'terms', 'net_terms', 'payment terms');
  const docDropship   = extractField(json, 'dropship_fee', 'ds_fee', 'drop_ship_fee', 'dropship fee', 'dropship');
  const docMisc       = extractField(json, 'misc_charges', 'miscellaneous_charges', 'misc_fees', 'other_charges', 'misc', 'miscellaneous');
  const docTotal      = extractField(json, 'total', 'grand_total', 'total_amount', 'total_cost', 'total_value', 'invoice_total', 'amount_due', 'balance_due');

  const lineItems = extractArray(json,
    'line_items', 'items', 'products', 'line items', 'lineItems', 'order_items', 'orderItems'
  );

  // Find all order imports in this workspace whose PO # normalises to `jobPo`.
  // We fetch them all and filter in JS so we can reuse `norm()`.
  const candidates = await DocTidyOrderImport.find({ workspaceId }).select('_id poNumber orderSku').lean();

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
      jobId:    job._id as Types.ObjectId,
      driveFileId:   job.driveFileId ?? undefined,
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

  if (matchedIds.length === 0) return 0;

  const bulkOps = matchedIds.map(({ id, cache }) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { matchedInvoice: cache } },
    },
  }));

  const result = await DocTidyOrderImport.bulkWrite(bulkOps);
  return result.modifiedCount;
}

/* ─────────────────── workspace-wide backfill (for Resync) ─────────────── */

/**
 * Re-run matching for every order import in a workspace that does not yet have
 * a `matchedInvoice` cache.  Intended to be called when the Resync button is
 * clicked so that rows imported before this feature existed get caught up.
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
