import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Bac à sable des bibliothèques front (port 5173), branché sur un core local. Les paquets sont lus depuis
 * leurs sources (rechargement à chaud). Configuration : `.env.local` (modèle `.env.example`, setup.md § 17).
 * La clé secrète n'est lue que par le serveur Vite, qui émet les jetons délégués (`POST /api/token`) : elle
 * n'atteint jamais le navigateur (aucune variable `VITE_`).
 */
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

function delegatedTokens(env: Record<string, string>): Plugin {
  return {
    name: 'surge-media-delegated-tokens',
    configureServer(server) {
      server.middlewares.use('/api/token', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          return response.end()
        }
        if (!env.SURGE_SECRET_KEY || !env.SURGE_PROJECT_ID) {
          response.statusCode = 503
          return response.end(JSON.stringify({ error: 'SURGE_SECRET_KEY and SURGE_PROJECT_ID are required in .env.local.' }))
        }
        // Jeton de lecture, lié à l'origine du bac à sable, valable 15 min (renouvelé par le client).
        const upstream = await fetch(`${env.SURGE_BASE_URL}/api/v1/projects/${env.SURGE_PROJECT_ID}/delegated-tokens`, {
          method: 'POST',
          headers: { 'authorization': `Bearer ${env.SURGE_SECRET_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ scopes: ['project:read', 'media:read'], expiresIn: 900, subject: 'playground', origin: 'http://localhost:5173' }),
        })
        response.statusCode = upstream.status
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'no-store')
        response.end(await upstream.text())
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'SURGE_')
  return {
    plugins: [vue(), delegatedTokens(env)],
    define: {
      __PLAYGROUND__: JSON.stringify({
        baseUrl: env.SURGE_BASE_URL ?? '',
        projectId: env.SURGE_PROJECT_ID ?? '',
        publishableKey: env.SURGE_PUBLISHABLE_KEY ?? '',
      }),
    },
    resolve: {
      alias: [
        { find: /^@surge-media\/vue\/style\.css$/, replacement: source('../../packages/vue/src/styles/index.css') },
        { find: /^@surge-media\/vue$/, replacement: source('../../packages/vue/src/index.ts') },
        { find: /^@surge-media\/client$/, replacement: source('../../packages/client/src/index.ts') },
      ],
    },
    server: { port: 5173, strictPort: true },
  }
})
