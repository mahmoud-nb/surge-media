import { mediaMetadataSchema, spaceQuerySchema } from '#shared/schemas/media'
import { createMedia, toMediaDetail } from '../../../lib/media/service'
import { receiveUpload } from '../../../lib/media/upload'

/**
 * POST /api/admin/media?project= — multipart/form-data : `file` (obligatoire), `title`,
 * `altText`, `visibility` (PUBLIC par défaut). Le média appartient au projet indiqué, ou à la
 * bibliothèque sans `project` (portée media:upload). 201 + média créé.
 * 400 NO_FILE / MULTIPART_REQUIRED · 403 (PROJECT_ARCHIVED) · 404 · 413 FILE_TOO_LARGE ·
 * 415 UNSUPPORTED_TYPE · 422 UNREADABLE_FILE / DIMENSIONS_TOO_LARGE.
 */
export default defineEventHandler(async (event) => {
  // Droits vérifiés avant de lire le corps de la requête.
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:upload')
  const upload = await receiveUpload(event, Number(useRuntimeConfig(event).media.maxUploadSize))
  try {
    const fields = mediaMetadataSchema.safeParse(upload.fields)
    if (!fields.success) throw createError({ statusCode: 400, statusMessage: 'Invalid fields', data: fields.error.issues })
    const media = await createMedia(access.space, upload, fields.data, { userId: access.user.id })
    setResponseStatus(event, 201)
    return { media: toMediaDetail(media) }
  }
  finally {
    await upload.cleanup()
  }
})
