# HH Sportswear B2B cookie from Sphere

**Date:** 2026-10-02
**Status:** accepted
**Author:** collaborative

## Context

Cookie Jar already refreshes Seller Central Outdoor Equipped US from Sphere.
HH Sportswear B2B (`helly-hansen-sports-b2b`) was a manual jar: operators pasted
the session on Configurations. Sphere now serves that session at
`/api/v1/cookie/provide/b2b-hhsportswear`.

## Decision

- One jar: `helly-hansen-sports-b2b`, named Helly Hansen Sports B2B. It calls
  Sphere at `/api/v1/cookie/provide/b2b-hhsportswear`. That id is the Sphere
  provider, not a second cookie jar.
- Same HTTP/auth/retry shape as Seller Central OE US. Default cron
  `0 0,6,12,18 * * *` (Asia/Manila). Seeded disabled until setup is finished.
  Seller Central stays the only scheduled jar.
- Token is `COOKIE_JAR_HH_SPORTSWEAR_TOKEN`. When that is unset, the fetcher
  uses `COOKIE_JAR_OE_US_TOKEN`.
- A row whose key is `b2b-hhsportswear` is removed when Helly Hansen Sports B2B
  already exists. If only the Sphere-id row exists, seed renames it back to
  `helly-hansen-sports-b2b` so a stored cookie is kept.
- A cookie saved on HH Sportswear → Configurations, or `HH_B2B_COOKIE`, still
  overrides the jar. Workwear stays manual.

## Consequences

- Restart the Cookie Jar worker (or wait for the next API boot that seeds jars)
  so the stray `b2b-hhsportswear` row is removed. Turn **Enabled** on for
  Helly Hansen Sports B2B when Sphere should start refreshing it. **Run now**
  fetches immediately.
- Clear a pasted Sportswear cookie on Configurations if Sphere should be the
  session that drafts use.
