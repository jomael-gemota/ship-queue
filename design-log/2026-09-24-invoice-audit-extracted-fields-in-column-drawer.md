# Invoice Audit — Extracted Fields in Column Drawer

**Date:** 2026-09-24
**Status:** accepted
**Author:** collaborative

## Context

The Columns drawer for the Invoice Audit tab currently only lists the 22 statically
declared `INVOICE_AUDIT_COLUMNS` (e.g. Vendor, Invoice #, SKU, Qty…). However the
Tidy Agent often extracts additional, vendor-specific fields from PDFs — fields like
`shipping_address`, `carrier`, `color`, `size`, `warehouse_location`, etc. — that do
not map to any of the known columns and are therefore invisible to the user.

## Decision

Scan the `jsonOutput` of every job currently loaded in the Invoice Audit table and
surface any **extra scalar fields** (not already covered by a static column) in a new
**"Extracted fields"** section at the bottom of the Columns drawer.

### What "extra" means

A **document-level** key in `jsonOutput` is "extra" when its normalised form
(`toLowerCase().replace(/[_\-\s]+/g,'')`) does not appear in the combined alias list
for any existing `InvoiceAuditColumn`. Nested objects and arrays are skipped
(they are not representable as a single column value).

A **line-item-level** key inside any item in a recognized line-items array (`line_items`,
`items`, `products`, etc.) is "extra" when its normalised form is not already covered by
a `li*` column alias.

### Visibility state

Extracted fields are stored in a separate `dynamicColVisibility: Record<string, boolean>`
map (keyed by the raw JSON key, e.g. `"shipping_address"`). Default value for every
discovered key is `false` (unchecked). Visibility is persisted in `localStorage` at
`docTidy.invoiceAudit.dynamicColumns.<workspaceId>` so preferences survive a page reload
and are isolated per workspace.

### Column type

A `DynamicAuditColumn` interface (`type: 'dynamic', id, key, label, section`) is used
alongside `InvoiceAuditColumn` in a `AnyAuditColumn` union. The `visibleCols` memo
now returns `AnyAuditColumn[]`, appending visible dynamic columns after the static ones.

Dynamic columns are **not drag-reorderable** and render with a ⚡ (bolt) icon in the
header to distinguish them from default columns.

### Rendering

When a dynamic column is visible:
- **Header**: plain `<th>` with bolt icon and raw-key subtitle (not draggable).
- **Cell**: `String(json[key])` for document fields; `String(item[key])` for line item
  fields. Null/undefined/array/object values show `—`.
- **Export**: raw string value; uses the column label as the header.

### "Reset to defaults" behaviour

Clicking "Reset to defaults" in the drawer resets both the static column visibility
**and** clears all dynamic column visibility (returns all extracted fields to unchecked).

## Alternatives Considered

- **Backend aggregation endpoint** — returns unique field keys from all jobs for a
  workspace. More correct for large datasets but adds an API surface and migration.
  Deferred; the frontend scan is sufficient for internal use.
- **Always fetch all 5000 jobs for field discovery** — heavier than scanning the
  currently loaded page. Unnecessary given the existing high page-size options (500–5000).

## Consequences

- Fields only visible on pages not yet loaded will not appear in the drawer until the
  user loads more records (e.g. by increasing page size or removing search).
- Dynamic columns always appear after static ones; they cannot be interleaved via drag.
- The `AnyAuditColumn` union means all consumers of `visibleCols` must discriminate on
  `isDynCol(col)` before treating `col.id` as `InvoiceAuditColumnId`.
