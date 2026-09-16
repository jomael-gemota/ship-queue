# Doc Tidy — Invoice Audit Tab, Tab Renames, and Parse-Abort

**Date:** 2026-09-17
**Status:** accepted
**Author:** collaborative

## Context

Three distinct UX improvements were requested for the Doc Tidy feature set:

1. **Tab renames** — "Extracted Messages" → "Email Records"; "Extraction Rules" → "Filter Rules". The original names were technically accurate but not user-friendly; the new names match what users call the things.
2. **Parse abort** — Jobs that get stuck in `pending` / `processing` give no escape route other than waiting; users need a stop button that forcibly marks the job as failed.
3. **Invoice Audit tab** — A new `/doc-tidy/invoice-audit` route that renders all *completed* parse jobs in a flat tabular ledger. Only a curated set of high-value columns are shown by default; the remainder are hidden but can be re-enabled via a column-settings drawer persisted to `localStorage`.

## Decision

### Tab renames
Single string change in `DocTidyTabs` in `docTidyUi.tsx`. No route or data changes required.

### Parse abort
- **Backend:** `POST /doc-tidy/parse-jobs/:id/abort` — sets `status: 'failed'`, writes a human-readable `error` string, and stamps `completedAt`. Does not touch the worker; the job is effectively orphaned (the worker will not pick it up again because it only re-dispatches `pending` jobs on reconnect and this becomes `failed`).
- **Frontend (AttachmentIcons):** When a job is running, the existing spinner becomes a two-state hover widget: the spinner shows at rest, an "×" abort button appears on hover with a tooltip.
- **Frontend (ParseJobPanel):** An "Abort" button is added to the header alongside "Re-run". Only enabled while `isParseRunning(status)`.

### Invoice Audit tab
- **Route:** `/doc-tidy/invoice-audit` → `DocTidyInvoiceAudit.tsx`.
- **Backend:** `GET /doc-tidy/parse-jobs` returns all completed parse jobs (excluding the `thinking` transcript and `documentTextSample` to keep payloads small), paginated.
- **Field extraction:** The AI-produced `jsonOutput` is schema-free, so the frontend uses a "try multiple key variants" extractor that normalises keys (lowercased, stripped of `_`/`-`/spaces) before matching. The 10 default columns cover the most common vendor invoice fields; any unrecognised fields can still be surfaced via the raw JSON in the existing ParseJobPanel.
- **Column visibility:** Persisted in `localStorage` under `docTidy.invoiceAudit.columns`. Default visible: Vendor, Type, Invoice #, PO Number, Order Date, Invoice Date, Terms, Tracking #, Total Value, Line Items. Default hidden: Filename, Parsed At, Requested By. A gear-icon drawer lets users toggle any column.
- **Line items:** Shown as a count badge in the table; clicking it opens an inline expansion below the row.

## Alternatives Considered

- **Separate `/invoice-audit` route outside Doc Tidy** — rejected; the audit is Doc Tidy data and belongs in its tab group.
- **Server-side column config** — rejected for now; localStorage is simpler, survives without a schema migration, and is per-user by default.
- **Hard-delete abort** — rejected; marking as `failed` preserves the job for history and lets the user re-run it once the underlying cause is fixed.

## Consequences

- The abort endpoint is idempotent for already-completed or already-failed jobs (the update is a no-op in Mongoose if the status hasn't changed and will just return the existing document).
- The Invoice Audit page only shows `completed` jobs. Pending/processing/failed jobs are visible in the Email Records tab via the parse-status chip on each row.
- Column-visibility preferences are browser-local; a user on a different machine starts with defaults again.
