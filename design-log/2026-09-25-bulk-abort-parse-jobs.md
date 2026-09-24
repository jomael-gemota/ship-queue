# Bulk Abort Parse Jobs for Emails and PDF Imports Tables

**Date:** 2026-09-25
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Bulk "Send to Tidy Agent"](./2026-09-22-bulk-send-to-tidy-agent.md).

The selection already lets users queue many rows at once. After the batch
starts — or after a test batch that grew larger than expected — there is no way
to cancel more than one job at a time; each row requires opening its reasoning
panel and clicking "Abort" individually.

## Decision

Add an **Abort N Jobs** button next to the existing **Send to Tidy Agent**
button in the filter bar of both the Emails tab and the PDF Imports tab.

### Visibility rule

The button is shown only when at least one selected row has a running parse job
(`pending` or `processing`). It is independent of the Send button, so both can
appear at the same time when the selection is a mix of running and finished rows.

### Emails tab

- `anySelectedEmailRunning`: `true` when at least one selected email has at
  least one `parseJob` with status `pending` or `processing`.
- `handleBulkAbortEmails` collects all such parse job ids and calls
  `POST /doc-tidy/parse-jobs/:id/abort` for each via `Promise.allSettled`.
- Refreshes the email list silently after all settle.
- Guarded by `emailBulkAborting` state.

### PDF Imports tab

- `anySelectedPdfRunning`: `true` when at least one selected import has a
  `parseJob` with status `pending` or `processing`.
- `handleBulkAbortPdfs` collects those parse job ids and calls the same
  abort endpoint via `Promise.allSettled`.
- Refreshes the imports list after all settle.
- Guarded by `pdfBulkAborting` state.

### Button style

Rose/red outline, consistent with the per-job Abort button inside
`ParseJobPanel`. Placed immediately before the Send button so the destructive
action never occupies the far-right slot next to Import PDFs.

## Alternatives Considered

- **Confirmation modal** — the per-job Abort inside the panel has no
  confirmation, and the action is reversible (re-run), so it is not needed here.
- **Single combined dropdown** — heavier; two buttons side by side are
  immediately scannable.
- **Abort all running on the current page** — too broad; the selection already
  scopes the action precisely.

## Consequences

- No backend changes required — reuses `POST /doc-tidy/parse-jobs/:id/abort`.
- Two new boolean state variables: `emailBulkAborting`, `pdfBulkAborting`.
- Two new derived booleans: `anySelectedEmailRunning`, `anySelectedPdfRunning`.
