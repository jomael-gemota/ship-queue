# Bulk "Send to Tidy Agent" for Emails and PDF Imports Tables

**Date:** 2026-09-22
**Status:** accepted
**Author:** collaborative

## Context

Both the workspace **Emails** tab and the **PDF Imports** tab have per-row checkboxes
and a selection state (`selectedEmailIds`, `pdfSelectedIds`). Until now, the selection
only drove "N selected" pill display — there was no action that operated on the whole
selection at once.

Users want to queue multiple rows for parsing in one click rather than clicking
"Send to Tidy Agent" on each row individually.

## Decision

When one or more rows are checked, a **"Send N to Tidy Agent"** button appears inline
in the filter bar, next to the "x messages" / "x files" count text.

### Emails tab

- `handleBulkSendEmailsToAgent` iterates `emailMessages` filtered to the selection.
- For each message, it walks `attachments` and picks parseable items
  (`/\.pdf$/i` + `driveFileId` present + no `uploadError`) that have no existing parse
  job or have a `failed` job (retry semantics).
- Fires `POST /doc-tidy/messages/:id/attachments/:index/parse` for each via
  `Promise.allSettled` (failures are silent so one bad attachment doesn't block others).
- Refreshes the email list silently after all settle.
- Guarded by `emailBulkSending` state; button is also disabled while the Tidy Agent is
  offline (`workerOnline === false`).

### PDF Imports tab

- `handleBulkSendPdfsToAgent` iterates `pdfImports` filtered to the selection.
- Only sends imports with no existing `parseJob` (not yet sent); already-running or
  completed rows are skipped silently.
- Fires `POST /doc-tidy/pdf-imports/:id/parse` for each via `Promise.allSettled`.
- Refreshes the import list after all settle.
- Guarded by `pdfBulkSending` state; button disabled when worker offline.

### Button placement

Both buttons sit inside the `ml-auto` flex row that already holds the spinner and the
"x messages" / "x files" count. They are only rendered when `selectedXxxIds.size > 0`,
so the filter bar is unchanged when nothing is selected.

## Alternatives Considered

- **Toolbar above the table** — heavier layout change. The inline placement is
  lower-friction and mirrors the existing per-row button style.
- **Separate confirmation step** — unnecessary; the action is easily undone (parse jobs
  can be aborted from the row).
- **Show count of sendable attachments instead of selected rows** — too clever; users
  already see the "N selected" pill and intuitively expect the button to act on that.

## Consequences

- No backend changes required — same endpoints already used by per-row actions.
- `PARSEABLE` regex imported from `AttachmentCell` into `DocTidyInvoiceAudit` for
  attachment filtering logic.
- Two new boolean state variables: `emailBulkSending`, `pdfBulkSending`.
