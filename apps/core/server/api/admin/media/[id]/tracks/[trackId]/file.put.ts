import { findMedia, toMediaDetail } from '../../../../../../lib/media/service'
import { TEXT_TRACK_MAX_SIZE } from '../../../../../../lib/media/text-track'
import { replaceTextTrackFile } from '../../../../../../lib/media/tracks'
import { receiveSmallUpload } from '../../../../../../lib/media/upload'

/**
 * PUT /api/admin/media/:id/tracks/:trackId/file — multipart `file` : remplace le fichier d'une piste. Le
 * fichier d'une piste est immuable : une nouvelle piste (nouvel identifiant, nouvelle URL) prend la place
 * de l'ancienne, avec les mêmes type, langue, libellé et « par défaut ». Portée media:write.
 * → { media } · 404 TRACK_NOT_FOUND · 413 · 422 INVALID_TEXT_TRACK.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  const file = await receiveSmallUpload(event, TEXT_TRACK_MAX_SIZE)
  await replaceTextTrackFile(media, getRouterParam(event, 'trackId') ?? '', file)
  return { media: toMediaDetail((await findMedia(media.id))!) }
})
