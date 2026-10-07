# Doc Tidy — URL-Based Navigation Routing

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit tab's navigation (organizations → workspace list → workspace
detail) was driven entirely by local React state. Refreshing the page always
reset the state to its initial value (`view: 'organizations'`), dropping the
user back to the organizations landing page — even if they were deep inside a
workspace. Likewise, after saving workspace edits from the editor modal, a
subsequent refresh would lose their position.

Builds on the organizations layer added in
[2026-09-30-doc-tidy-organizations.md](./2026-09-30-doc-tidy-organizations.md).

## Decision

### URL scheme

| URL | View rendered |
|-----|---------------|
| `/doc-tidy/invoice-audit` | Organizations landing |
| `/doc-tidy/invoice-audit/orgs/:orgId` | Workspace list inside an org |
| `/doc-tidy/invoice-audit/orgs/:orgId/workspaces/:workspaceId` | Workspace detail (inside an org) |
| `/doc-tidy/invoice-audit/workspaces/:workspaceId` | Workspace detail (unassigned — no org) |

Sub-tabs within a workspace (`audit`, `emails`, `rules`, `vendors`,
`pdf-imports`) are **not** part of the URL; they remain local state so tab
switches do not push history entries.

### App.tsx

Four `<Route>` entries, all rendering the same `DocTidyInvoiceAudit` component,
replace the single entry that existed before. The existing
`/doc-tidy → /doc-tidy/invoice-audit` redirect is preserved.

### DocTidyInvoiceAudit.tsx

Two responsibilities are added:

1. **Navigation functions push the URL.** `enterOrg`, `leaveOrg`,
   `enterWorkspace`, and `leaveWorkspace` each call `navigate()` with the
   appropriate path after updating local state. No other behaviour changes.

2. **One-shot URL restoration effect.** A `useRef` flag ensures the effect
   runs exactly once — after both `orgLoading` and `wsLoading` turn `false` for
   the first time. It reads `orgId` / `workspaceId` from `useParams`, locates
   the matching objects in already-loaded state, and applies the same
   initialisation logic as `enterWorkspace` / `enterOrg` (but without calling
   `navigate()` again, since the URL is already correct).

## Alternatives Considered

- **Derive `view` / `activeOrg` / `activeWorkspace` entirely from URL params**
  — cleaner in theory but would require restructuring every render branch in
  the 6 700-line component. Deferred until a larger refactor is planned.
- **Search params instead of path segments** — simpler route config but less
  clean URLs and doesn't survive certain proxy/cache stripping. Path params
  are the standard React Router pattern for addressable resources.
- **Nested `<Route>` children with sub-components** — would split the monolith
  across files; appropriate for a future split but out of scope here.

## Consequences

- Refreshing the page at any level (orgs list, workspace list, workspace detail)
  restores the user to the same view.
- Back/forward browser buttons navigate between org → workspace list →
  workspace detail correctly.
- Deep-link sharing of a specific workspace URL becomes possible.
- Sub-tab state (which tab inside a workspace is active) is still lost on
  refresh; this is acceptable for now.
- The workspace initialization logic is duplicated between `enterWorkspace` and
  the restoration effect. A future refactor should extract it into a shared
  `initWorkspaceState(ws)` helper.
