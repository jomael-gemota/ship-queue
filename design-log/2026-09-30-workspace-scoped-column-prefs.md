# Workspace-Scoped Column Preferences

**Date:** 2026-09-30
**Status:** accepted
**Author:** ai

## Context

Column order (drag-to-reorder) and column visibility (show/hide via the column settings panel) are currently shared globally:

- **Column order** (`auditColumnOrder`, `wsEmailColumnOrder`, `pdfImportColOrder`) is stored on the `DocTidyConfig` singleton — one record for the entire app.
- **Column visibility** is stored in `localStorage` under a single key (`docTidy.invoiceAudit.columns.v4`), not workspace-aware.

As a result, changing columns in Workspace A immediately corrupts Workspace B's layout — the exact opposite of what users expect.

Prior entry that introduced draggable columns: [2026-09-21-draggable-columns-and-audit-top-pagination.md](./2026-09-21-draggable-columns-and-audit-top-pagination.md).  
Note: that entry explicitly rejected *per-workspace* prefs ("request was for shared, all-users visibility"). The requirement has now changed to *per-workspace isolation*.

## Decision

Scope all three column preference types to the active workspace:

### Column order (server-persisted)
Move `auditColumnOrder`, `wsEmailColumnOrder`, `pdfImportColOrder` from `DocTidyConfig` out to `DocTidyWorkspace`. Each workspace document carries its own ordered column arrays.

- `GET /doc-tidy/ui-prefs?workspaceId=<id>` — read from the workspace doc
- `PUT /doc-tidy/ui-prefs` with `{ workspaceId, auditColumnOrder?, wsEmailColumnOrder?, pdfImportColOrder? }` — write to the workspace doc
- SSE `ui_prefs` broadcast now includes `workspaceId` so clients only apply updates that match their active workspace.

### Column visibility (localStorage)
Change the storage key to be workspace-scoped:

```
docTidy.invoiceAudit.columns.v4.<workspaceId>
```

`loadAuditColumnVisibility(workspaceId)` and `saveAuditColumnVisibility(visibility, workspaceId)` accept the workspace ID. On `enterWorkspace(ws)` the visibility is reloaded from the workspace-specific key.

### Workspace switching
`enterWorkspace(ws)`:
1. Resets column orders to defaults immediately.
2. Reloads `colVisibility` from the workspace-specific localStorage key.
3. Fires `GET /doc-tidy/ui-prefs?workspaceId=${ws._id}` to populate workspace-specific orders.

`leaveWorkspace()`:
- Resets column orders back to defaults (no stale state).

## Alternatives Considered

- **Keep global prefs, ignore isolation** — rejected; user explicitly requires isolation.
- **Per-user preferences in a new collection** — over-engineered; workspace-level granularity is sufficient and matches how every other workspace setting is scoped.
- **Move prefs entirely to localStorage (no server)** — loses cross-browser/cross-device consistency. Server remains source of truth for order; localStorage remains source of truth for visibility (personal preference).

## Consequences

- `DocTidyWorkspace` schema gains three optional `string[]` fields (backwards-compatible; absent = use defaults).
- Existing global `DocTidyConfig` column order fields are left in place (still populated by legacy writes) but are no longer read or written by the UI after this change. They can be removed in a future cleanup.
- The `DocTidyEvent.ui_prefs` event gains a `workspaceId` field; old clients without this field will apply the update unconditionally (same as today), which is safe because they'd be viewing the same workspace that triggered the save.
- `loadAuditColumnVisibility` / `saveAuditColumnVisibility` signatures change — call sites updated accordingly.
