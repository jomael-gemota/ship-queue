# Invoice Source Selection During Workspace Creation

**Date:** 2026-10-09
**Status:** accepted
**Author:** collaborative

## Context

The `WorkspaceEditorDialog` currently hides the **Invoice source** section when
creating a new workspace (`{initial && (...)}`) because connecting a Gmail or
SPS Commerce account requires an existing workspace ID to associate the OAuth
token with. Users therefore have to create the workspace, then re-open it to
connect a source — a two-step round-trip that is not obvious.

Relevant prior entries:
- [2026-10-07-workspace-email-sources.md](./2026-10-07-workspace-email-sources.md)
- [2026-10-08-workspace-sps-source.md](./2026-10-08-workspace-sps-source.md)

## Decision

Adopt a **create-then-connect** flow entirely within the new-workspace dialog:

1. A simplified **Invoice source** radio picker is shown in the "New workspace"
   dialog with three choices:
   - **Set up later** (default) — no source connected; user proceeds normally
   - **Gmail** — after workspace creation, immediately fetch the Gmail OAuth URL
     for the new workspace ID and redirect
   - **SPS Commerce** — same redirect pattern, but via `/auth/sps/workspaces/:id/connect`

2. Clicking "Create workspace" still POSTs to `/doc-tidy/workspaces` first. If
   a source type was chosen, the response's workspace `_id` is passed to the
   relevant connect endpoint and the page is redirected to OAuth. The existing
   OAuth callback (`ws_source=connected` / `ws_sps=connected`) already handles
   displaying the success toast and refreshing sources on return.

3. The dialog subtitle for new workspaces is updated to:
   *"Set up your workspace. You can add rules and change these settings later."*
   to acknowledge that the source picker is now part of creation.

### Why create-first?

OAuth tokens must be stored against a `workspaceId`. The workspace must exist
before the callback can upsert the source document. Alternative approaches:

- **Defer OAuth and store `pendingSourceType` in session** — complex, fragile
  across browser tabs.
- **Create workspace + source in a single transaction** — requires server-side
  changes and still needs the user to complete OAuth first.

Create-first is already exactly what happens today for the edit path; this
change simply surfaces the preference selection one step earlier.

## Alternatives Considered

- **Skip the dialog; add a "Connect source" step after workspace creation** —
  better explicit flow but requires a dedicated stepper/wizard component and
  more navigation changes.
- **Show the full Edit-mode source section (with Connect button) in New mode** —
  the source can only be connected after the workspace exists; adding a Connect
  button before creation would mislead users into thinking they can connect
  without saving first.

## Consequences

- Zero backend changes required.
- On return from OAuth the user lands on the Doc Tidy page with the new
  workspace already selected (the existing redirect handles this).
- Users who choose "Set up later" see no change from today's behavior.
