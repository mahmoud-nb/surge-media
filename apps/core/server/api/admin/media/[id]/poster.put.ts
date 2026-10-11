import { mediaError } from '../../../../lib/media/errors'
import { uploadRules } from '../../../../lib/media/limits'
import { findMedia, POSTER_TYPES, posterTimeField, setMediaPoster, toMediaDetail } from '../../../../lib/media/service'
import { receiveUpload } from '../../../../lib/media/upload'

/**
 * PUT /api/admin/media/:id/poster — multipart/form-data `file` (image JPEG, PNG, WebP, AVIF ou GIF) et
 * `time` facultatif (instant capturé, en secondes) : image d'affiche d'une vidéo (architecture phase D,
 * § 19). Normalisée en JPEG, elle devient la source de l'aperçu et des dérivés de la vidéo. Première
 * affiche : même version ; nouvelle affiche : nouvelle version. Mêmes droits que la modification du média
 * (portée media:write). 415 si ce n'est pas une image, 422 KIND_MISMATCH si le média n'est pas une vidéo,
 * 409 IN_TRASH, VERSION_CONFLICT, 503 SERVER_BUSY.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  if (media.kind !== 'VIDEO') throw mediaError(422, 'KIND_MISMATCH', { detail: 'Only videos have a poster image.' })
  const upload = await receiveUpload(event, uploadRules(POSTER_TYPES))
  try {
    const time = posterTimeField(upload.fields.time, media.duration)
    return { media: toMediaDetail(await setMediaPoster(media, upload, time)) }
  }
  finally {
    await upload.cleanup()
  }
})
