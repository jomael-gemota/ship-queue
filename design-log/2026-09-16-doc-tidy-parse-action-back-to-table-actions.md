# Doc Tidy — Parse action moves back to the table's Actions column

**Date:** 2026-09-16
**Status:** accepted
**Author:** collaborative

## Context

[Doc Tidy — denser messages table, row selection, detail
drawer](./2026-09-15-doc-tidy-messages-table-density-and-detail-drawer.md)
moved the Attachments column into a row of icon-only `AttachmentIcons` in
the Actions column, and moved the Parse action and status chip into the new
`MessageDetailDrawer`, reachable via a View (eye) button. Its own
Alternatives Considered section noted this only because "the request was
specifically for icon-only" — not because parsing belonged behind a drawer.

In practice, starting a parse is one of the most common things to do with a
row, and pushing it two clicks away (open the drawer, then find the
attachment) made the table's own action row — icons for attachments plus a
View button — feel incomplete. This entry reverses that one part of the
previous decision while keeping everything else about the denser table.

## Decision

**Parse moves from the drawer into the Actions column, next to each
attachment's icon.** `AttachmentIcons` (previously a read-only row of
`PdfIcon`s) now also renders, per parseable attachment:

- **No job yet:** a `TableActionButton` with a new `BoltIcon` (added to
  `docTidyUi.tsx`), which starts the parse and opens the reasoning panel on
  its own job once created — the same behaviour `AttachmentCell`'s Parse
  button had.
- **A job exists:** a status glyph instead of the bolt — `Spinner` while
  running, `SuccessIcon` once completed, `ErrorIcon` once failed (all
  existing icons, reused from `labelUi.tsx`) — clicking it opens the
  reasoning panel, exactly as the old status chip did.

This keeps the per-attachment granularity `AttachmentCell`'s docstring
called out originally: a message can carry several PDFs, each its own
document with its own extraction, so the action (and its status) has to
live on the attachment, not the row.

**The drawer's `AttachmentCell` becomes read-only.** It still shows
filename, size, upload errors, and — if a job exists — the status chip
(click to open the reasoning panel), but no longer offers a way to *start*
one. Its `onChanged` prop is gone (nothing in the drawer starts a mutation
that needs a refetch any more), and prop drilling for it is removed from
`MessageDetailDrawer` and `DocTidy.tsx`. `PARSEABLE` is now exported from
`AttachmentCell.tsx` as the shared source of truth for "can this filename be
parsed", since both it and `AttachmentIcons` need it.

**Action icons in the table are a bit bigger.** `TableActionButton` grew
from a 24px box to 28px; the `EyeIcon` and the new parse/status glyphs
inside it are 20px (up from 16px). `AttachmentIcons`' `PdfIcon` grew from
20px to 24px to match. This was a direct ask, but it also gives the busier
Actions column (now up to two icons per attachment, plus View) a little
more room to stay tappable.

## Alternatives Considered

- **One Parse button per row** (parse every attachment at once). Rejected —
  attachments are independent documents that can fail or succeed
  separately; a single button would need to represent a mix of states
  (one done, one failed, one not started) that a single icon can't honestly
  show.
- **Keep the drawer's Parse button too, as a second entry point.** Rejected
  — two places to start the same action invites them to drift (e.g., one
  updating local state the other doesn't watch), and the row is strictly
  closer to what the user is already looking at.
- **A dot/badge overlaid on the `PdfIcon` instead of a separate button.**
  Considered for a quieter look, but the user asked for a Parse *button*
  with its own icon, and a separate control is also the only way to keep
  "open the file" and "start parsing" as two independently clickable
  targets on the same attachment.

## Consequences

- The Actions column can now show up to two icons per attachment (open +
  parse/status) plus the View button, so a message with several attachments
  produces a noticeably busier cell than before. Worth revisiting if a
  message with many attachments becomes common.
- `AttachmentCell` and `AttachmentIcons` both know about `PARSEABLE` and the
  parse-status-to-icon mapping; if a third parse surface appears, that
  mapping should move into a shared helper instead of a third copy.
