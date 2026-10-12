# Doc Tidy — Table-view corrections must teach the agent JSON, not tables

**Date:** 2026-10-09
**Status:** accepted
**Author:** collaborative

## Context

Revises one assumption in [Correction editor tabular mode](./2026-09-24-correction-editor-tabular-mode.md),
which stored a table-view correction's `correctedOutput` as `{ tables: correctedTables }`
on the grounds that "the output is used for retrieval similarity only".

That is not true. `_build_example_messages` in `worker/tidy_agent.py` replays each
retrieved correction's `correctedOutput` verbatim as the assistant turn — "the
user-approved correct extraction" — and the model copies its shape.

In the Dansko workspace one table-view correction (2026-10-08) caused exactly
this. The system prompt still demands top-level `vendorName` and `lineItems`, so
the model kept those and moved every other field into a `tables` array. A later
JSON-mode correction asking for the flat format competes with it, so 17 of 34
Dansko parse jobs came out table-shaped.

Invoice Audit matching (`invoiceMatchCache.service.ts`, and its frontend mirror
`extractJsonField`) only searches top-level keys and plain-object children. In
the table shape the PO number sits inside `tables[].rows`, the PO lookup is
empty, and the job never matches an order — so those invoices leave the Invoice
Audit columns blank.

## Decision

### 1 — Store table-view corrections as agent-shaped JSON

`createJobCorrection` derives `correctedOutput` for `mode: 'tabular'` on the
server from `correctedTables`, using the job's `jsonOutput` as the shape
template (`src/services/docTidyTables.service.ts → tablesToAgentJson`):

- A grid table whose title matches an array key in the original
  (`Line Items` ↔ `lineItems`) becomes that array; a key/value table whose title
  matches an object key (`Bill To` ↔ `billTo`) becomes that object.
- Any other key/value table contributes top-level fields (the formatter puts the
  original's top-level scalars in a summary table).
- Labels and columns map back to the original's key by normalised name, then —
  for grid tables — by position, since the formatter emits one column per key in
  order (`Quantity` → `qty`). Unmatched labels become camelCase keys.
- Original keys with no table counterpart are carried over unchanged, so the
  result is the original JSON with the user's edits applied.

`correctedTables` is still stored for rendering and the table diff. The client
payload is unchanged; the server ignores its `{ tables }` `correctedOutput` in
tabular mode. A one-off script (`scripts/migrate-tabular-corrections.ts`)
rewrites existing tabular corrections the same way.

### 2 — Worker never replays a `tables` shape

`_build_example_messages` drops a `tables` key from a correction before replaying
it, and skips the assistant turn entirely when nothing else remains (the note is
still promoted into the system prompt). The system prompt also states that
document fields stay top-level and the output never carries a `tables` array.
This guards against anything the migration misses.

### 3 — Invoice Audit reads fields out of a `tables` array

`extractField` / `extractArray` (backend) and `extractJsonField` /
`extractJsonArray` (frontend) add the job's `tables` as a last search scope:
key/value tables as label → value objects, grid tables as title → row objects.
Top-level keys still win. The 17 table-shaped Dansko jobs then match on Resync
without a re-parse.

## Alternatives Considered

- **Convert in the browser.** The client has the job's `jsonOutput`, but the
  migration needs the same logic on the server; one implementation is simpler.
- **Only fix the worker.** Stops new damage, but leaves already-parsed jobs
  unmatched until each is re-run.
- **Delete tabular corrections.** Throws away real user fixes (SKU, labels).

## Consequences

- Retrieval duplicate detection now canonicalises the derived JSON; two
  identical table corrections still compare equal.
- Reconstruction is heuristic. A renamed label the original never had becomes a
  new camelCase key, which is the intended teaching signal.
- The 17 table-shaped Dansko jobs keep their shape until re-parsed; the reader
  change makes that harmless for Invoice Audit.
