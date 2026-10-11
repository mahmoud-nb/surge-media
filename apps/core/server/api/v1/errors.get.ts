import { API_ERRORS } from '#shared/utils/api'

defineRouteMeta({
  openAPI: {
    'operationId': 'getErrorCatalog',
    'tags': ['reference'],
    'summary': 'Catalogue des codes d\'erreur',
    'description': 'Codes stables des erreurs (champ `code` des problèmes RFC 9457), avec leur statut HTTP et leur titre ; cible du champ `type` des erreurs (`…/errors#CODE`). Public, sans identifiant.',
    'security': [],
    'responses': { 200: { $ref: '#/components/responses/ErrorCatalog' } },
    'x-i18n': {
      en: {
        summary: 'Error code catalog',
        description: 'Stable error codes (the `code` field of RFC 9457 problems), with their HTTP status and title; target of the `type` field of errors (`…/errors#CODE`). Public, no credential.',
      },
    },
  },
})

/**
 * GET /api/v1/errors — catalogue des codes d'erreur (public) : cible du champ `type` des
 * problèmes RFC 9457 (`…/api/v1/errors#CODE`).
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return { errors: Object.entries(API_ERRORS).map(([code, { status, title }]) => ({ code, status, title })) }
})
