import './config/env';
import path from 'path';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import passport from './config/passport';
import { connectDB } from './config/db';
import routes from './routes';
import { startSyncScheduler } from './services/syncScheduler';
import { startDocTidyPoller } from './services/docTidyPoller';
import { startDocTidyWorkerServer, WORKER_WS_PATH } from './services/docTidyWorkerRegistry';

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

// Middleware
const baseCspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  'img-src': ["'self'", 'data:', 'https:'],
};

// Strict CSP for the app itself.
const appHelmet = helmet({
  contentSecurityPolicy: { directives: baseCspDirectives },
});

// Relaxed CSP for the static VitePress guide under /docs. The build bootstraps
// the Vue app from inline <script> blocks (window.__VP_SITE_DATA__ and
// window.__VP_HASH_MAP__ for client-side navigation, plus appearance checks).
// The default `script-src 'self'` blocks those inline scripts, which leaves the
// docs un-hydrated so every link and button is dead. Allow inline scripts here
// only; the docs are public, non-sensitive, and contain only build output.
const docsHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      ...baseCspDirectives,
      'script-src': ["'self'", "'unsafe-inline'"],
    },
  },
});

app.use((req, res, next) => {
  if (req.path === '/docs' || req.path.startsWith('/docs/')) {
    return docsHelmet(req, res, next);
  }
  return appHelmet(req, res, next);
});
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the built frontend (single-origin deployment).
// From dist/index.js at runtime, the Vite build lives at ../frontend/dist.
const clientDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(clientDist));

// SPA fallback: send index.html for any non-API GET route so client-side
// routing works on page refresh / deep links.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// An explicit HTTP server, rather than app.listen, because the Doc Tidy parsing
// worker connects over WebSocket and needs the server's `upgrade` event.
const httpServer = createServer(app);
startDocTidyWorkerServer(httpServer);

const start = async () => {
  await connectDB();
  httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log(`Doc Tidy worker endpoint: ws://${HOST}:${PORT}${WORKER_WS_PATH}`);
  });
  // Keep orders in sync even when nobody has the web app open.
  await startSyncScheduler();
  // Same for Doc Tidy: capture matching mail as it arrives, not on demand.
  startDocTidyPoller();
};

start();
