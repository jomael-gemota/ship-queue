# Thorogood order-details cart drafts

**Date:** 2026-09-26
**Updated:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

Dropship (B2B) already runs Helly Hansen Sportswear and Workwear: import Order
ID + PO, fill Seller Central details, draft a live B2B cart, verify, then
Place Order. Thorogood needs the same operator station, but there is no
supplier API yet.

## Decision

Thorogood is a third brand on the same screens and `HHOrderGroup` model
(`brand: thorogood`).

| | Thorogood |
|---|---|
| UI | `/ordering/thorogood` |
| API | `/api/thorogood` |
| Draft | Order details sync. No supplier HTTP call. |
| Reference Number | The PO, until an API returns an order number |
| Place Order | Off. The action is hidden and the API refuses it. |

After details are Synced, the cart draft stores `b2bDraftId` as `details:<child id>`
and copies the order details into the cart snapshot. The check compares that
snapshot to itself and marks the cart Ready. Seller Central still uses the
shared Outdoor Equipped US cookie. The Thorogood portal session is Cookie Jar
`thorogood-b2b` (Sphere id `b2b-thorogood`). A pasted Configurations cookie
overrides that jar. See `design-log/2026-10-07-b2b-thorogood-cookie.md`.

## Consequences

- A later Thorogood API replaces `draftMode: 'order-details'` with a live
  draft client. Existing `details:` rows are not live documents.
- Place Order must stay refused until that client can submit.
