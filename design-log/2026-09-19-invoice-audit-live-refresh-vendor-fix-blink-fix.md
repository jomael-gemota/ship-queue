# Invoice Audit: Live Refresh, Vendor workspaceId Fix, Table Blink Fix

**Date:** 2026-09-19
**Status:** accepted
**Author:** collaborative

## Context

Three bugs were reported after testing the workspace-scoped Invoice Audit feature:

1. Completed parse jobs from the Emails tab do not automatically appear in the Invoice Audit tab — a manual page refresh is required.
2. Clicking "Register Vendor" in the parse details modal throws "A valid workspaceId is required".
3. While the parse details modal is open, the background Emails table blinks repeatedly (skeleton loading → data → skeleton) every few milliseconds.

## Decision

### 1 — Auto-refresh Invoice Audit tab on parse completion

The SSE listener in `DocTidyInvoiceAudit.tsx` already watches for `parse_status` events while the Emails tab is active. A symmetric listener is added for the Audit tab that calls `fetchJobs()` whenever a `parse_status === 'completed'` event arrives. A stable `fetchJobsRef` is used (mirroring the pattern already in place for `fetchEmailsRef`) so the subscription never needs to reconnect when filters change.

### 2 — VendorSetup needs workspaceId

The backend `upsertVendor` controller enforces a valid `workspaceId` (required because vendors are now workspace-scoped). The `VendorSetup` component was not receiving or forwarding this value. Fix:
- Add `workspaceId` prop to `VendorSetup`.
- Include `workspaceId` in the POST body to `/doc-tidy/vendors`.
- Add `workspaceId` prop to `ParseJobPanel` and thread it through to `VendorSetup`.
- Pass `activeWorkspace._id` from `DocTidyInvoiceAudit` to the `ParseJobPanel` render.

### 3 — Stop table blinking while modal is open

The Emails tab SSE listener called `fetchEmails()` on **every** `parse_status` event, including intermediate ones (pending → running → completed). Each call toggles `emailLoading = true` → skeleton → data. Fix: only refetch on terminal statuses (`completed` or `failed`). Intermediate status changes are already handled in the UI by the `AttachmentIcons` / `ParseJobPanel` stream, so the table does not need to reload until the job is done.

## Alternatives Considered

- Polling the audit tab on a timer — rejected; SSE is already available and event-driven is preferable.
- Using optimistic updates in the audit table instead of refetching — higher complexity; not needed since the table is small and fast to load.

## Consequences

- Audit tab now updates in real time when emails are parsed.
- Vendor registration from the parse modal works correctly within a workspace.
- No more table blinking while a parse modal is open.
