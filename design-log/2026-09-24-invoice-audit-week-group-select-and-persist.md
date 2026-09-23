# Invoice Audit — Week Group Select-All & Persistent Collapse State

**Date:** 2026-09-24
**Status:** accepted
**Author:** collaborative

## Context

Extends [2026-09-24 week grouping](./2026-09-24-invoice-audit-week-grouping-description-hidden.md).

Two usability gaps were identified after the initial week-grouping ship:

1. Users want to select **all rows inside a specific week in one click** rather
   than ticking each row individually or using the page-level select-all.
2. The collapsed/expanded state of each week group was reset on every page load
   / navigation, forcing users to re-collapse groups they don't care about.

## Decision

### 1. Group-level select-all checkbox

A checkbox is placed at the **left side of each week group header row**,
inside the first (checkbox) column.

- **Checked** — all row-keys in the group are present in `selectedRowKeys`.
- **Indeterminate** — some (but not all) row-keys are selected.
- **Unchecked** — no row-keys in the group are selected.
- Clicking the checkbox selects all group rows when not fully selected, or
  deselects them all when already fully selected.
- The checkbox click uses `e.stopPropagation()` so it does not trigger the
  collapse/expand toggle on the header row.
- The indeterminate state is set via a function ref
  (`ref={(el) => { if (el) el.indeterminate = ... }}`), which is the standard
  approach for dynamic list items where a React state ref would be over-engineered.

### 2. Persistent collapse state via localStorage

- Two helpers added to `docTidy.ts`:
  - `loadCollapsedWeeks(): Set<string>` — reads `docTidy.invoiceAudit.collapsedWeeks`
    from `localStorage`, falling back to an empty set on error.
  - `saveCollapsedWeeks(keys: Set<string>): void` — serialises the set as a
    JSON array.
- The `collapsedWeeks` React state is **lazily initialised** from
  `loadCollapsedWeeks` so it is populated synchronously on first render.
- A `useEffect` saves to `localStorage` whenever `collapsedWeeks` changes,
  debounce is not needed since toggling is infrequent.

## Alternatives Considered

- **Server-side persistence** — unnecessary for a UI preference; `localStorage`
  is sufficient and consistent with how column visibility is stored.
- **React context / global state** — over-engineered for a page-scoped feature.
- **Controlled ref for indeterminate** — would require a `Map<weekKey, RefObject>`
  which adds bookkeeping; function refs are simpler for dynamic lists.

## Consequences

- If a user collapses `"Week of Sep 21 – 27, 2026"`, that group stays collapsed
  across refreshes and tab switches until they explicitly expand it.
- Collapse state is workspace-agnostic (keyed only by week ISO string). This is
  acceptable: the same week key across workspaces collapsing together is harmless
  and avoids a more complex namespaced key scheme.
