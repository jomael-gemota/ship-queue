# DC COGS: batch lookup via pf/lookup/items, live refresh, cost history

**Date:** 2026-10-28
**Status:** accepted
**Author:** collaborative

## Context

Supersedes the lookup and "never overwrite" parts of
[2026-10-28-dc-cogs-failure-handling](2026-10-28-dc-cogs-failure-handling.md).

The `bt_costs?s=` fuzzy search took 150 s+ per SKU. `POST /v1/pf/lookup/items`
takes up to 1000 SKUs per request and matches exactly: all 368 distinct order
SKUs resolved in ~1.5 s, including 154 of the 155 SKUs stuck on "—" / pending
(the one miss is a blank SKU). 16 stored costs differed from the live value
(Data Central had since lowered them), so costs fetched once and frozen go stale.

## Decision

- `syncDcCogs()` looks up **every** distinct order SKU via `pf/lookup/items`
  (chunks of 1000, `domain: amazon.com`, `use_cache: false`) and writes the live
  cost to every row whose cost differs. It runs on import, on Invoice Audit
  open, and every 3 minutes from the background scheduler. One sync at a time;
  a trigger during a sync queues one follow-up sync.
- SKUs match case- and whitespace-insensitively. When a SKU has several items
  (one per ASIN), the first item with a cost is used.
- A SKU the API does not return is written as `'n/a'` only if the row has no
  cost yet; a stored cost is never cleared. A failed request writes nothing.
- `DocTidyDcCogsHistory` records `{ sku, cost, msrp, recordedAt, source }` the
  first time a SKU gets a cost and every time the cost changes. On the first
  sync, a SKU that already had a stored cost gets that cost seeded as its first
  entry (`source: 'stored'`, at its `dcCogsAt`), so the change is visible.
- The order-imports list attaches `dcCogsHistory` (newest first) to each row;
  the DC COGS cell shows an info icon with the history in a tooltip.

## Alternatives Considered

- **Keep `bt_costs` with a fallback:** the batch endpoint resolved every
  non-blank SKU, and the search is too slow to be a useful fallback.
- **History embedded on each order-import row:** cost is per SKU, so a per-SKU
  collection avoids duplicating the same history across rows and workspaces.

## Consequences

- `pf/lookup/items` does not say who uploaded a cost, so history shows when
  and what, not who. `bt_costs` items carry `created_by`, but that endpoint is
  too slow to query per change.
- Every 3-minute tick sends one request per 1000 SKUs; fine at current volume.
