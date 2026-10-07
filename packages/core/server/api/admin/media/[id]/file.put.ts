import { findMedia, replaceMediaFile, toMediaDetail } from '../../../../lib/media/service'
import { uploadRules } from '../../../../lib/media/limits'
import { receiveUpload } from '../../../../lib/media/upload'
import { videoProcessingActive } from '../../../../lib/video-processing/status'

/**
 * PUT /api/admin/media/:id/file — multipart/form-data `file` : remplace le fichier en
 * conservant l'identifiant, le titre, le texte alternatif et la visibilité (portée media:write).
 * Version incrémentée (nouvelles URL). 409 VERSION_CONFLICT si un autre remplacement est passé
 * avant, 422 KIND_MISMATCH si le genre change (dès les premiers octets), et les mêmes contrôles que l'envoi.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  // Types acceptés en ce moment : une vidéo peut être remplacée par un MKV… quand le traitement est actif.
  const rules = uploadRules(undefined, undefined, acceptedMimeTypes(await videoProcessingActive()))
  const upload = await receiveUpload(event, { ...rules, expectedKind: media.kind })
  try {
    return { media: toMediaDetail(await replaceMediaFile(media, upload)) }
  }
  finally {
    await upload.cleanup()
  }
})
