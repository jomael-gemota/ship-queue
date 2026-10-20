# Doc Tidy — Vendor editor modal, delete modal consistency, vendor editing

**Date:** 2026-09-17
**Status:** accepted
**Author:** collaborative

## Context

Follows [Rules and Vendors UI polish](./2026-09-16-doc-tidy-rules-and-vendors-ui-polish.md).

Three gaps remain after the previous polish pass:

1. The delete confirmation modal in the Extraction Rules tab still uses the old
   flat layout (`p-6`, single block), while the Vendors tab now has the
   structured header + body + footer-strip pattern.
2. The "Register a vendor" form sits inline at the top of the Vendors page.
   Every other create action in the app (new rule, new label) is behind a button
   that opens a focused modal. The inline form breaks that convention and occupies
   permanent vertical space even when the user is only reading.
3. There is no way to edit a vendor after it is created. Users who misspell a
   name, or who want to add more SKU samples later, currently have to delete and
   re-register.

## Decision

### 1 — Delete modal consistency (Extraction Rules)

The confirmDelete modal in `DocTidyRules.tsx` is updated to use the same
three-section layout introduced for the vendors delete modal:

- **Header strip**: trash icon + "Delete rule" title, separated from the body by
  a `border-b`.
- **Body**: the warning text, unchanged.
- **Footer strip**: Cancel + "Delete rule" buttons inside a `border-t` strip with
  a muted background, matching the vendor pattern exactly.

### 2 — Vendor create/edit modal (`VendorEditor`)

An inline component `VendorEditor` is added to `DocTidyVendors.tsx`. It handles
both create and edit via the same modal:

**Create mode** (`vendor === null`):
- Name input (required, focused on open, Escape closes).
- SKU samples chip input — type a code and press Enter or `,` to add; Backspace
  on empty removes the last. Tracks `pendingAdds: string[]` locally.
- No corrections row (there are none for a brand-new vendor).
- Save calls `POST /doc-tidy/vendors` once per sample (upsert by normalised name
  means the first call creates, subsequent calls add to `skuSamples`). If no
  samples were entered, a single call creates the vendor with no sample.

**Edit mode** (`vendor !== null`):
- Name shown in a read-only display tile (avatar + name + "Name cannot be
  changed" hint). Renaming is not supported because the corrections table stores
  the vendor name at the time of writing, and a rename without a correction
  migration would silently disassociate all learned corrections from the vendor.
  The correct flow is delete + re-register once corrections have been re-learned
  under the new name, which is rare enough not to warrant a migration path now.
- Existing SKU samples shown as removable chips; clicking × marks the sample
  in `pendingRemoves: string[]`.
- New samples typed into the same chip input land in `pendingAdds: string[]`.
- Agent corrections shown as a read-only locked row (emerald pill when > 0, grey
  when 0) with the explanation "Learned automatically during the PDF parsing
  process." This makes the source of truth clear without any affordance to edit.
- Save applies removes first (`POST /doc-tidy/vendors/:name/samples/remove` per
  removed sample), then adds (`POST /doc-tidy/vendors` per new sample). No new
  backend routes are required.

The "Register a vendor" inline card is removed entirely. Its place is taken by a
"New vendor" button in the tab-bar header strip, symmetrical with the "New rule"
button on the Extraction Rules tab. Each vendor row gains an edit icon button
(pencil) alongside the existing delete button.

### 3 — No backend changes

`upsertVendor` (POST `/doc-tidy/vendors`) already does `$addToSet: { skuSamples: sample }`
on the matched document, so calling it with the same vendor name + a new sample
is idempotent and correct. `removeVendorSample` already handles the legacy
`skuSample` field as well as the `skuSamples` array. No new routes are needed.

## Alternatives Considered

- **Allow renaming in the edit modal.** Requires a `PATCH /doc-tidy/vendors/:name`
  endpoint that also updates `vendorName` on all associated `DocTidyCorrection`
  rows. Not impossible, but the correction table stores the name as written at
  the time; normalisation is done at read time, so a bulk rename is safe — the
  work is just out of scope for this pass.
- **Immediate-persistence for remove (no "pending" state).** Calling the API on
  each × click is simpler but fires a network request before the user clicks
  Save, making Cancel lie (the deletion has already happened). Batch-on-save is
  correct.
- **Separate "Add sample" inline form below each vendor row.** Clutters the list
  and does not compose with a create flow.

## Consequences

- The inline register card is gone; users who had it open will find a modal
  instead. No data is lost.
- Vendor rename is intentionally not supported. The UI makes this clear with a
  "Name cannot be changed" hint. A follow-up entry can add rename support when
  the correction migration path is agreed.
- The `VendorEditor` component lives inline in `DocTidyVendors.tsx`. If it grows
  (e.g. rename support is added later), it should be extracted to
  `components/docTidy/VendorEditor.tsx` like `RuleEditor`.
