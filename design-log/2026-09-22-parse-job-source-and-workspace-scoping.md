# Parse Job Source Field and Workspace Scoping for PDF Imports

**Date:** 2026-09-22
**Status:** accepted
**Author:** collaborative

## Context

Two gaps were discovered after the PDF Imports tab shipped:

1. **PDF import parse jobs were invisible in workspace Invoice Audit.**
   The `listParseJobs` workspace filter follows the chain
   `workspace → rules → rule-captured messages → parse jobs`. Synthetic messages
   created for PDF imports carry no `ruleId`, so they are never reachable through
   that chain. Every workspace Invoice Audit view uses `workspaceId` as a query
   param, so **all** PDF import results were silently excluded.

2. **No source indicator existed.**
   A completed parse job in Invoice Audit gave no hint whether it originated from
   an email attachment or a direct PDF upload.

## Decision

### `source` field on `DocTidyParseJob`

Add `source: 'email' | 'pdf-import'` (optional for backward compat with existing
jobs). Set to `'email'` in `requestParse` and `'pdf-import'` in
`requestParseFromGridFS`.

### `workspaceId` field on `DocTidyParseJob`

Add `workspaceId: ObjectId` (optional). Populated only for PDF import jobs (passed
through `requestParseFromGridFS` → `DocTidyPdfImport.workspaceId`). Email jobs
continue to scope through the rule → message chain.

### Updated `listParseJobs` workspace filter

Replace the exclusive rule-chain filter with an OR:
```
messageId IN (messages from workspace rules)
OR
(source = 'pdf-import' AND workspaceId = <workspace>)
```

This ensures both email-originated and PDF-import-originated results appear in the
same workspace Invoice Audit view.

### Frontend source badge

`ParseJobListItem` gains an optional `source` field. The Invoice Audit table renders
a small icon (envelope for email, upload arrow for PDF import) before the vendor name
whenever `source` is present, with a tooltip describing the origin.

## Alternatives Considered

- **Add `workspaceId` to `DocTidyMessage`** and set it on synthetic messages —
  would let the existing filter chain work unchanged. Rejected: `DocTidyMessage`
  is tied to Gmail capture and has no workspace concept; widening it would conflate
  two distinct things.
- **Separate Invoice Audit query for PDF imports** — two API calls merged on the
  frontend. Rejected: unnecessary complexity; a single OR filter on the backend is
  simpler and cheaper.
- **Always show source icon** (infer `email` when source is absent) — rejected;
  incorrect labelling of legacy jobs is worse than showing nothing.

## Consequences

- Old parse jobs in the database have no `source` and no `workspaceId`; they
  continue to work. The icon simply doesn't render for them.
- PDF import parse jobs created before this change are still not workspace-scoped
  (no `workspaceId` on the job). Only newly triggered parses are affected.
- The Python worker doesn't need any changes — it never reads `source` or
  `workspaceId`.
