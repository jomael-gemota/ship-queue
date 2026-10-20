# Draggable Columns (Invoice Audit & Workspace Emails) + Audit Top Pagination

**Date:** 2026-09-21
**Status:** accepted
**Author:** ai

## Context

Two UX requests on the Doc Tidy → Invoice Audit page:

1. **Top pagination for the Invoice Audit tab** — the Emails tab already shows a "Rows per page" + count + arrows bar above the table. The same should appear in the Invoice Audit tab.

2. **Draggable, server-persisted column order** — both the Invoice Audit table and the Workspace Emails table should let users drag column headers to reorder them. The resulting order must be stored server-side so every connected user sees the same layout immediately (real-time via the existing SSE stream).

## Decision

### Top pagination (Invoice Audit tab)
Copy the exact same top-pagination bar that the Emails tab already has (rows-per-page select, X–Y of N count, selected-count chip, PaginationArrows) and insert it between the toolbar and the table in the audit tab.

### Draggable columns

#### Column-order storage
Extend `DocTidyConfig` (the existing singleton document) with two new fields:
- `auditColumnOrder: string[]` — ordered Invoice Audit column ids
- `wsEmailColumnOrder: string[]` — ordered Workspace Emails column ids

Two new endpoints (any authenticated user, not admin-only):
- `GET /doc-tidy/ui-prefs` — returns current orders
- `PUT /doc-tidy/ui-prefs` — saves new orders and broadcasts via SSE

#### SSE real-time sync
Add a new event type `ui_prefs` to `DocTidyEvent`. The backend emits it after every successful PUT so all open clients immediately apply the updated order without a page reload.

#### Email columns (new type system)
The Workspace Emails table had hardcoded `<th>` / `<td>` columns. These are promoted to a typed `WorkspaceEmailColumnId` union + `WORKSPACE_EMAIL_COLUMNS` definition array, allowing the table body to be rendered in a data-driven loop (same pattern as the audit table).

#### Drag mechanics
Native HTML5 drag-and-drop on `<th>` elements via a new `DraggableTh` component defined within the page file. Uses:
- `onDragStart` → set source ref (no state, no rerender)
- `onDragOver` → update hover-target state (border highlight)
- `onDrop` → compute new order, update state, save to server
- `onDragEnd` → clear visual state

## Alternatives Considered

- **localStorage only** — faster but not shared across users; rejected in favour of server-side.
- **External DnD library (dnd-kit, react-beautiful-dnd)** — adds bundle weight; native HTML5 DnD is sufficient for a simple left-to-right reorder on a table.
- **Per-user column preferences** — the request was explicitly for shared, all-users visibility; a new collection or user-settings model would over-engineer this.

## Consequences

- `DocTidyConfig` schema gets two new optional `string[]` fields (backwards-compatible; absent → use defaults).
- The Workspace Emails table render path is refactored from hardcoded column cells to a `orderedEmailCols.map(...)` pattern — more lines, but necessary to support dynamic ordering.
- The existing SSE connection already open on both tabs is reused; no new WebSocket or polling needed.
