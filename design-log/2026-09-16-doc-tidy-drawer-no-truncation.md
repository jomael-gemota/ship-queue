# Doc Tidy — detail drawer stops truncating, gets a metadata header

**Date:** 2026-09-16
**Status:** accepted
**Author:** collaborative

## Context

[Doc Tidy — denser messages table, row selection, detail
drawer](./2026-09-15-doc-tidy-messages-table-density-and-detail-drawer.md)
introduced `MessageDetailDrawer` as the "everything" view for a message,
explicitly to hold the detail the dense table couldn't. It reused `truncate`
+ `title` in several places (subject, From, To) and a fixed-width
`max-w-[200px]` on attachment filenames — patterns that make sense in a
table cell fighting for column width, but work against a drawer whose whole
purpose is to show detail the table cut off. A long subject had no `title`
at all (so it couldn't even be read on hover), and a To line with more than
one or two recipients truncated hard.

## Decision

**Every field in the drawer wraps instead of truncating.** `truncate` is
gone from the subject heading, the From/To `dd`s, and attachment filenames
in `AttachmentCell`; each now uses `break-words` or `break-all` (for
addresses and filenames, which have no natural break points) so the drawer
grows instead of hiding content.

**From/To move out of the two-column `dl` grid into stacked label-over-value
rows.** The old `grid-cols-[88px_1fr]` layout is exactly what forced
truncation in the first place — an address only has the remaining column
width to wrap into. Stacking the label above the value gives both the full
width of the drawer.

**To renders each recipient as its own pill**, not one comma-joined string,
so wrapping happens between addresses instead of mid-address, and a message
with many recipients reads as a list rather than a wall of text.

**Date, document type, and rule move into a metadata line under the
subject**, replacing the old separate `dl` rows for them. All three are
short, self-describing (the badge carries its own icon and label, the rule
is a recognisable pill matching the table's), and sit naturally as a single
wrapping row — mirroring how the same three pieces of data already sit
together in the table row.

**Attachments render as individual bordered rows, not a plain list.** Each
row is `flex-wrap`, so on a narrow drawer the size/status can drop to their
own line under a long filename instead of squeezing it. Upload errors get
their own full-width line (`w-full`) with the actual error text inline,
rather than a static "upload failed" label that needed a hover to explain
anything.

**The Message section calls out when it's showing a preview.** If
`bodyText` hasn't arrived (or the source message never had one) and only
`snippet` is available, a small "Preview only — full body unavailable" note
appears next to the section heading, so the drawer doesn't quietly pass off
a truncated Gmail snippet as the whole message. An explicit "No message
content." placeholder replaces silently rendering nothing when there's
neither.

**The drawer is wider:** `max-w-md` (28rem) → `max-w-lg` (32rem), giving all
of the above more room before anything has to wrap at all.

## Alternatives Considered

- **Keep `truncate` + `title` everywhere, just widen the drawer.** Rejected
  — no fixed width survives an address or subject long enough, and `title`
  tooltips are undiscoverable and inaccessible on touch; the drawer's whole
  job is to be the place nothing is hidden.
- **Comma-joined `To` text instead of pills.** Considered, since it's less
  markup, but wrapping a long comma-separated string mid-address still reads
  poorly; individual pills wrap cleanly between recipients instead.
- **Leave Document type / Rule in the `dl`.** Rejected once From/To moved
  to stacked rows — with the grid gone, keeping only two fields in it added
  a second layout pattern in the same drawer for no reason.

## Consequences

- The drawer can now grow considerably taller for a message with a long
  body, many recipients, or several attachments; it was already scrollable
  (`overflow-y-auto` on the content area), so this trades a fixed-height
  glance for a fully-readable one.
- `AttachmentCell`'s per-attachment rows are visually heavier (bordered
  cards) than the previous plain list — a deliberate trade for wrapping
  room, consistent with "improve everything" rather than the minimal fix.
