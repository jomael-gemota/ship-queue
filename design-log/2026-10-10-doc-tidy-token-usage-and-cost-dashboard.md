# Doc Tidy — Token Usage & Cost Dashboard (admin only)

**Date:** 2026-10-10
**Status:** accepted
**Author:** collaborative

## Context

Doc Tidy spends LLM tokens on every parse, but nothing records how many, for
which workspace, or what it costs. Admins want (a) a live view of tokens and
cost per workspace, grouped by organization, priced the way OpenAI bills, and
(b) to reduce that spend.

Builds on [agent parsing](./2026-09-11-doc-tidy-agent-parsing.md),
[organizations](./2026-09-30-doc-tidy-organizations.md),
[parse job workspace scoping](./2026-09-22-parse-job-source-and-workspace-scoping.md)
and [rate-limit retry](./2026-09-25-tidy-rate-limit-retry.md).

### Where tokens are spent today (per parse job)

| # | Call site | Backend | Model (env) | Calls per job |
|---|-----------|---------|-------------|---------------|
| 1 | `tidy_agent.stream_tidy` — extraction | Hermes (`HERMES_BASE_URL`) | `HERMES_MODEL` | 1 (+ retries on 429, which are not billed) |
| 2 | `tidy_agent.generate_table_data` — table reformat | Hermes | `HERMES_MODEL` | 1 |
| 3 | `narrator.Narrator.say` — reasoning-panel lines | OpenAI | `NARRATION_MODEL` (`gpt-4o-mini`) | ~6–10 |
| 4 | `embeddings.embed_text` — correction retrieval | OpenAI | `EMBEDDING_MODEL` (`text-embedding-3-small`) | 1 |
| 5 | server `lib/embeddings.embedText` — on correction save | OpenAI | `EMBEDDING_MODEL` | 1 per correction |

None of these read the `usage` object returned by the API.

### How OpenAI bills a request (verified 2026-10-10)

