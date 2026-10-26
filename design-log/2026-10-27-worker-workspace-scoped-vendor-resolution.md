# Worker resolves vendors within the job's workspace

**Date:** 2026-10-27
**Status:** accepted
**Author:** collaborative

## Context

[2026-09-18-workspace-scoped-vendors-and-email-records-removal](2026-09-18-workspace-scoped-vendors-and-email-records-removal.md)
made vendors per-workspace on the server, but the Python worker kept matching
vendors across every workspace (`resolve_vendor` and
`detect_vendor_name_from_text` in `worker/sku.py`).

Observed in the two "Gill" workspaces: one registered "Gill North America, Inc.",
the other only "Gill". Jobs in the second workspace resolved to the first
workspace's vendor, were stored with `vendorNeedsSetup: false`, and so the
Invoice Audit never offered "+ Add Vendor" — even after a correction and re-run.

Separately, `upsertVendor` cleared `vendorNeedsSetup` only on email jobs (found
through rule → message), leaving PDF/CSV-import jobs in the same workspace still
flagged after the vendor was registered.

## Decision

- The worker resolves the job's workspace (`job.workspaceId` for imports,
  message → rule → `workspaceId` for email) via `resolve_job_workspace_id`, and
  passes it to both vendor lookups. If the workspace can't be resolved, lookups
  fall back to the old global search rather than failing the job.
- `upsertVendor` clears the flag on jobs matching either the workspace's
  messages or `workspaceId` directly.

## Alternatives Considered

- **Fix only in the UI** (show "Add Vendor" when the job's vendor isn't in the
  workspace's vendor list): hides the symptom but leaves cross-workspace SKU
  samples and correction scoping wrong in the worker.

## Consequences

- Existing jobs keep their stored flag until re-run; re-running a job (or
  registering its vendor) brings it in line.
- Corrections are still keyed by vendor name only, so two workspaces that
  register the *same* vendor name still share corrections. Out of scope here.
