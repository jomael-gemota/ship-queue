# Invoice Audit — Workspace Layer

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit tab previously showed a flat, global table of every completed
parse job. Users want to organise their invoices into named views (workspaces)
that each pull from a specific subset of filter rules — e.g. one workspace for
supplier invoices, another for order confirmations from a particular vendor group.

A rule must be usable in more than one workspace (several users want the same
rule to appear in multiple views), so the relationship is many-to-many
(workspace → rules, not rule → workspace).

Supersedes the flat global table introduced in
[Invoice Audit tab design](./2026-09-17-doc-tidy-invoice-audit-tab-and-ux-polish.md).
The line-items tabular view from
[2026-09-18](./2026-09-18-invoice-audit-line-items-tabular-view.md) is unchanged
and moves inside the workspace detail view.

## Decision

### Data model — `DocTidyWorkspace`

```
{
  name: string          // user-chosen name, required
  ruleIds: ObjectId[]   // refs to DocTidyRule — many-to-many, denormalised here
  createdByUserId: string
  createdByName: string
  timestamps (createdAt, updatedAt)
}
```

Workspaces are **team-wide** (no per-user scoping for now), matching the
existing convention for rules and vendors.

### Backend

| Endpoint | Description |
|---|---|
| `GET /doc-tidy/workspaces` | List all workspaces, sorted by name |
| `POST /doc-tidy/workspaces` | Create a workspace |
| `PUT /doc-tidy/workspaces/:id` | Rename or change rule set |
| `DELETE /doc-tidy/workspaces/:id` | Delete a workspace (only the record; rules and jobs are unaffected) |
| `GET /doc-tidy/parse-jobs?workspaceId=…` | Filter completed parse jobs to only those whose parent message was captured by one of the workspace's rules |

The `workspaceId` filter on the parse-jobs endpoint does a two-step lookup:
1. Load the workspace → extract `ruleIds`.
2. Find `DocTidyMessage` docs with `ruleId ∈ ruleIds` → collect `_id`s.
3. Filter `DocTidyParseJob` by `messageId ∈ those _ids`.

This adds two lightweight queries. The `DocTidyMessage` index on `ruleId` makes
step 2 fast. No schema migration is needed for existing parse jobs.

### Frontend — UI flow

```
Invoice Audit tab
├── Workspace list (default landing)
│   ├── Empty state  → "Create your first workspace" CTA
│   └── Workspace cards grid (name, rule names, rule count)
│       ├── Click card → enter workspace detail
│       ├── Edit button → WorkspaceEditorDialog
│       └── Delete button → inline confirm → DELETE API
└── Workspace detail (after opening a workspace)
    ├── Breadcrumb: [← Workspaces] / [Workspace Name] / [Edit workspace]
    └── Invoice Audit table (filtered by workspaceId)
        └── All existing features: column visibility, line items table,
            per-vendor column prefs, pagination, vendor search
```

### `WorkspaceEditorDialog`

A centred modal (not a drawer, to distinguish it from column settings):
- **Name** — free-text input
- **Rules** — scrollable checkbox list, showing each rule's name,
  document-type badge, and enabled status. A rule can be selected in
  multiple workspaces simultaneously.

### Persistence

The last-viewed workspace is **not** persisted across sessions; users always
land on the workspace list when opening the tab. This avoids broken state if
a workspace is deleted on another device.

## Alternatives Considered

- **Per-user workspaces** — rejected for now; the team shares rules and vendors,
  so sharing workspaces too is consistent. Private workspaces can be added later.
- **Filter by vendor instead of rule** — rules are the existing team-configured
  scoping primitive; workspaces composed of rules are more flexible.
- **Denormalise `ruleId` onto `ParseJob`** — would simplify the query but
  requires a migration and changes the worker contract. The two-step lookup
  is cheaper overall.
- **Soft-delete workspaces** — no hard requirement; hard-delete keeps the DB
  clean. Jobs and rules are not affected by deleting a workspace.

## Consequences

- Existing completed parse jobs are still accessible — they just need to be in
  a workspace to be visible in this tab.
- The global vendor search and column-visibility preferences inside the audit
  table are preserved. They now operate within a workspace context.
- A workspace with zero rules will always return an empty table (by design).
- Workspaces do not affect rule execution — they are a view-only concept.
