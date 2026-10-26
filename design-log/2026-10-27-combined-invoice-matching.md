# Combined-invoice matching (one invoice, several customer POs)

**Date:** 2026-10-27
**Status:** accepted
**Author:** collaborative

## Context

Invoice Audit matching is PO-first (see
[2026-10-07-split-invoice-aggregation](2026-10-07-split-invoice-aggregation.md)):
an order row only matches an invoice whose PO # equals the row's PO.

Kryptek invoice INV/8312/15870 (SM org) bills two orders from the same customer
(Rusty Sowell — PO 241405 / KPR-22STALHH6 and PO 241418 / KPR-16VELJH6) but
prints only `PO# 241405`. The parse correctly extracted both line items, yet
the PO 241418 row never matched, so KPR-16VELJH6 showed "No match".

## Decision

Add a fallback, applied only when it is unambiguous. An order whose PO is not
on the invoice matches it as a **combined invoice** when:

1. another order with the **same customer name** (normalised, non-empty)
   matched the invoice by PO directly,
2. one of the invoice's line items has this order's SKU and was **not already
   claimed** by a direct match, and
3. (server cache) the order has **no direct match** from another invoice.

Server: `cachesForInvoice` in `src/services/invoiceMatchCache.service.ts` runs
the direct pass, then the fallback, and tags entries `matchedBy: 'customer'`
with `invoicePo` (the PO printed on the invoice). When an order later gets a
direct match, its `matchedBy: 'customer'` entries are pulled.

Client fallback (`findCombinedInvoiceMatches` in `DocTidyInvoiceAudit.tsx`)
mirrors the rule for rows without a server cache.

The Discrepancy column shows an amber **⇄ PO** badge and a tooltip note naming
the invoice's PO, so these rows never read "All good" silently.

## Alternatives Considered

- **Match by SKU alone, ignoring PO**: too loose — the same SKU is ordered by
  many customers.
- **Match by the invoice's bill-to name**: field names vary by vendor; using
  the sibling order's customer name is vendor-agnostic.
- **Leave it to corrections**: the parse is already correct; the gap is in
  matching, not extraction.

## Consequences

- Existing rows update on the next parse of the invoice or a **Resync Invoice
  Data**.
- Relies on `customerName` in the order import; workspaces without it get no
  fallback (unchanged behaviour).
- Two different customers with an identical name ordering the same SKU on the
  same day could be mis-paired; the ⇄ PO badge keeps that visible for review.
