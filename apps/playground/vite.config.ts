import type { IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv, type Plugin } from 'vite'
// Entrée serveur du client, lue depuis ses sources (comme les paquets dans le navigateur) : aucun build requis.
import { createDelegatedToken, DISPLAY_SCOPES, isSurgeApiError, UPLOAD_SCOPES } from '../../packages/client/src/server'

/**
 * Bac à sable des bibliothèques front (port 5173), branché sur un core local. Les paquets sont lus depuis
 * leurs sources (rechargement à chaud). Configuration : `.env.local` (modèle `.env.example`, setup.md § 17).
 * La clé secrète n'est lue que par le serveur Vite, qui émet les jetons délégués (`POST /api/token`) avec
 * `createDelegatedToken` de `@surge-media/client/server` : elle n'atteint jamais le navigateur (aucune
 * variable `VITE_`).
 */
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const ORIGIN = 'http://localhost:5173'

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

function delegatedTokens(env: Record<string, string>): Plugin {
  return {
    name: 'surge-media-delegated-tokens',
    configureServer(server) {
      server.middlewares.use('/api/token', async (request, response) => {
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'no-store')
        if (request.method !== 'POST') {
          response.statusCode = 405
          return response.end()
        }
        if (!env.SURGE_SECRET_KEY || !env.SURGE_PROJECT_ID || !env.SURGE_BASE_URL) {
          response.statusCode = 503
          return response.end(JSON.stringify({ error: 'SURGE_BASE_URL, SURGE_PROJECT_ID and SURGE_SECRET_KEY are required in .env.local.' }))
        }
        // Lecture (par défaut) ou envoi (`{ "purpose": "upload" }`) : lié à l'origine du bac à sable, 15 min,
        // renouvelé par le client. Envoi : 20 fichiers par jeton, 50 Mio au plus chacun.
        const upload = (await readJson(request)).purpose === 'upload'
        try {
          const token = await createDelegatedToken({
            baseUrl: env.SURGE_BASE_URL,
            projectId: env.SURGE_PROJECT_ID,
            secretKey: env.SURGE_SECRET_KEY,
            scopes: upload ? UPLOAD_SCOPES : DISPLAY_SCOPES,
            ...(upload ? { upload: { maxFiles: 20, maxSize: 50 * 1024 * 1024 } } : {}),
            expiresIn: 900,
            subject: 'playground',
            origin: ORIGIN,
          })
          response.statusCode = 201
          response.end(JSON.stringify(token))
        }
        catch (error) {
          response.statusCode = isSurgeApiError(error) && error.status > 0 ? error.status : 502
          response.end(JSON.stringify({ error: isSurgeApiError(error) ? error.code : String(error) }))
        }
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
