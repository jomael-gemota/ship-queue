# Token Usage Dashboard — Simplified Overview with Tabs

**Date:** 2026-10-10
**Status:** accepted
**Author:** collaborative

## Context

Revises the page layout from
[token usage and cost dashboard](./2026-10-10-doc-tidy-token-usage-and-cost-dashboard.md)
and [Hermes cost calibration](./2026-10-10-hermes-cost-calibration-and-daily-true-up.md).
Data, pricing and the true-up are unchanged.

Today everything is on one long page: token columns (input / cached / output),
a purpose/model breakdown, OpenAI line items, the calibration panel and the
price editor. That's useful for whoever maintains the pricing, but people who
only want to know "how much did we spend, and on whom?" have to dig for it.

## Decision

The page stays at `/doc-tidy/usage` and gets two tabs. The selected tab is
kept in the URL (`?tab=`) so it can be linked to.

### 0. Access

Every signed-in user can view the whole page, both tabs included. This
reverses the admin-only access from the original design: knowing what Doc
Tidy costs is useful to everyone who uses it, and the page holds no secrets.
OpenAI keys never reach the browser, only totals and line items.
Actions that change data stay admin-only, on both the server and in the UI:
editing, adding and deleting prices, **Re-price**, and **True up now**.
Non-admins see these values read-only.

### 1. Overview (default) — "how much did we spend, on whom, and how many tokens?"

- Range picker and Live badge, as today.
- Four headline cards in plain words:
  - **Spent**: the total in dollars.
  - **Documents processed**: the number of parse jobs.
  - **Average per document**.
  - **Tokens used**: input and output.
- One plain sentence under the cards when today is included: "Today's amount
  is an estimate. It becomes final once OpenAI bills the day, around 2 PM
  your time the next day." The time is shown in the viewer's timezone. No ≈
  symbols or "calibration" wording.
- **Spending by organization**: one table with costs and tokens together.
  Columns: documents, input tokens, cached tokens, output tokens, dollars, and
  share of the total. Tokens are shown compactly (e.g. 1.2M), with the exact
  number on hover. Click to expand into workspaces. Untracked Hermes spend is
  labeled "Not linked to a workspace".
- **Daily spending** chart with date labels and the dollar amount on hover.
- **By purpose & model**: what each part of Doc Tidy (extraction, table view,
  embeddings…) used and cost, in plain dollars.

### 2. Billing & prices — "does it match OpenAI, and at what rates?"

- The warnings for unpriced calls and missing usage, with a dot on the tab
  when there are any.
- **Recorded vs. billed** with OpenAI's line items, Hermes calibration and
  **True up now**.
- The model price table, its editor and **Re-price**.

## Alternatives Considered

- **Separate pages per section.** More sidebar entries for what is one
  feature; tabs keep it together.
- **Opening only Overview to non-admins.** Considered, but the user chose
  full read access for everyone.
- **A separate "Usage details" tab for tokens.** Tried first. It split one
  organization table into two (dollars on one tab, tokens on another). The
  user preferred seeing both in a single table.

## Consequences

- One table answers both "what did it cost" and "how much did it use", so
  nobody has to flip between tabs to compare.
- The Overview table is wider. On narrow screens it scrolls horizontally.
- Warnings are no longer on the default tab. The tab dot keeps them from
  going unnoticed.
- Read-only endpoints (`GET /usage/summary`, `/usage/reconciliation` and
  `/usage/prices`) move from `requireAdmin` to plain authentication. Every
  `POST`, `PUT` and `DELETE` stays behind `requireAdmin`. Reconciliation makes
  OpenAI Admin API calls, but these are cached for 10 minutes, and only an
  admin can bypass the cache with `refresh=1`.
