# Doc Tidy — Surfacing what the agent learned per vendor

**Date:** 2026-09-17
**Status:** accepted
**Author:** collaborative

## Context

Follows [Vendor editor modal and delete consistency](./2026-09-17-doc-tidy-vendor-editor-modal-and-delete-consistency.md).

A user reported that the agent "does not remember" what it learned per vendor,
contrasting Ship Queue with the standalone Doc Tidy prototype
(`github.com/jomael-gemota/doc-tidy`), where they could always see the agent's
learnings and corrections for a vendor.

Diffing the two workers settled where the difference is **not**:

- `worker/tidy_agent.py` is byte-for-byte identical between the repos.
- `worker/embeddings.py`, `narrator.py`, `pdf_extractor.py` are identical.
- `worker/corrections.py` and `sku.py` differ only in how collections are named
  (`db.corrections` / `db.vendors` there, `mongo_collections.CORRECTIONS` /
  `VENDORS` here).

The retrieval-and-inject learning loop is therefore intact and nothing was lost
in the port. Hermes has no memory in either repo — it is called through the
stateless `/v1/chat/completions` endpoint, and vendor SKU samples plus retrieved
corrections are re-injected on every job.

The real difference is the read surface:

- Doc Tidy's `client/src/pages/VendorsPage.tsx` fetches `/api/vendors` **and**
  `/api/corrections`, groups corrections under their vendor by normalised name,
  and renders each one with its note, timestamp and a before/after diff. Its
  sidebar labels the page "Captured vendors and corrections".
- Ship Queue's `DocTidyVendors.tsx` fetches only `/doc-tidy/vendors`, and
  `listVendors` flattens every correction into a single `correctionCount`
  integer before it reaches the browser. The UI can state *that* a vendor taught
  the agent three things but never *what* they were.

A second, load-bearing consequence: the `correctionCount` aggregation skips any
correction with a falsy `vendorName` (`if (row._id)`). With
`CORRECTION_VENDOR_STRICT=true` on the worker, such a correction is also never
retrieved for a known vendor. Those corrections are simultaneously invisible in
the UI and inert during parsing, with nothing anywhere to reveal it. Doc Tidy hit
this and shipped `worker/backfill_correction_vendors.py`; Ship Queue has no
equivalent and no "Unassigned" bucket to make it noticeable.

## Decision

Make the Vendors page the place where a vendor's learned corrections are read.
The work is frontend-led — every endpoint already exists and is already wired.

### 1 — Fetch and group corrections

`DocTidyVendors.tsx` fetches `/doc-tidy/vendors` and `/doc-tidy/corrections` in
parallel and groups the corrections by normalised vendor name.

`normalizeVendorName` is added to `frontend/src/types/docTidy.ts` next to
`vendorSamples`, and must stay identical to `normalizeVendorName()` in
`src/models/DocTidyVendor.ts` and `normalize_vendor_name()` in `worker/sku.py`.
A divergence would group the UI differently from how the worker scopes
retrieval, which is precisely the class of bug this page exists to expose.

### 2 — Expandable vendor rows

Row click currently opens the edit modal. Reading a vendor's learnings is the
more frequent action and the one that was missing, so:

- **Row click toggles expansion**, rotating the chevron already present in the
  row (it was decorative; it becomes the disclosure affordance).
- **Editing moves to a pencil `IconButton`** beside the delete button. This also
  completes the intent recorded in the previous entry, which specified a pencil
  button that was never added.

Expanded content lists that vendor's corrections newest-first. Each shows the
filename, `createdAt`, `createdByName`, the `note` promoted as a hard rule, and
the field-level changes from `diffOutputs(originalOutput, correctedOutput)`.
Changes are capped at five per correction with a "+N more" affordance, because a
size-grid explosion can produce hundreds of changed paths and the page must stay
readable. Each correction gets a delete button hitting the existing
`DELETE /doc-tidy/corrections/:id`.

### 3 — Unassigned corrections group

A section below the vendor list collects corrections whose `vendorName` is null,
or is set but matches no registered vendor. Each entry shows the raw
`vendorName` so the fix is obvious: register that vendor under exactly that name
and retrieval starts working. This converts the silent failure described above
into a visible, actionable one.

### 4 — Backend: widen the correction list

`listCorrections` currently returns 200 rows. Grouping needs the full set, so the
limit is raised to 1000 (matching Doc Tidy) and `documentTextSample` joins
`embedding` in the `select('-…')` exclusion — it is 2000 characters per row that
the UI never renders, so 1000 rows would otherwise ship ~2 MB of dead payload.

`listVendors` keeps its aggregation unchanged: it is correct for per-vendor
counts, and the unassigned group now covers what it omits.

## Alternatives Considered

- **Show corrections inside the existing edit modal.** Reuses a surface and
  needs no row-expansion work, but buries reading behind an editing affordance
  and constrains diffs to a `max-w-lg` dialog. Reading is the primary need here.
- **A separate `/doc-tidy/corrections` page.** Matches the "one concern per tab"
  convention, but splits a vendor from its learnings across two routes; the
  vendor is the unit users think in, and Doc Tidy's own page proved the grouped
  layout works.
- **A per-vendor endpoint (`/doc-tidy/vendors/:name/corrections`).** Avoids
  over-fetching and would suit a large correction volume, but costs a request
  per expansion and cannot populate the unassigned group at all. Revisit if the
  1000-row ceiling is ever reached.
- **Port `backfill_correction_vendors.py`.** Repairs null `vendorName` rows in
  bulk. Deliberately deferred: the unassigned group first makes the scale of the
  problem visible, and a blind backfill guesses at vendor attribution.

## Consequences

- Row click no longer opens the editor. Users who learned that gesture need the
  pencil button; the rotating chevron signals the new behaviour.
- The page now issues two requests and holds up to 1000 corrections in memory.
  Grouping is `useMemo`'d over both, so filtering and pagination stay cheap.
- Corrections with an unmatched `vendorName` become visible for the first time.
  Expect this to surface pre-existing data problems rather than create them.
- No worker change, no model change, no migration. Deleting a correction from
  this page takes effect on the next parse, since the worker reads corrections
  fresh per job.
- If a correction volume outgrows 1000 rows, move to the per-vendor endpoint
  described above; `retrieve_examples` is unaffected either way.
