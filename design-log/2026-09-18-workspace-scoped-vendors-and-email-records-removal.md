# Vendors become workspace-scoped; Email Records tab removed

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

Follows [workspace-scoped rules](./2026-09-18-workspace-scoped-rules.md). The
same principle extends to vendors: a vendor profile (name + SKU samples) makes
sense in the context of a workspace's documents, not globally. The global
Vendors tab is removed just like the Filter Rules tab was.

The Email Records tab (global inbox) is also removed — emails are now accessible
from within each workspace's Emails tab, making the global view redundant.

## Decision

### Email Records tab — removed

- The `/doc-tidy` route becomes a `<Navigate>` redirect to `/doc-tidy/invoice-audit`
  (the workspace list, which is the new Doc Tidy entry point).
- The "Email Records" NavLink is removed from `DocTidyTabs`.
- The unread-message badge (`newMessageStore`) moves to the "Invoice Audit" tab,
  so users still see a notification when new emails arrive.
- `DocTidy.tsx` is no longer routed; its component is no longer used.

### Vendors — workspace-scoped (one-to-many via `vendor.workspaceId`)

Same model as rules: vendors now belong to exactly one workspace.

**`DocTidyVendor` model:**
- Adds `workspaceId?: ObjectId` (optional for backward compat during migration).
- Removes the global unique index on `normalizedName`.
- Adds a compound unique index on `{ workspaceId: 1, normalizedName: 1 }`.

**Backend endpoint changes:**

| Endpoint | Change |
|---|---|
| `GET /doc-tidy/vendors` | Accepts `?workspaceId=` to filter by workspace |
| `POST /doc-tidy/vendors` | Accepts `workspaceId` in body; scopes upsert |
| `POST /doc-tidy/vendors/:name/samples/remove` | Accepts `workspaceId` in body |
| `DELETE /doc-tidy/vendors/:name` | Accepts `?workspaceId=` in query |
| `GET /doc-tidy/corrections` | Accepts `?workspaceId=`; scopes by vendor names in that workspace |

The worker reads corrections globally by vendor name — this is unchanged. Workspace
scoping is a UI concern only; the agent's correction retrieval is unaffected.

`setParseJobVendor` is unchanged — it only sets a name string on the job, not a
vendor document.

**Frontend:**

- `DocTidyVendors.tsx` is refactored into an exported `WorkspaceVendorsView({ workspaceId })`
  component (same pattern as `WorkspaceRulesView`), removing the standalone page chrome.
- The `Vendors` tab is removed from `DocTidyTabs`; the `/doc-tidy/vendors` route
  is removed from `App.tsx`.
- The workspace detail grows a fourth tab. Order (per user preference):
  **Audit Results | Emails | Rules | Vendors**
- The default landing tab when opening a workspace is `Audit Results` (first tab).
- `DocTidyWorkspace` type and the workspace card are unchanged (no rule/vendor count shown).

### Migration

A one-time script (`scripts/migrate-vendors-to-workspaces.ts`) matches unassigned
vendors to workspaces by name (exact match first, partial match second) — the same
strategy as the rules migration.

## Alternatives Considered

- **Scope vendor corrections to workspace too.** Would require changing
  `DocTidyCorrection` (add `workspaceId`) and updating the worker. Deferred — the
  agent works fine with global corrections; workspace scoping of corrections is a
  future improvement.
- **Keep a global Vendors page as a read-only cross-workspace overview.** Rejected
  per user preference — removed entirely.
- **Default tab: Emails.** Rejected; the user explicitly wants Audit Results first.

## Consequences

- Existing vendors without `workspaceId` will not appear in any workspace until
  the migration runs.
- The worker is unaffected: it loads corrections by vendorName globally.
- After migration, creating a vendor with the same name in two workspaces is valid
  (each has its own record). Their corrections share the same pool since they share
  the same normalizedName — acceptable for now.
- `DocTidy.tsx` is effectively dead code once the redirect is in place. It can be
  deleted in a follow-up cleanup.
