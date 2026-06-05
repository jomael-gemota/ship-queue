# Track and display Last Login in User Management

**Date:** 2026-06-06
**Status:** accepted
**Author:** collaborative

## Context

The User Management table (`AdminUsers.tsx`) shows each user's role, label
permission, and join date, but gives admins no signal of who is actually active.
Admins asked for a **Last Login** timestamp per user.

## Decision

- Add a `lastLoginAt?: Date` field to the `User` model.
- Set `user.lastLoginAt = new Date()` in the Google OAuth strategy
  (`config/passport.ts`) on every successful sign-in, just before the existing
  `user.save()`. The strategy callback runs on each interactive Google login, so
  it is the natural definition of "last login".
- Include `lastLoginAt` in the admin user-list projection
  (`admin.controller.ts` `listUsers`).
- Render a new **Last Login** column in the table (date + time, mirroring the
  existing "Joined" cell), showing an italic "Never" for users who predate this
  change or have not signed in since.

## Alternatives Considered

- **Update on every authenticated API request / JWT use** — rejected; that
  tracks activity, not login, and would add a write to the hot path. The OAuth
  callback is cheaper and matches the intended meaning.
- **Separate login-audit collection** — overkill for a single "last seen"
  timestamp; a field on `User` is sufficient and simple to surface.

## Consequences

- Existing users show "Never" until their next sign-in (the field is unset and
  backfilled on first login after deploy). No migration required.
- One extra field write per login (already inside the existing `save()`), so no
  additional database round-trip.
