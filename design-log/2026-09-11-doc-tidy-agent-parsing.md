# Doc Tidy — manual parse via the Hermes worker, with recorded reasoning and corrections

**Date:** 2026-09-11
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Doc Tidy email extraction](./2026-09-10-doc-tidy-email-extraction.md),
[live extraction](./2026-09-11-doc-tidy-live-extraction.md) and
[document type on rules](./2026-09-11-doc-tidy-document-type-and-rule-ui.md).

Doc Tidy today ends at capture: a rule matches mail, the attachment is copied to
Drive, and a row appears in the results table. Nothing reads the document. The
PDFs it collects — order confirmations and invoices — are exactly the documents
somebody then re-keys by hand.

A separate application, `doc-tidy` (github.com/jomael-gemota/doc-tidy), already
solves the reading half. It is a three-tier system: an Express server, a Python
worker on a dedicated Ubuntu machine, and the Hermes agent ("Tidy") reached over
its OpenAI-compatible API. The worker streams the agent's reasoning back through
the server to the browser over SSE, stores it per document, and accepts user
corrections that are embedded and retrieved as vendor-scoped few-shot examples on
later documents. Its architecture is recorded in that repo's
`design-log/2026-06-19-architecture.md`.

Running two apps against the same class of document means two mailbox stories,
two tables, and a manual hop — download from Drive, re-upload to doc-tidy. The
question is not whether to build the parser but where it should live.

## Decision

**Absorb `doc-tidy` into Ship Queue and retire it as a separate deployment.** The
server tier, the worker, the agent prompts, the vendor profiles and the
correction store all move into this repository. Doc Tidy's results table gains a
**Parse** action per attachment; everything downstream of that click is the
doc-tidy pipeline, unchanged in substance.

### One parse job per attachment, not per message

A captured message can carry several PDFs, and each is a separate document with
its own reasoning, output and corrections. `DocTidyParseJob` is therefore keyed
by `{ messageId, attachmentIndex }` with a unique index, which also makes the
"parse" endpoint idempotent — a second click resets and re-dispatches the
existing job rather than creating a second one.

### The worker talks to Mongo directly

The worker keeps doc-tidy's design: motor against the same database the server
uses. It reads its job, pulls the PDF, and reads the corrections collection to
build few-shot examples. The alternative — a purely server-mediated worker
speaking only WebSocket and HTTP — is a cleaner boundary and was rejected for
now because correction retrieval happens *after* text extraction, so it would add
a request/response round trip inside the job and a second implementation of
`retrieve_examples` on the server. Direct access ports the existing code as-is.

The consequence is a second writer on the database, which is why the new models
must tolerate raw writes: no `required` field is set only by a Mongoose path, and
nothing depends on a pre-save hook.

### Collection names are pinned on both sides

Mongoose would name the collection `doctidyparsejobs`, which the worker's motor
queries cannot derive. Every new model declares an explicit `collection`, and the
worker reads the same names from one `collections.py` module:
`doctidy_parse_jobs`, `doctidy_vendors`, `doctidy_corrections`, and the GridFS
bucket `doctidy_pdfs`.

### PDFs are mirrored from Drive into GridFS

doc-tidy's worker reads PDFs from GridFS because doc-tidy's PDFs arrive by
browser upload. Ship Queue's arrive from Gmail and live in Google Drive, reachable
only with the mailbox OAuth token that the server holds and the worker should not.

On a parse request the server downloads the attachment with that token and streams
it into a GridFS bucket, recording `pdfFileId` on the job. The worker's existing
`fetch_pdf_bytes` then works with a bucket-name change and nothing else. The
mirror is also what makes a re-run free: the bytes are already local, so a re-run
never touches Drive or Gmail.

### The worker WebSocket is authenticated

doc-tidy's `/ws` endpoint had no authentication, which was safe because the server
and worker were a private pair. Ship Queue is publicly reachable, so an open
WebSocket that accepts `{"type":"complete"}` for an arbitrary job id would let
anyone write extraction output. The upgrade handshake now requires a
`DOC_TIDY_WORKER_TOKEN` bearer header, compared with `timingSafeEqual`, and the
socket is destroyed on mismatch.

