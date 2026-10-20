# Invoice Audit — Row-Level (Line Item) Selection

**Date:** 2026-09-22
**Status:** accepted
**Author:** collaborative

## Context

[2026-09-18 inline line items](./2026-09-18-invoice-audit-inline-line-items.md) introduced a
flattened row model where each parse job expands into one row per line item.
The original selection model operated at the **job level**: the checkbox was
only rendered on the first line-item row (`itemIdx === 0`), and toggling it
selected or deselected the entire document (all its line items together).

This created confusion when a PDF contained multiple SKUs — only the first row
displayed a checkbox, making the second (and subsequent) rows look unselectable.
The user reported this as unexpected and asked for each row to be independently
selectable.

## Decision

Switch the selection model from **job-level** to **row-level**.

* **State** — `selectedJobIds: Set<string>` replaced by
  `selectedRowKeys: Set<string>`, keyed as `${job._id}-${itemIdx}`.
* **Checkbox** — rendered on every row; the `itemIdx === 0` guard is removed.
* **Select-all header** — `pageRowKeys` replaces `pageJobIds`; it enumerates
  all `${job._id}-${itemIdx}` keys for every line-item row currently on screen
  (documents with no line items contribute a single `…-0` key).
* **Export (selection mode)** — iterates jobs with an index and skips
  individual line items whose `rowKey` is not in `selectedRowKeys`, so a user
  can export two out of five line items from the same invoice.
* **Export (all mode)** — unchanged; still exports every line item.
* **Count pill / button label** — now reflects the number of selected rows,
  which matches the number of lines that will be exported.

## Alternatives Considered

- **Keep job-level selection, add a visual "continuation" indicator** — a dimmed
  border or connector glyph would show that row 2 belongs to the same document.
  Rejected: the user explicitly asked for independent row selection.
- **Hybrid — job-level checkbox + per-row override** — too complex for the
  marginal use case; row-level alone covers both scenarios.

## Consequences

- Selecting all line items of a multi-SKU invoice now requires ticking each
  row individually (or using "Select all" in the header, which covers the whole
  page). This is a minor regression for whole-document selection but matches
  user expectation.
- Export `selection` mode now outputs exactly the rows checked, even if only a
  subset of line items from a given document are selected.
- The "N selected" count in the toolbar and pagination bar now counts rows, not
  documents, which is the more useful number when exporting line-item data.
