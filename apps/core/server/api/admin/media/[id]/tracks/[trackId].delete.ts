import { findMedia, toMediaDetail } from '../../../../../lib/media/service'
import { deleteTextTrack } from '../../../../../lib/media/tracks'

/** DELETE /api/admin/media/:id/tracks/:trackId — supprime une piste de texte (portée media:write). → { media } · 404 TRACK_NOT_FOUND. */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  await deleteTextTrack(media, getRouterParam(event, 'trackId') ?? '')
  return { media: toMediaDetail((await findMedia(media.id))!, await sessionTagViewer(event)) }
})
