# Tidy Agent — Rate-Limit Retry for Bulk Parses

**Date:** 2026-09-25
**Status:** accepted
**Author:** collaborative

## Context

After the [bulk "Send to Tidy Agent"](./2026-09-22-bulk-send-to-tidy-agent.md) feature
landed, users can queue 10+ documents in a single click. The Hermes inference backend
enforces a **global** concurrent-run cap (currently 10). Because two workers can run
simultaneously (staging + production, each capped at `MAX_CONCURRENT_JOBS=5`), bursts
of more than ~10 jobs trigger:

```
Error code: 429 — Too many concurrent runs (max 10)
```

The job is then marked failed, and the user must retry manually.

## Decision

Add **retry with exponential backoff** in `tidy_agent.py` for both API call sites:

1. **`stream_tidy`** — wraps the `client.chat.completions.create(stream=True)` call.
   On `openai.RateLimitError`, yields a `THINKING` token so the user sees *"Queue is
   full — I'll retry in Xs…"* in the reasoning panel, sleeps, and retries the entire
   stream from the beginning (no partial output has been sent yet).

2. **`generate_table_data`** — wraps its `create(stream=False)` call. On
   `RateLimitError`, logs and sleeps before retrying silently (the table pass is
   non-fatal anyway).

### Retry parameters (overrideable via env vars)

| Env var | Default | Meaning |
|---|---|---|
| `TIDY_RETRY_MAX_ATTEMPTS` | `6` | Max attempts before the job fails |
| `TIDY_RETRY_BASE_DELAY` | `15` | Seconds for first retry delay |

Delay schedule: `base_delay × 1.5^(attempt-1)` — 15 s, 22 s, 34 s, 51 s, 76 s.

The semaphore slot is **held during the retry sleep** (intentionally). Releasing it
would let another job jump in, immediately hit the same limit, and create a thundering-
herd loop. Holding it keeps the concurrency stable and lets other running jobs drain
before we retry.

## Alternatives Considered

- **Raise `MAX_CONCURRENT_JOBS` to a higher value** — doesn't help; the limit is global
  on the Hermes backend, not per-worker.
- **Lower `MAX_CONCURRENT_JOBS` to 1–2** — serialises everything, eliminates 429s, but
  makes the worker unnecessarily slow on small batches.
- **Queue on the server side** — correct long-term fix, but the current architecture
  (one worker, WebSocket dispatch) doesn't have queue infrastructure. The design log
  for the original agent parsing noted this trade-off. Adding retry to the worker is
  the minimal, safe change.
- **Notify the user and let them retry** — status quo; breaks the "bulk send and walk
  away" UX that motivated the feature.

## Consequences

- A job that hits the limit retries automatically with visible status in the reasoning
  panel. Users can send 20+ documents and leave; they will all finish eventually.
- Worst-case latency for a queued job increases by `sum(retry delays)` — acceptable
  because the alternative is an outright failure.
- The worker `.env.example` is updated with the two new env vars.
- No server or frontend changes required.
