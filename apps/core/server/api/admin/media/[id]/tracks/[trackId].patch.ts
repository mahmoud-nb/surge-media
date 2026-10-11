import { textTrackUpdateSchema } from '#shared/schemas/media'
import { findMedia, toMediaDetail } from '../../../../../lib/media/service'
import { updateTextTrack } from '../../../../../lib/media/tracks'

/**
 * PATCH /api/admin/media/:id/tracks/:trackId — type, langue, libellé, « par défaut » d'une piste de texte
 * (le fichier et son URL ne changent pas ; une piste par défaut au plus par groupe). Portée media:write.
 * → { media } · 404 TRACK_NOT_FOUND · 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  const update = await readValidatedBody(event, body => textTrackUpdateSchema.parse(body))
  await updateTextTrack(media, getRouterParam(event, 'trackId') ?? '', update)
  return { media: toMediaDetail((await findMedia(media.id))!) }
})
