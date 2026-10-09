# SPS Mailbox Folder Discovery & Configurable Data Directory

**Date:** 2026-10-08
**Status:** accepted
**Author:** collaborative

## Context

The SPS Commerce tab ([2026-10-08-sps-invoice-lookup-tab.md](./2026-10-08-sps-invoice-lookup-tab.md))
hardcodes the Transaction API v5 path `/transactions/v5/data/out/…`. For a
connected account whose mailbox has no `out/` folder, every request fails with
SPS's `Directory '/out/' not found.` — including the "(root) — discover
available directories" option, which also lists `out/` and therefore cannot
discover anything.

Common real-world causes: the account is still in testing and SPS has set up
`testin/` / `testout/` instead of `in/` / `out/`, or the mailbox has not been
set up yet. Users need a way to see what folders actually exist and to
point the tab at the right one without a code change.

## Decision

### Backend (`src/services/sps.service.ts`, controller)

- New env var `SPS_DATA_DIR` (default `out`) — the mailbox folder under
  `/transactions/v5/data/` that the tab browses.
- `fetchSpsDocuments` / `fetchSpsDocumentContent` accept an optional `dataDir`
  override (validated against `^[A-Za-z0-9_-]+$` to prevent path injection).
- `fetchSpsDocuments` accepts `topLevel: true` to list
  `GET /transactions/v5/data/` — the true mailbox root (`in`, `out`,
  `testin`, `testout`, …).
- Listing endpoint accepts `?dir=<folder>` and `?topLevel=1`; download endpoint
  accepts `?dir=<folder>`. Listing response adds `dataDir` (the folder used).

### Frontend (`SpsCommerceTab.tsx`)

- New "Mailbox folder" selector: `out`, `testout`, or custom.
- Document-type options split into:
  - **Top level** — lists mailbox folders (`/data/`).
  - **Folder root** — lists sub-directories of the selected folder.
  - Existing doc types (PO, IN, 810, …).
- In a top-level listing, each folder row has an "Open" action that selects that
  folder and switches to folder-root mode.
- Path hints in the UI reflect the selected folder instead of hardcoded `out/`.

## Alternatives Considered

- **Env var only** — requires a server restart to try `testout`; too slow for
  diagnosing an account's setup.
- **Auto-fallback from `out` to `testout` on 404** — hides which environment
  is in use and could silently show test data as production.

## Consequences

- Unknown folder names are user-selectable, but are validated server-side.
- If SPS does not permit listing `/data/` for an account, the top-level option
  will surface SPS's error verbatim — which is itself a useful diagnostic.
