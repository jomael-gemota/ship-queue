# Customer PO Number / Customer Reference as PO Number

**Date:** 2026-10-21
**Status:** accepted
**Author:** collaborative

## Context

Many vendor invoices never print a field literally labelled "PO Number". The
buyer's purchase order appears instead as "Customer PO Number", "Customer PO #",
"Cust PO", "Customer Reference", "Your Reference", and similar. Tidy extracted
these under whatever key matched the label (`customerReference`,
`customer_po_number`, …), and every downstream PO lookup only recognised
`po_number` / `purchase_order_number` / `po_no` / `po` / `purchase_order` /
`order_number` / `order_no`. Those invoices therefore never matched their order
imports in the Invoice Audit, in any workspace.

The PO key list was also duplicated in four places (one backend, three
frontend), and the Tidy system prompt said nothing specific about PO numbers.

## Decision

Treat Customer PO Number / Customer Reference as the PO Number everywhere, at
three layers:

1. **Tidy prompt** (`worker/tidy_agent.py`): a "PO number (CRITICAL)" section
   instructs the agent to always emit a top-level `poNumber`, lists the label
   variants that count as the PO, prefers an explicit PO label over a customer
   reference when both differ, and warns against confusing it with the vendor's
   invoice / sales order / packing slip numbers or a "P.O. Box".
2. **Worker safety net** (`worker/po_number.py`): after JSON extraction, if
   `poNumber` is missing or empty it is filled deterministically from an alias
   key in the JSON (top level first, then nested objects), and failing that
   from a same-line `label: value` match in the raw PDF text. A value the model
   emitted is never overwritten. This makes detection independent of how well a
   given model follows the prompt.
3. **Downstream lookup**: a single shared candidate list — `PO_NUMBER_KEYS` in
   `src/services/invoiceMatchCache.service.ts` and `PO_NUMBER_FIELD_KEYS` in
   `frontend/src/types/docTidy.ts` (kept identical) — adds the customer PO /
   customer reference aliases ahead of the generic `order_number` / `order_no`.
   All four lookups use it. JSON key normalisation now strips every
   non-alphanumeric character (previously only `_`, `-` and spaces), so labels
   like `Customer PO #` or `P.O. Number` also match. This also covers invoices
   parsed before this change, without re-parsing.

Priority order for lookup: `poNumber`/`po_number`, `purchase_order_number`,
`po_no`, `po`, customer PO variants, customer reference variants,
`purchase_order`, `order_number`, `order_no`.

## Alternatives Considered

- **Prompt-only change** — cheapest, but a model miss still breaks matching and
  existing parsed jobs stay unmatched.
- **Rewrite stored `jsonOutput` with a migration** — mutates the agent's
  original output and the corrections built on it; widening the read-side
  lookup achieves the same matching without touching stored data.
- **Per-workspace alias configuration** — unnecessary; the user wants the rule
  applied to all workspaces.

## Consequences

- Existing invoices whose PO was stored under a customer PO / reference key
  start matching after a Resync (which rebuilds the match cache) — no re-parse
  needed. New parses carry a canonical `poNumber`.
- A "Customer Reference" that is not actually a PO (rare) will now be used as
  the PO. Matching still requires the value to equal an order import's PO, so a
  false positive only matters if the values collide.
- Normalising keys more aggressively applies to every extracted field, not only
  the PO; it only makes previously non-matching punctuated keys match.
- The two key lists and the two normalisers must stay identical (comments say
  so at both sites).
