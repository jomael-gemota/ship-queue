# HH Sportswear automated ordering (initial plan)

**Date:** 2026-09-12
**Status:** proposed
**Author:** collaborative

This is the working plan for how a user interacts with automated HH Sportswear
ordering. It is documented so we can continue brainstorming later. It is not
an implementation spec yet.

Related:

- Manual copy-paste process (agreed 2026-09-12): DS OM → Seller Central → B2B ASAP.
- Persistence: `design-log/2026-09-11-hh-sportswear-persistence.md`
- SC session cookies: `design-log/2026-09-11-cookie-jar-worker.md`

## Context

Operators currently place HH Sportswear drop-ship orders by hand across three
systems: **DS OM** (spreadsheet), **Seller Central (SC)**, and **B2B ASAP /
Builder Cart**. Cookie Jar now keeps an SC session available. The HH Sportswear
UI already has groups → orders → items, but it does not run this workflow.

## Decision

The page is the operator station for this pipeline. An Excel upload becomes a
**group** (batch). Each unique Order ID + PO pair becomes one **order** row.
The system then fills order/item details, drafts the B2B order (does not Place
Order), cross-checks SC vs the B2B draft, waits for the user, then Place Order
on go-ahead and writes the B2B Order Submission ID into **Reference Number**.

### User / system flow

1. User uploads an Excel file with columns **Order ID** and **PO**.
2. That upload is the **group** — a new row on `/ordering/hh-sportswear`. In
   that group’s Orders table, each Order ID + PO creates **1 order**. Right
   after upload, Order ID, PO, Details, and Cart are filled. Details is
   **Pending**. Cart is **—**.
3. Other order details (Customer, Address on the Orders page; Title, SKU,
   ASIN, Quantity, Unit Price on the Items page) are filled by a middleware
   function that fetches those data **by Order ID**.
4. Once filled, that order’s Details status is **Synced**.
5. When the system sees a **Synced** order with no cart yet, it begins creating a
   **draft B2B order**. A middleware function (APIs or scraping) imitates the
   manual placing steps: item, quantity, address, and so on.
6. Order submission on B2B stops at **Draft**. The system does **not** Submit
   or click **Place Order**.
7. After the B2B draft exists, Cart is **Draft**.
8. The system cross-checks Seller Central order details against the drafted
   B2B order.
9. If irregularities are found, Cart is **Review**. If everything matches,
   Cart is **Ready**.
10. The system waits for the user’s go signal. That order has a **Place Order**
    button.
11. Clicking **Place Order** executes the real Place Order in B2B.
12. The system waits for the response, reads the **Order Submission ID**, and
    shows it in the **Reference Number** column on the Orders page.

### Status sequence (per order)

| After | Details | Cart |
|---|---|---|
| Excel upload | Pending | — |
| Order/item details fetched | Synced | — |
| B2B draft created (no Place Order) | Synced | Draft |
| Cross-check passed | Synced | Ready |
| Cross-check failed | Synced | Review |
| Details fill failed | Failed | — |
| Place Order + submission ID | Synced | Placed |

### Sample import

Path used while writing this note:
`C:\Users\cpitech\Downloads\sample import.xlsx`

- Sheet: `template_1`
- Headers: `Order ID`, `PO Number`
- 7 data rows, **4 unique Order ID + PO Number pairs** → **4 orders**
  (three pairs appear twice in the file)

| Order ID | PO Number | Rows in file |
|---|---|---|
| 114-4703266-5116242 | 220888 | 2 |
| 114-8118039-2444247 | 221156 | 1 |
| 113-0335061-9241033 | 221036 | 2 |
| 113-1843047-2321854 | 221049 | 2 |

Import rule from this example: **one order per unique Order ID + PO**, not one
order per spreadsheet row.

### Mapping onto the current UI

- `/ordering/hh-sportswear` — one row per upload (the group / batch).
- `/ordering/hh-sportswear/:groupId` — one row per unique Order ID + PO.
  Columns used in this plan: Order ID, PO, Details, Cart, Reference Number
  (Reference Number stays empty until Place Order returns the submission ID).
- `/ordering/hh-sportswear/:groupId/orders/:orderId` — line items filled after
  the by-Order-ID fetch (Title, SKU, ASIN, Quantity, Unit Price).
- Customer and Address on the Orders (and Items header) views are also filled
  by that fetch.

Today each order has two statuses: **Details** (`pending`, `synced`, `failed`)
and **Cart** (`none`, `draft`, `ready`, `review`, `placed`). Excel upload
(`POST /api/hh-sportswear/import`) creates a group and one order per unique
Order ID + PO pair at Details **Pending**, Cart **—**. Dummy seed data was
removed; groups now come from spreadsheet upload.

## Consequences

- **Built:** spreadsheet upload creates a group and unique Order ID + PO orders
  at Details Pending / Cart —. Dummy seed data is gone.
- **Built:** right after a batch upload, the API fills that group’s Order IDs
  from Seller Central (Cookie Jar OE US cookie → Get Order → Get Buyer Info
  with `order.blob`). Success → Details **Synced**. Live fill status is on
  `GET /api/hh-sportswear/sc-sync` and the HH filter bar. A second upload
  while one is filling is queued. There is no background poller. Operators can
  also re-sync one Order ID or a whole batch from the row hover menu (or the
  batch header); that resets Details to **Pending** and runs the same fill.
  Re-sync also clears Cart **Draft** (not Ready / Review / Placed) so a new
  draft can be created from the refreshed details.
- **Built:** once an Order ID is Details **Synced** (and has line items), the
  API automatically creates a **Cart draft** for that order via Helly Hansen
  Sports B2B HTTP (catalog search → `POST /api/documents/` with `do_submit:
  false`). Config matches Order Swift brand Helly Hansen Sports: baseUrl
  `https://b2bsport.hellyhansen.com`, catalog `ASAPSPORT`, account `9014876`.
  Session cookie is Cookie Jar `helly-hansen-sports-b2b` (manual; not Sphere)
  or `HH_B2B_COOKIE`. Drop-ship address is not applied until Place Order.
  The filter-bar chip shows “Drafting …” while that job runs.
- **Not built yet:** cross-check, Place Order (`do_submit: true`).
- Cookie Jar is the SC session source for fetches/cross-checks that need SC.
