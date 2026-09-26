import { mediaMetadataSchema } from '#shared/schemas/media'
import { createMedia, toMediaDetail } from '../../../lib/media/service'
import { receiveUpload } from '../../../lib/media/upload'

/**
 * POST /api/admin/media — multipart/form-data : `file` (obligatoire), `title`, `altText`,
 * `visibility` (PUBLIC par défaut). 201 + média créé.
 * 400 NO_FILE / MULTIPART_REQUIRED · 413 FILE_TOO_LARGE · 415 UNSUPPORTED_TYPE ·
 * 422 UNREADABLE_FILE / DIMENSIONS_TOO_LARGE.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'media:manage')
  const upload = await receiveUpload(event, Number(useRuntimeConfig(event).media.maxUploadSize))
  try {
    const fields = mediaMetadataSchema.safeParse(upload.fields)
    if (!fields.success) throw createError({ statusCode: 400, statusMessage: 'Invalid fields', data: fields.error.issues })
    const media = await createMedia(upload, fields.data, actor)
    setResponseStatus(event, 201)
    return { media: toMediaDetail(media) }
  }
  finally {
    await upload.cleanup()
  }
})
