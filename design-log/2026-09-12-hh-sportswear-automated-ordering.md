# HH Sportswear / Workwear automated ordering

**Date:** 2026-09-12
**Updated:** 2026-09-21
**Status:** accepted
**Author:** collaborative

Working plan for the Helly Hansen B2B operator station. Sportswear and
Workwear share one pipeline; only portal, catalog, account, and cookie differ.

Related:

- Manual copy-paste process (agreed 2026-09-12): DS OM → Seller Central → B2B ASAP.
- Persistence: `design-log/2026-09-11-hh-sportswear-persistence.md`
- Dual-brand split: `design-log/2026-09-19-hh-workwear-brand.md`
- SC session cookies: `design-log/2026-09-11-cookie-jar-worker.md`

## Context

Operators place Helly Hansen drop-ship orders across three systems: **DS OM**
(spreadsheet), **Seller Central (SC)**, and **B2B ASAP / Builder Cart**. Cookie
Jar keeps an SC session available. Dropship (B2B) is the operator station for
that pipeline.

## Decision

An Excel upload (or paste) becomes a **group** (batch). Each unique Order ID +
PO pair becomes one **order** row. The system fills order/item details from
Seller Central, drafts the B2B order (does not Place Order), cross-checks the
live B2B document against Seller Central details, waits for the user, then
Place Order on go-ahead.

**Reference Number** holds the B2B order number from the cart draft. Writing that number back into the DS OM spreadsheet is **not** the path.
Operators download Order ID / PO / B2B order # from a **batch export**
(`.xlsx` from the orders-page ⋯ menu).

Stamping the PO into Amazon **Seller Notes** is still an open question — confirm
whether that manual step is still needed before automating it.

Place Order is gated by Configurations (`placeOrderEnabled`, default off). The
submit path is wired (`POST` the document with `do_submit: true`) but has not
been proven against a live Helly Hansen order.

### User / system flow

1. User uploads an Excel file (or pastes rows) with **Order ID** and **PO**.
2. That upload is the **group** — a new row on `/ordering/hh-sportswear` or
   `/ordering/hh-workwear`. In that group’s Orders table, each Order ID + PO
   creates **1 order**. Right after upload, Order ID, PO, Details, and Cart
   are filled. Details is **Pending**. Cart is **—**.
3. Other order details (Buyer Info on the Orders page; Title, SKU, ASIN,
   Quantity, Unit Price on the Items page) are filled from Seller Central
   **by Order ID**.
4. Once filled, that order’s Details status is **Synced**.
5. When the system sees a **Synced** order with line items and no cart yet, it
   creates a **draft B2B order** (catalog search → `POST /api/documents/` with
   `do_submit: false`).
6. Order submission on B2B stops at **Draft**. The system does **not** Submit
   or click **Place Order**.
7. After the B2B draft exists, Cart is **Draft**. The B2B order number is
   stored in **Reference Number**.
8. The system cross-checks Seller Central order details against the **live**
   B2B document.
9. If irregularities are found, Cart is **Review**. If everything matches,
   Cart is **Ready**.
10. The system waits for the user’s go signal. Place Order is available on
    Ready orders (hover menu / batch ⋯).
11. Clicking **Place Order** live-rechecks the cart, then submits only Ready
    matches. A mixed batch (for example 7 Ready, 2 no cart, 1 mismatch) places
    only the 7; the confirm dialog lists who is placed and who is skipped.
12. On a successful submit, Cart becomes **Placed** and the row is locked (no
    delete / re-sync / regen). Helly Hansen does not receive a submit while
    Place Order is off in Configurations — the live re-check still runs.

### Status sequence (per order)

| After | Details | Cart |
|---|---|---|
| Excel upload | Pending | — |
| Order/item details fetched | Synced | — |
| B2B draft created (no Place Order) | Synced | Draft |
| Cross-check passed | Synced | Ready |
| Cross-check failed | Synced | Review |
| Details fill failed | Failed | — |
| Place Order + submission | Synced | Placed |

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

- `/ordering/hh-sportswear` or `/ordering/hh-workwear` — one row per upload
  (the group / batch).
- `…/:groupId` — one row per unique Order ID + PO. Columns: Order ID, PO,
  Details, Cart, Order Placed, Reference Number, Buyer Info, Notes.
- `…/:groupId/orders/:orderId` — line items filled after the by-Order-ID fetch
  (Title, SKU, ASIN, Quantity, Unit Price).
- Buyer Info on the Orders (and Items header) views is also filled by that
  fetch.

Today each order has two statuses: **Details** (`pending`, `synced`, `failed`)
and **Cart** (`none`, `draft`, `ready`, `review`, `placed`). Excel upload
(`POST /api/hh-sportswear/import` or `/api/hh-workwear/import`) creates a group
and one order per unique Order ID + PO pair at Details **Pending**, Cart **—**.
Dummy seed data was removed; groups now come from spreadsheet upload or paste.

## Consequences

- **Built:** spreadsheet / paste import creates a group and unique Order ID +
  PO orders at Details Pending / Cart —. Dummy seed data is gone.
- **Built:** right after a batch upload, the API fills that group’s Order IDs
  from Seller Central (Cookie Jar OE US cookie → Get Order → Get Buyer Info
  with `order.blob`). Success → Details **Synced**. Live fill status is on
  `GET /api/hh-sportswear/sc-sync` (or `/hh-workwear`) and the HH filter bar.
  A second upload while one is filling is queued. There is no background
  poller. Operators can also re-sync one Order ID or a whole batch from the
  row hover menu (or the batch header); that resets Details to **Pending**
  and runs the same fill. Re-sync also clears an unplaced cart so a new draft
  can be created from the refreshed details. Cart draft is not offered until
  Details is **Synced**.
- **Built:** once an Order ID is Details **Synced** (and has line items), the
  API automatically creates a **Cart draft** for that order via Helly Hansen
  B2B HTTP (catalog search → `POST /api/documents/` with `do_submit: false`).
  Brand defaults live in `src/lib/hhBrand.ts`. Session cookie is the brand’s
  Configurations paste, Cookie Jar row, or (Sportswear only) `HH_B2B_COOKIE`.
  Drop-ship address is not applied until Place Order.
- **Built:** live cross-check of the Helly Hansen document vs Seller Central
  details. Cart becomes **Ready** or **Review**. Place Order only includes
  Ready orders and live-rechecks first.
- **Wired, not live-tested:** Place Order (`do_submit: true`) when
  Configurations has Place Order on. Held until a real order can be used.
- **Built:** batch export (`GET /api/hh-sportswear/:groupId/export` or
  `/hh-workwear`) downloads an `.xlsx` with **Order ID**, **PO Number**, and
  **Reference Number** for every order in that batch. Empty references stay
  blank. Available from the orders-page ⋯ menu.
- **Open:** whether PO still needs to be stamped into Amazon Seller Notes.
- Cookie Jar is the SC session source for fetches/cross-checks that need SC.
- Small leftovers: notes-field blur race; cancelled Amazon orders still fill.
