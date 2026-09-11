import http from 'http';

/**
 * Tiny health server so Railway (and local probes) can see the worker is up.
 * Prefers COOKIE_JAR_PORT so a local API on PORT=5000 does not collide.
 */
export function startHealthServer(): http.Server {
  const port = Number(process.env.COOKIE_JAR_PORT || process.env.PORT) || 5001;

  const server = http.createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'cookie-jar',
        timestamp: new Date().toISOString(),
      }));
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[cookie-jar] Health server on 0.0.0.0:${port}`);
  });

  return server;
}
