import { mediaMetadataSchema, spaceQuerySchema } from '#shared/schemas/media'
import { createMedia, toMediaDetail } from '../../../lib/media/service'
import { uploadRules } from '../../../lib/media/limits'
import { receiveUpload } from '../../../lib/media/upload'
import { videoProcessingActive } from '../../../lib/video-processing/status'

/**
 * POST /api/admin/media?project= — multipart/form-data : `file` (obligatoire), `title`,
 * `altText`, `visibility` (PUBLIC par défaut), `folderId` (dossier de l'espace, racine par défaut). Le média appartient au projet indiqué, ou à la
 * bibliothèque sans `project` (portée media:upload). 201 + média créé.
 * Images et vidéos, limite de taille propre au genre (reconnu dès les premiers octets) ; MKV, AVI, 3GP,
 * MPEG-TS, OGV, WMV seulement quand le traitement des vidéos est actif (phase D3, convertis ensuite).
 * 400 NO_FILE / MULTIPART_REQUIRED · 403 (PROJECT_ARCHIVED) · 404 · 408 UPLOAD_TIMEOUT · 413 FILE_TOO_LARGE ·
 * 415 UNSUPPORTED_TYPE · 422 UNREADABLE_FILE / DIMENSIONS_TOO_LARGE.
 */
export default defineEventHandler(async (event) => {
  // Droits vérifiés avant de lire le corps de la requête.
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:upload')
  const upload = await receiveUpload(event, uploadRules(undefined, undefined, acceptedMimeTypes(await videoProcessingActive())))
  try {
    const fields = mediaMetadataSchema.safeParse(upload.fields)
    if (!fields.success) throw createError({ statusCode: 400, statusMessage: 'Invalid fields', data: fields.error.issues })
    const media = await createMedia(access.space, upload, fields.data, { userId: access.user.id })
    setResponseStatus(event, 201)
    return { media: toMediaDetail(media, await sessionTagViewer(event)) }
  }
  finally {
    await upload.cleanup()
  }
})
