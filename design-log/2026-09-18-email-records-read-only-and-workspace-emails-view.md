# Email Records → Read-Only Inbox; Parse Actions Move Into Workspace Emails View

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

[Parse action moves back to the table's Actions column](./2026-09-16-doc-tidy-parse-action-back-to-table-actions.md)
put the bolt/status icons directly on every row of the Email Records table.
This kept parse access one click away, but it came at a cost: the
`/doc-tidy/messages` endpoint must `$lookup` each message's parse jobs to
know which attachment already has a job and what its status is. At any
meaningful volume that join is the dominant cost of loading the table.

The user's goal for this change is two-fold:

1. **Email Records becomes a pure read-only inbox** — no parse actions, no parse
   job data loaded. Load time target: 5× faster than current.
2. **Parse actions move into workspaces** — the existing
   [Invoice Audit workspace layer](./2026-09-18-invoice-audit-workspaces.md)
   is extended so each workspace detail shows an **Emails** sub-view alongside
   its existing **Audit Results** table. Emails that passed the workspace's
   rules appear here with their parse actions intact.

An email appears in a workspace only if it matched a rule that is assigned to
that workspace. Workspaces with no rules assigned will show an empty Emails
view (consistent with the empty Audit Results behaviour already designed).

## Decision

### 1 — Email Records tab becomes a read-only inbox

**Removed from `DocTidy.tsx` / `AttachmentIcons`:**
- `AttachmentIcons` is no longer rendered in the table's Actions column.
- The Actions column is removed entirely (the row itself is already clickable to open the detail drawer).
- The multi-select checkboxes **stay** — they are scaffolding for a future bulk action and their presence is harmless without parse actions.
- The detail drawer (`MessageDetailDrawer`) stays unchanged — it is read-only display.

**Backend — `/doc-tidy/messages`:**
- The `$lookup` / join against `DocTidyParseJob` is removed from the default
  messages query. `parseJobs` is no longer included on `DocTidyMessage` rows
  returned by this endpoint.
- This is the primary driver of the 5× speed improvement.
- A new query parameter `?includeParseJobs=true` (or scoped via
  `?workspaceId=…`) re-enables the join for callers that need it (the
  workspace Emails view, below).

**Frontend — `DocTidyMessage` type:**
- `parseJobs` becomes optional (`ParseJobSummary[] | undefined`) since the
  global inbox no longer populates it.
- `AttachmentIcons` is still used in the workspace Emails view where
  `parseJobs` is present; it already handles a missing/undefined gracefully
  via the `parseableItems` filter.

### 2 — Workspace detail grows an "Emails" sub-view

The workspace detail page in `DocTidyInvoiceAudit.tsx` gains a two-tab row
immediately below the breadcrumb:

```
[Emails]   [Audit Results]
```

**Emails tab (new):**
- Fetches `/doc-tidy/messages?workspaceId=<id>` — the server resolves the
  workspace's `ruleIds`, finds messages with `ruleId ∈ ruleIds`, and returns
  them **with** `parseJobs` included (the join is enabled for this code path).
- Renders the same compact table as the current Email Records view (date,
  sender, subject, document type, rule chip) **plus** the `AttachmentIcons`
  Actions column — bolt buttons, status icons, reasoning panel.
- Reuses the same `ParseJobPanel` overlay already wired in
  `DocTidyInvoiceAudit.tsx`.
- Live SSE updates (`parse_status` events) trigger a silent refetch, exactly
  as they do in the current Email Records table.
- Pagination, search, and date-range filters are available (same filter bar
  pattern), but the rule/document-type filters are omitted — the workspace
  already scopes by rule, so filtering by rule inside it would be redundant
  and confusing.

**Audit Results tab (existing):**
- The current workspace detail content (parse jobs table, column visibility
  drawer, line-items view) moves here unchanged. No logic changes, only a
  tab wrapper around it.

### 3 — No new workspace model needed

The `DocTidyWorkspace` model and all four CRUD endpoints are unchanged. The
workspace's `ruleIds` already serve as the scoping key for both the Emails
view and the Audit Results view.

### Backend query for workspace Emails

```
GET /doc-tidy/messages?workspaceId=<id>
```

Server steps (mirrors the existing workspaceId logic for parse-jobs):
1. Load workspace → extract `ruleIds`.
2. Find `DocTidyMessage` with `ruleId ∈ ruleIds` (existing index).
3. Return messages **with** the `parseJobs` `$lookup` re-enabled.

This adds one lightweight workspace fetch on top of the existing messages
query path. The messages index on `ruleId` keeps step 2 fast.

## Alternatives Considered

- **Keep parse actions in Email Records, just lazy-load the parse job status.**
  Rejected — lazy-loading on a 500-row page (current default page size) would
  fire 500 requests or one large batch query, which is worse than the current
  join.
- **Separate workspace model for Email Records workspaces (distinct from
  Invoice Audit workspaces).** Rejected — workspaces are defined by rules;
  the same workspace naturally scopes both the raw emails and their parse
  results. Two separate workspace lists would require the user to recreate the
  same groupings twice.
- **Merge Emails and Audit Results into one unified workspace table** showing
  both raw emails and completed parse jobs side by side. Rejected — the two
  have different columns, different actions, and different pagination needs.
  A tabbed split keeps each view clean and avoids a hybrid table that's hard
  to scan.
- **Remove checkboxes from Email Records along with parse actions.** Not done —
  the checkboxes are near-zero overhead and are already scaffolded for bulk
  actions. Removing them now would require re-adding the logic later.

## Consequences

- **Email Records loads in roughly 1/5 the current time** at any significant
  message count, because the parse-job join (the table's most expensive
  operation) is gone from the default path.
- **Parsing is only possible from within a workspace.** An email that did not
  match any rule — and therefore does not appear in any workspace — cannot be
  parsed through the UI. This is intentional: rule-less parsing is already
  unsupported by the agent worker.
- **`AttachmentIcons` is no longer rendered in the global inbox.** Its
  `onChanged` / `onOpenJob` wiring is removed from `DocTidy.tsx`; the component
  itself is untouched and reused inside the workspace Emails view.
- The workspace detail now has two tabs. The landing tab should default to
  **Emails** (closer to the user's active work) rather than Audit Results.
  This can be revisited if feedback shows users land on the audit table more
  often.
- `DocTidyMessage.parseJobs` being optional means any code that currently
  assumes `parseJobs` is always present needs a guard. `AttachmentIcons`
  already handles this; `MessageDetailDrawer` needs a quick audit.
