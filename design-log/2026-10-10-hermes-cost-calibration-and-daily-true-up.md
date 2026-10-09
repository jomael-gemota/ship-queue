# Hermes Cost — Calibrated Estimate and Daily True-Up from OpenAI Billing

**Date:** 2026-10-10
**Status:** accepted
**Author:** collaborative

## Context

Refines [token usage and cost dashboard](./2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md).

That design prices each call from the `usage` object the API returns. That's
exact for the calls the worker makes directly to OpenAI (narration, embeddings),
but not for the Hermes calls, which are ~99.6% of spend. Findings from 10/9 UTC
(key `key_PAjkKbDrYAAZDMei`, $6.40 billed):

- Hermes reports its model as `hermes-agent`. Upstream it calls `gpt-5.6-sol`
  ($6.38 of the $6.40).
- `worker/diagnose_usage.py` shows Hermes returns only `prompt_tokens` /
  `completion_tokens`. `prompt_tokens_details` and `completion_tokens_details`
  are `null`, so cached input and cache writes are invisible per call.
- Hermes's totals are right: in the 18:00 UTC hour, the tracked jobs scaled to
  the hour's job count land within ~5% of OpenAI's own token counts.
  Each Hermes request fans out to ~2.6 upstream calls, and Hermes sums them.
- The cache split matters: on 10/9, 72% of upstream input was cached reads
  (billed at $0.40/1M) and 27% were cache writes ($5/1M). Pricing every input
  token at the $4 list rate gives $13.34 instead of $6.38.
- Jobs run on the old worker before tracking began (13:00, 16:00 and
  18:13–18:16 UTC) appear in OpenAI's bill but not in our events.

## Decision

Hermes calls get a **live estimate** while the day is in progress, then a
**true-up** to OpenAI's actual bill once the day is complete. Directly priced
OpenAI calls are unchanged.

### 1. Upstream mapping

A `hermes-agent` price row carries the upstream model's list rates (gpt-5.6-sol:
$4 input, $0.40 cached, $5 cache writes, $20 output), plus a new optional field
`upstreamModel: 'gpt-5.6-sol'`, so the true-up knows which OpenAI line items and
usage rows belong to Hermes.

### 2. Live estimate (calibration factor)

```
listCost   = input × $4 + output × $20        (every input token at full price)
estimate   = listCost × calibrationFactor
```

`calibrationFactor` = billed `upstreamModel` cost ÷ that model's list-price cost
for the same tokens, over the last 7 UTC days including today so far (Costs API
for dollars, Usage API for tokens). It's a ratio, so a partial day is still a
valid sample, and including it means a new deployment calibrates on its first
day instead of running at list price for a week. On 10/9 it's 6.38 ÷ 13.34 ≈
0.48. The factor is stored on the price row with the date it was computed, and
recalculated by the true-up.
Without an admin key, or with no history yet, it's 1.0 (list price), flagged
as such.

Events priced this way are marked `costBasis: 'estimated'`.

### 3. Daily true-up

For each complete UTC day D (run hourly from 06:00 UTC on D+1, when OpenAI's
figures have usually settled, and on demand from the dashboard; idempotent):

```
billedUpstream  = Costs API, key filter, line items for upstreamModel on D
upstreamTokens  = Usage API, key filter, upstreamModel input+output on D (list-weighted)
trackedTokens   = our Hermes events on D (same list weighting)
trackedShare    = min(1, trackedTokens / upstreamTokens)
trackedBilled   = billedUpstream × trackedShare
```

Each Hermes event on D is re-priced to `trackedBilled × (its listCost ÷ Σ listCost)`
and marked `costBasis: 'billed'`. The day's untracked remainder
(`billedUpstream − trackedBilled`) is stored as one `DocTidyBilledRemainder` row
per day and shown on the dashboard as **"Untracked Hermes usage"**, not assigned
to any workspace.

Result: for complete days, the dashboard total plus the untracked row equals
OpenAI's bill for that key, and each workspace's share is proportional to the
tokens it actually used.

### 4. Dashboard

- Cost cells and totals show whether they're estimated or billed. Today is
  always estimated until it's trued up.
- New "Untracked Hermes usage" row under Unassigned, for days with a remainder.
- The reconciliation panel shows the current calibration factor and the last
  true-up time, plus a **True up now** button.

## Alternatives Considered

- **Price `hermes-agent` at list rates.** Simple, but overstates ~2×.
- **Get the cache split from Hermes.** It isn't exposed (verified with the
  diagnostic). Patching Hermes to forward `prompt_tokens_details` would make this
  exact. Worth raising upstream, and the worker already reads those fields, so it
  would start working with no code change. Not something we control today.
- **Hourly allocation via the Usage API.** The Usage API has hourly buckets but
  the Costs API is daily only, and cache writes are only visible as dollars in
  the Costs API. A daily true-up is the finest grain that matches the invoice.
- **Allocate the whole day's bill to tracked workspaces.** Rejected: on 10/9 it
  would charge Danner/Lacrosse for the jobs that ran before tracking began.

## Consequences

- Workspace costs for today move once when the true-up runs. The dashboard
  labels them, so the change isn't a surprise.
- The split between workspaces is proportional to list-weighted tokens. A
  workspace whose documents happen to hit the cache more often is charged the
  day's average rate, not its own.
- Needs `OPENAI_ADMIN_KEY` and the right `OPENAI_USAGE_API_KEY_IDS`. Without them
  the dashboard falls back to list prices, flagged as such.
- If Hermes ever routes to a different upstream model, `upstreamModel` must be
  updated, or the true-up finds no line items and flags it.
