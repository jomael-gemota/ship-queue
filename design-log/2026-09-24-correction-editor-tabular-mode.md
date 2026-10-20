# Correction Editor — Tabular Input Mode

**Date:** 2026-09-24
**Status:** accepted
**Author:** collaborative

## Context

Follows [Vendor learned corrections visibility](./2026-09-17-doc-tidy-vendor-learned-corrections-visibility.md).

The current `CorrectionEditor` renders a raw JSON textarea populated with the
agent's full `jsonOutput`. Users must hand-edit the JSON to record what was wrong,
which is error-prone for non-technical users and obscures the structure that
matters — the line-item rows in the table the agent produced.

The agent already emits a second pass as `tableOutput` (an `AgentTable[]` with
`title`, `columns`, and `rows`). `DocTidyCorrection` already has `correctedTables`
(Mixed on the model, `AgentTable[]` in the frontend type) and `mode: 'json' | 'tabular'`
— the data layer is fully ready. The backend controller validates both fields and
already stores them. Nothing in the worker's `corrections.py` is changed: it
retrieves on `correctedOutput`, which tabular corrections populate as
`{ tables: correctedTables }` — a canonical, diffable JSON object.

## Decision

Add a **Table** mode to `CorrectionEditor` alongside the existing **JSON** mode.

### Mode toggle

Shown only when `tableOutput?.tables` has at least one entry. A small segmented
control (JSON | Table) sits above the editor body. The note field (shared across
both modes) is preserved when the user switches tabs, so a note typed in JSON
mode is not lost when they switch to Table.

### Tabular editor (`TabularCorrectionEditor`)

- Renders each `AgentTable` from `tableOutput` as an editable grid.
- All cells are `<input>` elements styled to look like table cells; they are
  always editable (no click-to-activate state machine).
- Column headers are read-only (structure comes from the agent; reordering or
  renaming columns is out of scope).
- Each row has a **×** delete button (visible on row hover).
- Each table has a **+ Add row** button that appends a blank row.
- Cell values are stored as strings internally; `parseCell` converts back to
  `number | string | null` when building the `AgentTable` for submission.
- A "changes" bar below the tables shows a summary: _N cells changed · N rows
  added · N rows removed_. The save button stays disabled until at least one
  change is detected.

### API submission (tabular mode)

```
POST /doc-tidy/parse-jobs/:id/corrections
{
  correctedOutput: { tables: [...correctedTables] },   // JSON object for retrieval
  correctedTables: [...],                               // AgentTable[] for rendering
  mode: "tabular",
  note: "...",
}
```

`correctedOutput` is set to `{ tables: correctedTables }` so the backend's
duplicate check (which canonicalises `correctedOutput` + `note`) works correctly —
two tabular corrections with the same table data and same note are correctly
identified as duplicates. Embedding is computed over the document text sample as
usual; the worker retrieval loop is unaffected.

### Correction history rendering

`CorrectionHistory` inspects `correction.mode`:
- `'tabular'` with `correctedTables`: renders a compact read-only table grid
  (`TabularCorrectionView`) instead of the JSON `CorrectionDiff`.
- Everything else: existing `CorrectionDiff` (unchanged).

### Props change to `CorrectionEditor`

`tableOutput?: TableOutput | null` is added. `ParseJobPanel` forwards the
resolved `table` value it already holds.

## Alternatives Considered

- **Editable columns (add/rename).** Would let users fix structural extraction
  errors (wrong column name), but mapping renamed columns back to the JSON output
  is ambiguous. Deferred.
- **Cell-level diff in history.** Show exactly which cells changed between
  `originalOutput` and `correctedTables`. Adds complexity (table-to-table
  alignment is non-trivial when row counts differ). Deferred; the corrected
  table alone is actionable in history.
- **Separate `TabularCorrectionEditor` file.** All correction UI lives in one
  file today (`CorrectionEditor.tsx`); splitting is mechanical and adds a new
  import for only one extra component. Kept in one file.
- **Auto-switch to Table mode.** If `tableOutput` exists, default to Table mode
  instead of JSON. Rejected: JSON mode is the existing behaviour; users who know
  it should not be surprised by a default change.

## Consequences

- No backend changes. All new fields are already accepted and stored.
- No worker changes. The `correctedOutput` shape for tabular corrections
  (`{ tables: [...] }`) is uncommon in the training set, but the note is what
  actually teaches the agent; the output is used for retrieval similarity only.
- `ParseJobPanel` passes `tableOutput` to `CorrectionEditor` — a one-line addition.
- The tabular editor resets on `originalTables` change (same guard the JSON
  editor uses on `original`), so re-running a job does not leave stale edits.
