# Cookie Jar worker

**Date:** 2026-09-11
**Updated:** 2026-09-21
**Status:** accepted
**Author:** collaborative

## Context

Ship Queue already has an in-process `setInterval` scheduler for ShipStation
order sync. We also need a repeating job that fetches session cookies from
external APIs (starting with Outdoor Equipped US) and stores the latest value
in Mongo so other parts of the app can read it.

This is a different job than order sync: different secrets, a cron expression
rather than an interval, and a value that should be treatable as a secret. A
dedicated long-running process keeps cookie refresh off the HTTP API.

Admins should be able to change name / enabled / cron from a UI later. Adding a
*new kind* of fetch stays a code change.

## Decision

- **Worker process** `src/cookie-jar/`, started separately (`npm run cookie-jar`
  / `cookie-jar:dev`). Replicas = 1. Tiny `/health` server for Railway.
- **Code owns fetchers.** `registry.ts` maps `key` → function. The first key is
  `seller-central-outdoor-equipped-us`. Credentials used to *obtain* the cookie
  live in env.
- **Mongo owns knobs and results.** `CookieJar` stores `key`, `name`, `enabled`,
  `cron` (Asia/Manila), `cookie` (`select: false`), `lastRunAt`, `lastSuccessAt`,
  `lastError`.
- **Insert-if-missing seed** on worker/API boot. The original
  `outdoor-equipped-us` row is renamed in place (cookie / last-run kept; name and
  cron set to Seller Central Outdoor Equipped US / `0 0,6,12,18 * * *`). After that,
  the worker never overwrites name / enabled / cron.
- **Config poll** every 30s rebinds crons when enabled/cron change, so a
  Settings save takes effect without restarting the worker (the API cannot call
  into the worker’s memory).
- Overlapping ticks for the same key are skipped. Failed runs keep the last
  good cookie and record `lastError`.
- **Settings UI** lists jars (GET `/api/settings/cookie-jars`) and admins PATCH
  name / enabled / cron. The cookie value is never returned (`hasCookie` only).
  No add/delete in the UI — new fetcher kinds stay a code change. No Bull/Redis.

## Consequences

- Railway needs a second service with start command `npm run cookie-jar`
  (after `npm run build`), sharing `MONGODB_URI`.
- Settings **Cookie Jar** card is the admin UI. Adding a *fetched* jar type is
  still a new fetcher + a new seed row. Helly Hansen Sports and Work B2B are
  **manual** jars (`helly-hansen-sports-b2b`, `helly-hansen-work-b2b`): seeded
  and listed, not refreshed by Sphere. Prefer Dropship (B2B) → brand →
  Configurations for those cookies.
- Cron is Philippines time (`Asia/Manila`). A start or restart waits for the
  next matching clock time. Set the schedule shorter than the cookie’s real TTL.
- Seller Central Outdoor Equipped US GETs Sphere
  `/api/v1/cookie/provide/seller-central-oe-us` (up to 3 tries) and stores
  `data.cookie`. Auth token is `COOKIE_JAR_OE_US_TOKEN`. Default cron is
  `0 0,6,12,18 * * *` (12:00 AM, 6:00 AM, 12:00 PM, 6:00 PM).
