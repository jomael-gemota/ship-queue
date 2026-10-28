# Resync parse statuses when live events are missed

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

Revises the refetch behaviour from
[2026-09-25-parse-progress-multiplexing](2026-09-25-parse-progress-multiplexing.md).

Rows in the workspace Emails and CSV/PDF Imports tables sometimes stay on the
running badge (60–70%) after Tidy has finished. The database is correct — every
finished job is stored as `completed` — so the tables simply never refetched.

The badge's percentage is `step × 10`; a typical run ends around step 6–7, which
is why the stuck rows always read 60–70%.

The tables only learn about a completion from a `parse_status` event on the
shared `/doc-tidy/stream`. `docTidyEvents.ts` already calls these events
best-effort hints and expects clients to "recover on the next refetch or
reconnect", but nothing did:

- **Reconnects never resynced.** The stream reconnects after sleep, network
  changes, deploys, or when its last subscriber releases it (tab/workspace
  switches). The server sends `connected` on every (re)connect, but no table
  reacted to it, so completions during the gap were lost.
- **The trailing-only debounce can starve.** Each event resets the 400 ms
  timer. PDF Imports refetches on *every* status change, so a busy batch can
  keep postponing the refetch.
- **No fallback** while rows are running.

## Decision

- Emails, CSV/PDF Imports and the audit tab refetch on `connected`.
- `useDebouncedRefetch` gets a max wait (2 s): it still coalesces bursts, but a
  steady stream of events can no longer postpone the refetch indefinitely.
- While any row on the visible page is pending or processing, the table
  silently refetches every 15 s. It stops as soon as nothing is running.
- `fetchPdfImports` gains the same `silent` option `fetchEmails` has, so these
  background refreshes don't flash the loading state.

## Alternatives Considered

- **Apply `parse_status` to the row in place** instead of refetching: faster,
  but still loses whatever was missed during a disconnect, so the resync is
  needed regardless.
- **Event replay / sequence numbers on the server:** exact, but adds state to a
  stream deliberately kept stateless for a problem a refetch already solves.

## Consequences

- One extra page request per 15 s per open tab, only while jobs are running.
- The orphaned `processing` job from 2026-09-15 (`Invoice_INV0905639.pdf`)
  would keep a polling loop alive if it is on the visible page; it should be
  aborted or re-run.
