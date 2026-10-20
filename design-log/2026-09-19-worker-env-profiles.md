# Worker Environment Profiles (`--env` flag)

**Date:** 2026-09-19
**Status:** accepted
**Author:** collaborative

## Context

The Doc Tidy worker previously read `SERVER_WS_URL` from a single `.env` file,
making it impossible to target different servers (localhost dev, staging,
production) without manually editing that file. The Ubuntu worker machine needed
to simultaneously support:

- A Windows PC's localhost development server (reachable via LAN IP)
- The staging WebSocket endpoint
- Eventually the production WebSocket endpoint

## Decision

Added a `--env FILE` CLI argument to `worker.py`. When provided, `load_dotenv`
loads that file instead of the default `.env`. This allows named profiles:

```
.env                # default (unchanged behaviour)
.env.local          # Windows localhost dev (ws://192.168.x.x:5000/ws/doc-tidy)
.env.staging        # staging environment
.env.production     # production environment
```

Usage:

```bash
python worker.py                        # loads .env
python worker.py --env .env.staging     # loads .env.staging
python worker.py --env .env.local       # loads .env.local
python worker.py --env .env.production  # loads .env.production
```

To connect to **two environments simultaneously**, open two terminals and run
each with its own `--env` flag. Each process maintains its own independent
WebSocket connection.

`argparse.ArgumentParser` is used with `add_help=False` and
`parse_known_args()` so the flag does not interfere with any future positional
arguments or conflict with system runners.

## Alternatives Considered

- **Shell-level env override** (`SERVER_WS_URL=... python worker.py`) — no code
  change required, but awkward to use consistently and hard to encode all the
  other per-environment settings (e.g. `MONGODB_URI`, `DOC_TIDY_WORKER_TOKEN`).
- **Multi-target worker** — a single process managing multiple WebSocket
  connections concurrently. More powerful but significantly more complex, and
  risks cross-environment job processing confusion during development.
- **`ENV` environment variable selecting profile** — similar to `--env` flag but
  less explicit and harder to see at a glance which profile is active.

## Consequences

- **Zero breaking change** — `python worker.py` with no arguments behaves
  identically to before.
- Each profile file only needs to override the settings that differ
  (typically `SERVER_WS_URL`, `MONGODB_URI`, and `DOC_TIDY_WORKER_TOKEN`).
- `.env.example` updated with the full usage guide and LAN IP note.
- Profile files (`.env.local`, `.env.staging`, `.env.production`) are **not**
  committed; add them to `.gitignore` if not already covered.
