/**
 * parsedContentSearch.service.ts
 *
 * Searches DocTidyParseJob.jsonOutput for specific PO numbers, invoice numbers,
 * or vendor names, returning the parent message IDs and parse-job IDs so the
 * caller can apply them as additional filters on their respective collections.
 */

import { Types } from 'mongoose';
import DocTidyParseJob from '../models/DocTidyParseJob';
import DocTidyRule from '../models/DocTidyRule';
import DocTidyMessage from '../models/DocTidyMessage';

/** Escapes a string for safe use inside a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive regex object for MongoDB. */
function re(term: string) {
  return { $regex: esc(term.trim()), $options: 'i' };
}

/** All MongoDB field paths that may hold the PO number inside jsonOutput. */
const PO_FIELDS = [
  'jsonOutput.poNumber',
  'jsonOutput.po_number',
  'jsonOutput.purchase_order_number',
  'jsonOutput.customer_po_number',
  'jsonOutput.customerPoNumber',
  'jsonOutput.customer_reference',
  'jsonOutput.customerReference',
];

/** All MongoDB field paths that may hold the invoice number inside jsonOutput. */
const INVOICE_FIELDS = [
  'jsonOutput.invoiceNumber',
  'jsonOutput.invoice_number',
  'jsonOutput.invoice_id',
  'jsonOutput.invoice_no',
  'jsonOutput.invoiceNo',
  'jsonOutput.invoice',
];

/**
 * Build the $or clauses for a single PO number term.
 * Covers both single-invoice jobs (top-level field) and batch jobs
 * (invoices array — MongoDB dot notation matches if ANY element matches).
 */
function poClauses(po: string): Record<string, unknown>[] {
  const r = re(po);
  return [
    ...PO_FIELDS.map((f) => ({ [f]: r })),
    // Batch files store individual invoices in jsonOutput.invoices[].poNumber
    { 'jsonOutput.invoices.poNumber': r },
    { 'jsonOutput.invoices.po_number': r },
  ];
}

/**
 * Build the $or clauses for a single invoice number term.
 */
function invoiceClauses(inv: string): Record<string, unknown>[] {
  const r = re(inv);
  return [
    ...INVOICE_FIELDS.map((f) => ({ [f]: r })),
    // Batch files
    { 'jsonOutput.invoices.invoiceNumber': r },
    { 'jsonOutput.invoices.invoice_number': r },
    { 'jsonOutput.invoices.invoice_id': r },
    { 'jsonOutput.invoices.invoiceNo': r },
    { 'jsonOutput.invoices.invoice': r },
  ];
}

export interface ContentSearchOptions {
  /** Parsed PO number terms — one per entry (already split by caller). */
  poNumbers?: string[];
  /** Parsed invoice number terms — one per entry. */
  invoiceNumbers?: string[];
  /** Vendor name substring. */
  vendor?: string;
}

export interface ContentSearchResult {
  /** _ids of DocTidyMessage documents that have a matching parse job. */
  messageIds: Types.ObjectId[];
  /** _ids of DocTidyParseJob documents linked to matching pdf-import jobs. */
  pdfJobIds: Types.ObjectId[];
  /** Whether at least one advanced criterion was provided. */
  hasFilter: boolean;
}

/**
 * Finds parse jobs (completed) that match the given parsed-content criteria
 * and returns the associated parent IDs for caller-side filtering.
 */
export async function findJobsByContent(
  workspaceId: string,
  opts: ContentSearchOptions,
): Promise<ContentSearchResult> {
  const { poNumbers, invoiceNumbers, vendor } = opts;
  const empty: ContentSearchResult = { messageIds: [], pdfJobIds: [], hasFilter: false };

  const hasFilter = !!(poNumbers?.length || invoiceNumbers?.length || vendor?.trim());
  if (!hasFilter) return empty;

  // ── Build content conditions ─────────────────────────────────────────────
  const andClauses: Record<string, unknown>[] = [];

  if (poNumbers?.length) {
    // Each PO term is a separate requirement (AND), but within a term any field can match (OR).
    // Caller may pass a comma-separated list; each element is already a single term.
    andClauses.push({ $or: poNumbers.flatMap(poClauses) });
  }

  if (invoiceNumbers?.length) {
    andClauses.push({ $or: invoiceNumbers.flatMap(invoiceClauses) });
  }

  if (vendor?.trim()) {
    andClauses.push({ vendorName: re(vendor) });
  }

  // ── Scope to the workspace ───────────────────────────────────────────────
  const wsOid = new Types.ObjectId(workspaceId);

  // Find all rules belonging to this workspace, then find messages under those rules.
  // This mirrors how getMessages scopes itself.
  const wsRules = await DocTidyRule.find({ workspaceId: wsOid }).select('_id').lean();

  let workspaceScopeClause: Record<string, unknown>;
  if (wsRules.length > 0) {
    const wsMessages = await DocTidyMessage.find({ ruleId: { $in: wsRules.map((r) => r._id) } })
      .select('_id')
      .lean();

    if (wsMessages.length > 0) {
      workspaceScopeClause = {
        $or: [
          { source: 'pdf-import', workspaceId: wsOid },
          { messageId: { $in: wsMessages.map((m) => m._id) } },
        ],
      };
    } else {
      // Workspace has rules but no messages yet — only pdf-import jobs can match.
      workspaceScopeClause = { source: 'pdf-import', workspaceId: wsOid };
    }
  } else {
    workspaceScopeClause = { source: 'pdf-import', workspaceId: wsOid };
  }

  // ── Run the query ────────────────────────────────────────────────────────
  const jobFilter: Record<string, unknown> = {
    status: 'completed',
    jsonOutput: { $ne: null },
    $and: [workspaceScopeClause, ...andClauses],
  };

  const jobs = await DocTidyParseJob.find(jobFilter)
    .select('messageId source _id')
    .lean();

  const messageIds = jobs
    .filter((j) => j.source !== 'pdf-import' && j.messageId)
    .map((j) => j.messageId as Types.ObjectId);

  const pdfJobIds = jobs
    .filter((j) => j.source === 'pdf-import')
    .map((j) => j._id as Types.ObjectId);

  return { messageIds, pdfJobIds, hasFilter: true };
}
