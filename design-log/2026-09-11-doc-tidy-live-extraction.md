# Doc Tidy live extraction and compact results table

**Date:** 2026-09-11
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Doc Tidy email extraction](./2026-09-10-doc-tidy-email-extraction.md) and
[Google Group mailbox access](./2026-09-10-doc-tidy-group-mailbox-access.md).

Two requests came out of using the first version:

1. The results table wastes vertical space. Each row carries a second line under
   **From** (the raw address, under the display name) and under **Subject** (the
   Gmail snippet), so a row is three lines tall and few messages fit on screen.
2. Extraction only happens when someone clicks **Run all enabled rules**. The
   table should capture and display matching mail on its own, "instantly".

## Decision

### Compact rows

Drop both subtexts from the default row rendering. The sender's address moves to
the cell's `title` so it is still recoverable on hover, and the snippet stays
reachable through the subject's existing click-to-expand toggle — that toggle
previously only un-clamped a line that was already visible, so it now earns its
place. Cell padding drops from `py-2.5` to `py-1.5` and the sender and rule cells
stop wrapping.

### Automatic capture: interval poller, not Gmail push

A `docTidyPoller` service runs every enabled rule on a timer, modelled directly on
the existing `syncScheduler`: a single `setInterval`, `unref()`ed so it cannot hold
the process open, skipping a tick while a run is still in flight. The interval is
`DOC_TIDY_POLL_INTERVAL_SECONDS` (default 15, floor 5).

Each tick re-reads the config and rule list rather than caching them, so
connecting the mailbox or enabling a rule takes effect without a restart.

To make a 15-second cadence affordable, `runRule` gains a `skipKnown` option. The
poller passes it, which means a tick costs one `messages.list` call per rule plus
a `messages.get` only for Gmail ids not already stored. Without it, every tick
would re-download every message inside every rule's lookback window forever.
Manual runs leave `skipKnown` off and keep refreshing what they find.

### Immediate display: server-sent events over `fetch`

The page holds an open `GET /api/doc-tidy/stream` and refetches when the server
announces an import. Events carry only a signal (`{ imported, at }`), not the rows
themselves, so the client re-queries with whatever filters, sort and page it
currently has and can never drift out of sync with its own filter state.

The stream is consumed with `fetch` + a `ReadableStream` reader rather than
`EventSource`, because `EventSource` cannot send an `Authorization` header and the
alternative — the JWT in the query string — would leak the token into morgan's
access log. This reuses the NDJSON-over-`fetch` approach already in `authPostStream`.
A 25-second heartbeat keeps intermediaries from closing an idle stream, and the
client reconnects with backoff.

### Concurrency

`runEnabledRules` moves from the controller into the service so the poller and the
HTTP endpoint share one implementation, guarded by a module-level "running" flag.
The manual endpoint returns 409 while a run is in flight. Two concurrent runs
could both miss an existing message between the `findOne` and the `upsert` and
upload the same attachment to Drive twice, which nothing downstream would clean up.

## Alternatives Considered

- **Gmail push notifications (`users.watch` + Cloud Pub/Sub).** The only true
  "instant" capture, and rejected for now rather than on principle. It needs a
  publicly reachable HTTPS webhook, so it cannot work in local development; a
  Pub/Sub topic, subscription and IAM grants; and a `watch()` renewal job, since
  a watch expires after seven days and silently stops delivering. That is a lot
  of infrastructure and a new silent-failure mode for an internal tool, to save
  an average of ~7 seconds. The poller is the fallback such a system would need
  anyway, so this stays available as a later addition.
- **Client-side polling only.** No server changes, but capture would only happen
  while somebody had the page open, and the request would be a full filtered,
  paginated query every few seconds for every open tab.
- **Long-polling the messages endpoint.** Comparable latency to SSE but holds a
  request open per client with no way to multiplex the heartbeat, and the
  reconnect logic ends up more complex than the stream reader.
- **Pushing new rows down the stream.** Saves a round trip, but the server would
  have to replicate each client's filter, page and page-size to decide whether a
  row belongs in that client's view; a refetch signal keeps that logic in one place.
- **Emitting events from a Mongo change stream.** Decoupled and would also catch
  writes from other processes, but it requires a replica set and the poller is
  the only writer.

## Consequences

- Capture latency is bounded by the poll interval (≤15s by default), not truly
  instant. Display latency after capture is effectively zero.
- The **Run all enabled rules** button is now mostly for backfilling a
  newly-created rule with a long lookback, rather than routine use.
- The poller assumes a single server instance, as `syncScheduler` already does.
  Two instances would double every tick and could race on attachment upload.
- Gmail quota use becomes continuous instead of on-demand: roughly one
  `messages.list` per enabled rule per interval (~5 units), which stays far below
  the per-project daily and per-user per-minute ceilings.
- A rule with a wide lookback still costs one `messages.get` per never-before-seen
  message on the first tick after it is created.
- `skipKnown` means an already-imported message is not revisited, so editing a
  rule will not retroactively re-classify mail another rule already captured.
  Deleting the affected messages and re-running remains the way to reclassify.
