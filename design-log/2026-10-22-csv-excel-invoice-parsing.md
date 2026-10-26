# CSV / Excel Invoice Parsing

**Date:** 2026-10-22
**Status:** accepted
**Author:** collaborative

## Context

Vendors increasingly send invoices as CSV or Excel exports rather than PDFs, both
as email attachments and as files the team downloads and uploads. Tidy could only
read PDFs: `PARSEABLE` in `AttachmentCell.tsx` hid the parse action on anything
else, the PDF Imports upload rejected non-PDFs, and the worker always ran
`pdfplumber`.

The sample files (a WS16007 `invoices_…csv` and a Badorf Shoe "DROP SHIP Daily
Invoice Export") are **daily exports holding many invoices per file** — one or
more rows per invoice, each with its own PO. Everything downstream assumed one
parse job = one invoice = one PO: the match cache read a single PO per job, and
header-only workspaces render one Invoice Audit row per job. Fed through as-is,
an 11-invoice file would match at most one PO.

Builds on [Customer PO as PO Number](2026-10-21-customer-po-as-po-number.md).

## Decision

Chosen with the user: **one parse job per file**, expanded into **one Invoice
Audit row per invoice**, with **Tidy reading the invoices in batches**.

### Accepted files

`.pdf`, `.csv`, `.xlsx`, `.xls` — for email attachments (parse action) and the
PDF Imports tab (upload + parse). One server-side list
(`src/lib/parseableFiles.ts`) drives the upload filter, Drive mime type and the
email parse validation; `PARSEABLE` mirrors it on the frontend.

### Worker (`worker/tabular_reader.py`, `worker/worker.py`)

1. Read the sheet: CSV (UTF-8 with BOM, falling back to cp1252; delimiter
   sniffed), XLSX via `openpyxl`, XLS via `xlrd` — first non-empty sheet. The
   header is the first of the opening rows with the most filled cells, so title
   rows above it are skipped.
2. Group rows into invoices by the invoice-number column (`invoice`,
   `invoice_id`, `invoice_number`, …), falling back to the PO column. Rows with
   a blank key continue the previous invoice. With no such column, or only one
   invoice, the file is parsed as a single document exactly like a PDF.
3. Batch the invoices (`TIDY_TABULAR_BATCH_INVOICES`, default 10, and a
   character budget) and run Tidy once per batch. Each invoice is rendered as its
   own block with the header repeated, and a per-call system message asks for
   `{"invoices": [...]}` with exactly that many elements, each following every
   existing rule (PO number, vendor, line items, pricing). Corrections, learned
   rules and vendor SKU samples apply as for PDFs.
4. If a batch returns the wrong number of invoices, that batch is re-read one
   invoice at a time, so an invoice is never silently dropped.
5. `ensure_po_number` runs per invoice, against that invoice's own rows.
6. Stored output: `{ vendorName, invoiceCount, invoices: [...] }`. The table view
   is built deterministically as one editable **"Invoices"** grid (one row per
   invoice, its scalar fields) that round-trips through tabular corrections, plus
   a read-only **"Line Items"** grid that combines every invoice's line items into
   one table (invoice identifier prepended as the first column). The Line Items
   table is skipped by `tablesToAgentJson` during corrections (it has no matching
   top-level key in the batch JSON structure), so saving a tabular correction
   never corrupts the invoices array.

### Matching and Invoice Audit

- `writeMatchCacheForJob` treats each element of `invoices[]` as its own invoice
  (a regular job is a list of one), and writes all of a job's entries for an
  order in one pull-then-push.
- The frontend expands batch jobs into one virtual job per invoice
  (`expandInvoiceJobs` in `frontend/src/types/docTidy.ts`) before client-side
  matching and the header-only table, filters and export — so every existing
  column extractor works unchanged. Rows keep the real job id: opening, selecting
  or deleting an invoice row acts on the file's parse job (the delete confirmation
  says how many invoices that removes).

## Alternatives Considered

- **One parse job per invoice** — the file would show many statuses in Emails /
  PDF Imports and break the one-attachment-one-job model (unique
  `{messageId, attachmentIndex}` index, single send/rerun/abort button).
- **Tidy maps columns once, code converts rows** — faster and cheaper with exact
  numbers, but loses per-vendor SKU learning and corrections on these files.
- **Whole file in one Tidy call** — large exports exceed the output token budget
  (`MAX_TOKENS`) and get truncated mid-array.
- **LLM table pass for batches** — the formatter truncates large JSON at
  `MAX_DOCUMENT_CHARS`, and costs another call per file.

## Consequences

- Cost and time scale with invoices per file: roughly one extraction call per 10
  invoices (more when a batch has to be re-read singly).
- The worker needs `openpyxl` and `xlrd` (`pip install -r requirements.txt`).
- Only the first non-empty sheet of a workbook is read.
- Line items on batch files are now visible in the Table view (read-only "Line
  Items" grid); to edit individual line-item cells, use the JSON tab.
- Deleting one invoice row of a batch file deletes the whole file's parse job.
- The PDF Imports tab keeps its name; its copy now says PDF, CSV or Excel.
