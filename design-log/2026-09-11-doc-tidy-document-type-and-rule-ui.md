# Doc Tidy — document type on rules, and a rebuilt rules surface

**Date:** 2026-09-11
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Doc Tidy email extraction](./2026-09-10-doc-tidy-email-extraction.md) and
[the table and filename revisions](./2026-09-11-doc-tidy-table-and-filename-revisions.md).

Two problems with the feature as it stands:

1. **Nothing says what kind of document a rule collects.** In practice every rule
   exists to gather either an order confirmation or an invoice, but that intent
   lives only in the rule's name (`Acme supplier invoices`) and in whatever the
   author wrote in the description. The results table therefore cannot be filtered
   or scanned by document kind, which is the first question anyone asks of it.
2. **The rules page is hard to read and the rule form is hard to fill in.** The
   list renders each rule as a run-on sentence (`from a@b.com · subject: invoice ·
   last 30 days · pdf/xlsx files`) with four same-weight buttons beside it. The
   editor is a flat stack of fourteen controls in one undivided column, with no
   grouping, no validation beyond "name is not empty", and no way to dismiss it
   from the keyboard.

## Decision

### A `documentType` field on the rule, denormalised onto the message

`documentType` is a closed enum — `order_confirmation`, `invoice`, `other` —
stored on `DocTidyRule` and copied onto every `DocTidyMessage` the rule captures,
exactly as `ruleName` already is. Denormalising keeps extracted history readable
and filterable after the rule that produced it is edited or deleted, and lets the
messages list filter on an indexed field on the message itself rather than
resolving rule ids on every query.

`other` is the default, so existing rules stay valid and the field never blocks a
save. It is offered in the form as a real choice rather than an "unset" state,
because a rule whose author declined to classify it and a rule for something that
genuinely is neither an order confirmation nor an invoice want the same treatment
in the list and the table.

**Backfill on edit, not by migration.** Saving a rule now also pushes its current
`name` and `documentType` onto the messages it has already captured. The previous
entry noted that `skipKnown` means editing a rule will not re-classify mail it
already captured; that remains true of *matching*, but the labels on already
captured rows should not be allowed to contradict the rule that produced them.
Messages from rules nobody ever edits keep an absent `documentType` and read as
`Other`, which the messages filter accounts for by matching missing values
alongside `other`.

### Rules list: a scannable row, not a sentence

Each rule's criteria are rendered as discrete labelled chips (`FROM`, `SUBJECT`,
`NOT`, `WINDOW`, `FILES`) instead of a joined string, so a specific condition can
be found by position rather than by reading. Exclusions get a rose tone, since
"excluding: draft" and "subject: draft" previously differed by one word in the
middle of a sentence.

The four equal-weight text buttons become one labelled **Run** action plus two
icon buttons for the destructive and secondary actions, and the Enable/Disable
button becomes a switch that also serves as the status indicator — the old row
carried both a status pill and a button that contradicted it (`Enabled` next to a
button reading `Disable`).

A toolbar over the list filters by name, document type and status. The list is
already fetched in full, so this filters client-side and costs no requests.

### Rule editor: collapsible sections, segmented choices, real validation

The form is grouped into five numbered, collapsible sections (Basics, Senders and
recipients, Keywords, Timeframe, Attachments), each with a one-line explanation of
what the section does to matching. Only **Basics** is open initially: it holds the
one required field, and the other four are all optional conditions that most rules
leave partly empty. The remaining sections open independently rather than
one-at-a-time, so two related groups can be compared side by side.

A collapsed header swaps its description for a summary of what the section
currently holds (`From 1 address`, `3 keywords · any may match`, `Last 30 days`),
which is what makes collapsing safe: the whole rule can still be reviewed without
expanding anything. A section holding an invalid field turns rose and, on a failed
submit, is expanded automatically before its field is focused.

Within Basics, the enabled switch sits above the name, since whether the rule runs
at all is the first thing to decide and the first thing to check when returning to
an existing rule.

Mutually exclusive choices — document type, keyword matching, timeframe mode —
become segmented controls instead of a `<select>` and a pair of radios, so the
options are visible without opening anything.

Validation moves inline and per-field: a missing name, an out-of-range lookback,
and a fixed range whose end precedes its start are all reported against the
control that owns them, and the first offending field is focused on a failed
submit rather than the save silently doing nothing.

A live preview strip above the footer renders the same criteria chips the list
uses, so the effect of a change to the form is visible before saving.

The editor is extracted from `DocTidyRules.tsx` into its own component file. The
page was 620 lines with the modal, its chip input and a confirm dialog inlined;
the modal is the part most likely to keep growing.

## Alternatives Considered

- **Free-text document type, or a user-managed list of types.** More flexible and
  immediately worse: `Invoice`, `invoice` and `Invoices` would coexist within a
  week, and the value has to be reliable enough to filter on.
- **Deriving the type from the rule's keywords** (a rule matching "invoice" is an
  invoice rule). Guesses at intent, is wrong for exclusion keywords, and leaves
  the user no way to correct it.
- **Storing the type only on the rule and joining at read time.** Avoids the
  denormalisation, but loses the label as soon as a rule is deleted — the same
  reason `ruleName` is already denormalised — and would need a `$lookup` or a
  second query on every page of the messages table.
- **A migration script to backfill `documentType` on existing messages.** Nothing
  to backfill *from*: existing rules have no type until somebody sets one, so the
  script would have to run after that and would still be a no-op today.
- **Per-attachment document type**, classified from the file itself. A much larger
  feature (content inspection, a correction workflow) aimed at a different problem;
  a rule already encodes the intent well enough.
- **Rebuilding the rules list as a table.** Consistent with the Orders and results
  tables, but a rule's criteria are variable-length and would leave most cells
  empty or truncated at any fixed column width.
- **A wizard with Back/Next instead of an accordion.** Enforces the order, but
  forces it on edits too, where someone opening a saved rule usually wants one
  field in one section.
- **A true accordion that closes the previous section on open.** Keeps the dialog
  short, and makes comparing sender conditions against exclusion keywords a matter
  of clicking back and forth.
- **Keeping collapsed sections mounted and hidden with CSS.** Simpler focus
  handling, but a hidden field cannot take focus anyway, so the section has to be
  expanded first regardless — which is what the submit path does.
- **Replacing the custom modal with a shared dialog primitive.** Worth doing, but
  it is a cross-cutting change: the app has hand-rolled overlays in several pages
  and no dialog component to adopt. Out of scope here.

## Consequences

- Rules created before this change read as `Other` until somebody edits them.
- Messages captured before this change show `Other` until their rule is next
  saved, which now backfills them.
- The messages "Other" filter uses `$in: ['other', null]` to include rows written
  before the field existed. If a backfill ever runs, that can simplify.
- Saving a rule now writes to `doctidymessage` as well as `doctidyrule`. It is an
  indexed `updateMany` on `ruleId`, so the cost is proportional to what the rule
  has captured; the enable/disable switch pays it too, since it saves the whole rule.
- Adding a document type later means touching the enum in two models, the badge
  map and the filter options. The enum is small and closed on purpose.
