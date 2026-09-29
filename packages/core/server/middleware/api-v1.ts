import { randomUUID } from 'node:crypto'
import { isOriginAllowed } from '#shared/utils/origins'
import { authenticateApiRequest } from '../lib/api/context'
import { sendProblem } from '../lib/api/problem'
import { getProjectState } from '../lib/projects/state'

/**
 * Entrée de l'API publique v1 (`/api/v1/**`), avant les routes :
 *   1. identifiant de requête (X-Request-Id) ;
 *   2. CORS : sous /api/v1/projects/<id>/… seules les origines autorisées du projet (tous
 *      environnements) reçoivent les en-têtes ; ailleurs (/me, /projects) toute origine, puisque
 *      l'API n'utilise jamais de cookie (le contrôle anti-abus des clés publiques est fait à
 *      l'authentification). Jamais `Access-Control-Allow-Credentials` ;
 *   3. preflight OPTIONS : réponse 204, sans authentification (le navigateur n'envoie pas l'en-tête
 *      Authorization) ;
 *   4. authentification Bearer + limitation de débit (sauf documents publics) ; erreurs RFC 9457.
 * Les cookies ne sont jamais lus : aucune confusion possible avec la session d'administration.
 */

const PUBLIC_PATHS = new Set(['/api/v1/openapi.json', '/api/v1/errors'])
const ALLOW_METHODS = 'GET, HEAD, POST, PATCH, PUT, DELETE'
const ALLOW_HEADERS = 'Authorization, Content-Type, If-None-Match'
const EXPOSE_HEADERS = 'ETag, Location, RateLimit, RateLimit-Policy, Retry-After, X-Request-Id'

export default defineEventHandler(async (event) => {
  const pathname = event.path.split('?')[0]!
  if (pathname !== '/api/v1' && !pathname.startsWith('/api/v1/')) return

  const requestId = randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'X-Request-Id', requestId)

  const origin = getRequestHeader(event, 'origin')
  const isPublic = PUBLIC_PATHS.has(pathname)
  let corsAllowed = false
  if (origin) {
    const projectId = /^\/api\/v1\/projects\/([^/]+)/.exec(pathname)?.[1]
    if (isPublic || !projectId) {
      corsAllowed = true
    }
    else {
      const project = await getProjectState(decodeURIComponent(projectId))
      corsAllowed = Boolean(project && isOriginAllowed(origin, project.origins))
    }
    appendResponseHeader(event, 'Vary', 'Origin')
    if (corsAllowed) {
      setResponseHeaders(event, {
        'Access-Control-Allow-Origin': isPublic ? '*' : origin,
        'Access-Control-Expose-Headers': EXPOSE_HEADERS,
      })
    }
  }

  if (event.method === 'OPTIONS') {
    if (corsAllowed) {
      setResponseHeaders(event, {
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Max-Age': '7200',
      })
    }
    setResponseStatus(event, 204)
    return null
  }

  if (isPublic) return
  try {
    event.context.apiPrincipal = await authenticateApiRequest(event)
  }
  catch (error) {
    return sendProblem(event, error)
  }
})
