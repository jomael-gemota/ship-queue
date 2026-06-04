# Batch Ship Date override

**Date:** 2026-06-04
**Status:** accepted
**Author:** collaborative

## Context

Operators need to apply a custom Ship Date to every order in a batch from the
Batch Items page, rather than relying solely on the order's `shipByDate` derived
at draft time. The chosen date must persist to the database, drive the Ship Date
used when creating/printing labels, and update the Ship Date column in real time.

Today `shipDate` is recomputed from `order.shipByDate` every time `prepareRow`
runs (draft, refresh, create, recreate), so any stored value is overwritten at
label-purchase time.

## Decision

- Add a dedicated `shipDateOverride` field to the `Label` model, mirroring the
  existing `propertyOverride` pattern. When present, `prepareRow` uses it instead
  of the order-derived ship date, so the operator's choice survives
  re-resolution.
- Add `PATCH /labels/batches/:id/ship-date` (label permission + batch ownership)
  that validates a `YYYY-MM-DD` date and sets both `shipDate` and
  `shipDateOverride` on every item in the batch that is **not yet created**.
  Already-created labels keep the ship date they were purchased with, since the
  carrier label is immutable once bought.
- Frontend: a date picker in the Batch Items table toolbar (visible to the batch
  owner with label permission). Selecting a date auto-applies it, optimistically
  updates the Ship Date column for pending items, then reconciles with the
  server response.

## Alternatives Considered

- Overwriting `shipDate` only (no override field): rejected — `prepareRow` would
  clobber it at create time, so the chosen date would not be used for the label.
- Applying to all items including created ones: rejected — created labels are
  already purchased with a fixed date; changing the stored value would
  misrepresent what shipped.

## Consequences

- `prepareRow`, `createLabelForRecord`, and `refreshBatchItems` must thread the
  override through so it is honored and preserved.
- The picker only affects not-yet-created items; this is surfaced via tooltip.
