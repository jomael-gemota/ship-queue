# Doc Tidy — plain-text subject, original Drive filenames, visible striping

**Date:** 2026-09-11
**Status:** accepted
**Author:** collaborative

## Context

Revises two decisions after review of the working feature:

- [Doc Tidy live extraction and compact results table](./2026-09-11-doc-tidy-live-extraction.md)
  kept the Gmail snippet reachable behind a click-to-expand toggle on the subject.
  In use, a clickable subject that only reveals a preview reads as a link to the
  message and invites a click that does not do what it promises.
- [Doc Tidy email extraction](./2026-09-10-doc-tidy-email-extraction.md) uploaded
  attachments to Drive under a derived name,
  `2026-09-10_Acme-Invoice_bill.pdf`, for traceability. That traceability is not
  worth the cost: the files are invoices that people search for and cross-check by
  the sender's own filename, and the prefix breaks that.

Row striping was also reported as invisible.

## Decision

**Subject is plain text.** The toggle, the snippet and the `expanded` state are
removed outright rather than made non-interactive, since nothing else used them.
The full subject remains available in the cell's `title` for rows that truncate.
The snippet is still stored and still searchable — it is only absent from the
table.

**Attachments keep their original filename.** Drive tolerates duplicate names in
a folder, so no uniqueness suffix replaces the removed prefix. Traceability from
a file back to its message is already available through the results table, which
links each attachment to the row it came from.

**Striping uses the palette at full opacity.** The even-row rule was
`bg-[var(--bg-200)]/40`; at 40% over the card's `--bg-100` the two rows differed
by well under 2%, which is why it read as no striping at all. Dropping the
opacity modifier restores the palette's intended step between `--bg-100` and
`--bg-200` — the same step the table header and pagination bars already use.

Hover stays at `--primary-100/60` rather than full opacity, so the rule-name
badge (also `--primary-100`) does not disappear into the row behind it. Verified
in the built CSS that the hover rule still follows the `odd`/`even` rules, so it
continues to win at equal specificity.

## Alternatives Considered

- **Keep the toggle but style the subject as plain text.** Hidden affordances are
  worse than absent ones, and the snippet adds little next to the subject.
- **Move the snippet to an expandable detail row or a hover card.** Defensible,
  but the request was explicitly for a compact table, and `/messages/:id` already
  returns the full body for a future detail view.
- **Prefix filenames only on collision.** Solves a problem Drive does not have.
- **A stronger stripe from outside the palette** (e.g. `slate-100`). More
  contrast, but it introduces a cool grey into a warm surface palette and would
  make this one table inconsistent with the rest of the app.
- **Cell borders instead of striping.** Would in fact fix a latent issue — the
  `divide-y` on `tbody` cannot render, because `border-collapse: separate` (set
  via `border-separate`) ignores borders on `tr`. Left alone since striping now
  carries row separation on its own; worth revisiting if rows still read as
  running together.

## Consequences

- Attachments already uploaded keep their old prefixed names; only new uploads
  use the original filename. No migration is planned.
- Two files arriving with the same name now sit side by side in Drive with
  identical names, distinguishable only by their Drive metadata or through the
  results table.
- The snippet is dead weight in the table's payload, though it is still used by
  search, so it stays on the list endpoint.
