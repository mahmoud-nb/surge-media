import { defineApiHandler, requireApiProject, requireUploadAllowance } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { uploadRules } from '../../../../../../lib/media/limits'
import { POSTER_TYPES, posterTimeField, setMediaPoster } from '../../../../../../lib/media/service'
import { receiveUpload } from '../../../../../../lib/media/upload'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'setMediaPoster',
    'tags': ['media'],
    'summary': 'Définir l\'image d\'affiche d\'une vidéo',
    'description': 'Image (JPEG, PNG, WebP, AVIF, GIF) normalisée en JPEG (orientation appliquée, 3840 px au plus, métadonnées retirées), puis source de `poster`, `previewUrl` et `urlTemplate`. Champ `time` facultatif : instant de la vidéo représenté (image capturée dans un navigateur, par exemple). Première affiche : même version ; nouvelle affiche : version incrémentée, donc nouvelles URL (les anciennes redirigent). Avec un jeton délégué : ne compte pas dans `maxFiles` et n\'est pas soumise à `types`.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'MULTIPART_REQUIRED',
      'NO_FILE',
      'INVALID_REQUEST',
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
    'requestBody': { $ref: '#/components/requestBodies/PosterUpload' },
    'responses': { 200: { $ref: '#/components/responses/Media' } },
    'x-i18n': {
      en: {
        summary: 'Set the poster image of a video',
        description: 'Image (JPEG, PNG, WebP, AVIF, GIF) normalised to JPEG (orientation applied, 3840 px at most, metadata removed), then source of `poster`, `previewUrl` and `urlTemplate`. Optional `time` field: moment of the video shown (frame captured in a browser, for example). First poster: same version; new poster: version incremented, hence new URLs (old ones redirect). With a delegated token: not counted in `maxFiles` and not subject to `types`.',
      },
    },
  },
})

/**
 * PUT /api/v1/projects/:projectId/media/:mediaId/poster — multipart `file` (image) et `time` facultatif :
 * image d'affiche d'une vidéo (portée media:write ; débit des envois ; jeton délégué : hors quota de
 * fichiers et de types). → Media · 404 MEDIA_NOT_FOUND · 409 VERSION_CONFLICT · 415 · 422 KIND_MISMATCH.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  if (media.kind !== 'VIDEO') throw apiProblem('KIND_MISMATCH', 'Only videos have a poster image.')
  requireUploadAllowance(event, principal)

  const upload = await receiveUpload(event, uploadRules(POSTER_TYPES))
  try {
    const updated = await setMediaPoster(media, upload, posterTimeField(upload.fields.time, media.duration))
    const expires = apiLinkExpiry()
    setResponseHeader(event, 'ETag', mediaEtag(updated, expires))
    return toApiMedia(updated, mediaBaseUrl(event), expires)
  }
  finally {
    await upload.cleanup()
  }
})
