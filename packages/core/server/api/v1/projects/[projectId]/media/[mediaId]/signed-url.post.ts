import { apiSignedUrlBodySchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { handlerFor } from '../../../../../../lib/media/handlers'
import { signMediaAccess } from '../../../../../../lib/media/signing'
import { mediaBaseUrl, mediaPath } from '../../../../../../lib/media/urls'

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/signed-url — { target?, preset?, expiresIn? }
 * (portée media:read ; clé secrète ou jeton personnel : 403 CREDENTIAL_NOT_ALLOWED pour une clé
 * publique). Lien temporaire (échéance exacte, 60 s à 7 jours) vers l'original (`file`), un dérivé
 * nommé (`preset`), ou signature valable pour tout dérivé de la version (`derived` : `query` à
 * ajouter aux URL des dérivés). Média public : URL permanente, `expiresAt: null`.
 * → { url, query, expiresAt }
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.credential.type === 'PUBLISHABLE') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Signed links are issued to secret keys and personal tokens only.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const body = await readApiBody(event, apiSignedUrlBodySchema)
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
