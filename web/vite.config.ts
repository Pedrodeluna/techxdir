import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Serve the same public badge handler locally as Vercel does in production.
function localBadgePages(): Plugin {
  return {
    name: 'local-badge-pages',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, 'VITE_')
      process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL
      process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1:55330')
        if (!/^\/acreditacion\/[^/]+(?:\/imagen\.png)?\/?$/.test(url.pathname) && url.pathname !== '/api/badge') return next()
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end()
          return
        }
        try {
          const { GET } = await server.ssrLoadModule('/api/badge.ts')
          const response: Response = await GET(new Request(url))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localBadgePages()],
  server: {
    host: '127.0.0.1',
    port: 55330,
    strictPort: true,
  },
})
