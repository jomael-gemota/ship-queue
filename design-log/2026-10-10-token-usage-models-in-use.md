# Token Usage — "Models in use" on the Overview

**Date:** 2026-10-10
**Status:** accepted
**Author:** collaborative

## Context

Builds on [simplified Token Usage tabs](./2026-10-10-token-usage-dashboard-simplified-tabs.md).
The Overview shows what was spent, but not which model is doing the work or
what it costs per token. Today that means cross-referencing the purpose/model
breakdown with the price table on the other tab. The user asked for the
current model and its prices on the Overview.

## Decision

- "Current" means the model of the **most recent call for each purpose**
  (extraction, table view, correction lookup, …) in the **last 30 days**,
  regardless of the selected range. A purpose with no calls in 30 days isn't
  listed, so a switched-off feature (e.g. narration) drops off on its own.
- Prices come from the **current price table** (the same lookup used when a
  call is recorded), not the snapshot on the old event, so an edit shows up
  immediately.
- For an alias such as `hermes-agent`, show the upstream model it forwards
  to (`gpt-5.6-sol`) as the model, with "via Hermes". When calibrated, add one
  plain line saying what OpenAI recently billed relative to list price.
- The summary endpoint returns this as `currentModels`. It's one extra
  aggregation, using the `createdAt` index.
- On the Overview it's a compact card, **Models in use**: what each model is
  used for, the model, the input / cached input / cache-write / output price
  per 1M tokens, and when it was last used. A model with no price row says
  "No price set".

## Alternatives Considered

- **Read the model from worker / Hermes configuration.** That would show the
  configured model, but Hermes's config lives on another machine and is not
  exposed. The model that actually answered the last call is both available
  and more truthful.
- **Show every model used in the selected range.** That's already the
  purpose/model breakdown. This card answers "what's running now?"

## Consequences

- After a model switch, the card updates as soon as the next call of that
  purpose is recorded.
- If Hermes switches upstream model, the card still shows the old upstream
  until an admin updates the `hermes-agent` row. This is the same dependency
  the true-up already has.
