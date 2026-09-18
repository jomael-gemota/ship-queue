# Invoice Audit: PDF link, Excel export, multi-column search

**Date:** 2026-09-19
**Status:** accepted
**Author:** collaborative

## Context

User requested three enhancements to the Invoice Audit tab:
1. Invoice # values should link to the original PDF on Google Drive.
2. The table should be exportable to Excel (by selection or all matching records).
3. The search bar should cover more than just vendor name.

## Decision

### 1 — Invoice # → GDrive PDF link
`ParseJobListItem` already carries `driveFileId`. The `invoiceNumber` cell renderer
wraps the value in an `<a target="_blank">` pointing to
`https://drive.google.com/file/d/{driveFileId}/view` when the field is present.
A small red PDF icon precedes the link text.

### 2 — Excel export (SheetJS `xlsx`)
Added dynamically-imported `xlsx` (so it doesn't bloat the initial bundle).
The toolbar gains an **Export** button with two modes:
- **Export selection** – exports only the checked jobs (visible when ≥1 job is selected).
- **Export all** – fetches all records for the current workspace + search filters
  (pageSize 5000) and exports them regardless of pagination.

Row selection is tracked as `selectedJobIds: Set<string>`.  A checkbox column
prepended to the table selects/deselects all rows that belong to a given job
(since one job can produce multiple line-item rows). A select-all header checkbox
covers every unique job on the current page.

The exported sheet is flat — one row per line item — with every document-level
field repeated. Sheet name: "Invoice Audit". Filename: `invoice-audit-YYYY-MM-DD.xlsx`.

### 3 — Multi-column search
- **Backend**: the `vendorName` query param is renamed to `search`; the filter
  becomes `$or: [{ vendorName: /term/i }, { filename: /term/i }]`.
- **Frontend**: the search input's placeholder and label reflect the broader scope.
  The state is renamed from `vendorSearch`/`debouncedVendor` to
  `auditSearch`/`debouncedAuditSearch`.

## Alternatives Considered
- Full-text search on `jsonOutput` fields (invoice #, PO #): deferred — would
  require a text index or denormalised fields; the backend `$or` on vendor+filename
  covers the most common lookup patterns. Invoice # is reachable via the link.
- CSV instead of Excel: user explicitly requested Excel.

## Consequences
- `xlsx` adds ~500 KB to the lazy-loaded export chunk (not the main bundle).
- Export-all makes one extra API call with pageSize=5000; acceptable for audit
  data volumes.