### Reasoning is streamed live and stored permanently

Every narrated pipeline step and every reasoning token the model emits is relayed
to open browsers and appended to the job's `thinking` field with a `$concat`
pipeline update. Opening the panel for a job that finished last week replays the
stored text; opening one that is mid-flight replays what has accumulated and then
continues live. This is what "record the agent's process for every file" means
here — not a summary written at the end, but the transcript as it happened.

Ship Queue already has a Doc Tidy SSE stream, but it is a global refetch hint
carrying no data. Per-job token streaming needs its own per-job client registry,
so the two coexist: `docTidyEvents` for table-level signals (extended with a
`parse_status` type so status chips update in other open tabs), and
`docTidyWorkerRegistry` for token relay.

### Corrections are the learning loop

A correction stores the corrected JSON plus an embedding of the source document's
first 2000 characters. On the next parse the worker embeds the new document,
scores it against stored corrections, and injects the top matches as prior
user/assistant turns, with the user's notes promoted into the system prompt as
hard rules. Retrieval is vendor-scoped: a vendor's fixes never leak into another
vendor's documents, and a registered vendor's corrections are pulled directly so a
learned SKU format is never crowded out of the global recency window.

Vendor profiles come across with it, because they are what scopes corrections and
what supplies cold-start SKU format anchors before any correction exists.

## Alternatives Considered

- **Call the existing doc-tidy service over HTTP from Ship Queue.** The smallest
  change: POST the Drive PDF to `/api/upload`, store the returned job id, proxy
  the SSE stream. Rejected because it leaves two deployments, two databases and
  two vendor/correction stores to keep in step, and every Ship Queue feature that
  wants the extracted JSON has to cross an app boundary to get it.
- **Teach the worker a second connection so it serves both apps.** Avoids porting
  the client components, but the worker would hold two WebSockets, two job
  schemas and two sets of collection names, and doc-tidy's UI would still be the
  only place to see a Ship Queue document's reasoning.
- **A job queue (BullMQ/Redis) instead of a WebSocket registry.** The repo has no
  queue infrastructure at all and this is a single-worker topology; doc-tidy
  rejected the same option for the same reason. A queue becomes worth it when
  there is a second worker.
- **Parse automatically on capture.** Tempting, and wrong for a first pass: every
  captured PDF would spend model time whether or not anyone wants its data, and a
  wide rule lookback would flood the worker on the first tick. Manual parse also
  keeps the reasoning transcript tied to a deliberate human request.
- **Serving PDF bytes to the worker over an authenticated HTTP endpoint** instead
  of mirroring to GridFS. Avoids storing a second copy, but adds a second
  authenticated surface and makes a re-run depend on Drive still holding the file.
- **A per-message parse action** rather than per-attachment. Simpler table
  affordance, but it cannot express which of three PDFs produced which JSON.

## Consequences

- The Ubuntu box needs network access to Ship Queue's MongoDB in addition to the
  public HTTPS domain.
- Mirrored PDFs accumulate in GridFS. Nothing prunes them yet; a retention sweep
  keyed on job age is the obvious follow-up.
- The registry holds one worker socket. A worker restart drops in-flight jobs,
  which are recovered because the worker re-dispatches everything still in
  `pending` when it announces `ready` — a job that was mid-`processing` at the
  moment of the crash stays stuck until someone re-runs it.
- `src/index.ts` now creates an HTTP server explicitly rather than using
  `app.listen`, because the WebSocket server needs the upgrade event.
- Corrections and embeddings need `OPENAI_API_KEY`. Without it corrections are
  still stored, just not retrievable, and narration falls back to static phrasing.
- The ported client components were written against doc-tidy's palette and
  `lucide-react`. They are re-tokenized to Ship Queue's CSS variables and inline
  SVG convention on the way in, so they read as part of this app rather than as a
  transplant.
