import { findMedia, restoreMedia, toMediaDetail } from '../../../../lib/media/service'

/** POST /api/admin/media/:id/restore — sortie de la corbeille (portée media:delete). */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:delete')
  return { media: toMediaDetail(await restoreMedia(media), await sessionTagViewer(event)) }
})
