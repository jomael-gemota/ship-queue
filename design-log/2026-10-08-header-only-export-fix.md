# Fix: Export Functionality for Header-Only Workspaces

**Date:** 2026-10-08
**Status:** accepted
**Author:** ai

## Context

The Invoice Audit table has two modes driven by `workspace.importMode`:

- **`full`** — primary rows are `DocTidyOrderImport` records; invoice data comes from
  matched `ParseJobListItem` objects.
- **`header-only`** — primary rows are `ParseJobListItem` objects directly (`filteredHeaderOnlyJobs`);
  there are no order imports in these workspaces. Row selection uses `selectedJobIds`
  (not `selectedRowKeys`).

The existing `exportToExcel` function only handled the full-mode path (fetching
`orderImports`, using `auditColStr`). Clicking the export button on a header-only
workspace produced an empty Excel file because `orderImports` is always empty in
that mode.

## Decision

Branch `exportToExcel` on `isHeaderOnly`:

- **Header-only, `'selection'`** — filter `jobs` by `selectedJobIds`.
- **Header-only, `'all'`** — use `filteredHeaderOnlyJobs` directly (already
  in-memory, already respects all active column + date-range filters). No extra
  network call is needed because `fetchAllJobs` already loads up to 5,000 records.
- In both header-only branches, extract values with `headerOnlyColStr` and skip
  rows where every visible column is empty / null (null `jsonOutput` → all blanks).
- **Full-mode path** — unchanged.

Also fix the export button's `mode` selector and tooltip so header-only workspaces
use `selectedJobIds.size` instead of the order-import `selectedRowKeys.size`.

## Alternatives Considered

- Re-fetching parse jobs at export time — unnecessary; `jobs` is already fully
  loaded up to the same 5,000-row cap and `filteredHeaderOnlyJobs` mirrors what
  the table shows.
- Sharing one export path — the data sources and extraction functions are
  fundamentally different, so separate branches are cleaner than a shared
  abstraction.

## Consequences

- Export now works for header-only workspaces.
- Rows with no parsed data (null/empty `jsonOutput`) are silently skipped so the
  spreadsheet stays clean.
- When filters are active the export matches exactly what the user sees in the
  table; when no filters are active every loaded parse job is exported.
