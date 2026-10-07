# Thorogood B2B cookie from Sphere

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

Cookie Jar refreshes Helly Hansen Sports and Work from Sphere. Thorogood B2B
was a pasted session on Configurations. Sphere now serves that session at
`/api/v1/cookie/provide/b2b-thorogood`.

## Decision

- One jar: `thorogood-b2b`, named Thorogood B2B. It calls Sphere at
  `/api/v1/cookie/provide/b2b-thorogood`. That id is the Sphere provider, not
  a second cookie jar.
- Same HTTP/auth/retry shape as the Helly Hansen jars. Default cron
  `0 0,6,12,18 * * *` (Asia/Manila). Seeded disabled.
- Token is `COOKIE_JAR_THOROGOOD_TOKEN`. When that is unset, the fetcher uses
  `COOKIE_JAR_OE_US_TOKEN`.
- A row whose key is `b2b-thorogood` is removed when Thorogood B2B already
  exists. If only the Sphere-id row exists, seed renames it to `thorogood-b2b`
  so a stored cookie is kept.
- A cookie saved on Thorogood → Configurations still overrides the jar.
  `HH_B2B_COOKIE` stays Sportswear-only. Draft mode stays `order-details`.

## Consequences

- Restart the Cookie Jar worker (or wait for the next API boot that seeds jars)
  so the fetcher is registered. Turn **Enabled** on for Thorogood B2B when
  Sphere should start refreshing it. **Run now** fetches immediately.
- Clear a pasted Thorogood cookie on Configurations if Sphere should be the
  session that drafts use.
