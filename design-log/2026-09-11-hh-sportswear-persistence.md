# HH Sportswear B2B ordering persistence

**Date:** 2026-09-11
**Status:** accepted
**Author:** collaborative

## Context

The HH Sportswear ordering UI already drill-downs groups → orders → line items,
with client-side search/filter and row delete. Rows were sample data in the
browser. We need a real API so groups survive refresh and can be created later
from uploads or a form.

Volume is expected to stay small (B2B sessions, not the ShipStation order firehose).

## Decision

- One Mongo collection, `HHOrderGroup`, with **nested** `children` (orders) and
  `items` (line items). This matches the UI tree and keeps deletes in one write.
  Split collections (like LabelBatch + Label) are reserved for large/binary rows.
- Auth: any signed-in user can list, create, and delete. Label-style
  “only the creator may delete” is skipped because these records are not
  purchased labels.
- List returns the **full tree**. Nested search stays on the client, same as the
  sample UI. Server-side pagination/search can wait until volume needs it.
- Create stamps `createdByName` / `createdByEmail` / `createdByUserId` from the
  JWT. IDs in API responses are string `id` fields (Mongo `_id` / subdocument ids).
- Groups are created from spreadsheet upload (`POST /api/hh-sportswear/import`).
  A one-off seed script for dummy sample groups was removed.

## Consequences

- Create UI / CSV import can POST `/api/hh-sportswear/import` without changing
  the nested group → orders → items shape.
- If groups grow large, list payloads and nested `$pull` deletes should be
  revisited (lean list + per-group fetch, or separate collections).