From the [pricing page](https://platform.openai.com/docs/pricing) and the
[prompt caching guide](https://platform.openai.com/docs/guides/prompt-caching):

- Prices are per 1M tokens, per model, per **service tier** (Standard, Batch,
  Flex, Fast — "Priority" was renamed Fast on 2026-07-30).
- Input is split three ways. `cached_tokens` and `cache_write_tokens` are both
  subsets of `input_tokens`:
  `ordinary = input − cached − cache_write`.
- Cache writes cost 1.25× input on GPT-5.6 and later. Earlier models have no
  cache-write charge and report zero cache-write tokens.
- Some models have **short/long context** prices: short is ≤ 272K input tokens,
  long is above.
- Reasoning tokens are billed as output and are already included in the output count.
- Embeddings bill input only.

## Decision

### 1. Capture actual usage on every call (worker + server)

Every call site reads the provider's `usage` object — never estimates from text
length. Streamed calls send `stream_options={"include_usage": True}`. If a backend
rejects that option, the worker drops it, retries once, and keeps it off for the
rest of the process.

Normalised fields recorded per call (Chat Completions names in brackets):

- `inputTokens` (`prompt_tokens`)
- `cachedInputTokens` (`prompt_tokens_details.cached_tokens`)
- `cacheWriteTokens` (`prompt_tokens_details.cache_write_tokens`)
- `outputTokens` (`completion_tokens`)
- `reasoningTokens` (`completion_tokens_details.reasoning_tokens`, informational)
- `model` and `service_tier` exactly as the API echoed them back

If a backend returns no usage, the event is stored with `usageSource: 'missing'`
and counted separately on the dashboard. It is never silently treated as zero.

The worker reports usage through a per-job `contextvars` sink, so the call sites
in `tidy_agent`, `narrator` and `embeddings` don't need the WebSocket threaded
through them.

### 2. New collection `doctidy_usage_events` (`DocTidyUsageEvent`)

```
{
  jobId?: ObjectId
  workspaceId?: ObjectId      // resolved at record time
  purpose: 'extraction' | 'table' | 'narration' | 'embedding' | 'correction-embedding'
  provider: 'openai' | 'hermes'
  model: string
  serviceTier: 'standard' | 'flex' | 'batch' | 'fast'
  inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens
  usageSource: 'reported' | 'missing'
  costUsd: number             // snapshotted at record time
  priced: boolean             // false when no price row matched
  priceId?: ObjectId          // which price row was applied
  createdAt
}
```

Indexed on `{ createdAt }`, `{ workspaceId, createdAt }`. The organization is
resolved at **query** time, so moving a workspace between organizations moves its
history with it.

Transport: the worker sends `{"type":"usage", jobId, ...}` over the existing
authenticated WebSocket. The server persists it, resolves the workspace (cached
per job) and price, and broadcasts a data-free `usage` hint on `docTidyEvents`.
The dashboard refetches on that hint, which is what makes it live.

### 3. Pricing — `DocTidyModelPrice`, admin-editable

One row per `(model, serviceTier)`:
`inputPer1M`, `cachedInputPer1M?`, `cacheWritePer1M?`, `outputPer1M`, and
optional `longContextThreshold` + `long*Per1M` prices.

```
long  = longContextThreshold && input > longContextThreshold && longInputPer1M set
rates = long ? long* : short*
cost  = ( ordinary    × rates.input
        + cached      × (rates.cachedInput ?? rates.input)
        + cacheWrite  × (rates.cacheWrite  ?? rates.input)
        + output      × rates.output ) / 1,000,000
```

- Matching: exact model first, then the longest price row that is a prefix
  followed by `-` (so `gpt-4o-mini-2024-07-18` matches `gpt-4o-mini`). If there's
  no row for the echoed tier, the Standard row is used.
- Service tier mapping: `default`/`auto`/`scale`/missing → standard,
  `flex` → flex, `priority`/`fast` → fast, `batch` → batch.
- Seeded on first start with verified 2026-10-10 Standard prices for the models
  Doc Tidy uses (`gpt-4o-mini`, `text-embedding-3-small`, `gpt-5.5`), plus Flex
  and Fast rows where published. Admins add or edit rows on the dashboard.
- Cost is snapshotted on the event. Admins can **re-price** a date range after
  editing prices, which also prices events recorded before their model had a row.
  This replaces the `effectiveFrom` idea: snapshot + explicit re-price is simpler
  and just as auditable.
- A model with no price row (e.g. `hermes-agent` until an admin prices it) is
  recorded with `priced: false`. The dashboard lists unpriced models with their
  token counts so nothing is hidden.

### 4. Reconciliation with OpenAI's Costs API

When `OPENAI_ADMIN_KEY` is set, `GET /doc-tidy/usage/reconciliation` calls
`GET /v1/organization/costs` (`bucket_width=1d`, `group_by=line_item`, paginated).
If `OPENAI_USAGE_API_KEY_IDS` is set, it also passes `api_key_ids` so only Doc
Tidy's key is counted. The panel compares OpenAI's billed total with our recorded
`provider: 'openai'` cost over the same UTC days and lists the line items.
Results are cached in memory for 10 minutes, and there's no scheduler. Spend that
Hermes bills to another provider can't be seen from here.

### 5. Admin dashboard — `/doc-tidy/usage`

- Route guarded with `ProtectedRoute adminOnly`, a "Token Usage" item in the
  sidebar's Invoice Auditing group that only admins see, and `requireAdmin` on
  every endpoint.
- Range presets: Today / 7d / 30d / Month to date (UTC).
- Summary cards: total cost, total tokens (input / cached / output), parse jobs,
  average cost per job, plus warnings for unpriced or missing-usage events.
- Organization → workspace table with tokens, cost, jobs and average cost per job.
  "Unassigned" and "No workspace" get their own rows.
- Breakdown by purpose and model.
- Daily cost trend (inline SVG bars, so no chart dependency).
- Price table editor + re-price action.
- Reconciliation panel.
- "Live" badge driven by the shared Doc Tidy SSE stream.

### 6. Cost-saving changes in scope

1. **Narration off by default.** `NARRATION_ENABLED` defaults to `false`, so the
   6–10 `gpt-4o-mini` calls per job are replaced with the existing static
   Tidy-voiced lines. Setting it to `true` brings them back, and they're tracked.
2. **Prompt-cache friendly ordering.** The large static `SYSTEM_PROMPT` stays
   first and byte-identical across jobs. The per-vendor SKU anchor and learned
   correction rules move into a second system message, so the static prefix
   (> 1,024 tokens) is cacheable. When the worker talks directly to OpenAI (no
   `HERMES_BASE_URL`), it also sends a stable `prompt_cache_key` to improve cache
   routing.

Out of scope for now: replacing the LLM table pass with code, and the Batch API.

## Alternatives Considered

- **Estimate tokens with `tiktoken`.** Rejected: it misses cached, cache-write
  and reasoning tokens and per-message overhead. Reported usage is exact.
- **Rely only on OpenAI's Usage/Costs API.** Rejected as the primary source: it
  can't attribute to Doc Tidy workspaces, lags, and needs an admin key. Kept as
  the reconciliation check.
- **Worker writes usage straight to Mongo.** Works, but adds another raw-writer
  collection, duplicates the pricing logic in Python, and has no live event.
- **Store usage counters on the parse job.** Loses per-call model/purpose/price
  detail, and can't hold correction embeddings.
- **One OpenAI project/API key per workspace.** Unmanageable as workspaces grow,
  and doesn't cover Hermes.
- **A charting library for the trend.** Not worth a dependency for one bar chart.

## Consequences

- Accuracy for Hermes calls depends on Hermes returning `usage`. If Hermes runs
  an internal agent loop (several upstream calls per request), its reported
  usage may undercount the upstream bill. `worker/diagnose_usage.py` makes one
  tiny call and prints the echoed model and usage, to settle this.
- A job aborted mid-stream is still billed by the provider for tokens already
  generated, but its final usage frame never arrives, so it isn't recorded.
  Usage sent while the worker socket is down is also lost (the job fails then
  too). Both are small, and they're why the reconciliation panel exists.
- One small document write per LLM call. That's negligible next to the existing
  `thinking` `$concat` writes.
- Spend from before this ships isn't recorded. The reconciliation panel still
  shows OpenAI's totals for those days.
- Workspaces deleted later keep their events, shown as "Deleted workspace".
- With narration off, the reasoning panel's step lines are the fixed fallback
  phrases rather than varied ones.
