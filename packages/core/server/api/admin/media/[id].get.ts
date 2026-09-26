import { findMediaOr404, toMediaDetail } from '../../../lib/media/service'

/** GET /api/admin/media/:id — métadonnées complètes (corbeille comprise). */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const media = await findMediaOr404(getRouterParam(event, 'id') ?? '')
  return { media: toMediaDetail(media) }
})
