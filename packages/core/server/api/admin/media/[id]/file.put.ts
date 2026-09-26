import { findMediaOr404, replaceMediaFile, toMediaDetail } from '../../../../lib/media/service'
import { receiveUpload } from '../../../../lib/media/upload'

/**
 * PUT /api/admin/media/:id/file — multipart/form-data `file` : remplace le fichier en
 * conservant l'identifiant, le titre, le texte alternatif et la visibilité. Version
 * incrémentée (nouvelles URL). 409 VERSION_CONFLICT si un autre remplacement est passé avant,
 * 422 KIND_MISMATCH si le genre change, et les mêmes contrôles que l'envoi.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const media = await findMediaOr404(getRouterParam(event, 'id') ?? '')
  const upload = await receiveUpload(event, Number(useRuntimeConfig(event).media.maxUploadSize))
  try {
    return { media: toMediaDetail(await replaceMediaFile(media, upload)) }
  }
  finally {
    await upload.cleanup()
  }
})
