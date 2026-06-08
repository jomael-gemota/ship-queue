# Relax CSP for /docs so VitePress inline bootstrap scripts run

**Date:** 2026-06-08
**Status:** accepted
**Author:** collaborative

## Context

Supersedes the CSP note in
[2026-06-06-user-guide-vitepress.md](./2026-06-06-user-guide-vitepress.md),
which assumed Helmet's default `script-src 'self'` would only cost "a brief
theme flash" on docs pages.

In production every button and link in the `/docs` guide is dead, while
`vitepress dev` works fine. Root cause: the static VitePress build bootstraps
the Vue app from **inline** `<script>` blocks in each page's HTML:

- `window.__VP_SITE_DATA__` (site config the app needs to mount)
- `window.__VP_HASH_MAP__` (page → hashed JS chunk map used for client-side
  navigation)
- the appearance/dark-mode and mac-os check scripts

Helmet (`src/index.ts`) applies a global CSP with the default
`script-src 'self'`, which blocks all inline scripts. So `__VP_SITE_DATA__` and
`__VP_HASH_MAP__` never get defined, the app fails to initialize/hydrate, and
no link or button responds. The dev server has no Helmet, so the bug is
invisible locally.

## Decision

Split the CSP into two Helmet instances and route by path in `src/index.ts`:

- **App routes:** keep the existing strict CSP unchanged.
- **`/docs` routes:** same directives, but add `'unsafe-inline'` to
  `script-src` so VitePress's inline bootstrap scripts execute.

A small dispatch middleware applies the docs CSP when `req.path` is `/docs` or
starts with `/docs/`, and the strict CSP otherwise. Styles already work because
Helmet's default `style-src` includes `'unsafe-inline'`.

## Alternatives Considered

- **Add CSP hashes for the inline scripts:** most secure, but `__VP_HASH_MAP__`
  / `__VP_SITE_DATA__` content (and thus their hashes) changes on every docs
  build, so the hash list would need regeneration each build — brittle.
- **Nonces:** VitePress's static build emits no nonce hooks; would require
  rewriting generated HTML at serve time.
- **Globally add `'unsafe-inline'`:** rejected — needlessly weakens CSP for the
  authenticated app; the relaxation should be confined to the static,
  non-sensitive docs.

## Consequences

- The static docs run under a slightly looser CSP (`script-src` allows inline).
  Acceptable: the guide is already public, non-sensitive, and contains only
  build-generated scripts. The main app keeps the strict policy.
- No change to the docs build pipeline; this is purely a serving-time header
  fix.
