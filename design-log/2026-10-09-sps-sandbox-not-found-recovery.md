# SPS Sandbox "Directory Not Found" Smart Recovery

**Date:** 2026-10-09
**Status:** accepted
**Author:** collaborative

## Context

Sandbox SPS Commerce accounts provision `testout/` and `testin/` mailbox folders
instead of the production `out/` and `in/` folders.  The SPS Commerce tab
defaults to `out` (via the `SPS_DATA_DIR` env var), so every request a sandbox
user makes fails with:

```
Directory '/out/PO/' not found
```

The folder dropdown (added in [2026-10-08-sps-mailbox-folder-discovery.md](./2026-10-08-sps-mailbox-folder-discovery.md))
already has a `testout` option, but there is no contextual guidance when this
specific error fires.  Users are left guessing.

## Decision

### `SpsCommerceTab.tsx` — smart error recovery

- Detect "not found" / "directory" errors in `fetchError` and render a
  **contextual recovery banner** in place of the plain red error message.
- Two one-click recovery actions:
  - **"Try testout"** — sets `folder` state to `testout` and immediately
    re-fetches with that folder, without requiring the user to dismiss the
    error and click "Fetch documents" again.
  - **"Discover my folders"** — sets `docType` state to the top-level option
    and immediately fetches `GET /transactions/v5/data/` to list whatever
    mailbox folders the account actually has.
- Both actions require `fetchDocuments` to accept **inline param overrides**
  so the re-fetch uses the intended new values rather than React's
  not-yet-settled state.

### Backend — `src/services/sps.service.ts`

Verified against the live API with `scripts/diagnose-sps.ts` (2026-10-09) for
the connected account:

```
GET /transactions/v5/data/          200  {"results":[],"paging":{"limit":1000}}
GET /transactions/v5/data/in/       404  Directory '/in/' not found.
GET /transactions/v5/data/out/      404  Directory '/out/' not found.
GET /transactions/v5/data/testin/   404  Directory '/testin/' not found.
GET /transactions/v5/data/testout/  404  Directory '/testout/' not found.
```

The listing envelope is `results` (already handled). The account's mailbox
root is empty, so no folder path can succeed until SPS provisions a mailbox.
The `testin`/`testout` assumption in the Context above does not hold for this
account.

Hardening applied:

1. **Accept `entries` / `content` envelopes** as fallbacks after `results`.
2. **`toRecord` — resolve relative `href` values**: SPS returns hrefs as
   absolute-path strings (`/transactions/v5/data/testout/`).  These are now
   prefixed with `SPS_API_BASE` to become full URLs.
3. **`toRecord` — directory detection via `type` field**: entries with
   `"type": "directory"` are now recognised as directories in addition to the
   trailing-slash heuristic.
4. **`nextCursor` extracted from response**: was hardcoded to `null`; now reads
   `cursor` / `nextCursor` / `next_cursor` from the top-level response object.

## Alternatives Considered

- **Auto-fallback from `out` to `testout` on 404** — considered and rejected
  in the previous design log entry; silently shows test data and hides which
  environment is active.
- **Change the server default to `testout`** — would break production accounts
  that actually use `out`.
- **Show a static hint** — less actionable; the user still has to manually
  change the dropdown and re-click "Fetch documents".

### Folder direction model

SPS Commerce mailboxes are directional:

| Folder | Direction | Typical contents |
|--------|-----------|-----------------|
| `in`   | Inbound — trading partners → you | Purchase Orders (850/PO) |
| `out`  | Outbound — you → trading partners | Invoices (810/IN), ASNs (856/SN) |
| `testin`  | Sandbox inbound  | Same as `in`, test environment |
| `testout` | Sandbox outbound | Same as `out`, test environment |

The original `FOLDER_OPTIONS` only listed `out` and `testout`, so users had no
way to select `in` or `testin` without typing a custom value.  All four folders
are now first-class options with directional labels.

The error recovery banner also now offers both `testin` (inbound) and `testout`
(outbound) as one-click options instead of just `testout`.

## Consequences

- Sandbox users see an actionable error banner instead of a dead end.
- All four production + sandbox folders are selectable from the dropdown.
- The info box explains the inbound/outbound distinction.
- `fetchDocuments` gains an optional `opts` parameter; existing callers
  (the search button) are unaffected.
- No API or model changes needed for the folder direction changes.
