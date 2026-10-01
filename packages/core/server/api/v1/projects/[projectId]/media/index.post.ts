import { apiMediaUploadFieldsSchema } from '#shared/schemas/api'
import { defineApiHandler, requireApiProject } from '../../../../../lib/api/context'
import { invalidRequest } from '../../../../../lib/api/problem'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../lib/api/serializers'
import { apiMediaLocation, principalProvenance, toMetadataInput, withApiUpload } from '../../../../../lib/api/writes'
import { createMedia } from '../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../lib/media/urls'

/**
 * POST /api/v1/projects/:projectId/media — multipart/form-data : `file` (obligatoire), `title`,
 * `altText`, `visibility` (`public` par défaut), `folderId` (dossier du projet ; hors dossier par
 * défaut). Portée media:upload (clé secrète, jeton personnel, jeton délégué). Le type est détecté
 * d'après le contenu. → 201 Media + Location.
 * Jeton délégué : nombre de fichiers, taille, types, visibilité et dossier selon ses contraintes.
 * 404 FOLDER_NOT_FOUND (dossier d'un autre projet ou supprimé).
 * 400 INVALID_REQUEST / MULTIPART_REQUIRED / NO_FILE · 403 UPLOAD_LIMIT_REACHED · 413 FILE_TOO_LARGE ·
 * 415 UNSUPPORTED_TYPE · 422 UNREADABLE_FILE / DIMENSIONS_TOO_LARGE · 429 · 503 SERVER_BUSY.
 */
export default defineApiHandler(async (event, principal) => {
  // Droits vérifiés avant de lire le corps de la requête.
  const { project } = await requireApiProject(event, principal, 'media:upload')
  const media = await withApiUpload(event, principal, async (upload, options) => {
    const fields = apiMediaUploadFieldsSchema.safeParse(upload.fields)
    if (!fields.success) throw invalidRequest(fields.error.issues)
    const input = toMetadataInput(fields.data, principal.delegated?.upload)
    return createMedia({ type: 'project', id: project.id }, upload, input, principalProvenance(principal), options)
  })

  const expires = apiLinkExpiry()
  setResponseStatus(event, 201)
  setResponseHeaders(event, { Location: apiMediaLocation(event, media)!, ETag: mediaEtag(media, expires) })
  return toApiMedia(media, mediaBaseUrl(event), expires)
})
