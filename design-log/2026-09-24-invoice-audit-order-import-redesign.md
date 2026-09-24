# Invoice Audit — Order Import Redesign

**Date:** 2026-09-24
**Status:** accepted
**Author:** collaborative

## Context

The Invoice Audit table previously showed rows sourced entirely from parsed PDF
files (Tidy Agent `ParseJobListItem` records). Each parsed document produced one
row per extracted line item.

Users need a different workflow:

1. **Import** a structured order file (CSV or XLSX) containing the order details
   placed with a vendor.
2. **Parse** the vendor's invoices via email/PDF upload (existing flow unchanged).
3. The system **auto-joins** the two sources — each imported order row is enriched
   with the matching invoice data — so the audit table shows both what was ordered
   and what was actually invoiced side-by-side.

This supersedes the row model introduced in
[2026-09-18 inline line items](./2026-09-18-invoice-audit-inline-line-items.md)
and the grouping approach in
[2026-09-24 week grouping](./2026-09-24-invoice-audit-week-grouping-description-hidden.md).

## Decision

### Primary data source: `DocTidyOrderImport`

A new Mongoose model stores individual order-line records imported from a file.
Each record maps to one row in the Invoice Audit table.

| Field | Type | Notes |
|---|---|---|
| `workspaceId` | ObjectId | Workspace scope |
| `importBatchId` | String | Groups rows from the same file upload |
| `processedDate` | String | As-written in the import file |
| `poNumber` | String | PO # — primary matching key |
| `purchasedDate` | String | |
| `customerName` | String | |
| `orderId` | String | |
| `orderSku` | String | Secondary matching key |
| `orderQty` | String | Used for discrepancy check |
| `status` | String | |
| `importedByUserId` | String | |
| `importedByName` | String | |
| timestamps | | |

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/doc-tidy/order-imports` | Upload CSV or XLSX; creates one record per row |
| `GET` | `/doc-tidy/order-imports` | List records for a workspace (paginated) |
| `DELETE` | `/doc-tidy/order-imports/:id` | Delete a single record |
| `DELETE` | `/doc-tidy/order-imports/batch/:batchId` | Delete an entire import batch |

File parsing uses `exceljs` (already a backend dependency): XLSX sheets are read
via `workbook.xlsx.load(buffer)`; CSV files via `workbook.csv.read(stream)`.
Header columns are normalised (lowercased, strip spaces/`#`/`_`/`-`) before
mapping to model fields.

### Matching logic (client-side)

For each `DocTidyOrderImport` row the frontend finds a matching parse job by:

1. Normalise `order.poNumber` and each job's extracted PO # (same normalisation
   as above: lowercase, strip separators).
2. When a PO # match is found, scan that job's line items for a line item whose
   extracted SKU normalises to `order.orderSku`.
3. If a line-item SKU match is found → use that `(job, item)` pair as the
   invoice data source.
4. If the job has **no line items** and the PO # matches → use `(job, null)` and
   read quantity/price from document-level fields.
5. If no match is found → invoice columns show `—`.

This is computed in a `useMemo` over `(orderImports, allJobs)`.
`allJobs` is fetched once per workspace open with `pageSize=5000`.

### New column layout

The 15-column `InvoiceAuditColumnId` set completely replaces the old one
(storage key bumped to `docTidy.invoiceAudit.columns.v2` to avoid conflicts).

| Id | Label | Default | Source |
|---|---|---|---|
| `poNumber` | PO # | ✓ | Order import |
| `orderSku` | Order SKU | ✓ | Order import |
| `invoiceSku` | Invoice SKU | ✓ | PDF line item |
| `invoiceDate` | Invoice Date | ✓ | PDF document |
| `invoiceNumber` | Invoice # | ✓ | PDF document |
| `terms` | Terms | — | PDF document |
| `itemCost` | Item Cost | ✓ | PDF line item |
| `dcCogs` | DC COGS | — | Blank (future source) |
| `orderQty` | Order Qty | ✓ | Order import |
| `invoiceQty` | Invoice Qty | ✓ | PDF line item |
| `discountedCostPct` | Discounted Cost/% | ✓ | PDF line item |
| `dropshipFee` | Dropship Fee | — | PDF (doc or item level) |
| `miscCharges` | Misc. Charges | — | PDF (doc or item level) |
| `totalCost` | Total Cost (incl. Tax & DS Fees) | ✓ | PDF line item or doc |
| `discrepancy` | Discrepancy | ✓ | Computed |

Column sections in the drawer:
- **📋 Order fields** — `poNumber`, `orderSku`, `orderQty`
- **🧾 Invoice fields** — `invoiceSku` … `totalCost`
- **🔍 Computed** — `discrepancy`

### Discrepancy Checker column

Compares order vs. invoice on three dimensions, rendered as coloured badges:

| Check | Pass | Fail | N/A |
|---|---|---|---|
| Order SKU vs. Invoice SKU | ✓ SKU (green) | ✗ SKU (red) | — (no invoice match) |
| Order Qty vs. Invoice Qty | ✓ Qty (green) | ✗ Qty (red) | — |
| Item Cost vs. DC COGS | — (always, DC COGS blank) | — | — |

### Week grouping: Sunday → Saturday

The table groups rows by the week that contains `order.processedDate`.
The week anchor changes from **Monday** (old design) to **Sunday**.

`getWeekStartKey`: `diffToSunday = -day` (day 0 → 0, day 1..6 → -1..-6)
`formatWeekLabel`: "Sun Sep 20 – Sat Sep 26, 2026"

### Import UI

An **Import Orders** button is added to the Invoice Audit tab's toolbar. Clicking
it opens a modal with a drag-and-drop zone that accepts `.csv` and `.xlsx` files.
After a successful upload the modal closes and the table refreshes. Each imported
batch has a batch ID so individual batches can be cleared later.

## Alternatives Considered

- **Server-side join endpoint** — a `GET /doc-tidy/invoice-audit` that returns
  pre-joined rows. More correct for very large datasets but adds a complex
  aggregation pipeline and migration. Deferred; the client-side join is
  sufficient for the current page-size patterns (≤5000 rows).
- **Parse file on the frontend** — using the `xlsx` package already in the
  frontend bundle. Rejected: backend parsing is consistent with the PDF import
  pattern, keeps the business logic server-side, and avoids trusting browser
  parsing for data integrity.
- **Week group by Invoice Date** — would require waiting until a PDF is matched
  before assigning a week. Rejected: users need to see order rows grouped
  immediately after import, regardless of whether invoices have been matched yet.

## Consequences

- Old `InvoiceAuditColumnId` preferences stored under
  `docTidy.invoiceAudit.columns` are silently abandoned (new key `.columns.v2`).
  Users start with the new defaults on next load.
- The dynamic extracted-field columns feature (bolt ⚡ columns) is retired from
  the Invoice Audit table. The underlying parse-job data is still accessible via
  the ParseJobPanel (clicking a matched invoice row).
- `allJobs` is fetched with `pageSize=5000` per workspace open. For workspaces
  with more than 5000 completed jobs, some matches may not be found. This is
  acceptable for the internal-tool scale.
- The row selection model changes from `${job._id}-${itemIdx}` to
  `${orderImport._id}` — one key per order row.
