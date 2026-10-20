# Invoice Audit — Discount Badge on Item Cost & Effective Cost for COGS

**Date:** 2026-09-26
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit table displays an **Item Cost** column pulled from the matched
invoice's line items. Some invoices carry a discount — either as an explicit
discounted/net price field, a percentage, or both. Previously:

- The `itemCost` cell always showed the raw (original) unit price.
- The COGS discrepancy check compared `dcCogs` against that raw price.
- Discounts only appeared in the separate `discountedCostPct` column.

This meant that when a vendor applied a discount, the discrepancy checker would
flag a mismatch even though the actual amount paid matched the DC COGS exactly.

Additionally, the Hermes AI system prompt lacked explicit guidance for
invoice-specific fields (discounts, net prices), making discount detection
unreliable.

## Decision

### 1 — Hermes system prompt (tidy_agent.py)

Add an **Invoice fields** section to `SYSTEM_PROMPT` that explicitly instructs
the AI to:
- Extract both the original list/unit price **and** any discounted/net price.
- Detect implicit discounts from price column pairs (e.g. "List Price" vs. "Net
  Price" / "Your Price").
- Compute `discount_percent` from the two prices when not already printed.
- Always populate `unit_price` with the *original* price and `discounted_price`
  with the *after-discount* price so downstream logic has both values.

### 2 — Effective cost helper (DocTidyInvoiceAudit.tsx)

Add `resolveEffectiveCost(inv)` that picks:
1. `discountedPrice` (explicit post-discount price on the invoice)
2. `itemCost × (1 − discountPct/100)` (computed when only % is present)
3. `itemCost` (no discount signal)

### 3 — Item Cost cell rendering

When a discount is detected, the **Item Cost** cell shows:
- The **effective (discounted) cost** as the primary value.
- A small amber **"% OFF"** badge rendered via the existing `Tooltip` component.
- Hovering the badge reveals a tooltip: `"Original: <original price>"`.

### 4 — Discrepancy / COGS comparison

Both `discrepancyCell` and `auditColStr` (used for Excel export) now use
`resolveEffectiveCost(inv)` for the COGS comparison so the discrepancy check
reflects the actual amount billed.

## Alternatives Considered

- **Always show original cost, add a separate "effective cost" column** — rejected
  as cluttering; the discounted price IS the cost for COGS purposes.
- **Only change discrepancy, leave cell unchanged** — rejected; users need a
  visual cue that the displayed price is post-discount.
- **Compute effective cost server-side in the match cache** — deferred; frontend
  computation is sufficient and avoids a schema migration.

## Consequences

- Existing rows with discount data will immediately reflect the new cell
  rendering on the next page load — no re-parse required.
- COGS validation will stop flagging false mismatches for discounted invoices.
- Hermes re-parses will produce richer discount fields going forward.
- The `discountedCostPct` column (dedicated discount column) is unchanged —
  it still shows the discounted price + % for reference.
