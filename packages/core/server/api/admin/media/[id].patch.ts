import { mediaMetadataSchema } from '#shared/schemas/media'
import { findMediaOr404, toMediaDetail, updateMediaMetadata } from '../../../lib/media/service'

/**
 * PATCH /api/admin/media/:id — { title?, altText?, visibility? }.
 * Passer un média en privé prend effet immédiatement pour les nouvelles requêtes ; les copies
 * déjà en cache chez les visiteurs ou un CDN restent valables jusqu'à leur expiration.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const media = await findMediaOr404(getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, body => mediaMetadataSchema.parse(body))
  return { media: toMediaDetail(await updateMediaMetadata(media, input)) }
})
