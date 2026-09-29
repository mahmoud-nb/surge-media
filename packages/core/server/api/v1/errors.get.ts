import { API_ERRORS } from '#shared/utils/api'

/**
 * GET /api/v1/errors — catalogue des codes d'erreur (public) : cible du champ `type` des
 * problèmes RFC 9457 (`…/api/v1/errors#CODE`).
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return { errors: Object.entries(API_ERRORS).map(([code, { status, title }]) => ({ code, status, title })) }
})
