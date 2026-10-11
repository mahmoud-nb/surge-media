import { textTrackInputSchema } from '#shared/schemas/media'
import { findMedia, toMediaDetail } from '../../../../../lib/media/service'
import { TEXT_TRACK_MAX_SIZE } from '../../../../../lib/media/text-track'
import { addTextTrack } from '../../../../../lib/media/tracks'
import { receiveSmallUpload } from '../../../../../lib/media/upload'

/**
 * POST /api/admin/media/:id/tracks — multipart/form-data `file` (WebVTT ou SRT, 1 Mio au plus) et champs
 * `kind` (SUBTITLES, CAPTIONS, DESCRIPTIONS, CHAPTERS), `language` (BCP 47), `label`, `isDefault` :
 * ajoute une piste de texte à une vidéo (architecture phase D, § 20). Mêmes droits que la modification du
 * média (portée media:write). → { media } · 400 champs invalides · 409 TRACK_LIMIT_REACHED, IN_TRASH ·
 * 413 · 422 INVALID_TEXT_TRACK (`data.line`), KIND_MISMATCH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  const file = await receiveSmallUpload(event, TEXT_TRACK_MAX_SIZE)
  const input = textTrackInputSchema.safeParse(file.fields)
  if (!input.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid text track fields', data: { issues: input.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } })
  }
  await addTextTrack(media, file, input.data)
  return { media: toMediaDetail((await findMedia(media.id))!) }
})
