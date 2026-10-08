# Per-Workspace SPS Commerce Sources for Doc Tidy

**Date:** 2026-10-08
**Status:** accepted
**Author:** collaborative

## Context

The initial SPS Commerce OAuth scaffold (added 2026-10-08, same session) stored
tokens on the `User` document (per-user), following the Dropbox Fetcher pattern.
This was a placeholder; the actual requirement is that SPS Commerce is a
**source-of-invoices for a workspace**, not a personal user credential.

Different Doc Tidy workspaces receive invoices through different channels:

- Some workspaces poll a Gmail mailbox (via `DocTidyEmailSource`).
- Other workspaces receive invoices through an SPS Commerce EDI/API integration.

Users should be able to choose, per workspace, whether to connect a Gmail
account or an SPS Commerce account instead of — or in addition to — email.

This mirrors the existing `DocTidyEmailSource` design
([2026-10-07-workspace-email-sources.md](./2026-10-07-workspace-email-sources.md))
exactly, replacing Google OAuth with SPS Commerce OAuth (Auth0).

## Decision

Introduce a new `DocTidySpsSource` collection. Each document associates an SPS
Commerce OAuth refresh token with a specific workspace. The credential shape
follows `DocTidyEmailSource` 1-to-1.

The previous per-user SPS fields on the `User` model are removed; they were
never persisted to the DB in production.

### Key components

| Layer | Change |
|-------|--------|
| `src/models/DocTidySpsSource.ts` | New model — `workspaceId` + SPS OAuth fields, `spsRefreshToken` hidden by default |
| `src/services/sps.service.ts` | `ensureAccessToken` now takes `IDocTidySpsSource` instead of `IUser` |
| `src/controllers/spsAuth.controller.ts` | `getWorkspaceSpsAuthUrl` + updated `handleSpsCallback` — upserts `DocTidySpsSource`; removes global/user-level handler |
| `src/controllers/docTidySpsSource.controller.ts` | New controller — `listSpsSources` + `deleteSpsSource` |
| `src/routes/auth.routes.ts` | `GET /sps/workspaces/:workspaceId/connect` replaces `/sps/connect` |
| `src/routes/docTidy.routes.ts` | `GET + DELETE /workspaces/:workspaceId/sps-sources` |
| `src/models/User.ts` | Remove `spsRefreshToken`, `spsAccessToken`, `spsTokenExpiry`, `spsConnectedAt`, `spsAccountId`, `spsAccountEmail` |

### OAuth redirect path

On success, the callback redirects to:
`/doc-tidy?ws_sps=connected&workspaceId=<id>` — mirrors the email source
redirect (`ws_source=connected`) so the frontend can show a toast and refresh.

On error:
`/doc-tidy?ws_sps_error=<code>&workspaceId=<id>`

## Alternatives Considered

- **Keep per-user SPS tokens as a "global fallback"** — rejected; SPS Commerce
  is a workspace-level invoice source, not a personal integration. No global
  fallback is needed (unlike email, which has the legacy `DocTidyConfig` singleton).
- **Store SPS credentials directly on `DocTidyWorkspace`** — same objections as
  for email sources: conflates workspace metadata with secrets, cannot use
  `select: false` cleanly, harder to support multiple sources per workspace later.

## Consequences

- Each workspace that uses SPS Commerce must have at least one `DocTidySpsSource`
  connected before the invoice poller can pull data for that workspace.
- Multiple SPS sources per workspace are supported by the data model (same as
  email sources). The service layer uses the first available source for now.
- Workspaces that use Gmail remain unaffected; the email source and SPS source
  models are independent.
