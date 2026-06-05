# Persistent Dropbox Fetcher Setup (folder + file type)

**Date:** 2026-06-05
**Status:** accepted
**Author:** collaborative

## Context

Builds on [2026-06-05-dropbox-fetcher.md](./2026-06-05-dropbox-fetcher.md). In v1 the
Dropbox Fetcher's working state (which folder the user drilled into, the chosen
file type, and the recursive toggle) lived only in React component state, so it
reset on page refresh and on logout/login.

Request: the last setup the user had should persist across page refresh **and**
logout, so they return to exactly where they left off.

## Decision

Persist the setup **server-side, per user**, on the `User` document — the same
place the app already stores per-user Drive settings (`driveFolderId`, etc.).
This makes the setup durable across refresh, logout/login, and other devices,
and avoids per-browser `localStorage` pitfalls (e.g. another user logging into
the same browser, or losing the setup on a different machine).

### Stored shape
A single embedded sub-document `dropboxFetcherPrefs` on `User`:
- `folderPath` — the selected folder's Dropbox path (`''` = root)
- `crumbs` — the breadcrumb trail `[{ path, name }]` (source of truth for
  restoring the folder browser exactly, including intermediate folder names)
- `fileType` — the selected file-type catalog id (e.g. `pdf`, `excel`, `all`)
- `recursive` — the "include sub-folders" toggle

Extracted link **results are intentionally not persisted** — only the *setup*.
Results are re-generated on demand (links can change/expire) and could be large.

### API
- `GET /api/settings` payload gains `dropboxPrefs` (null when never saved).
  The Fetcher page already calls this, so no extra round-trip on load.
- `PUT /api/dropbox/preferences` (requireAuth) saves the prefs. Called
  fire-and-forget whenever the user navigates folders, changes the file type,
  or toggles recursion.

### Restore behaviour
- On load, the page restores `crumbs`, `fileType` (validated against the current
  catalog; falls back to `all`), and `recursive`, then lists the restored folder.
- **Graceful fallback:** if the saved folder no longer exists (deleted/moved),
  the listing fails and the page falls back to the Dropbox root without
  overwriting the saved prefs (so a transient error doesn't wipe the setup).

## Alternatives Considered

- **`localStorage`** — simplest, survives refresh and logout on the *same*
  browser, but is per-device and can leak one user's setup to another on a shared
  machine. Rejected in favour of durable, user-scoped server storage that matches
  the existing Drive-settings precedent.
- **Persisting results too** — rejected; links can change/expire and the payload
  could be large. Only the reproducible setup is stored.

## Consequences

- New embedded field on `User`; returned by default (non-sensitive).
- A lightweight write happens on each setup change (folder nav / type / toggle).
  Acceptable for an internal tool with few users; calls are fire-and-forget and
  failures are non-fatal (setup still works for the session).
