import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// Content types for the pre-built VitePress guide assets.
const DOCS_MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.map': 'application/json',
}

// The user guide is a pre-built VitePress site copied into public/docs. The Vite
// dev server would otherwise intercept its hashed CSS/JS asset requests and
// return the app's index.html (breaking the guide's styling), so we serve the
// guide ourselves, before Vite's own middlewares run.
function serveGuideDocs() {
  const docsRoot = path.join(rootDir, 'public', 'docs')

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    try {
      // Mounted at /docs, so req.url is the path *after* /docs.
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let rel = urlPath.replace(/^\/+/, '')
      if (rel === '' || rel.endsWith('/')) rel += 'index.html'

      const filePath = path.join(docsRoot, rel)
      if (!filePath.startsWith(docsRoot)) return next()
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next()

      const ext = path.extname(filePath).toLowerCase()
      res.setHeader('Content-Type', DOCS_MIME[ext] || 'application/octet-stream')
      fs.createReadStream(filePath).pipe(res)
    } catch {
      next()
    }
  }

  return {
    name: 'serve-ship-queue-guide',
    configureServer(server: import('vite').ViteDevServer) {
      // Registered in the hook body so it runs before Vite's built-in middlewares.
      server.middlewares.use('/docs', handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    serveGuideDocs(),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
