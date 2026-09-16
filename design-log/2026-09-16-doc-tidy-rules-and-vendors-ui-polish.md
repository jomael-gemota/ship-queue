# Doc Tidy — Extraction Rules and Vendors UI polish

**Date:** 2026-09-16
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Doc Tidy document type and rule UI](./2026-09-11-doc-tidy-document-type-and-rule-ui.md).

The Extraction Rules and Vendors tabs are functionally complete, but their
visual presentation is baseline rather than refined. The request is to make
both tabs more intuitive, easier to read and understand, and more professional
and elegant — without changing any data model, API contract, or business logic.

## Decision

### Extraction Rules tab

**Rule list items** receive four visual enhancements:

1. **Left accent stripe** — a 2px `border-l` whose colour switches between
   `--accent-200` (enabled) and `--bg-300` (disabled). This is the fastest
   possible scan of a list of rules: enabled items glow, disabled ones recede.
   No status pill or `opacity-60` is removed; the stripe is additive.

2. **Icon-annotated metadata footer** — the plain run timestamp / creator
   string becomes a row of `inline-flex` spans each prefixed by a small SVG
   icon (clock for last-run, person for creator, warning-triangle for last-run
   error). Icons give the eye an anchor before it reads the text, and separate
   the three pieces of information from one another so they can be scanned
   independently. The error span stays rose-coloured.

3. **Divider between the toggle and the action buttons** — a 1px vertical rule
   `h-5 w-px bg-[var(--bg-300)]` inserted between the `ToggleSwitch` and the
   `Run` button. This makes two conceptual groups explicit (status control vs.
   execution controls) and stops the row from looking like five equal peers.

4. **Run button hover refinement** — adds `transition-colors` and a faint
   `hover:border-[var(--accent-200)]/30` so the button's border shifts toward
   the accent colour on hover, reinforcing that it is the primary per-row
   action.

### Vendors tab

The vendors page is redesigned more extensively:

**Register-a-vendor card** gains a proper header strip with an icon, a title,
and a one-sentence explanation of what a vendor does (the existing comment in
the component file, surfaced to the UI). The three inline inputs become a
labelled, two-column grid with an inline-label sub-text explanation of the
optional SKU field, followed by a helper sentence beneath the form. The `Save`
button label is changed to `Save vendor` so the action is unambiguous.

**Vendor list header** shows a `Known vendors` heading alongside two
summary stats (vendor count, total corrections learned) so the user can
understand the scope of what the agent has been taught at a glance. The
corrections stat is colour-reactive: it is plain text when zero, emerald when
positive.

**Vendor list items** gain a coloured avatar circle with the vendor's initial,
using the existing `avatarColour` deterministic palette from `docTidyUi.tsx`.
The correction count moves from a small badge to a pill that is emerald
(`${n} corrections taught to agent`) when positive and muted (`No corrections
yet`) when zero — the phrasing is contextually meaningful rather than a raw
number. The SKU samples section gets a labelled section header (`SKU format
samples`) in caps-tracked style, matching the convention in other parts of
the app. The sample-remove button becomes an SVG × instead of a text ✕ for
visual consistency, and gains `transition-opacity` for feedback.

**Delete confirmation modal** receives a structured header strip (icon + title)
and a footer strip for the buttons, matching the style of other confirm dialogs
in the codebase. `Delete` becomes `Delete vendor` for clarity.

**Empty state** gains a centred icon tile and a more actionable caption.

## Alternatives Considered

- **Switching to a card grid for vendors.** Cards with more whitespace look
  premium but reduce information density and force the user to scan a 2D
  layout for a list that is inherently one-dimensional (ordered by name).
  Staying with a list but adding avatar + stats achieves the same premium feel
  without the density regression.
- **A progress bar or chart for corrections learned.** An absolute count is
  clear enough; a bar would imply a target or a maximum that doesn't exist.
- **Coloured left stripe on vendors too.** Vendors have no enabled/disabled
  state, so a stripe has no semantic meaning. A coloured avatar serves the
  same "quick scan" purpose.

## Consequences

- No API changes.
- No new dependencies — `avatarColour` is already exported from `docTidyUi.tsx`.
- The `DocTidyVendors` import list gains `avatarColour`.
- Visual changes only; all existing functionality, state, and event handlers
  are preserved verbatim.
