# Doc Tidy — reading a Google Group inbox via member delivery

**Date:** 2026-09-10
**Status:** accepted
**Author:** collaborative

## Context

Revises the mailbox-access decision in
[2026-09-10-doc-tidy-email-extraction.md](./2026-09-10-doc-tidy-email-extraction.md),
which assumed `invoice@outdoorequipped.com` could be connected directly and
flagged the opposite case as the main implementation risk. That risk
materialised.

First live run extracted nothing. A read-only diagnostic
(`scripts/diagnose-doc-tidy.ts`) against the connected account showed why:

- The connected mailbox was `jomael@outdoorequipped.com` — the admin's own
  account, picked up by Google's account chooser during the connect flow — not
  the invoice address.
- That mailbox holds 234,692 messages, so it is healthy and the token works.
- But `to:invoice@outdoorequipped.com` returned **0** hits, as did
  `deliveredto:invoice@outdoorequipped.com` and the rule's sender clause
  `from:CustomerService@proforceequipment.com`.

The rule itself compiled to valid Gmail syntax and each clause was tested in
isolation, so rule logic was not at fault. The mail simply was not in the
connected account.

Confirmed with the developer: `invoice@outdoorequipped.com` is a **Google
Group** (collaborative inbox). A Group is not a mailbox — it has no Gmail
mailbox to authorise and its archive is not exposed by the Gmail API, so no
OAuth connection can ever point at it directly.

## Decision

Read the group's mail from a **real mailbox that receives it as a member**,
then narrow to the group with a new rule criterion.

1. **Mail routing (configuration, not code):** add a real Workspace account to
   the `invoice@` group with **"Each email"** delivery, so every group message
   lands in a mailbox the Gmail API can read. Connect *that* account in
   Settings.

2. **New `toAddresses` rule field ("Delivered to"):** because the connected
   mailbox is now a general-purpose account containing unrelated mail, rules
   must be able to scope to messages that arrived via the group. Without this,
   a rule would hoover up matching mail from anywhere in the account.

   The criterion compiles to an OR group across every header a group message
   can land under:

   ```
   {to:addr cc:addr bcc:addr deliveredto:addr list:addr}
   ```

   `list:` is included because Google Groups stamps `List-ID` / `List-Post`
   headers, and it is the most reliable marker of group-delivered mail;
   `deliveredto:` covers the member-delivery path where the `To:` header was
   rewritten.

3. **Recipient-aware local matcher:** the post-Gmail verification pass now
   parses `Cc`, `Bcc`, `Delivered-To`, `X-Original-To`, `List-ID` and
   `List-Post` in addition to `To`, and matches a rule's recipients against all
   of them. `List-ID` renders the address dot-separated
   (`<invoice.outdoorequipped.com>`), so the matcher also tries an
   `@`→`.` variant of each term. Without this the strict local pass would
   discard messages Gmail had correctly returned.

## Alternatives Considered

- **Service account with domain-wide delegation:** impersonates any mailbox
  without changing mail routing, and is the "proper" enterprise answer. Rejected
  for now: it needs a new credential type (JSON key) alongside the existing
  OAuth client, Workspace-admin scope registration, and a separate secret to
  store and rotate — a lot of moving parts for one internal tool. Still the
  right upgrade if more shared inboxes appear.
- **Google Groups Migration / Cloud Identity Groups APIs:** manage membership
  and settings, but expose no message *content*; the Groups archive is simply
  not readable programmatically.
- **Auto-forwarding the group to a dedicated mailbox:** works, but forwarding
  rewrites headers and can break the `to:`/`list:` markers, making it harder to
  attribute a message to the group. Group membership preserves the headers.
- **Dropping the recipient filter and relying on sender rules alone:** would
  work for the Proforce case, but silently widens every rule to the whole
  personal mailbox — a privacy and correctness hazard once other rules exist.
- **Making `invoice@` a real user account:** cleanest technically, but it is an
  established Group with existing members and workflows; converting it is an
  operational change well beyond this feature.

## Consequences

- Doc Tidy reads a mailbox that contains **more than** the group's mail. The
  `toAddresses` criterion is what keeps rules scoped, so rules intended for
  group mail should always set it. This is a soft constraint, not enforced.
- Whoever is added as the group member must keep "Each email" delivery on, and
  must not filter the group's mail out of their account; if they leave the
  group, extraction silently returns nothing again.
- Messages that predate the member joining the group will not be present.
- `scripts/diagnose-doc-tidy.ts` is kept as a maintenance tool, since this
  class of failure (wrong account connected, mail not where expected) is
  invisible from the UI and recurs whenever the connection is re-made.
