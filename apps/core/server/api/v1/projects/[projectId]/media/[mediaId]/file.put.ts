import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { withApiUpload } from '../../../../../../lib/api/writes'
import { replaceMediaFile } from '../../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'replaceMediaFile',
    'tags': ['media'],
    'summary': 'Remplacer le fichier',
    'description': 'Identifiant, titre, texte alternatif et visibilité conservés ; version incrémentée, donc nouvelles URL (les anciennes redirigent). Mêmes contrôles que l\'envoi ; un fichier d\'un autre genre (une vidéo à la place d\'une image…) est refusé dès ses premiers octets.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'MULTIPART_REQUIRED',
      'NO_FILE',
      'UPLOAD_LIMIT_REACHED',
      'MEDIA_NOT_FOUND',
      'VERSION_CONFLICT',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_TYPE',
      'UNREADABLE_FILE',
      'DIMENSIONS_TOO_LARGE',
      'KIND_MISMATCH',
      'SERVER_BUSY',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/FileReplace' },
    'responses': { 200: { $ref: '#/components/responses/Media' } },
    'x-i18n': {
      en: {
        summary: 'Replace the file',
        description: 'Id, title, alternative text and visibility are kept; the version is incremented, hence new URLs (old ones redirect). Same checks as an upload; a file of another kind (a video instead of an image…) is rejected from its first bytes.',
      },
    },
  },
})

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

  const replaced = await withApiUpload(event, principal, (upload, options) => replaceMediaFile(media, upload, options), media.kind)
  const expires = apiLinkExpiry()
  setResponseHeader(event, 'ETag', mediaEtag(replaced, expires))
  return toApiMedia(replaced, mediaBaseUrl(event), expires)
})
