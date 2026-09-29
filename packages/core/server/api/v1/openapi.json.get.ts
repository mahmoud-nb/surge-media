import { buildOpenApiDocument } from '../../lib/api/openapi'
import { apiBaseUrl } from '../../lib/api/problem'

let cached: { base: string, document: ReturnType<typeof buildOpenApiDocument> } | undefined

/** GET /api/v1/openapi.json — spécification OpenAPI 3.1 de l'API v1 (publique, CORS ouvert). */
export default defineEventHandler((event) => {
  const base = apiBaseUrl(event)
  if (cached?.base !== base) cached = { base, document: buildOpenApiDocument(base) }
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return cached.document
})
