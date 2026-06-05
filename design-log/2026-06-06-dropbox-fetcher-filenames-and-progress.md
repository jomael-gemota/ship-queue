# Dropbox Fetcher — filenames in output + live extraction progress

**Date:** 2026-06-06
**Status:** accepted
**Author:** collaborative

## Context

Builds on [Dropbox Fetcher & Dropbox Account Connection](2026-06-05-dropbox-fetcher.md).

Two usability gaps surfaced once the Dropbox Fetcher was in use:

1. **Output only contains URLs.** Both "Copy all" and "Export .txt" emit one
   shared-link URL per line. Users want the matching **filename** alongside each
   URL so the exported list is self-describing (e.g. to paste into a sheet).
2. **No feedback during extraction.** Creating a shared link is ≥1 API call per
   file, so a folder with many files can take a while. Today the button just
   shows a spinner with no indication of how many files there are or how far
   along the run is.

## Decision

### Output format — `filename,url` per line

Both copy and export change from `url` per line to `name,url` per line
(comma-separated), keeping the existing newline separation between files
(`\n` for clipboard, `\r\n` for the `.txt` download). This is the smallest
change that makes the list self-describing and trivially importable as 2-column
CSV. Filenames are emitted as-is (internal tool; no CSV quoting/escaping).

### Progress — stream extraction as NDJSON

The extraction endpoint is long-running and was a single request/response. To
report progress we add a **streaming** variant rather than polling or websockets:

- New route `POST /api/dropbox/links/stream` returns
  `Content-Type: application/x-ndjson` and writes one JSON event per line:
  - `{ "type": "listing" }` — enumerating files (count unknown yet).
  - `{ "type": "counted", "total": N }` — file list resolved.
  - `{ "type": "progress", "processed": n, "total": N }` — after each file's
    link is created/reused.
  - `{ "type": "done", "data": ExtractLinksResult }` — final payload (same shape
    the old `/links` endpoint returned).
  - `{ "type": "error", "code"?, "message" }` — mid-stream failure (e.g.
    `dropbox_token_expired`).
- We keep streaming auth consistent with the rest of the app (Bearer token in
  the `Authorization` header), so the frontend reads the stream with `fetch` +
  `ReadableStream` rather than `EventSource` (which can't set headers). A small
  `authApi.postStream` async-generator helper yields parsed line objects.
- The service `extractFileLinks` gains an optional progress callback object
  (`onListed`, `onProgress`); behavior is unchanged when omitted. The existing
  non-streaming `POST /api/dropbox/links` route is left intact for compatibility.

### Frontend

- `handleExtract` consumes the stream and drives a small progress state
  (`phase: 'listing' | 'processing'`, `processed`, `total`). A progress bar +
  "Processed X of N files" replaces the bare spinner while running.

## Alternatives Considered

- **Server-Sent Events (`EventSource`)** — natural fit for progress, but
  `EventSource` cannot send the `Authorization` header this app relies on
  (token in `localStorage`). NDJSON over `fetch` keeps auth uniform.
- **Polling a job id** — would need server-side job state/store; overkill for a
  per-request, in-memory operation.
- **Filenames as a separate comma-joined block** — rejected; pairing each
  filename with its URL on the same line is more useful and stays line-aligned.

## Consequences

- One new route + controller and an optional callback on `extractFileLinks`; the
  original `/links` endpoint and its response shape are unchanged.
- Output lines change shape (`name,url`); anyone who scripted against the old
  URL-only export must adjust. Acceptable for an internal tool.
- Streaming responses must not be buffered by a reverse proxy; we set
  `X-Accel-Buffering: no` and `Cache-Control: no-cache` to be safe.
