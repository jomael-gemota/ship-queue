# Dropbox Fetcher & Dropbox Account Connection

**Date:** 2026-06-05
**Status:** accepted
**Author:** collaborative

## Context

Users need a way to pull together shareable links for a batch of files that live
in Dropbox. Today the app integrates Google (login + Drive uploads) but has no
Dropbox integration. The request is a new "Dropbox Fetcher" page plus a Dropbox
connection managed from the Settings page.

Desired flow:
1. User connects their Dropbox account in **Settings** (OAuth).
2. On the **Dropbox Fetcher** page they browse their Dropbox (including mounted
   shared folders) and pick a single sub-folder.
3. They choose a file type (PDF, CSV, Excel, …).
4. They click a button that extracts the links of all matching files in that folder.
5. The links are shown in the UI, can be copied in one click, and exported to a
   single `.txt` file.

This mirrors the existing Google Drive pattern (`driveAuth.controller.ts`,
`googleDrive.service.ts`, per-user tokens on the `User` model, the Drive section
in `Settings.tsx`, and the Drive folder browser). We reuse those conventions.

## Decision

### Auth model — per-user Dropbox OAuth (offline)
- Use Dropbox OAuth 2 **authorization code flow with `token_access_type=offline`**
  so we receive a long-lived **refresh token** + short-lived access token.
- Scopes requested: `account_info.read`, `files.metadata.read`, `sharing.read`,
  `sharing.write`.
- Tokens are stored on the `User` document (mirroring the Google fields), with
  the secrets marked `select: false`:
  `dropboxRefreshToken`, `dropboxAccessToken`, `dropboxTokenExpiry`,
  `dropboxConnectedAt`, `dropboxAccountId`, `dropboxAccountEmail`,
  `dropboxAccountName`. The JWT stays the only thing in `localStorage`.
- Access tokens expire (~4h); `dropbox.service.ts` transparently refreshes them
  using the refresh token (with a 60s safety buffer) and persists the new token.
- A revoked/expired refresh token surfaces as `401 { code: 'dropbox_token_expired' }`
  so the UI can prompt a reconnect, matching the Drive `drive_token_expired` flow.

### Backend — no SDK, raw HTTPS calls
- We call the Dropbox HTTP API with the built-in `fetch` (Node 20), the same way
  `settings.controller.ts` already calls Google's revoke endpoint. This avoids a
  new dependency and keeps the surface tiny and explicit.
- Endpoints used:
  - `POST /oauth2/token` (exchange + refresh)
  - `POST /2/users/get_current_account` (display name/email)
  - `POST /2/files/list_folder` (+ `/continue` for pagination)
  - `POST /2/sharing/create_shared_link_with_settings`, falling back to
    `POST /2/sharing/list_shared_links` when a link already exists.

### New routes
- `GET  /api/auth/dropbox/connect` (requireAuth) → `{ url }` (frontend redirects).
- `GET  /api/auth/dropbox/callback` → exchange code, store tokens, redirect to
  `/settings?dropbox=connected` (or `?dropbox_error=...`).
- `DELETE /api/settings/dropbox` → disconnect (clears fields; best-effort token revoke).
- `GET  /api/dropbox/folders?path=` → list **sub-folders** of `path` (root when blank).
- `POST /api/dropbox/links` → body `{ path, extensions, recursive }` → returns the
  matching files with their shared-link URLs.

### File-type filtering
- The **frontend** owns the type catalog (label + extension list) and sends an
  `extensions: string[]` array (lower-case, no dot) to the backend; the backend
  filters file names by extension. An empty array means "all files". This keeps
  the backend generic and the catalog easy to extend in one place.

### Shared folders
- Mounted shared folders appear in the normal `list_folder` tree, so the folder
  browser surfaces them without extra work. (Team-space folders that are not
  mounted into the member namespace are out of scope for v1.)

### Recursion
- The folder picker selects a single folder. A "include sub-folders" toggle lets
  the user optionally recurse; default is **off** (files directly in the folder).

### Link semantics
- We create (or reuse) a **persistent shared link** per file
  (`create_shared_link_with_settings`, reusing the existing link on
  `shared_link_already_exists`). Links are returned as Dropbox provides them
  (`...?dl=0`). Calls run with bounded concurrency to stay polite to the API.

### Frontend
- New page `frontend/src/pages/DropboxFetcher.tsx`, registered as a protected
  route `/dropbox-fetcher`, added to the sidebar (Operations group), the navbar
  title map, and the full-width layout list.
- Reuses the breadcrumb folder-browser UX from the Drive picker in `Settings.tsx`.
- New **Dropbox** section in `Settings.tsx` mirroring the Google Drive card
  (status badge, connect/disconnect/switch account, connected-account details,
  OAuth redirect handling via `?dropbox=connected` / `?dropbox_error=`).
- `AppSettings` is extended with `dropboxConnected` + account display fields.

## Alternatives Considered

- **Official `dropbox` npm SDK** — convenient typings, but adds a dependency and
  its own fetch/transport quirks. Raw `fetch` against a handful of stable
  endpoints is lower-risk and matches the existing Google-revoke approach.
- **Temporary links (`/2/files/get_temporary_link`)** — only needs
  `files.content.read` and gives direct-download URLs, but they expire after ~4h.
  Persistent shared links are better for copying/exporting to share later.
- **Recursive-by-default extraction** — rejected; could pull thousands of files
  unexpectedly. Opt-in recursion is safer and clearer.
- **Storing extension map on the backend** — rejected to avoid duplicating the
  catalog the UI must render anyway; the UI sends extensions.

## Consequences

- Requires a Dropbox app (scoped, with the four scopes above) and three new env
  vars: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_CALLBACK_URL`. The
  redirect URI must be registered in the Dropbox App Console.
- Link extraction cost scales with file count (≥1 API call per file); acceptable
  for an internal tool, mitigated with bounded concurrency.
- New per-user secret fields on `User`; consistent with the Drive precedent
  (`select: false`, never returned to the client).
- Connecting Dropbox is available to all authenticated users (not gated on
  `canCreateLabels`), since fetching links is unrelated to label creation.
