# SPS Commerce Invoice Lookup Tab

**Date:** 2026-10-08
**Status:** accepted
**Author:** collaborative

## Context

With workspace-scoped SPS Commerce OAuth sources in place
([2026-10-08-workspace-sps-source.md](./2026-10-08-workspace-sps-source.md)),
the next step is to expose the SPS API's invoice data inside the app.

The user's goal: given a PO number from an imported order, look up the associated
EDI 810 (Invoice) records from SPS Commerce and display the invoice details in a
new "SPS Commerce" tab inside the workspace view.

## Decision

### Backend additions

| Layer | Change |
|-------|--------|
| `src/services/sps.service.ts` | `fetchSpsInvoices(accessToken, { poNumber?, limit?, cursor? })` — calls `GET https://api.spscommerce.com/fulfillment/v1/invoices` with auto-refresh via `ensureAccessToken` |
| `src/controllers/docTidySpsSource.controller.ts` | `querySpsInvoices` — `GET /workspaces/:workspaceId/sps-sources/:sourceId/invoices` |
| `src/routes/docTidy.routes.ts` | Wire new route |

The response shape is normalized from SPS's RSX 7.7.7 JSON envelope into flat
`SpsInvoiceRecord` objects — one per invoice line, mapped from common field names
(`purchaseOrderNumber`, `invoiceNumber`, `invoiceDate`, `totalAmount`, etc.).
Since SPS endpoint paths vary by account provisioning, a 502 response from the
backend returns the SPS error message verbatim so users can diagnose access issues.

### Frontend additions

| Layer | Change |
|-------|--------|
| `frontend/src/types/docTidy.ts` | `SpsInvoiceRecord`, `SpsInvoicesResponse` types |
| `frontend/src/components/docTidy/SpsCommerceTab.tsx` | New self-contained tab component |
| `frontend/src/pages/DocTidyInvoiceAudit.tsx` | Add `'sps-commerce'` to `WorkspaceTab`; wire tab bar + content render |

The `SpsCommerceTab` component is self-contained: it fetches its own SPS sources,
shows a PO-number lookup form, and displays results. This keeps the already large
`DocTidyInvoiceAudit.tsx` changes minimal.

The tab is visible for all workspaces but shows a "Connect SPS Commerce first"
prompt when no source is connected. If multiple sources are connected, the user
picks which one to query (defaults to the first).

### SPS API endpoint strategy

The primary endpoint tried:
```
GET https://api.spscommerce.com/fulfillment/v1/invoices?purchaseOrderNumber=<po>
```

If the account is not provisioned for the Fulfillment API, the backend surfaces
the SPS error message. A comment in the service documents the alternative
Transaction API v5 path (`/transactions/v5/data/out?documentType=810`) so devs
can swap it when needed.

## Alternatives Considered

- **Build into `DocTidyInvoiceAudit.tsx` inline** — rejected; that file is
  already 7 000+ lines; extracting to `SpsCommerceTab.tsx` keeps the diff small
  and the component self-contained.
- **Auto-poll SPS on workspace enter** — deferred; polling would run without any
  filter and consume API quota. Start with on-demand lookup; auto-polling can be
  added once the endpoint shape is confirmed and the user decides a polling interval.
- **Embed results into the Invoice Audit table** — possible future work; for now
  the SPS data lives in its own tab to avoid polluting the order-import audit view.

## Consequences

- The exact SPS endpoint and response schema depend on account provisioning;
  the user must confirm the endpoint with their SPS account manager if the default
  path returns 404/403.
- RSX 7.7.7 JSON envelopes are normalised best-effort; fields that don't map to
  known keys are available in `rawData` for debugging.
- Auto-polling and background sync are out of scope for this iteration.
