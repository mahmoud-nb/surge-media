import { handlersMeta } from '#nitro-internal-virtual/server-handlers-meta'
import { apiOpenApiQuerySchema } from '#shared/schemas/api'
import { buildOpenApiDocument, openApiProblems } from '../../lib/api/openapi'
import { apiBaseUrl } from '../../lib/api/problem'

defineRouteMeta({
  openAPI: {
    'operationId': 'getOpenApiDocument',
    'tags': ['reference'],
    'summary': 'Spécification OpenAPI',
    'description': 'Cette spécification, générée depuis le code des routes et les schémas de validation. Publique (sans identifiant), CORS ouvert, en cache 5 minutes.',
    'security': [],
    'x-query': 'OpenApiQuery',
    'responses': {
      200: { $ref: '#/components/responses/OpenApiDocument' },
    },
    'x-i18n': {
      en: {
        summary: 'OpenAPI specification',
        description: 'This specification, generated from the route code and the validation schemas. Public (no credential), open CORS, cached for 5 minutes.',
      },
    },
  },
})

/**
 * GET /api/v1/openapi.json[?lang=fr|en] — spécification OpenAPI 3.1 de l'API v1 (publique, CORS
 * ouvert), assemblée depuis les `defineRouteMeta` des routes (server/lib/api/openapi.ts).
 * Mise en cache par langue pour l'URL de base courante ; en développement, les incohérences de la
 * documentation (route non décrite, traduction manquante…) sont signalées dans la console.
 */
let cache: { base: string, documents: Map<string, unknown> } | undefined
let checked = false

export default defineEventHandler((event) => {
  const { lang } = apiOpenApiQuerySchema.parse(getQuery(event))
  const base = apiBaseUrl(event)
  if (import.meta.dev && !checked) {
    checked = true
    for (const problem of openApiProblems(handlersMeta, base)) console.warn(`[surge-media] OpenAPI — ${problem}`)
  }
  if (cache?.base !== base) cache = { base, documents: new Map() }
  let document = cache.documents.get(lang)
  if (!document) {
    document = buildOpenApiDocument(handlersMeta, { serverUrl: base, lang })
    cache.documents.set(lang, document)
  }
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return document
})
