import { signedUrlSchema } from '#shared/schemas/media'
import { findMediaOr404 } from '../../../../lib/media/service'
import { mediaPath, signedMediaPath } from '../../../../lib/media/urls'

/**
 * POST /api/admin/media/:id/signed-url — { expiresIn: secondes (60 à 7 jours) } → lien
 * temporaire vers un média privé, utilisable directement (balise <img>, partage).
 * Pour un média public, renvoie son URL permanente (expiresAt: null).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const media = await findMediaOr404(getRouterParam(event, 'id') ?? '')
  const { expiresIn } = await readValidatedBody(event, body => signedUrlSchema.parse(body))
  if (media.deletedAt) throw createError({ statusCode: 409, statusMessage: 'Media is in the trash' })

  if (media.visibility === 'PUBLIC') return { path: mediaPath(media), expiresAt: null }
  return signedMediaPath(media, expiresIn)
})
