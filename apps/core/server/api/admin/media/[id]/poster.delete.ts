import { findMedia, removeMediaPoster, toMediaDetail } from '../../../../lib/media/service'

/**
 * DELETE /api/admin/media/:id/poster — retire l'image d'affiche d'une vidéo : nouvelle version, aperçu et
 * dérivés supprimés (portée media:write). Sans affiche : média inchangé. 422 KIND_MISMATCH, 409 IN_TRASH,
 * VERSION_CONFLICT.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  return { media: toMediaDetail(await removeMediaPoster(media)) }
})
