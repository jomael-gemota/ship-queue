# HH Workwear B2B cookie from Sphere

**Date:** 2026-10-07
**Status:** accepted
**Author:** collaborative

## Context

Cookie Jar already refreshes Helly Hansen Sports B2B from Sphere provider id
`b2b-hhsportswear`. HH Workwear B2B (`helly-hansen-work-b2b`) was a manual jar:
operators pasted the session on Configurations. Sphere now serves that session
at `/api/v1/cookie/provide/b2b-hhworkwear`.

## Decision

- One jar: `helly-hansen-work-b2b`, named Helly Hansen Work B2B. It calls
  Sphere at `/api/v1/cookie/provide/b2b-hhworkwear`. That id is the Sphere
  provider, not a second cookie jar.
- Same HTTP/auth/retry shape as Helly Hansen Sports B2B. Default cron
  `0 0,6,12,18 * * *` (Asia/Manila). Seeded disabled. An existing row keeps its
  name, enabled flag, and cron.
- Token is `COOKIE_JAR_HH_WORKWEAR_TOKEN`. When that is unset, the fetcher
  uses `COOKIE_JAR_OE_US_TOKEN`.
- A row whose key is `b2b-hhworkwear` is removed when Helly Hansen Work B2B
  already exists. If only the Sphere-id row exists, seed renames it back to
  `helly-hansen-work-b2b` so a stored cookie is kept.
- A cookie saved on HH Workwear → Configurations still overrides the jar.
  `HH_B2B_COOKIE` stays Sportswear-only.

## Consequences

- Restart the Cookie Jar worker (or wait for the next API boot that seeds jars)
  so the fetcher is registered. Turn **Enabled** on for Helly Hansen Work B2B
  when Sphere should start refreshing it. **Run now** fetches immediately.
- Clear a pasted Workwear cookie on Configurations if Sphere should be the
  session that drafts use.
