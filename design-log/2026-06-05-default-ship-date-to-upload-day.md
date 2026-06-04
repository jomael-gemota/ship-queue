# Default Ship Date to Batch Upload Day

**Date:** 2026-06-05
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Batch Ship Date override](2026-06-04-batch-ship-date-override.md). Operators
were forgetting to set a ship date. We already made the batch Ship Date picker
visually prominent; the remaining ask is that every newly uploaded batch defaults
its Ship Date to the day it was uploaded, so a sensible value is always present
(and used) even if the operator never touches the picker.

Previously, at draft time each item's `shipDate` was derived from the order's
`shipByDate` (`formatShipDate(order.shipByDate)`), which could be empty or an
Amazon-imposed date rather than the upload day, and was not stored as an override
(so it was recomputed at purchase time).

## Decision

- At draft (`draftBatch`), set every item's `shipDate` **and** `shipDateOverride`
  to the batch's upload day. Persisting it as an override means it survives
  re-resolution (`prepareRow`) and is the date the label is actually purchased
  with, while staying editable via the batch-wide Ship Date picker.
- "Upload day" is taken from the **client's local date** (sent as `shipDate` in
  the draft request) so it matches the operator's timezone. The server validates
  it against `YYYY-MM-DD` and falls back to the batch's `createdAt` timestamp if
  missing/invalid.

## Alternatives Considered

- Server-side `formatShipDate(new Date())` only — simplest, but UTC-based, so a
  late-night upload at UTC+8 would default to the previous calendar day.
- Frontend-only default (picker falls back to upload day for display) — rejected:
  it wouldn't persist, so the purchased label would still use the order's
  `shipByDate`, making the displayed default misleading.

## Consequences

- New batches always show a pre-filled, "set" Ship Date (the upload day) in the
  picker; operators can still change it for the whole batch.
- The draft endpoint now accepts an optional `shipDate` (YYYY-MM-DD) field.
- Existing batches are unaffected (no migration); this only changes new drafts.
