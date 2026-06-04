# Table & Card UI Enhancements

**Date:** 2026-06-05
**Status:** accepted
**Author:** collaborative

## Context

Polish pass across three surfaces of the label/order UI to improve scannability
and affordances, while staying within the existing CSS-variable theme (light +
dark) and avoiding gradient fills.

Affected files:
- `frontend/src/pages/CreateShippingLabel.tsx` (Label Batches table + Import & Draft card)
- `frontend/src/components/labels/labelUi.tsx` (shared icons + buttons)
- `frontend/src/pages/Orders.tsx` (ShipStation Orders table)

## Decision

### Label Batches table
- **Alternating row colors** — zebra striping using `--bg-100` / `--bg-200` so it
  matches the Orders table convention.
- **Folder icon beside the filename** — a Windows-style folder glyph (`FolderIcon`)
  rendered before `batch.fileName`.
- **Disabled delete affordance** — the delete icon is always rendered; when the
  current user is not the batch owner it is shown disabled (greyed, not clickable)
  instead of hidden, so the action is discoverable.
- **Layers icon for the batch row** — the per-row batch glyph switches from the
  generic `RowItemIcon` to a stacked `LayersIcon`.
- **Reprint Labels color** — once a batch is created the button reads "Reprint
  Labels"; it now uses a complementing indigo treatment to visually distinguish
  reprint from the green "Create + Print" primary action.

### Import & Draft card
- Background switches from the default surface (`--bg-100`) to the complementing
  `--primary-100` tint (light: soft blue, dark: deep navy). Solid color only — no
  gradients.

### ShipStation Orders table
- **Amazon icon beside Order #** — the official Amazon brand mark (orange smile),
  marking each order's source.
- **Person icon for Customer cells** — a user glyph precedes the customer name.
- **Full-row click to expand** — clicking anywhere in an order row toggles the
  nested items table; the dedicated chevron remains and stops propagation to avoid
  a double toggle.

## Alternatives Considered

- Using `--bg-200` as the Import & Draft card background (too close to the table
  header); `--primary-100` reads as an intentional, complementing accent.
- Keeping the delete button hidden for non-owners (less discoverable than a
  disabled control).

## Consequences

- New shared icon components (`FolderIcon`, `LayersIcon`, `AmazonIcon`,
  `CustomerIcon`) added to `labelUi.tsx` / inline in `Orders.tsx`.
- `DeleteBatchButton` gains a `disabled`/`title` prop so callers can render it
  disabled rather than conditionally hiding it.
- `CreatePrintButton` applies a different color scheme in its `done` (reprint)
  state.
