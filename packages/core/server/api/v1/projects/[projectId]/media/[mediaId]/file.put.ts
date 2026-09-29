import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { withApiUpload } from '../../../../../../lib/api/writes'
import { replaceMediaFile } from '../../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

/**
 * PUT /api/v1/projects/:projectId/media/:mediaId/file — multipart/form-data `file` : remplace le
 * fichier (portée media:write) en gardant l'identifiant, le titre, le texte alternatif et la
 * visibilité. Version incrémentée : nouvelles URL (les anciennes redirigent). Jeton délégué : taille,
 * types et nombre de fichiers selon ses contraintes. → Media · 404 MEDIA_NOT_FOUND ·
 * 409 VERSION_CONFLICT · 422 KIND_MISMATCH · et les mêmes contrôles que l'envoi.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')

  const replaced = await withApiUpload(event, principal, (upload, options) => replaceMediaFile(media, upload, options))
  const expires = apiLinkExpiry()
  setResponseHeader(event, 'ETag', mediaEtag(replaced, expires))
  return toApiMedia(replaced, mediaBaseUrl(event), expires)
})
