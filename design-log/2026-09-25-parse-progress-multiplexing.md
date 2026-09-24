# Multiplexed parse progress and bounded worker intake

**Date:** 2026-09-25
**Status:** accepted
**Author:** collaborative

## Context

Revises the per-row live reasoning chip introduced alongside
[Doc Tidy agent parsing](./2026-09-11-doc-tidy-agent-parsing.md) and
[Doc Tidy live extraction](./2026-09-11-doc-tidy-live-extraction.md), and the
bulk queueing added in [Bulk send to Tidy Agent](./2026-09-22-bulk-send-to-tidy-agent.md).

Two failures show up together once a user queues a large batch (200+ PDFs):

1. Rows in the Actions column count up to "Step 12" while the reasoning modal for
   the very same job is stuck on "Tidy Agent is starting up…".
2. The machine running the browser (and, when co-located, the worker) becomes
   unresponsive for the duration of the batch.

Both trace back to a per-job connection model that was sized for a handful of
concurrent jobs.

### Why the modal disagrees with the row

`LiveReasoningSnippet` opened its own SSE connection per running job through
`useParseJobStream`. With N jobs running, one browser tab holds N streaming
`fetch` calls plus the always-on `/doc-tidy/stream`. Browsers cap concurrent
connections per origin at six over HTTP/1.1, which is what both the Vite dev
proxy and the Node server speak.

So the first few chips connect and keep streaming, and everything queued behind
them — including `ParseJobPanel`'s *second* stream for a job whose chip is
already connected, and the plain `GET /doc-tidy/parse-jobs/:id` that would have
supplied the stored transcript as a fallback — never gets a socket. The panel
renders `thinking: ''` with `live: true`, which is exactly the
"Tidy Agent is starting up…" empty state.

The step numbers disagreed independently of this: the chip counted
sentence-like segments while `ReasoningStepper` counts blank-line-separated
blocks, so the two were never showing the same quantity.

### Why the machine crawls

- Every token on every open stream is its own `setState`, and the chip re-ran a
  regex pipeline over the *entire* accumulated transcript on each one — O(n²)
  per job, multiplied by the number of running jobs.
- Each chip retained the full transcript in memory to display six words of it.
- `parse_status` events triggered an undebounced full-list refetch, so one batch
  produced hundreds of them.
- The worker does `asyncio.create_task(process_job(...))` per job with no
  bound. Only the inference phase is behind a semaphore; 200 tasks therefore ran
  `extract_text()` — synchronous pdfplumber, plus 300-DPI Tesseract OCR on
  scanned pages — directly on the event loop, blocking the WebSocket relay that
  the reasoning streams depend on.

## Decision

### One multiplexed progress stream instead of one stream per row

The server already sees every reasoning token in `docTidyWorkerRegistry`. It now
derives the chip's two display values — step number and snippet — there, once
per job, and broadcasts them as a `parse_progress` event on the **existing**
global `/doc-tidy/stream` fan-out. Broadcasts are throttled per job (800 ms) and
carry only `{ parseJobId, step, snippet }`.

Step number is the count of blank-line-separated blocks, computed incrementally
from a small carry buffer so a separator split across two token chunks still
counts. This is the same quantity `ReasoningStepper` renders, so the chip and the
modal now agree by construction.

The full per-job stream at `/doc-tidy/parse-jobs/:id/stream` is unchanged and
stays the transport for `ParseJobPanel`. The difference is that it is now the
*only* per-job connection a tab ever opens, and only while the panel is open.

### One shared client connection to the global stream

`subscribeDocTidyEvents` in `docTidyStore` ref-counts subscribers over a single
`authApi.eventStream('/doc-tidy/stream')`. The four call sites across
`DocTidy` and `DocTidyInvoiceAudit` now share one connection instead of opening
their own, and `useParseProgress(jobId)` subscribes per job id so a token on one
job re-renders one chip rather than the table.

Net effect on a tab watching 200 running jobs: one connection, down from 201.

### Batched token application in `useParseJobStream`

Tokens accumulate in a buffer flushed on a 100 ms timer, so a fast model burst
costs one render instead of one per token. Terminal events flush synchronously
before applying, so nothing is lost or reordered.

### Debounced list refetches

SSE-triggered refetches in `DocTidyInvoiceAudit` go through a 400 ms trailing
debounce, collapsing a batch's status churn into one request per quiet period.

### Bounded worker intake

`MAX_CONCURRENT_JOBS` (default 5) still guards inference. A new
`MAX_ACTIVE_JOBS` (default 12) guards the whole pipeline, so queued jobs wait in
`pending` rather than all starting at once, and `extract_text` moves to
`asyncio.to_thread` so PDF parsing and OCR never block the event loop.
Narration shares the active-job bound implicitly, since a job holds its slot for
its whole lifetime.

## Alternatives Considered

- **Raise the browser connection cap by serving HTTP/2.** Lifts the ceiling to
  ~100 streams but does not remove it, does nothing for the render churn, and
  makes the symptom reappear at a larger batch size. It also would not have
  fixed the step-count disagreement.
- **Poll a summary endpoint from the table.** Simple, but reintroduces the
  fixed-cost polling that `/doc-tidy/stream` was built to replace, and the chip
  would lag behind the panel by the poll interval.
- **Push raw tokens down the global stream.** No server-side text processing,
  but it broadcasts every job's tokens to every connected client regardless of
  what they are displaying — strictly more bytes than the per-job streams it
  replaces.
- **Drop the live chip entirely and show a plain spinner.** Fixes both problems
  and loses the feature; the chip is the main signal that a long batch is
  progressing rather than stuck.
- **Queue jobs server-side instead of bounding the worker.** The registry is
  deliberately not a queue (single-worker topology). Bounding intake inside the
  worker keeps that property and leaves `dispatchPending` as the recovery path.

## Consequences

- Chip snippets are now server-rendered text. Changing their wording is a server
  change plus a restart, not a frontend-only edit.
- `parse_progress` is best-effort like every other `/doc-tidy/stream` event: a
  dropped one just means the chip skips a step number.
- The registry holds a small per-job progress record (~600 chars) for the life of
  a run. It is cleared on completion, failure and abort.
- With `MAX_ACTIVE_JOBS=12`, a 200-file batch now visibly drains in waves.
  Queued rows sit at "Queued" longer than they used to before flipping to
  "Parsing", which is a more honest representation of what was already happening.
- `MAX_ACTIVE_JOBS` must stay ≥ `MAX_CONCURRENT_JOBS` or the inference semaphore
  can never be saturated. The worker logs a warning and raises it if it is not.
