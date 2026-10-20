# Invoice Audit — LESD Column

**Date:** 2026-09-30
**Status:** accepted
**Author:** collaborative

## Context

Users need a new field in the import template and Invoice Audit table called **LESD**,
positioned immediately after **Order Qty**. The column belongs to the "Order fields"
section and is sourced entirely from the imported order CSV/XLSX file.

## Decision

Add `lesd` as a first-class field across the full import pipeline:

| Layer | Change |
|---|---|
| **DB model** (`DocTidyOrderImport`) | Add `lesd: String` field, default `''` |
| **Import controller** | Map header variants `lesd`, `lesd date`, `lastexpectedshipdate`, etc. → `lesd` |
| **Frontend type** (`DocTidyOrderImport`) | Add `lesd: string` |
| **Column registry** (`INVOICE_AUDIT_COLUMNS`) | New `order`-section column, `defaultVisible: true`, inserted after `orderQty` |
| **Column storage key** | Bumped `v3` → `v4` so the new column slots in at the correct position |
| **Cell renderer** (`auditCellFor`) | Plain text cell, same style as `status` |
| **CSV string helper** (`auditColStr`) | Returns `order.lesd ?? ''` |

## Alternatives Considered

- Hidden by default — rejected; users explicitly want the column visible out of the box.
- Invoice-section column — rejected; LESD comes from the order import file, not from a parsed invoice.

## Consequences

- Existing user column preferences stored under `v3` are silently abandoned (bumped to `v4`).
  Users get the new defaults on next load with LESD appearing after Order Qty.
- Older import batches uploaded before this change will show an empty LESD cell
  (the field defaults to `''` server-side, so no migration is required).
