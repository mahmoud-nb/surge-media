import { signedUrlSchema } from '#shared/schemas/media'
import { mediaError } from '../../../../lib/media/errors'
import { findMedia } from '../../../../lib/media/service'
import { mediaBaseUrl, mediaPath, signedMediaPath } from '../../../../lib/media/urls'

/**
 * POST /api/admin/media/:id/signed-url — { expiresIn: secondes (60 à 7 jours) } → lien
 * temporaire absolu vers un média privé, utilisable directement (balise <img>, partage).
 * Pour un média public, renvoie son URL permanente (expiresAt: null). 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const { expiresIn } = await readValidatedBody(event, body => signedUrlSchema.parse(body))
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')

  const base = mediaBaseUrl(event)
  if (media.visibility === 'PUBLIC') return { url: `${base}${mediaPath(media)}`, expiresAt: null }
  const { path, expiresAt } = signedMediaPath(media, expiresIn)
  return { url: `${base}${path}`, expiresAt }
})
