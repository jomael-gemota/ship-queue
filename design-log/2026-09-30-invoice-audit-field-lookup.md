# Invoice Audit — Tolerant field lookup for parsed invoices

**Date:** 2026-09-30
**Status:** accepted
**Author:** collaborative

## Context

Follows [Faithful diffs for table-view corrections](./2026-09-30-doc-tidy-tabular-correction-diff.md).

In the Gill workspace a user taught Tidy Agent "Total Due is the Total Costs".
The re-parsed INV-32308 correctly emits `totals.totalCosts: 54.13`, yet the
Invoice Audit row for PO 232266 shows "—" under Total Cost. Two lookups fill
that column and both miss:

1. **Server cache** (`invoiceMatchCache.service.ts`) reads keys by *exact*
   snake_case name. Gill's output is camelCase (`poNumber`), so the PO never
   matches and no `matchedInvoice` is ever written — for any camelCase vendor.
2. **Browser fallback** (`extractJsonField`) normalises key names, so it finds
   the invoice, but only reads top-level keys and has no `total_costs`,
   `total_due` or `total_invoice` candidate. Gill's totals are nested under
   `totals`.

`extractJsonField` also returned `''` as soon as a candidate matched an object,
skipping every lower-priority candidate.

## Decision

One lookup, mirrored in `frontend/src/types/docTidy.ts` (`extractJsonField`,
`extractJsonArray`) and `src/services/invoiceMatchCache.service.ts`
(`extractField`, `extractArray`). The two must stay identical, or the cached and
fallback values for a row will disagree.

- Key names match after lowercasing and stripping `_`, `-` and spaces, so
  `poNumber` ≡ `po_number`.
- All candidates are tried at the top level first, then one level down inside
  plain-object children (`totals`, `summary`, …). A top-level hit always wins.
- A candidate that matches a non-scalar is skipped, not treated as a miss for
  the whole lookup.

Invoice-level Total Cost candidates, in priority order: `total_cost`,
`total_costs`, then the existing names (`total`, `grand_total`, `total_amount`,
`total_value`, `invoice_total`, `amount_due`, `balance_due`), then `total_due`
and `total_invoice` as last resorts. Line-item totals still take precedence
for SKU-matched rows, unchanged.

## Alternatives Considered

- **Only add `total_costs` to the browser list.** Fixes this cell today but
  leaves Gill (and every camelCase vendor) uncached, and still misses nested
  totals.
- **Deep recursive search.** Would find values anywhere, but nested address or
  shipping blocks would start supplying dates and totals they don't own. One
  level covers the grouped-totals shape the agent actually produces.

## Consequences

- Rows that showed "—" may now show a value for vendors with camelCase or
  grouped output — intended, but visible across all workspaces.
- Existing rows get a server cache only after the next parse or a
  **Resync Invoice Data**; the browser fallback shows the value immediately.
