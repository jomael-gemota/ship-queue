# 🚢 Ship Queue

Ship Queue is an internal bulk shipping tool that integrates with **ShipStation's API** to streamline carrier label creation and order processing. Pull orders automatically, prepare and ship them in batches, generate carrier labels with built-in packing slips, and keep your fulfillment team moving fast — all from a single interface.

## Features

- **Automated order sync** — A background scheduler pulls new orders from ShipStation on a configurable interval, even when nobody has the app open.
- **Batch label creation** — Group orders into batches, preflight rates, override ship dates, and generate carrier labels in bulk.
- **Packing slips** — Native ShipStation packing slips are grafted onto each label PDF (via a non-billable USPS test label).
- **Bulk PDF / ZIP export** — Download an individual label PDF or an entire batch as a ZIP.
- **Google Drive uploads** — Optionally archive generated labels to Google Drive (any connected Google account, not just the login account).
- **Google OAuth login** — Sign-in via Google, with optional workspace-domain restriction.
- **Role & permission management** — Admins manage users, label-creation permissions, and sync configuration from the in-app Settings/Admin pages.

## User Guide

A non-technical, end-user guide is built with [VitePress](https://vitepress.dev/)
from the `docs/` folder. `docs:build` outputs it into `frontend/public/docs`, so
it is served at **`/docs/index.html`** in the Vite dev server, `vite preview`,
and the Express production server alike (Vite copies `public/` into the build
output). A **Guide** link in the app header opens it in a new tab.

```bash
npm run docs:dev      # author the guide with live reload (separate dev server)
npm run docs:build    # build the guide into frontend/public/docs (runs as part of `npm run build`, before the frontend build)
npm run docs:preview  # preview the standalone VitePress build
```

## Tech Stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 19, Vite, TypeScript, TailwindCSS, React Router 7 |
| Backend  | Node.js, Express, TypeScript                            |
| Database | MongoDB (via Mongoose)                                  |
| Auth     | Passport + Google OAuth 2.0, JWT                        |
| External | ShipStation API, Google Drive API                       |

## Project Structure

```
ship-queue/
├── src/                      # Backend source
│   ├── config/               # DB, env, and Passport config
│   ├── controllers/          # Route handlers
│   ├── middleware/           # Auth & error-handling middleware
│   ├── models/               # Mongoose models (Order, Shipment, Label, …)
│   ├── routes/               # API route definitions
│   ├── cookie-jar/           # Dedicated cookie-refresh worker (separate process)
│   └── services/             # ShipStation, Google Drive, sync scheduler, …
├── frontend/                 # React app
│   └── src/
│       ├── components/       # Reusable UI components
│       ├── context/          # Auth & theme context
│       ├── hooks/            # Custom React hooks
│       ├── lib/              # API client & utilities
│       ├── pages/            # Route-level page components
│       └── types/            # Shared TypeScript types
├── scripts/                  # One-off verification/maintenance scripts
├── design-log/               # Architecture & decision records
├── .env.example              # Environment variable template
├── nodemon.json              # Dev server config
├── package.json              # Backend dependencies & scripts
└── tsconfig.json             # Backend TypeScript config
```

## Getting Started

### Prerequisites

- Node.js >= 18
- MongoDB (local or Atlas)
- A Google Cloud OAuth client (for login and Drive uploads)
- ShipStation API credentials (for syncing orders and creating labels)

### 1. Clone & install

```bash
# Backend (from repo root)
npm install

# Frontend
cd frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in MONGODB_URI, Google OAuth, and ShipStation values
```

Key variables (see `.env.example` for the full list and inline notes):

| Variable                                  | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| `MONGODB_URI`                             | MongoDB connection string                              |
| `CLIENT_URL`                              | Frontend origin (CORS + OAuth redirects)               |
| `JWT_SECRET` / `JWT_EXPIRES_IN`           | JWT signing secret and lifetime                        |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials                             |
| `GOOGLE_CALLBACK_URL` / `DRIVE_CALLBACK_URL` | OAuth redirect URIs (login + Drive picker)          |
| `SHIPSTATION_API_KEY` / `SHIPSTATION_API_SECRET` | ShipStation API credentials                     |
| `AUTO_SYNC_ENABLED` / `AUTO_SYNC_INTERVAL_MS` | Initial background order-sync seed config         |
| `COOKIE_JAR_PORT`                         | Cookie Jar health port (local; default 5001)       |
| `COOKIE_JAR_OE_US_TOKEN`                  | Sphere API token for Seller Central OE US cookies  |
| `HH_B2B_COOKIE` / `HH_B2B_BASE_URL` / `HH_B2B_CATALOG` / `HH_B2B_ACCOUNT_ID` | Helly Hansen Sports B2B session (cookie optional if Cookie Jar has it) |
| `SHIP_FROM_WAREHOUSE_ID` / `SHIP_FROM_*`  | Ship-from origin warehouse / fallback address          |

### 3. Run in development

```bash
# Terminal 1 — Backend (http://localhost:5000)
npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend && npm run dev

# Terminal 3 — Cookie Jar worker (optional; http://localhost:5001/health)
npm run cookie-jar:dev
```

### 4. Build for production

The backend build also compiles the frontend and serves it from the same origin:

```bash
npm run build   # compiles backend (tsc) + installs/builds frontend
npm start       # serves API + built frontend from http://localhost:5000
```

## Available Scripts

**Backend** (repo root):

| Script          | Description                                        |
| --------------- | -------------------------------------------------- |
| `npm run dev`   | Start backend with hot reload (nodemon)            |
| `npm run build` | Compile backend (tsc) and build the frontend       |
| `npm start`     | Run the compiled server (serves API + frontend)    |
| `npm run lint`           | Lint backend TypeScript                            |
| `npm run cookie-jar:dev` | Cookie Jar worker with hot reload                  |
| `npm run cookie-jar`     | Run the compiled Cookie Jar worker                 |

**Frontend** (`frontend/`):

| Script            | Description                       |
| ----------------- | --------------------------------- |
| `npm run dev`     | Start Vite dev server             |
| `npm run build`   | Type-check and build for production |
| `npm run lint`    | Lint frontend                     |
| `npm run preview` | Preview the production build      |

## API Overview

All routes are mounted under `/api`. Most require a valid JWT (`requireAuth`); label creation requires an explicit permission, and admin/sync management requires an admin role.

### Auth — `/api/auth`

| Method | Path                 | Description                                   |
| ------ | -------------------- | --------------------------------------------- |
| GET    | `/google`            | Begin Google OAuth login                      |
| GET    | `/google/callback`   | OAuth callback                                |
| GET    | `/drive/connect`     | Connect a Google account for Drive uploads    |
| GET    | `/me`                | Get the current authenticated user            |
| POST   | `/logout`            | Log out                                       |

### Orders — `/api/orders`

| Method | Path           | Description                          |
| ------ | -------------- | ------------------------------------ |
| GET    | `/`            | List synced orders                   |
| GET    | `/sync-status` | Get current sync status              |
| GET    | `/:id/items`   | Get line items for an order          |
| POST   | `/sync`        | Trigger a manual order sync          |

### Labels & Batches — `/api/labels`

| Method | Path                       | Description                                 |
| ------ | -------------------------- | ------------------------------------------- |
| GET    | `/`                        | List created labels                         |
| GET    | `/:id/pdf`                 | Download a label PDF                         |
| POST   | `/prepare` · `/create`     | Prepare / create labels (permission gated)  |
| GET    | `/batches`                 | List batches                                |
| POST   | `/batches`                 | Draft a new batch                           |
| GET    | `/batches/:id/items`       | Get batch items                             |
| GET    | `/batches/:id/labels.zip`  | Download all batch labels as a ZIP          |
| POST   | `/batches/:id/preflight`   | Preflight rates for a batch                 |
| POST   | `/batches/:id/create`      | Create labels for a batch                   |
| PATCH  | `/batches/:id/ship-date`   | Override a batch ship date                  |
| DELETE | `/batches/:id`             | Delete a batch                              |

### Settings — `/api/settings`

| Method | Path             | Description                                   |
| ------ | ---------------- | --------------------------------------------- |
| GET/PUT| `/`              | Get / update user settings                    |
| GET    | `/drive/folders` | List Google Drive folders                     |
| DELETE | `/drive`         | Disconnect Google Drive                       |
| GET/PUT| `/sync`          | Get / update auto-sync config (PUT = admin)   |
| GET    | `/cookie-jars`   | List cookie-jar schedules (no cookie values)  |
| PATCH  | `/cookie-jars/:key` | Update name / enabled / cron (admin)       |
| POST   | `/cookie-jars/:key/run` | Run a jar immediately (admin)           |

### Admin — `/api/admin` (admin only)

| Method | Path                     | Description                  |
| ------ | ------------------------ | ---------------------------- |
| GET    | `/users`                 | List users                   |
| PATCH  | `/users/:id/permissions` | Update user permissions      |
| DELETE | `/users/:id`             | Delete a user                |

### Shipments — `/api/shipments`

| Method | Path   | Description          |
| ------ | ------ | -------------------- |
| GET    | `/`    | List all shipments   |
| GET    | `/:id` | Get a shipment       |
| POST   | `/`    | Create a shipment    |
| PUT    | `/:id` | Update a shipment    |
| DELETE | `/:id` | Delete a shipment    |

### HH Sportswear — `/api/hh-sportswear`

B2B order groups with nested orders and line items. All routes require a JWT.

| Method | Path                         | Description                           |
| ------ | ---------------------------- | ------------------------------------- |
| GET    | `/`                          | List groups (full tree, newest first) |
| POST   | `/`                          | Create a group (JSON)                 |
| POST   | `/import`                    | Upload .xlsx/.csv or paste Order ID + PO |
| GET    | `/sc-sync`                   | Details fill runtime (chip)           |
| POST   | `/:groupId/sc-sync`          | Re-sync details for a whole batch     |
| POST   | `/:groupId/orders/:orderId/sc-sync` | Re-sync details for one order  |
| PATCH  | `/:groupId`                  | Update batch notes                    |
| PATCH  | `/:groupId/orders/:orderId`  | Update order notes                    |
| GET    | `/:groupId`                  | Get one group                         |
| DELETE | `/:groupId`                  | Delete a group                        |
| DELETE | `/:groupId/orders/:orderId`  | Delete one order from a group         |

Import creates one group (batch) and one order per **unique** Order ID + PO
Number pair. Duplicate rows are skipped. Files can list those columns in either
order when headers are present (`Order ID` / `PO Number`). You can also paste
rows in the import modal; headers are optional if one column is an Amazon Order
ID. New orders start with Details
`pending` and Cart `none`. Customer, address, and line items stay empty until
the Seller Central fill that runs right after upload. As soon as an Order ID
is **Synced**, a cart-draft job runs for that order against Helly Hansen Sports
B2B (`POST /api/documents/` with `do_submit: false` — no Place Order). Catalog
`ASAPSPORT` and account `9014876` are the Order Swift Sports brand defaults.
The session cookie lives in Cookie Jar `helly-hansen-sports-b2b` (or `HH_B2B_COOKIE`).
Cart becomes **Draft** when that step finishes. The Notes column starts
as the uploaded filename and can be edited later (for example `Skip: Cancelled`).
Each order also has its own Notes field.

### Cookie Jar worker

Dedicated process (not the API) that refreshes stored session cookies on a cron
from Mongo. Fetcher implementations live in `src/cookie-jar/jars/`; name,
enabled, cron, last cookie, and last run live in the `CookieJar` collection.

```bash
npm run cookie-jar:dev   # local
npm run cookie-jar       # compiled (Railway start command for the worker service)
```

Keep the worker at **one replica**. Cron expressions are UTC. A future Settings
UI can edit the Mongo row; the worker re-reads config every 30 seconds.

### Health

| Method | Path      | Description          |
| ------ | --------- | -------------------- |
| GET    | `/health` | Server health check  |

## License

MIT
