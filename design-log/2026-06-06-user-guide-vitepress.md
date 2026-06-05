# User guide with VitePress, served same-origin at /docs

**Date:** 2026-06-06
**Status:** accepted
**Author:** collaborative

## Context

The app has no end-user documentation. Non-technical fulfillment staff need a
simple, readable guide that walks them through each feature (Orders, Create
Shipping Label / batches, Dropbox Fetcher, Settings, User Management) so they
can use the system without hand-holding.

The system ships as a single-origin deployment: the Express backend
(`src/index.ts`) serves the built React app from `frontend/dist` via
`express.static`, with an `app.get('*')` SPA fallback for non-API routes.

## Decision

Build the guide with **VitePress** and serve it from the same origin at
`/docs`, with a "Guide" link added to the app header (`Navbar.tsx`) that opens
it in a new tab.

- **Location:** docs source lives at the repo root in `docs/`.
- **Build output:** VitePress builds (with `base: '/docs/'`) to its default
  location, then the `docs:build` script copies the output into
  **`frontend/public/docs`**. Vite serves `public/` at the web root in dev, and
  `vite build` copies `public/` into `frontend/dist`, so the guide is available
  at `/docs` in dev, `vite preview`, and the Express production server alike.
- **Build wiring:** `docs:build` runs *before* the frontend build in the root
  `build` script, so Vite copies the freshly built guide from `public/docs`
  into `frontend/dist/docs`.
- **Clean URLs off (default):** generated links keep the `.html` extension so
  deep links resolve as real static files and never fall through to the SPA
  `index.html`.
- **Header entry point:** a plain `<a href="/docs/index.html" target="_blank">`
  (not a React Router link) forces a full navigation to the static site. The
  link targets `index.html` explicitly because the Vite dev server rewrites a
  bare directory request (`/docs/`) to the app's `index.html` (SPA fallback),
  which would bounce the user back into the app; requesting the real
  `index.html` file is served directly in every mode.

### Why not `outDir` straight into `frontend/dist/docs`, and why not a bare `/docs/`
Two issues surfaced during implementation and shaped the approach above:
1. Setting VitePress `outDir` outside the project root tripped a manifest bug
   (`Cannot read properties of undefined (reading 'imports')`) during page
   rendering, so we build to the default dir and copy instead. On Windows the
   build also needs `vite.resolve.preserveSymlinks: true` to avoid a
   drive-letter casing mismatch in the same code path.
2. A bare `/docs/` link works under Express and `vite preview`, but the Vite
   dev server serves the SPA for it. Using `frontend/public/docs` +
   `/docs/index.html` makes the guide work uniformly across dev, preview, and
   production.
- **Content:** full beginner-friendly pages plus an **About** page (developer
  details, project purpose, version). Tone is short, step-by-step, jargon-free.

## Alternatives Considered

- **Separate hosted docs site (GitHub Pages / Netlify):** rejected for now — adds
  hosting/infra and an external URL to maintain; the single-origin approach keeps
  everything in one deploy with zero extra services.
- **In-app React docs pages (inside the SPA):** rejected — would couple docs to
  the app build, lose VitePress search/markdown authoring ergonomics, and require
  auth to view; static docs are simpler for non-technical readers.
- **Serving docs via a dedicated Express route/middleware:** unnecessary — placing
  the build under `frontend/dist/docs` reuses the existing static middleware.

## Consequences

- One extra build step and a `vitepress` devDependency at the repo root.
- Docs are publicly reachable at `/docs` (not behind app auth). Acceptable for a
  non-sensitive user guide; revisit if sensitive details are ever added.
- The built guide lives in `frontend/public/docs` (gitignored). It must be built
  (`npm run docs:build`) before it appears in dev; `npm run docs:dev` is still
  available for live authoring on a separate port.
- CSP: Helmet's default `script-src 'self'` allows VitePress's same-origin module
  scripts, but its inline appearance script may be blocked, possibly causing a
  brief theme flash on docs pages. Minor; can relax CSP for `/docs` if needed.
