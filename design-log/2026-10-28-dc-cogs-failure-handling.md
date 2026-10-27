# DC COGS: separate lookup failures from "not found", never overwrite a cost

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

DC COGS in the Invoice Audit table showed "pending…" and then "—" in most
workspaces (Weatherbeeta, Tru Spec, Alegria, Vertx, Arborwear, Kryptek; Gill
and Danner/Lacrosse stuck on pending).

Probing the Channel Precision `bt_costs` API showed it is reachable and the
credentials are valid (an unfiltered request answers in ~5 s), but the `s`
search — the only search parameter the API accepts — took over 150 s for every
SKU, including SKUs that resolved earlier. Our 10 s timeout fired, and
`fetchDcCogs` swallowed the error and returned `null`, which was stored as
`'n/a'` exactly like a genuine "SKU not found". On every Invoice Audit tab
open, `forceRefreshCogsForWorkspace` reset all `'n/a'` rows to `null`
("pending…") and re-ran the slow lookups, which failed again ("—"). Runs also
overlapped when the tab was opened repeatedly.

## Decision

- `fetchDcCogs` returns `found` / `not_found` / `error`. Only `not_found` is
  written as `'n/a'`; on `error` the row is left untouched and retried on the
  next pass. Timeout raised to 30 s.
- Every write is guarded by `dcCogs ∈ {null, 'n/a'}`, so a stored cost is never
  overwritten or cleared.
- Before calling the API, SKUs that already have a cost on any order-import row
  are filled from that row (DC cost is per SKU, not per workspace).
- `'n/a'` rows are retried after 3 minutes and are no longer reset to `null`
  first, so the table does not flip back to "pending…".
- A server-side scheduler retries every workspace with missing costs every 3
  minutes, so costs appear without anyone reopening the Invoice Audit tab. A
  tick stops at the first workspace whose pass finds the API unavailable.
- One population pass per workspace / import batch at a time.
- If an entire batch of 5 lookups errors, the pass stops early: the API is down.
- After writing, the server broadcasts a `dc_cogs` SSE event and the Invoice
  Audit tab refetches its rows, so costs appear without a reload.

## Alternatives Considered

- **Exact-SKU filter on the API:** not supported; the API rejects any query
  parameter other than `s`, `page`, `limit`, `sort_by`, `sort_dir`.
- **Separate `'error'` value in `dcCogs`:** would need UI and filter changes;
  leaving the row as it was achieves the same retry behaviour.

## Consequences

- While the upstream search is slow, affected rows stay "pending…" rather than
  showing a misleading "—".
- `'n/a'` rows written under the old behaviour (mostly timeouts) are retried
  on the first scheduler tick after deploy.
- SKUs genuinely missing from DC are searched again every 3 minutes, adding
  steady load on the slow `s` search; raise `NOT_FOUND_RETRY_MS` if that
  becomes a problem.
