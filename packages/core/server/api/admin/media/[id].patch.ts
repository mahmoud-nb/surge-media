import { mediaMetadataSchema } from '#shared/schemas/media'
import { findMedia, toMediaDetail, updateMediaMetadata } from '../../../lib/media/service'

/**
 * PATCH /api/admin/media/:id — { title?, altText?, visibility? } (portée media:write).
 * Passer un média en privé prend effet immédiatement pour les nouvelles requêtes ; les copies
 * déjà en cache chez les visiteurs ou un CDN restent valables jusqu'à leur expiration.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  const input = await readValidatedBody(event, body => mediaMetadataSchema.parse(body))
  return { media: toMediaDetail(await updateMediaMetadata(media, input)) }
})
