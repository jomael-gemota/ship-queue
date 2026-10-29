# Workspace Auto-Parse Toggle (Emails and CSV/PDF Imports)

**Date:** 2026-10-29
**Status:** accepted
**Author:** collaborative

## Context

Parsing is manual today. In both workspace tabs a user has to select rows and click
"Send to Agent". In the Emails tab, `requestParse(messageId, attachmentIndex)` handles
this. In the CSV/PDF Imports tab, it is `sendPdfImportToAgent` →
`requestParseFromGridFS`. New mail arrives through the background `docTidyPoller`
every 30 seconds whether or not anyone has the page open. Uploads arrive through
`uploadPdfImports`.

We want an on/off switch on each tab. When it is on, new PDFs, CSVs and Excel files are
sent to Tidy automatically.

Related: [Bulk send to Tidy Agent](2026-09-22-bulk-send-to-tidy-agent.md),
[CSV/PDF Imports tab](2026-09-22-pdf-imports-tab.md),
[CSV/Excel invoice parsing](2026-10-22-csv-excel-invoice-parsing.md),
[Tidy rate-limit retry](2026-09-25-tidy-rate-limit-retry.md).

## Decision

### Server-side trigger, not client-side

The trigger has to run on the server. If the browser watched for new rows and clicked
"parse" itself, mail that the poller imported overnight would never be parsed. It would
also get parsed twice when two people had the tab open.

### Storage: two per-workspace flags

Add these fields to `DocTidyWorkspace`:

- `autoParseEmails: boolean` (default `false`)
- `autoParseImports: boolean` (default `false`)
- `autoParseEmailsSince?: Date` and `autoParseImportsSince?: Date`. Each is set when its
  switch is turned on, and limits auto-parsing to items that arrive after that time.

Both flags go through the existing `PUT /workspaces/:id` endpoint, the same way
`importMode` does. They are shared by the whole team, so the switch shows the same
state to everyone looking at that workspace.

### Hooks

- **Emails.** After `runRule` upserts a new message (`result.imported` path only, not
  re-runs), if the rule's workspace has `autoParseEmails`, call `requestParse` for each
  attachment that is parseable (`isParseableFilename`) and has a `driveFileId`.
- **Imports.** After `uploadPdfImports` creates the records, if the workspace has
  `autoParseImports`, run the same logic as `sendPdfImportToAgent` for each record and
  link `parseJobId`.
- Failures in the hook are logged and never fail the import or upload itself.

### Catch-up sweep

If the worker is offline, `requestParse` throws 503 and the item stays unparsed. On
each poller tick, for workspaces with a switch on, queue up to N items that:

- have no parse job, and
- were created after the matching `autoParseSince` timestamp.

Failed jobs are **not** retried automatically. This avoids a loop that keeps spending
tokens on a document that always fails.

### UI

- A pill switch in each tab's toolbar, next to "Fetch Emails" / "Import files". It is
  red with "OFF" and the knob on the left, or green with "ON" and the knob on the right,
  scaled to the 28px toolbar height. The knob slides when toggled.
- Tooltip: "Auto-parse: new files are sent to Tidy Agent as soon as they arrive".
- Both turning it on and turning it off go through a confirmation modal. The modal says
  what will change and that the setting applies to the whole workspace. The switch only
  flips after the save succeeds.
- Switching it on does not backfill existing unparsed rows. Users can still bulk-select
  those and click "Send to Agent".
- Built as one reusable `AutoParseSwitch` component in `components/docTidy/`, with
  `role="switch"` and `aria-checked`.

## Alternatives Considered

- **Client-side auto-click.** Rejected. It misses mail imported by the background poller
  and parses twice when several tabs are open.
- **One global switch in Settings.** Rejected. Each workspace has different vendors and
  different cost tolerance, and the request asks for the switch on each tab.
- **Per-user switch.** Rejected. Parsing is a shared server action. Two users seeing
  different states for the same workspace would be confusing.
- **Backfill on enable.** Rejected as the default. Turning the switch on in a workspace
  with hundreds of old emails would start a burst of token spend no one meant to start.

## Consequences

- Token spend goes up for workspaces that turn this on. It shows up in the existing
  usage dashboard.
- Large mail batches put a burst of jobs on the worker. This relies on the existing
  rate-limit retry, and the sweep cap N bounds the burst.
- Unknown-vendor documents will auto-parse into the "vendor needs setup" state. That is
  the same result as a manual parse.
- Follow-up: update `docs/guide/doc-tidy.md` to describe the switch.
