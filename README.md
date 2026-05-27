# ship-queue

🚢 Ship Queue is an internal bulk shipping tool that integrates with ShipStation's API to streamline label creation and order processing. Upload and manage multiple shipments at once, generate carrier labels in bulk, and keep your fulfillment team moving fast — all from a single interface.

## Tech Stack

| Layer    | Technology                              |
| -------- | --------------------------------------- |
| Frontend | React 19, Vite, TypeScript, TailwindCSS |
| Backend  | Node.js, Express, TypeScript            |
| Database | MongoDB (via Mongoose)                  |

## Project Structure

```
ship-queue/
├── src/                      # Backend source
│   ├── config/               # DB connection
│   ├── controllers/          # Route handlers
│   ├── middleware/           # Express middleware
│   ├── models/               # Mongoose models
│   └── routes/               # API routes
├── frontend/                 # React app
│   └── src/
│       ├── components/       # Reusable UI components
│       ├── hooks/            # Custom React hooks
│       ├── lib/              # API client & utilities
│       ├── pages/            # Route-level page components
│       └── types/            # Shared TypeScript types
├── .env.example              # Environment variable template
├── nodemon.json              # Dev server config
├── package.json              # Backend dependencies
└── tsconfig.json             # Backend TypeScript config
```

## Getting Started

### Prerequisites

- Node.js >= 18
- MongoDB (local or Atlas)

### 1. Clone & install

```bash
# Backend
npm install

# Frontend
cd frontend && npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your MONGODB_URI and other values
```

### 3. Run in development

```bash
# Terminal 1 — Backend (http://localhost:5000)
npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend && npm run dev
```

### 4. Build for production

```bash
# Backend
npm run build && npm start

# Frontend
cd frontend && npm run build
```

## API Endpoints

| Method | Path                  | Description          |
| ------ | --------------------- | -------------------- |
| GET    | `/api/shipments`      | List all shipments   |
| GET    | `/api/shipments/:id`  | Get a shipment       |
| POST   | `/api/shipments`      | Create a shipment    |
| PUT    | `/api/shipments/:id`  | Update a shipment    |
| DELETE | `/api/shipments/:id`  | Delete a shipment    |
| GET    | `/health`             | Server health check  |
