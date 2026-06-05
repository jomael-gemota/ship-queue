# Drive/Dropbox management for all roles + read-only Auto Sync

**Date:** 2026-06-06
**Status:** accepted
**Author:** collaborative

## Context

The Settings page currently exposes three integration sections with three
different access models (see `2026-06-05-dropbox-fetcher.md` and
`2026-06-05-user-role-management.md`):

- **Google Drive** — connect / disconnect / switch-account / folder picker were
  all gated in the UI behind `canCreateLabels` (`canCreate`). View-only users
  could see the Drive status but could not manage the connection.
- **Dropbox** — already open to every authenticated user (no role/permission
  gate), matching its design-log decision.
- **Automatic order syncing (Auto Sync)** — the entire section was wrapped in
  `{isAdmin && (...)}`, so non-admins never saw it at all. The config is also
  only fetched for admins.

The request: every user, regardless of role, should be able to reconnect/modify
their own Drive and Dropbox connection. The Auto Sync section should also be
visible to everyone, but **read-only** when the user is not an admin.

## Decision

### Google Drive — drop the `canCreateLabels` gate in the Settings UI
Remove the `canCreate &&` conditions around the Drive connect, disconnect,
switch-account, reconnect-on-expiry, "Browse folders", "Reset to root", manual
folder ID input, and folder browser controls. Drive connection management is a
per-user concern (each user connects their own Drive), so it should behave like
Dropbox and be available to all authenticated users.

The backend Drive endpoints already require only `requireAuth` (no
`canCreateLabels` / `requireAdmin`), so the frontend change brings the UI in
line with what the API already permits — no backend change needed.

The `!canCreate` "view-only access" warning banner at the top of the page is
kept, since it still accurately communicates label-creation permission (which is
a separate concern from connection management).

### Auto Sync — always visible, read-only for non-admins
- Load the sync config for **all** authenticated users (remove the
  `if (!isAdmin) return` guard). The backend `GET /settings/sync` is already
  available to any authenticated user; only `PUT /settings/sync` is admin-only.
- Render the Auto Sync section unconditionally (remove the `{isAdmin && ...}`
  wrapper).
- When the user is not an admin:
  - Disable the enable/disable toggle and the interval input.
  - Hide the "Save changes" button and instead show a short note that only an
    admin can change these settings.

This keeps the single source of truth (the backend admin gate) authoritative
while letting all users see the current background-sync status in Settings,
consistent with the read-only auto-sync badge already shown on the Orders page.

## Alternatives Considered

- **Gate Drive on admin instead of removing the gate** — rejected; the request
  is explicitly to let all roles manage their own connection, and Dropbox
  already follows the open model.
- **Add `requireLabelPermission` to the Drive backend routes** — out of scope
  and contrary to the request; would re-restrict what we are intentionally
  opening up.
- **Keep Auto Sync admin-only but mirror status on Orders only** — rejected; the
  request specifically asks for the section to be visible (read-only) in
  Settings for non-admins.

## Consequences

- View-only / non-label users can now connect, disconnect, switch, and configure
  the destination folder for their own Google Drive from Settings. This matches
  the existing backend authorization (JWT only) — no new server exposure.
- Non-admins see the Auto Sync configuration but cannot change it; the controls
  are disabled and the save action is hidden. Any attempt to PUT would still be
  rejected by `requireAdmin` server-side.
- No backend changes. Purely a frontend (`Settings.tsx`) adjustment.
