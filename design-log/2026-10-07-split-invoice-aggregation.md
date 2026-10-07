# Split-Invoice Aggregation

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit table was built on a 1-to-1 assumption: one order import row
matches at most one invoice (parse job). In practice, vendors sometimes split a
single order line across multiple PDFs — same PO number, same SKU, different
Invoice # and separate attachment. Under the old design:

- `findInvoiceMatch()` returned the **first** matching job and stopped.
- `writeMatchCacheForJob()` overwrote `matchedInvoice` with `$set`, so the last
  job to complete silently replaced earlier matches.
- The discrepancy checker reported `✗ Qty` even when the total quantity invoiced
  across all PDFs was correct.

## Decision

Aggregate all matching invoices for a given PO+SKU rather than stopping at the
first hit.

### Data model — `src/models/DocTidyOrderImport.ts`

Added `matchedInvoices: IMatchedInvoice[]` alongside the existing
`matchedInvoice` (kept for backward compatibility with rows cached before this
change). The new field stores one entry per distinct parse job that matched.

### Server cache — `src/services/invoiceMatchCache.service.ts`

`writeMatchCacheForJob` now writes to `matchedInvoices[]` using an idempotent
**pull-then-push** strategy:

1. `$pull { matchedInvoices: { jobId: <this job> } }` — remove any prior entry
   for this job (handles re-parses cleanly).
2. `$push { matchedInvoices: <new cache> }` — append the fresh entry.

The legacy `matchedInvoice` (singular) is no longer written. Existing rows keep
their singular cache until a Resync migrates them to the new array.

### Frontend types — `frontend/src/types/docTidy.ts`

Added `matchedInvoices?: MatchedInvoiceCache[]` to `DocTidyOrderImport`. The
singular `matchedInvoice` is marked `@deprecated` but retained for reads.

### Client matching — `frontend/src/pages/DocTidyInvoiceAudit.tsx`

- `findInvoiceMatch` → `findAllInvoiceMatches` returning `InvoiceMatch[]`.
  Scans all jobs and collects every PO+SKU match instead of returning on first
  hit.
- `invoiceMatchMap` type changed from `Map<string, InvoiceMatch | null>` to
  `Map<string, InvoiceMatch[]>`.

### Aggregation — `resolveInvoiceFields`

Accepts `InvoiceMatch[]` and builds a unified `perInvoice` list from the
server cache (`matchedInvoices[]`) or the legacy singular cache or the
client-side fallback, in that priority order.

| Field | Aggregation rule |
|---|---|
| `invoiceNumber` | Unique values joined with `", "` |
| `invoiceDate` | Earliest non-empty date string |
| `invoiceSku` | First non-empty (same SKU across all splits) |
| `invoiceQty` | Numeric sum across all matched invoices |
| `itemCost` | From first match (same SKU → same unit price) |
| `discountedPrice`, `discountPct` | From first match |
| `dropshipFee`, `miscCharges` | Numeric sum across all |
| `totalCost` | Numeric sum across all |
| `driveFileId` | From first match (primary PDF link) |

Added helpers `sumNumericStrings` and `earliestDateStr`.

### UI polish

- `invoiceNumber` cell shows a sky-blue `+N` badge (with a tooltip) when
  `inv.matchCount > 1`, indicating split invoices. The PDF link still points to
  the first (primary) invoice.
- Skip-fetch optimization updated: a row is considered "fully cached" when
  `matchedInvoices.length > 0 || matchedInvoice != null`.

## Alternatives Considered

- **Expand order row into N invoice rows** — good for per-invoice line review but
  breaks the 1-to-1 order→row model; order qty would repeat on every sub-row.
  Rejected in favour of the aggregate approach.
- **Badge + side panel** — aggregate primary row + drill-down for individual
  invoices. Clean but adds an extra interaction step for the common inspection
  flow. Deferred.
- **Server-side aggregation endpoint** — a specialised `GET /invoice-audit` that
  pre-joins. Deferred; client-side aggregation is sufficient at current scale.

## Consequences

- Existing rows with only `matchedInvoice` (singular) continue to display
  correctly — the read path wraps the singular into a one-element array.
- A **Resync Invoice Data** run migrates all legacy rows to `matchedInvoices[]`.
- The discrepancy `✗ Qty` check now compares order qty against the **sum** of
  all matched invoice quantities, eliminating false positives for split
  shipments.
- Two sequential `bulkWrite` calls are issued per `writeMatchCacheForJob`
  invocation (one pull, one push) rather than one. This is acceptable for the
  internal-tool write rate.
- `parsedAt` and `vendorNeedsSetup` detection now use the earliest/first matched
  invoice across the array rather than a single entry.
