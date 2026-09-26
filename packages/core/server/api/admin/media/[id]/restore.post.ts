import { findMediaOr404, restoreMedia, toMediaDetail } from '../../../../lib/media/service'

/** POST /api/admin/media/:id/restore — sortie de la corbeille. */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const media = await findMediaOr404(getRouterParam(event, 'id') ?? '')
  return { media: toMediaDetail(await restoreMedia(media)) }
})
