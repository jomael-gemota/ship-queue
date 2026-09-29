# Doc Tidy — Faithful diffs for table-view corrections

**Date:** 2026-09-30
**Status:** accepted
**Author:** collaborative

## Context

Follows [Correction editor tabular mode](./2026-09-24-correction-editor-tabular-mode.md)
and [Surfacing what the agent learned per vendor](./2026-09-17-doc-tidy-vendor-learned-corrections-visibility.md).

A user in the Gill workspace (Accounts Payable) corrected invoice INV-32308
twice from the table view: the Invoice Summary label "Customer Reference" became
"PO Number", and the Totals label "Total Due" became "Total Costs". Both
corrections were stored correctly — `correctedTables` holds the new labels and
the re-run job already emits `poNumber` and `totals.totalCosts`. The Vendors tab,
however, showed the same unrelated line for both:

> Additional Charges · Description (row 1) · Junior Pursuit Full Arm Wetsuit … → Shipping - Use my own shipping account

`diffTabularCorrection` had no original *tables* to compare against, only the
agent's JSON, and reconstructed a baseline with two flawed assumptions:

1. **Every multi-row table is the line-items array.** The "Additional Charges"
   table was compared row-by-row against `lineItems`, producing a phantom diff
   on every correction for any document with additional charges.
2. **Columns map to JSON keys.** Key/value tables (`Field` | `Value`) have no
   JSON key named "Field", so they were skipped entirely — which is exactly
   where label corrections happen.

## Decision

### 1 — Store the original tables with the correction

`createJobCorrection` saves `originalTables` (the job's `tableOutput.tables` at
correction time) alongside `correctedTables`. The job's own `tableOutput` is not
a usable baseline later: a re-run overwrites it, and here it already reflects
the correction.

### 2 — Table-to-table diff (`frontend/src/lib/tableCorrectionDiff.ts`)

Both sides are reduced to *sections*:

- **Key/value section** — a two-column table whose first column is a label
  (`Field`, `Label`, `Key`, `Name`, `Attribute`). Rows are matched by normalised
  label, not position. An unmatched removed label and an unmatched added label
  with the same value are merged into a **rename**
  (`Totals · Total Due → Total Costs`).
- **Grid section** — any other table. Rows compared by index, cells by column
  name; extra rows on either side are reported as added/removed.

Sections pair by normalised title (`Additional Charges` ↔ `additionalCharges`).

### 3 — Legacy fallback from JSON

Corrections saved before this change have no `originalTables`. Their baseline
is derived from `originalOutput`: arrays of objects become grid sections,
objects of scalars become key/value sections, top-level scalars form a root
key/value section that any unmatched key/value table falls back to. Because the
agent's JSON and tables are not guaranteed to hold the same fields, the legacy
path reports only value changes and renames — never bare additions or removals,
which would be noise from that mismatch. Grid tables whose title matches no JSON
array are skipped rather than guessed.

## Alternatives Considered

- **Backfill `originalTables` from the parse job.** Rejected: re-runs overwrite
  `tableOutput`, so the backfilled baseline would be the post-correction output
  and every legacy diff would read "no changes".
- **Positional cell diff only.** Simple, but a row removed mid-table would shift
  every following row into a false change, and it can't express a label rename.

## Consequences

- No worker change: retrieval reads `correctedOutput`, which is unchanged.
- New corrections get an exact diff; legacy ones get a best-effort one that is
  correct for the common cases (label renames, value edits) and silent rather
  than wrong otherwise.
- `originalTables` adds one copy of the table payload per tabular correction.
