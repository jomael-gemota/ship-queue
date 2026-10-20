# Invoice Audit Table — Row Deletion (Single & Bulk)

**Date:** 2026-09-30
**Status:** accepted
**Author:** ai

## Context

The Invoice Audit table lets users import orders via CSV/XLSX and view them
alongside matched invoice data. Currently there is no way to remove individual
or multiple rows from the table once they have been imported.

## Decision

Add two deletion modes to the Invoice Audit table:

### Single-row deletion
- A small trash-icon button appears at the end of each data row (fixed, non-scrolling actions column).
- Clicking it opens a `ConfirmDeleteDialog` modal naming the order's PO number.
- On confirm, `DELETE /doc-tidy/order-imports/:id` is called; the row is
  removed from local state immediately on success.

### Bulk deletion
- A **Delete X selected** button appears in the toolbar whenever one or more
  rows are checked.
- Clicking it opens a `ConfirmDeleteDialog` with the count of rows to be deleted.
- On confirm, `POST /doc-tidy/order-imports/bulk-delete` is called with
  `{ ids: string[] }`. On success, matching rows are removed from local state
  and the selection is cleared.

### New backend endpoint
`POST /doc-tidy/order-imports/bulk-delete` — accepts `{ ids: string[] }` in the
request body and calls `DocTidyOrderImport.deleteMany({ _id: { $in: ids } })`.
A POST is used so the body is always present and routable without fighting
Express's parameter-matching order.

## Alternatives Considered

- **Multiple individual DELETE calls** — works but creates N network round-trips
  for large selections; rejected in favour of a single bulk endpoint.
- **DELETE with request body** — some proxies strip DELETE bodies; POST is safer
  and consistent with the existing `/bulk-delete` patterns in this codebase.
- **Inline row-level confirmation (no modal)** — already used in some older
  panels, but the `ConfirmDeleteDialog` modal is the established pattern for
  the audit section and prevents accidental deletion.

## Consequences

- Users can now clean up incorrectly imported rows without re-uploading the
  entire file.
- Both individual and bulk deletions are guarded by a confirmation modal to
  prevent accidental data loss.
- The table's `totalCols` counter and `colSpan` values are bumped by 1 to
  accommodate the new fixed actions column.
