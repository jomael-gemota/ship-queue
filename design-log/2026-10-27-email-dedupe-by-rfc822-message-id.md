# Dedupe captured emails by RFC 822 Message-ID

**Date:** 2026-10-27
**Status:** accepted
**Author:** collaborative

## Context

In the Bearpaw workspace the Emails tab shows each Romeo & Juliette invoice
twice; the only difference between the rows is the TO address
(`accounts_payable@outdoorequipped.com` vs `invoice@outdoorequipped.com`).

The vendor addresses the invoice to both group aliases. Google Groups delivers
one copy per group into the connected mailbox, and each copy gets its own Gmail
message id. `runRule` dedupes only on `gmailMessageId`, so both copies are
imported, both attachments are uploaded to Drive, and both can be sent to the
Tidy Agent — doubling parse cost and producing duplicate parsed invoices.

Both copies carry the same RFC 822 `Message-ID` header, which is assigned by
the sender and identifies the logical email.

## Decision

- `getMessage` reads the `Message-ID` header into `rfc822MessageId`.
- `DocTidyMessage` stores `rfc822MessageId` (indexed) and
  `aliasGmailMessageIds` (indexed): the Gmail ids of extra copies folded into
  the row.
- `runRule`, for a message it has not stored before, looks for a row with the
  same `rfc822MessageId` among messages of rules in the **same workspace**. If
  one exists, the copy's TO addresses are merged into it, its Gmail id is added
  to `aliasGmailMessageIds`, and it is not imported (no Drive upload). The run
  result reports these as `duplicatesMerged`.
- `skipKnown` also treats alias ids as known, so the poller does not re-fetch
  the folded copies every tick.
- Existing duplicates are cleaned up by `scripts/dedupe-doc-tidy-messages.ts`.
  It backfills `rfc822MessageId` from Gmail (metadata-only fetch), groups rows
  by workspace + Message-ID, keeps the row with the most parse progress (then
  the oldest), merges TO addresses and alias ids into it, and deletes the other
  rows along with their parse jobs and Drive files. Dry run by default;
  `--apply` performs the changes.

## Alternatives Considered

- **Heuristic match (from + subject + sentAt):** no Gmail calls needed, but
  legitimately distinct emails (e.g. resends) can collide. Message-ID is exact.
- **Global (cross-workspace) dedupe:** two workspaces with different mailboxes
  may each legitimately want the same email; scoping to the workspace avoids
  one workspace stealing another's row.
- **Unique index on `rfc822MessageId`:** some mail lacks the header, and the
  dedupe is workspace-scoped, so a plain index plus an application check fits.

## Consequences

- One extra indexed lookup per newly imported message.
- Rows captured before this change have no `rfc822MessageId` until the cleanup
  script backfills them; until then a new copy of an old email can still slip
  through.
- The cleanup script deletes rows, parse jobs and Drive files for the losing
  duplicates, so it needs an explicit `--apply` run after reviewing the dry run.
