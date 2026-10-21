# Advanced Search — Emails & PDF Imports Tabs

**Date:** 2026-10-21
**Status:** accepted
**Author:** collaborative

## Context

Users requested the ability to search across multiple POs and invoice numbers in the Emails and
PDF Imports tabs of Doc Tidy. The existing simple search bar only searched message-level metadata
(subject, sender, filename, snippet) — it had no knowledge of parsed invoice content stored in
`DocTidyParseJob.jsonOutput`.

## Decision

Implement a two-layer Advanced Search feature:

### UI

- An **"Advanced" toggle button** (with filter icon + active badge) added to both toolbars, placed
  between the "Clear" link and the separator before action buttons.
- When toggled, a **collapsible panel** drops below the toolbar containing three fields:
  - **PO Numbers** — textarea, one per line or comma-separated
  - **Invoice Numbers** — textarea, one per line or comma-separated
  - **Vendor** — text input (substring match against parsed `vendorName`)
- Active fields highlight the toggle button and show a count badge.
- The toolbar's "Clear" button also clears all advanced fields.

### Backend

A new shared service `src/services/parsedContentSearch.service.ts`:
- `findJobsByContent(workspaceId, { poNumbers, invoiceNumbers, vendor })` queries
  `DocTidyParseJob` (completed jobs with jsonOutput) scoped to the workspace.
- PO field coverage: `jsonOutput.poNumber`, `jsonOutput.po_number`, and six aliases, plus
  `jsonOutput.invoices.poNumber` for batch files.
- Invoice field coverage: `jsonOutput.invoiceNumber`, `invoice_number`, `invoice_id`, `invoice_no`,
  `invoice`, plus batch equivalents.
- Returns `{ messageIds, pdfJobIds }` for callers to use as `_id.$in` / `parseJobId.$in` filters.

Both endpoints now accept `poNumbers`, `invoiceNumbers`, `vendor` query params:
- `GET /doc-tidy/messages` — adds `filter._id = { $in: messageIds }` when advanced criteria present
- `GET /doc-tidy/pdf-imports` — adds `filter.parseJobId = { $in: pdfJobIds }` when criteria present

This is a server-side join query, so results are scoped across all pages (not just the current
page), making the feature useful even in large workspaces.

### Debouncing

Advanced inputs are debounced at 400 ms before being sent to the server, mirroring the existing
simple search debounce. Page is reset to 1 whenever the debounced values change.

## Alternatives Considered

- **Client-side filtering only** — would only filter the currently visible page, missing items on
  other pages. Rejected because the primary use case is "find which email/file contains PO 12345".

- **Full-text index on jsonOutput** — MongoDB full-text indexes can't be applied to nested Mixed
  fields selectively. Rejected; regex on known field paths is sufficient at workspace scale.

- **Load all parse jobs on demand** — fetch the entire workspace job list (as the audit tab does)
  and filter client-side. Rejected because it adds latency on open and re-fetch on every page switch.

## Consequences

- The `parsedContentSearch.service.ts` join runs two extra queries (DocTidyRule + DocTidyMessage
  for workspace scoping) when advanced criteria are present. This is acceptable at workspace scale.
- Only **completed** parse jobs are searched. Files not yet parsed (or that failed) will not match.
- Results are correctly scoped to the active workspace via the same rule→message chain used by
  the main messages query.
- Adding new PO or invoice field aliases requires updating the arrays in `parsedContentSearch.service.ts`
  and re-testing.
