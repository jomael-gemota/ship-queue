# Tidy Agent Branding, Parse Button UX, and Worker Online Status

**Date:** 2026-09-19
**Status:** accepted
**Author:** collaborative

## Context

Three UX improvements requested:
1. Emails tab: "Send to Tidy Agent" always-visible button for unparsed items instead of hidden bolt icon on hover.
2. All user-facing text that said "the agent" should say "Tidy Agent".
3. Inside a workspace, show a live Tidy Agent online/offline badge that accurately reflects whether the Python worker on Ubuntu is connected.

## Decision

### 1 — "Send to Tidy Agent" button
`AttachmentIcons` no longer hides the parse trigger behind hover opacity.
Instead it renders a compact pill button with a sparkle SVG icon and the label "Send to Tidy Agent", always visible in the Actions column.

### 2 — "Tidy Agent" branding
All user-visible strings across the doc-tidy component tree that previously read "the agent" / "agent" are updated to say "Tidy Agent". Code identifiers, type names, and developer comments are left unchanged.

### 3 — Worker status badge
- **Backend**: `docTidyWorkerRegistry` broadcasts `{ type: 'worker_status', workerOnline: bool }` over the fan-out SSE bus whenever the Python worker connects or disconnects. A new `GET /doc-tidy/worker-status` endpoint returns the current state for the initial render.
- **Frontend**: `DocTidyEvent` gains `workerOnline?: boolean`. The workspace view fetches initial status on mount and subscribes to `worker_status` SSE events. A badge ("Tidy Agent · Online/Offline") appears in the workspace tab bar. Disconnection is detected within one WebSocket close event — typically < 1 second.
