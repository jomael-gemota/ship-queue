# PDF Imports Tab — Direct PDF Upload to Tidy Agent

**Date:** 2026-09-22
**Status:** accepted
**Author:** collaborative

## Context

Users needed a way to send PDFs directly to the Tidy Agent without them originating
from an email attachment. The existing flow (Email Records → parse attachment) requires
the PDF to have been captured from Gmail, which excludes invoices received through
other channels (Dropbox, local files, scanned documents, etc.).

## Decision

Add a **PDF Imports** tab inside the workspace detail page (alongside Invoice Audit,
Emails, Rules, Vendors). The flow is:

1. User clicks the tab and drops or selects one or more PDF files.
2. Files are uploaded to the backend immediately and stored in the `doctidy_pdfs`
   GridFS bucket. A row per file appears in the table.
3. No parsing runs automatically — the user explicitly clicks **Send to Tidy Agent**
   on each row when ready.
4. On send, a parse job is created against a synthetic `DocTidyMessage` (prefixed
   `pdf-import-<importId>`) so the existing worker protocol is unmodified. The job
   appears in the Invoice Audit tab once completed.

### New model: `DocTidyPdfImport`

| Field | Type | Notes |
|---|---|---|
| `workspaceId` | ObjectId | Workspace scope |
| `filename` | String | Original filename |
| `size` | Number | Bytes |
| `pdfFileId` | ObjectId | GridFS id |
| `parseJobId` | ObjectId? | Populated after "Send to Tidy Agent" |
| `uploadedByUserId` | String | |
| `uploadedByName` | String | |
| timestamps | | |

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/doc-tidy/pdf-imports` | List imports for a workspace |
| `POST` | `/doc-tidy/pdf-imports` | Upload PDFs (multipart, `files[]`, `workspaceId`) |
| `POST` | `/doc-tidy/pdf-imports/:id/parse` | Send one import to Tidy Agent |
| `DELETE` | `/doc-tidy/pdf-imports/:id` | Remove an unneeded import |

### Parsing flow for direct uploads

Since `DocTidyParseJob` requires a `messageId`, a synthetic `DocTidyMessage` is
created per import using `gmailMessageId: pdf-import-<importId>`. The attachment
entry has no `driveFileId`; the `pdfFileId` already in GridFS is set directly on
the parse job, bypassing the Drive download step entirely. The worker reads from
GridFS regardless of origin.

### Frontend changes

- `WorkspaceTab` union extended with `'pdf-imports'`.
- New tab button "PDF Imports" added to the workspace sub-tab bar.
- New `PdfImport` type added to `types/docTidy.ts`.
- `authApi` extended with an `uploadFiles` helper for multipart uploads.
- Tab content: drag-and-drop upload zone + table with Filename, Size, Uploaded,
  Status, and Actions columns.

## Alternatives Considered

- **Make `messageId` optional on `DocTidyParseJob`** — rejected; would require
  co-ordinated changes to the Python worker.
- **Store file as base64 JSON** — rejected; large PDFs would bloat request bodies
  and hit the JSON body-parser limit.
- **Parse immediately on upload** — rejected by user; explicit "Send" gives control
  over when agent capacity is used.

## Consequences

- `multer` added as a production dependency for multipart handling.
- Synthetic messages created for direct uploads are distinguishable by their
  `gmailMessageId` prefix (`pdf-import-`); they do not appear in the Email Records
  tab because that view filters on rule-captured messages.
- The parse job created by a PDF import appears in Invoice Audit (completed jobs)
  exactly like an email-originated job.
