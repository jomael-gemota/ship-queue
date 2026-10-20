# Rules become workspace-scoped; global Filter Rules page removed

**Date:** 2026-09-18
**Status:** accepted
**Author:** collaborative

## Context

Rules were originally global, shared team-wide. Workspaces referenced them via
a many-to-many `ruleIds[]` array
([Invoice Audit workspace layer](./2026-09-18-invoice-audit-workspaces.md)).

The user now wants rules to belong to exactly one workspace — not shared, not
accessible from other workspaces. This removes the indirection of "pick rules to
include" and makes each workspace fully self-contained.

Supersedes the rule-association model from the workspace layer design above.

## Decision

### Data model

**`DocTidyRule`** gains a `workspaceId?: ObjectId` field (optional for backward
compatibility with rules that predate this change, required for all new rules).
An index on `(workspaceId, enabled)` is added.

**`DocTidyWorkspace`** drops the `ruleIds: ObjectId[]` field entirely. The
relationship is now `rule.workspaceId → workspace._id` (one-to-many), not
`workspace.ruleIds → [rule._id]` (many-to-many).

### Backend

| Change | Details |
|---|---|
| `GET /doc-tidy/rules` | Accepts optional `?workspaceId=` to filter rules by workspace. Without the param, returns all rules (needed by the poller and admin tooling). |
| `POST /doc-tidy/rules` | Accepts `workspaceId` in the request body; sets it on the created rule. |
| `PUT /doc-tidy/rules/:id` | Allows updating `workspaceId` (moving a rule to another workspace). |
| `GET /doc-tidy/messages?workspaceId=` | Replaces `workspace.ruleIds` lookup with `DocTidyRule.find({ workspaceId }).select('_id')` to get the rule IDs for the filter. |
| `GET /doc-tidy/parse-jobs?workspaceId=` | Same change as above. |
| `POST /doc-tidy/workspaces` | No longer accepts or stores `ruleIds`. |
| `PUT /doc-tidy/workspaces/:id` | Same — `ruleIds` removed from update. |

The email poller (`docTidyPoller.ts`) runs `DocTidyRule.find({ enabled: true })`
globally, which is unaffected — workspace scoping is a UI/query concern, not a
capture concern.

### Frontend

**Removed:**
- The `/doc-tidy/rules` route and the `DocTidyRules` page.
- The "Filter Rules" tab from the `DocTidyTabs` component.
- The rule filter dropdown from the Email Records tab (`DocTidy.tsx`); since rules
  are now workspace-scoped, filtering the global inbox by a workspace-specific
  rule has no meaningful semantic.
- The rule picker (checkbox list) from `WorkspaceEditorDialog`; rules belong to
  workspaces, workspaces do not select rules.

**Added:**
- A **Rules tab** in the workspace detail: `Emails | Rules | Audit Results`.
- The Rules tab embeds the full rule list + editor (previously `DocTidyRules.tsx`)
  scoped to the active workspace's `_id`. Rules created from here inherit the
  workspace's `_id` automatically.
- `DocTidyRules.tsx` is refactored into an exported `WorkspaceRulesView` component
  that accepts a `workspaceId` prop instead of reading from a route. The file is
  kept; the standalone page export is removed.

**Workspace cards** load rule names from a single `GET /doc-tidy/rules` call
(scoped per workspace by `workspaceId` during the workspace list fetch, or by
grouping client-side from a single all-rules fetch).

### Migration

A one-time script (`scripts/migrate-rules-to-workspaces.ts`) matches unassigned
rules to workspaces by name:
- Exact match (case-insensitive) first.
- If no exact match, partial match (workspace name contained in rule name or
  vice versa).
- Unmatched rules are reported but not deleted.

The user's rule and workspace names are intentionally aligned (e.g. "Weatherbeeta
rule" → "Weatherbeeta workspace"), so the name-based match is reliable.

## Alternatives Considered

- **Keep `ruleIds` on workspace as a denormalised cache alongside `rule.workspaceId`.**
  Rejected — two sources of truth that diverge silently. The rule's `workspaceId`
  is the single source of truth; all queries derive from it.
- **Many-to-many preserved but rules default to one workspace.** Rejected — the
  user explicitly wants rules to be private to their workspace, which many-to-many
  cannot enforce.
- **Migrate by UI (drag-and-drop assignment screen).** Practical, but unnecessary
  given the names match; a script is faster and auditable.
- **Keep a read-only global rules page as an admin view.** Rejected per user
  preference — the page is removed entirely.

## Consequences

- The global `/doc-tidy/rules` route still exists for the poller and any tooling
  that needs all rules, but it is no longer surfaced in the UI.
- A rule without a `workspaceId` (legacy) will not appear in any workspace until
  the migration runs or it is manually edited and saved from within a workspace.
- Moving a rule from one workspace to another requires editing it and changing its
  `workspaceId`. No bulk-move UI is designed now.
- The `WorkspaceEditorDialog` becomes significantly simpler (name only).
- The tab order is `Emails | Rules | Audit Results` — users reach parsing through
  Rules (set up) → Emails (trigger) → Audit Results (review).
