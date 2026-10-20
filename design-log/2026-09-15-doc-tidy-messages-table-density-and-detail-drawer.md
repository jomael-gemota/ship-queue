# Doc Tidy — denser messages table, row selection, detail drawer

**Date:** 2026-09-15
**Status:** accepted
**Author:** collaborative

## Context

[Doc Tidy table and filename revisions](./2026-09-11-doc-tidy-table-and-filename-revisions.md)
already anticipated this: "the request was explicitly for a compact table, and
`/messages/:id` already returns the full body for a future detail view."

The Extracted Messages table had grown one more axis of detail than a results
table needs on first glance: **Received** showed a full timestamp, and
**Attachments** rendered each file as a truncated filename link plus its byte
size plus (once parsed) a status chip or Parse button — three or four pieces
of text per attachment, in a column that can hold several attachments per
row.

## Decision

**Received shows the date only; the time is a hover tooltip.** Added
`formatDate` alongside the existing `formatDateTime` in `lib/format.ts`. The
cell keeps `formatDateTime` in its `title`, matching the `title`-for-detail
convention already used throughout this table (subject, sender, rule chips).

**The Attachments column is gone; its files render as a bare `PdfIcon` each,
inside the Actions column.** The icon reuses the glyph already defined for
label PDFs in `components/labels/labelUi.tsx` rather than adding a second one.
The filename moves to `title`; clicking still opens `webViewLink` exactly as
the old link did. A new `AttachmentIcons` component holds this compact view —
it takes no `onOpenJob`/`onChanged`, because it carries no parse actions, and
renders `null` (not a "—" placeholder) for a message with no attachments,
since a dash sitting in a row of buttons reads as a disabled one.

Dropping the column is what makes the icons work: as its own column it had to
reserve width for the widest row on the page, while a row of glyphs next to
the view button costs nothing when a message has one attachment or none.

**Parse status and the Parse action move behind a detail view, not removed.**
The existing `AttachmentCell` (full filename, size, upload errors, parse
status chip, Parse button) is untouched and now used exclusively inside a new
`MessageDetailDrawer`.

**A right-side drawer, opened by a new Actions column's view (eye) icon,
shows the rest of the row:** sender/recipients in full, document type, rule,
the full `AttachmentCell`, and the message body (`bodyText`, falling back to
`snippet`). The drawer starts from the row's already-loaded `DocTidyMessage`
(so it opens instantly with attachments and parse jobs already in hand) and
fetches `/doc-tidy/messages/:id` in the background to fill in `bodyText`,
which the list endpoint never sends. `parseJobs` from the fetch response is
discarded in favor of the row's copy, since the detail endpoint doesn't join
them.

The drawer follows the same modal conventions as `ParseJobPanel` (Escape to
close, backdrop click to close, `body` overflow locked while open), but is
positioned and animated as a right-side panel (`translate-x-full` →
`translate-x-0` on mount) instead of a centered dialog, since "open a drawer
at the right side" was explicit.

**The whole table drops to 11px.** The `<table>` element's base size changed
from `text-[13px]` to `text-[11px]`; the few cells with an explicit
`text-xs` (12px) override — the rule badge and its "—" fallback, the loading
and empty-state rows — were changed to `text-[11px]` so they don't sit a size
above everything else that was already inheriting the table's base size.

**A new `TableActionButton`** (in `docTidyUi.tsx`) is a plain 24px icon
button for the Actions column, distinct from the existing 32px bordered
`IconButton` used for the rules list's edit/delete actions — that button's
border would have made this already-dense table's rows taller for no reason.

**Every text in the table body is regular weight.** `font-medium` came off the
sender and subject cells, off the rule chip, and out of `DocumentTypeBadge`.
At 11px, medium weight on near-black text read as bold and gave the sender and
subject a prominence they had not earned next to the date.

The badge change is deliberately made in the shared component rather than at
this one call site: the two chips sit side by side in a row, so they have to
match, and `className`-based overriding does not work here — Tailwind emits
`font-normal` before `font-medium`, so the passed-in class loses. The badge is
also used on the rules list and in the rule editor's preview, which therefore
lighten too; the badges carry their emphasis with colour and a ring, not
weight, so nothing is lost. Header cells keep `font-semibold`, since a
uppercased 11px header is doing a different job than a data cell.

**A checkbox column leads the row, for multi-select.** `Th` grew an optional
`children` (and `className`), so the column headed by the select-all control
reuses the same sticky/border styling as the named columns instead of a
hand-rolled `<th>`. `Th`'s `label` is now optional; the component is only used
by this table, so nothing else had to change.

Selection is a `Set` of message ids, not of rows: this table refetches on a
live import and on every filter change, and ids survive that where row objects
would go stale. Select-all covers the current page only — that is all the
header checkbox can honestly represent — and the header gets `indeterminate`
set through a ref, since it is a DOM property with no React attribute. The
selection survives paging but is dropped whenever a filter changes, because
rows the user can no longer see should not stay checked. A "N selected" chip
with a Clear button in the pagination bar keeps the count visible once the
checked rows scroll out of view.

## Alternatives Considered

- **Keep filename + size in the Attachments cell, just smaller.** Rejected —
  the request was specifically for icon-only with the name on hover, and a
  row with three attachments would still wrap or overflow at any font size.
- **Drop the parse status chip and Parse button entirely** now that
  Attachments is icon-only. Rejected — parsing is core functionality; it
  moves to the drawer instead of disappearing.
- **Reuse `IconButton` for the view action** by giving it a `size` prop.
  Considered, but `IconButton` renders one `<path>` and the `EyeIcon` needs
  two; a separate small button was simpler than reshaping `IconButton`'s
  props for one caller.
- **Fetch the full message only when the drawer opens, showing a spinner
  first.** Rejected — the row already has everything except `bodyText`, so
  showing it immediately and back-filling the body is strictly better than a
  loading state for data already in memory.
- **Tint selected rows.** Deliberately not done, on the evidence of
  [the striping post-mortem](./2026-09-11-doc-tidy-table-and-filename-revisions.md):
  every tint close enough to be subtle at `--primary-100` swallows the rule
  chip, which is that exact colour, and `border-separate` rules out a ring or
  left border on `<tr>`. The checkbox and the "N selected" count carry the
  state instead.
- **Keep the selection across filter changes.** Rejected — a count that
  includes invisible rows is a footgun for whatever bulk action lands next.

## Consequences

- Nothing consumes the selection yet; it is scaffolding for a bulk action
  (re-parse, export, delete) that has not been designed. Until one exists the
  checkboxes are inert beyond the count.
- The table no longer surfaces upload failures or parse status at a glance; a
  row with a failed upload or a running parse now needs the drawer to see it.
  Worth revisiting with a small indicator dot on the PDF icon itself if this
  proves too quiet in practice.
- `AttachmentCell` is now only reachable through the drawer — dead as a
  direct table cell, kept as the detail view's attachment list.
- `formatDate` and `formatDateTime` now both live in `lib/format.ts`; call
  sites choose based on whether hover detail is wanted.
- `DocumentTypeBadge` is now regular weight everywhere it appears, including
  the rules list and rule editor.
