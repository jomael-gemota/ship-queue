# Invoice Audit — Week Grouping & Description Hidden by Default

**Date:** 2026-09-24
**Status:** accepted
**Author:** collaborative

## Context

Following the flattened row model introduced in
[2026-09-18 inline line items](./2026-09-18-invoice-audit-inline-line-items.md),
users want to visually group audit results by the invoice week they belong to.
The `invoiceDate` column (already extracted from parsed JSON) is the grouping key.

Additionally, the `Description` (`liDescription`) column was enabled by default,
but users prefer a leaner view — it takes significant horizontal space and is
less critical at a glance than SKU, model, quantity, and pricing fields.

## Decision

### 1. Week range grouping (Monday–Sunday)

- The table body is segmented into collapsible week buckets, computed from the
  `invoiceDate` string already rendered in each row.
- A week runs **Monday → Sunday**. The group header shows the range as
  `"Mon MMM D – Sun MMM D, YYYY"` (e.g. *Mon Sep 21 – Sun Sep 27, 2026*).
- Date parsing is intentionally lenient: any string parseable by `new Date()`
  is accepted; unparseable / blank dates fall into an **"Unknown date"** bucket
  at the bottom of the page.
- Grouping is applied **client-side on the current page's data** only — no API
  change needed. Because records are paginated, the grouping reflects whatever
  window is visible. This is the simplest approach and sufficient for the
  current page-size patterns (25–200 rows).
- Each group header spans the full table width and shows:
  - Calendar icon
  - Week label (e.g. *Week of Sep 21 – Sep 27, 2026*)
  - Row count badge for that week
- Groups are sorted newest-first (matching the default sort direction of the
  table). The "Unknown date" bucket always appears last.
- Groups are **collapsible**: clicking the header row toggles visibility of all
  rows in the group. The collapsed state is kept in a `Set<string>` keyed by
  the week start ISO string (e.g. `"2026-09-21"`).

### 2. `liDescription` hidden by default

Change `defaultVisible` from `true` → `false` for the `liDescription` column
in `INVOICE_AUDIT_COLUMNS`. Existing users whose preference is stored in
localStorage keep their current setting; only fresh sessions / "Reset to
defaults" will hide it.

## Alternatives Considered

- **Server-side grouping** — would require a new API endpoint or aggregation
  pipeline change. Overkill for a display-only feature; client-side is
  sufficient given the existing pagination model.
- **Fixed week labels (always expanded)** — simpler, but collapsible headers
  give users the ability to focus on a specific week and reduce visual noise
  when many weeks are present on a single page.

## Consequences

- The `liDescription` column is hidden by default for all new sessions.
  Existing stored preferences are not migrated; users who had it visible keep
  it visible until they "Reset to defaults".
- Week grouping is page-scoped: a single invoice week may span two pages if the
  page boundary falls mid-week. This is an accepted trade-off.
