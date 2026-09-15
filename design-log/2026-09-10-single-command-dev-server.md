# Single-command dev startup for backend + frontend

**Date:** 2026-09-10
**Status:** accepted
**Author:** collaborative

## Context

Development required two terminals: `npm run dev` at the repo root for the
Express API (nodemon + ts-node on port 5000), and `cd frontend && npm run dev`
for the Vite dev server (port 5173, proxying `/api` to the backend). Forgetting
the second terminal is a common source of confusion — the app loads but every
API call fails through the proxy.

Since the two processes are already coupled by the Vite proxy, starting them
independently buys nothing.

## Decision

Run both dev servers from the root `npm run dev` using
[concurrently](https://github.com/open-cli-tools/concurrently) as a root
devDependency:

- `dev` — runs `dev:server` and `dev:client` together, prefixed and colored so
  the interleaved output is attributable to each process.
- `dev:server` — the previous root `dev` (`nodemon`), unchanged.
- `dev:client` — `npm --prefix frontend run dev`.
- `install:all` — installs root and `frontend/` dependencies in one step, so a
  fresh clone can reach `npm run dev` without a `cd`.

`concurrently -k` (`--kill-others`) is used so that Ctrl-C, or either process
exiting, tears down both instead of leaving an orphaned server holding a port.

Ports, the Vite `/api` proxy, and the production `build`/`start` scripts are
untouched; this is a developer-ergonomics change only.

## Alternatives Considered

- **`npm-run-all --parallel`:** equivalent, but unmaintained upstream and
  without `concurrently`'s kill-others / prefix-coloring defaults.
- **Shell backgrounding (`nodemon & vite`):** not portable to Windows (the
  primary dev environment here) and leaks processes on interrupt.
- **Vite plugin that boots Express in-process:** would collapse both servers
  into one process, but couples frontend HMR restarts to backend reloads and
  diverges from how production runs (compiled `dist/index.js`).
- **npm workspaces:** a larger restructuring of both manifests for a problem
  that one script solves; worth revisiting only if more packages appear.

## Consequences

- One new root devDependency.
- Backend and frontend logs share a terminal; the `server`/`client` prefixes
  keep them readable, and either can still be run alone via `dev:server` /
  `dev:client` when isolated output is needed.
- `npm run dev` now requires `frontend/node_modules` to be present; `install:all`
  covers this, and the failure mode is an immediate, explicit error from npm.
