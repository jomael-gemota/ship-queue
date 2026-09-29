# Header-Only Import Mode

**Date:** 2026-09-30
**Status:** accepted
**Author:** collaborative

## Context

A new department wants to use the Doc Tidy Invoice Audit service but only needs
header-level invoice data (PO #, Invoice #, Terms, Invoice Date, Total Cost,
etc.). They cannot supply SKU-level order data — only PO numbers. At the same
time, they must not see multiple rows per PO in the Invoice Audit table, even
when the matched invoice contains multiple line items.

The existing department continues to import full order files (PO # + SKU per row)
and relies on PO + SKU matching for line-item discrepancy checking.

## Decision

Add a **workspace-level `importMode` setting** with two values:

- `full` (default) — current behaviour. All import fields supported; matching
  requires PO # + SKU; line-item columns shown by default.
- `header-only` — only PO # is required; matching by PO # alone; line-item
  columns hidden by default in the Invoice Audit table.

Because the two departments already use separate workspaces (and organizations),
setting the mode per-workspace keeps each team's experience consistent without
any per-import toggles.

### Changes made

| Layer | Change |
|---|---|
| **DB model** (`DocTidyWorkspace`) | Add `importMode: String, enum ['full', 'header-only'], default 'full'` |
| **Workspace controller** | Accept and validate `importMode` in `PUT /doc-tidy/workspaces/:id`; admin-only |
| **Frontend type** (`DocTidyWorkspace`) | Add `importMode?: 'full' \| 'header-only'` |
| **Workspace editor dialog** | Add a Full / Header-only segmented toggle (admin-only, visible only when editing an existing workspace) |
| **Import modal** | Mode-aware column hint and template CSV download: header-only shows PO # as bold/required, others faded/optional; template is a single-column PO-only file |
| **Column visibility defaults** | `loadAuditColumnVisibility` accepts optional `importMode`; when `header-only` and no saved pref exists, defaults `invoiceSku`, `invoiceQty`, `itemCost`, `discountedCostPct`, `discrepancy` to hidden |
| **`findInvoiceMatch` fallback** | Bug fix: when `order.orderSku` is blank and the invoice has line items, the loop previously fell through without returning. Now returns `{ job, item: null }` for PO-level matching |

### How PO-only matching works

When `orderSku` is blank:

- **Server-side cache** (`invoiceMatchCache.service.ts`): the `if (lineItems.length > 0 && normSku)` block is skipped (normSku is falsy), so a PO-level match is written with document-level fields (Invoice Date, Invoice #, Terms, Total Cost) and no line-item fields.
- **Frontend fallback** (before cache warms up): after the line-items loop, if `normSku` is blank the function now returns `{ job, item: null }` — the same semantics as the server-side cache.

Because the new department imports one CSV row per PO, there is exactly one
`DocTidyOrderImport` record per PO — and thus one row per PO in the Invoice Audit
table, regardless of how many line items the matched invoice has.

## Alternatives Considered

- **Per-import batch toggle** — rejected. Would require a modal step on every upload, and creates mixed row types in the same workspace table that need different column sets. Doesn't match how teams are organised (they already use separate workspaces).
- **Always-optional import fields** — partly addressed (backend already defaults missing fields to `''`), but without mode-awareness the template and column defaults give no guidance to the new team.
- **Separate import endpoint for header-only** — rejected; unnecessary complexity. The same upload pipeline works for both modes.

## Consequences

- Existing workspaces default to `importMode: 'full'` with no migration required.
- Admins must set `header-only` on a workspace before the new team starts importing; changing the mode after data exists does not retroactively change stored matches.
- Column visibility saved in localStorage overrides mode defaults — if a user has a prior saved preference for a workspace, it is respected regardless of `importMode`.
- Line-item columns (`invoiceSku`, `invoiceQty`, `itemCost`, `discountedCostPct`, `discrepancy`) remain available in the column drawer for header-only workspaces and can be re-enabled by the user.
