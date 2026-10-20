# Invoice Audit — Inline Line Item Columns

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

[2026-09-18 line items tabular view](./2026-09-18-invoice-audit-line-items-tabular-view.md)
placed the line item table in a collapsible sub-row below each document row.
Users want the line item fields to appear **beside** the document-level columns
(Vendor, Type, Invoice #, etc.) in the same flat table — not in a separate
expansion panel.

## Decision

### Flattened row model

Each parse job expands into **one row per line item** in the main table.
If a document has no line items, it still produces one row with the line item
cells empty (shown as `—`).

**Document-level columns** (Vendor, Type, Invoice #, PO Number, Invoice Date,
Order Date, Total Value, Terms, Tracking #, Filename, Parsed At, Requested By)
repeat on every line item row so the table remains independently filterable and
sortable without grouping.

**Line item columns** (SKU, Model #, Description, Qty, Unit Price, Disc. Price,
Discount %, Line Total, UOM, Tax, Notes) appear after the document columns.

### Visual document grouping

Adjacent rows that belong to the same parse job share an alternating background
(even document → `--bg-100`, odd document → `--bg-200`). The first row of each
new document group carries a `border-t-2` on its cells, providing a clear visual
break without a dedicated separator row.

### Unified column configuration

All columns — document-level and line item-level — are controlled by a single
**Column visibility drawer**, replacing the two separate drawers that existed
before. The drawer is split into two labelled sections:

* **📄 Document fields** — document-level columns
* **📦 Line item fields** — line item columns

Per-vendor line item column preferences (introduced the same day) are removed;
a single global visibility preference applies across the whole table.

### Default-visible columns (15)

| Section | Columns |
|---|---|
| Document | Vendor, Type, Invoice #, PO Number, Order Date, Invoice Date, Total Value |
| Line item | SKU, Model #, Description, Qty, Unit Price, Disc. Price, Discount %, Line Total |

Hidden by default: Terms, Tracking #, Filename, Parsed At, Requested By, UOM, Tax, Notes.

### Removed

* `LineItemsTable` component (sub-table) — no longer needed.
* `LineItemColumnDrawer` component — merged into `ColumnSettingsDrawer`.
* The `lineItems` count-badge column (`InvoiceAuditColumnId = 'lineItems'`) —
  superseded by the inline line item columns.
* Per-vendor line item column localStorage keys (`docTidy.lineItems.columns.*`).
* `LINE_ITEM_COLUMNS`, `LineItemColumnId`, `loadLineItemColumnVisibility`,
  `saveLineItemColumnVisibility` exports from `docTidy.ts`.

## Alternatives Considered

- **Keep the sub-table, just add columns to the main settings** — rejected;
  user explicitly asked for the line items to sit beside the document columns.
- **Show only first line item per row** — loses the per-item audit detail and
  hides items 2+ from view.
- **Rowspan for document columns** — complex to implement with React's flatMap
  and `border-separate` tables; not worth the complexity for repeating values.

## Consequences

- A document with 10 line items produces 10 rows; tables with many documents
  and many items per document can be long. Existing pagination and max-height
  scrolling mitigates this.
- Sorting the table by a line item column (future feature) will naturally work
  since each row carries the complete data.
- Existing `localStorage` visibility preferences are forward-compatible via the
  `{ ...defaults, ...stored }` merge; unknown old keys are ignored.
