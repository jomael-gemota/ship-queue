# Invoice Audit — Line Items Tabular View with Per-Vendor Column Persistence

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit tab's inline line-item expansion was a simple `<ul>` that rendered
items as text chips (Desc · SKU · Qty · Unit · Total). It was functional but hard to
scan: no alignment, no column headers, no way to compare values across rows.

Users need to quickly audit quantities, prices, discounts, and totals across multiple
line items, so a proper table is warranted. Additionally, different vendors emit
different JSON fields (some have `model_number`, others `style_no`, some have
`discount_percent`, others omit it entirely), so column preferences should be
**per-vendor** rather than global.

Supersedes the line-items display from
[Invoice Audit tab design](./2026-09-17-doc-tidy-invoice-audit-tab-and-ux-polish.md).

## Decision

### Column set
Eight columns are **visible by default**, matching the most universally useful
invoice line-item fields:

| Column          | Label            | Extraction candidates |
|-----------------|------------------|-----------------------|
| `sku`           | SKU              | `sku`, `part_number`, `part_no`, `item_code`, `product_code`, `sku_number` |
| `model`         | Model #          | `model`, `model_number`, `model_no`, `style`, `style_number`, `style_no` |
| `description`   | Description      | `description`, `name`, `product`, `item`, `item_description`, `desc` |
| `quantity`      | Qty              | `quantity`, `qty`, `units`, `ordered_quantity`, `order_qty` |
| `unitPrice`     | Unit Price       | `unit_price`, `price`, `rate`, `cost`, `unit_cost`, `item_cost`, `list_price` |
| `discountedPrice` | Disc. Price    | `discounted_price`, `sale_price`, `net_price`, `after_discount`, `final_price` |
| `discountPercent` | Discount %     | `discount_percent`, `discount_pct`, `discount_rate`, `discount`, `disc_pct` |
| `lineTotal`     | Line Total       | `total`, `line_total`, `subtotal`, `extended_price`, `total_cost`, `ext_price` |

Three additional columns are **hidden by default**:
`uom` (Unit of Measure), `taxAmount` (Tax), `notes` (Notes).

### Per-vendor persistence
Column visibility is stored in `localStorage` under:
```
docTidy.lineItems.columns.<normalized-vendor-name>
```
The same `normalizeVendorName()` helper used for corrections is used here, so the
key is stable even if the vendor display name has minor casing differences.

When a vendor has no stored preference, the default set (above) is used.

### Column settings drawer
A gear-icon "Columns" button appears in the line-items header row for each expansion
panel. Clicking it opens a `LineItemColumnDrawer` — visually identical to the existing
`ColumnSettingsDrawer` — but with a title that includes the vendor name so the user
knows the settings are scoped to that vendor only.

### Table design
- Sticky/scrollable horizontally within the expansion cell.
- Numeric columns (Qty, prices, Discount %, totals, Tax) are right-aligned and
  `tabular-nums`.
- Text columns (SKU, Model, UOM) use `font-mono`; Description and Notes are
  plain text.
- Row striping and hover match the parent table's palette.
- Empty cells render `—` to avoid visual gaps.
- A count badge (e.g. "3 items · Vendor Co.") sits to the left of the Columns button.

## Alternatives Considered

- **Global line-item columns** — simpler but ignores that vendors have very different
  JSON schemas; a vendor that never emits `discount_percent` would just show a column
  of dashes for every row.
- **Dynamic columns from actual JSON keys** — would surface every AI-extracted field,
  but the keys are unpredictable and some are nested objects or arrays that can't be
  rendered as scalars without extra logic. Predefined candidates are safer and
  easier to label.
- **Modal instead of drawer** — the existing pattern is a drawer; keeping it
  consistent avoids introducing a second overlay style.

## Consequences

- Per-vendor preferences start empty; users see the 8-default columns until they
  customise per vendor. No migration needed.
- The `LineItemsExpansion` component is replaced by `LineItemsTable`. The old
  component is removed.
- The `LineItemColumnDrawer` shares the same visual template as `ColumnSettingsDrawer`
  but is a separate component to keep prop types clean.
