# Per-Workspace Email Sources for Doc Tidy

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

Doc Tidy was originally designed with a single shared Gmail mailbox (stored as
`DocTidyConfig.gmailRefreshToken`) that all workspaces and rules draw from. The
[2026-09-10-doc-tidy-group-mailbox-access.md](./2026-09-10-doc-tidy-group-mailbox-access.md)
entry already flagged multi-inbox as the right upgrade path: *"still the right
upgrade if more shared inboxes appear."*

Testing has revealed that brands operate under multiple email sources — both
real Gmail accounts and Google Groups that deliver mail to a member account. A
single globally-connected mailbox cannot cleanly isolate mail per brand workspace:

- Brand A's invoices arrive at `billing@brand-a.com` (or via a Google Group
  whose mail lands in a member account).
- Brand B's invoices arrive at a different address entirely.
- Rules' `toAddresses` field scopes extraction, but all rules still share one
  OAuth token, meaning an admin must ensure the single connected account has
  access to every brand's mail.

The fix is to allow each workspace to connect its own Gmail account
independently, rather than relying solely on the global singleton.

## Decision

Introduce a new `DocTidyEmailSource` collection. Each document associates a
Gmail OAuth refresh token with a specific workspace, following the same
credential shape already used by `DocTidyConfig`. The extraction service
(`runRule`) resolves the token to use by:

1. Looking up any `DocTidyEmailSource` documents for the rule's workspace.
2. Using the first active (token-bearing) source if found.
3. Falling back to the global `DocTidyConfig.gmailRefreshToken` when no
   workspace-level source is configured.

This preserves full backward compatibility: existing workspaces and rules
continue working without any changes.

### Key components

| Layer | Change |
|-------|--------|
| `src/models/DocTidyEmailSource.ts` | New model (workspaceId + OAuth fields, `gmailRefreshToken` secret) |
| `src/controllers/docTidyAuth.controller.ts` | New `getWorkspaceEmailSourceAuthUrl` handler; callback branches on `state.target` |
| `src/controllers/docTidyEmailSource.controller.ts` | New controller — list + delete per workspace |
| `src/routes/auth.routes.ts` | `GET /doc-tidy/workspaces/:workspaceId/connect` (admin) |
| `src/routes/docTidy.routes.ts` | `GET + DELETE /workspaces/:workspaceId/email-sources` |
| `src/services/docTidy.service.ts` | `resolveWorkspaceRefreshToken(workspaceId)` helper, used in `runRule` |
| `frontend/src/types/docTidy.ts` | `DocTidyEmailSource` interface; `emailSources?` on `DocTidyWorkspace` |
| `frontend/src/pages/DocTidyInvoiceAudit.tsx` | Email Sources section in `WorkspaceEditorDialog` |

### OAuth redirect path

The existing global connect redirects to `/settings?doc_tidy=connected`.
Workspace-level connect redirects to
`/doc-tidy?ws_source=connected&workspaceId=<id>` so the Invoice Audit page can
display the success toast and refresh the workspace's source list.

## Alternatives Considered

- **Service account with domain-wide delegation** — the cleanest enterprise
  option; still rejected here for the same reasons as the original design log
  (separate credential type, workspace-admin scope registration, rotation
  complexity). Remains a future upgrade path.
- **Storing multiple tokens on `DocTidyWorkspace` directly** — avoids a new
  collection but conflates workspace metadata with credential management. Harder
  to gate `select: false` on a single sub-field, and harder to extend later.
- **Reusing the global mailbox with tighter `toAddresses` scoping** — status
  quo; does not solve the case where brands use entirely different Gmail
  accounts that the global connected account cannot access.

## Consequences

- Admins must individually connect one Gmail account per workspace that needs
  its own source. Workspaces that share a mailbox (or are happy with the global
  one) need no action.
- The `resolveWorkspaceRefreshToken` fallback means a misconfigured or
  disconnected workspace source silently falls back to the global mailbox —
  this is intentional for safety but operators should be aware.
- Multiple sources per workspace are supported by the data model. The service
  layer currently uses the first available source; future work can add
  round-robin or source-per-rule selection if needed.
