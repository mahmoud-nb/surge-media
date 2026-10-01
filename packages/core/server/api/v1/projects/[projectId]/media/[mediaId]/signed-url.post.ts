import { apiSignedUrlBodySchema } from '#shared/schemas/api'
import { DELEGATED_SIGNED_URL_MAX_TTL } from '#shared/utils/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { handlerFor } from '../../../../../../lib/media/handlers'
import { signMediaAccess } from '../../../../../../lib/media/signing'
import { mediaBaseUrl, mediaPath } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'createSignedUrl',
    'tags': ['media'],
    'summary': 'Lien temporaire vers un média',
    'description': 'Lien signé (échéance exacte, 60 s à 7 jours ; 1 h au plus avec un jeton délégué) vers l\'original (`file`), un dérivé nommé (`preset`), ou signature valable pour tout dérivé de la version (`derived`). Média public : URL permanente, `expiresAt: null`.',
    'x-scopes': ['media:read'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'CREDENTIAL_NOT_ALLOWED',
      'MEDIA_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/SignedUrlRequest' },
    'responses': { 200: { $ref: '#/components/responses/SignedUrl' } },
    'x-i18n': {
      en: {
        summary: 'Temporary link to a media item',
        description: 'Signed link (exact expiry, 60 s to 7 days; 1 h at most with a delegated token) to the original (`file`), a named derivative (`preset`), or a signature valid for any derivative of the version (`derived`). Public media item: permanent URL, `expiresAt: null`.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/signed-url — { target?, preset?, expiresIn? }
 * (portée media:read ; clé secrète, jeton personnel ou jeton délégué — 1 h au plus ; 403
 * CREDENTIAL_NOT_ALLOWED pour une clé publique). Lien temporaire (échéance exacte, 60 s à 7 jours) vers l'original (`file`), un dérivé
 * nommé (`preset`), ou signature valable pour tout dérivé de la version (`derived` : `query` à
 * ajouter aux URL des dérivés). Média public : URL permanente, `expiresAt: null`.
 * → { url, query, expiresAt }
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type === 'publishable') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Signed links are issued to secret keys, personal tokens and delegated tokens only.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const body = await readApiBody(event, apiSignedUrlBodySchema)
  if (principal.delegated && body.expiresIn > DELEGATED_SIGNED_URL_MAX_TTL) {
    throw apiProblem('INVALID_REQUEST', `Delegated tokens can request links valid for ${DELEGATED_SIGNED_URL_MAX_TTL} seconds at most.`)
  }
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  if (body.target !== 'file' && !handlerFor(media.kind)?.preview) {
    throw apiProblem('INVALID_REQUEST', 'This media has no derived files.')
  }

  const variant = body.target === 'file' ? undefined : (body.preset ?? 'preview')
  const url = `${mediaBaseUrl(event)}${mediaPath(media, variant)}`
  if (media.visibility === 'PUBLIC') return { url, query: '', expiresAt: null }

  const expires = Math.floor(Date.now() / 1000) + body.expiresIn
  const query = body.target === 'derived'
    ? signMediaAccess(media, { scope: 'derived' }, expires)
    : signMediaAccess(media, { variant: variant ?? 'original' }, expires)
  return { url: `${url}?${query}`, query, expiresAt: new Date(expires * 1000).toISOString() }
})
