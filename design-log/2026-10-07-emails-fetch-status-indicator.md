# Emails Tab — Fetch Status Indicator

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

Users of the Doc Tidy Emails tab have no real-time visibility into what the
background mailbox poller is doing. They see a countdown to the next sync, and
a "Live"/"Offline" SSE badge, but nothing that tells them:

- whether the poller is **actively fetching** emails right now
- whether the last fetch **completed successfully** or **errored**
- approximately **how long** an in-progress fetch will take

This causes confusion: users refresh the page or assume the system is broken
when a long poll is simply in flight.

## Decision

### Backend

1. **`docTidyPoller.ts`** — track `isPolling: boolean`; broadcast a new
   `poll_status` SSE event (via `docTidyEvents`) at the start and end of each
   tick. The event carries `pollerRunning`, `pollError` (last error string or
   `null`), and `lastImportAt` (ISO timestamp or `null`).

2. **`docTidyEvents.ts`** — add `poll_status` to the event union with fields
   `pollerRunning`, `pollError`, `lastImportAt`.

3. **`docTidy.controller.ts` / `buildConfigPayload`** — expose
   `pollerRunning`, `lastError`, and `lastImportAt` so the initial page-load
   state is correct without waiting for the next SSE event.

### Frontend

1. **`types/docTidy.ts`** — extend `DocTidyConfig` and `DocTidyEvent` with
   the new fields.

2. **`DocTidy.tsx`** — add three new reactive state variables (`pollerRunning`,
   `pollError`, `lastImportAt`) seeded from the config response and updated
   by `poll_status` SSE events.

   Render a **fetch-status chip** in the filter bar, right-aligned alongside
   the existing Live/Offline badge:

   | State | Chip |
   |-------|------|
   | `pollerRunning = true` | amber spinner + "Fetching emails…" |
   | `pollerRunning = false`, `pollError` set | rose `!` icon + "Fetch error" (title = full message) |
   | `pollerRunning = false`, no error | green checkmark + "OK" (fades out after 8 s) |

   The "next in Xs" countdown in the tab-bar header is already present and
   naturally communicates how long to wait; no changes are needed there.

## Alternatives Considered

- **Polling the config endpoint every few seconds** — wasteful; the SSE stream
  is already open. Rejected.
- **Showing a full-page banner** — too intrusive for a routine poll; the filter
  bar chip is contextual and non-blocking. Rejected.
- **Only showing errors** — users explicitly asked for in-progress visibility.
  Rejected.

## Consequences

- Small backend change: one new boolean + two timestamps added to an already
  in-use SSE channel; no schema migration.
- Filter bar gains a third status chip; horizontal space is already flexible
  (`flex-wrap`).
- If the poller is disabled (no mailbox connected, no enabled rules), the chip
  is simply absent — the "mailbox not connected" banner already covers that case.
