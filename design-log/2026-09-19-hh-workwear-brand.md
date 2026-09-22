# HH Workwear as a second Helly Hansen B2B brand

**Date:** 2026-09-19
**Updated:** 2026-09-21
**Status:** accepted
**Author:** collaborative

## Context

HH Sportswear ordering (import → Seller Central fill → B2B draft → verify →
gated Place Order) was already on `feat/hh-b2b-ordering`. Workwear uses the
same Helly Hansen B2B app, so copying the Sportswear feature would double the
UI. Order Swift already treats Sports and Work as one `hellyhansen` module
with different Mongo `environment` values.

## Decision

One brand registry (`src/lib/hhBrand.ts` and `frontend/src/lib/hhBrand.ts`)
and one set of screens/routes. Workwear is the same operator station as
Sportswear, scoped by path and `HHOrderGroup.brand`.

| | Sportswear | Workwear |
|---|---|---|
| UI | `/ordering/hh-sportswear` | `/ordering/hh-workwear` |
| API | `/api/hh-sportswear` | `/api/hh-workwear` |
| Portal | `https://b2bsport.hellyhansen.com` | `https://b2bwork.hellyhansen.com` |
| Catalog | `ASAPSPORT` | `ASAPWW` |
| Account | `9014876` | `9062220` |
| Config key | `helly-hansen-sports` | `helly-hansen-work` |
| Cookie jar | `helly-hansen-sports-b2b` | `helly-hansen-work-b2b` |

SKU parse (`style_color-size`), HTTP (`/api/products/`, `/api/documents/`),
ship-via `"-"`, and drop-ship `address1` are shared. Seller Central fill is
shared (same OE US cookie). Env `HH_B2B_*` overrides Sportswear only so
Workwear cannot hit the Sports portal by accident.

Existing batches without `brand` migrate to `sportswear` on boot. Place Order
stays off per brand until Configurations is toggled.

## Consequences

- Dropship (B2B) lists both brands. Workwear reuses the Sportswear pages; it
  is not a second copy of the UI.
- Paste the Work B2B cookie on **HH Workwear → Configurations** (or the
  Helly Hansen Work B2B jar in Settings). Sphere does not refresh either HH
  jar.
- Batch export of Order ID / PO / B2B order # is on the batch
  (`GET /api/hh-*/:groupId/export`). See
  `design-log/2026-09-12-hh-sportswear-automated-ordering.md`.
