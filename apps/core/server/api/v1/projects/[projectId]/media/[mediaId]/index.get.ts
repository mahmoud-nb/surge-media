import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, etagMatches, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'getMedia',
    'tags': ['media'],
    'summary': 'Média',
    'description': 'Un média actif du projet (clé publique : média public seulement). `ETag` → 304. Suivi du traitement d\'une vidéo : relire le média avec `If-None-Match` (pas plus d\'une fois toutes les 5 s, tant que `processing.status` vaut `pending` ou `processing`) ; l\'`ETag` change avec l\'avancement.',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-errors': ['MEDIA_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': {
      200: { $ref: '#/components/responses/Media' },
      304: { $ref: '#/components/responses/NotModified' },
    },
    'x-i18n': {
      en: {
        summary: 'Media item',
        description: 'An active media item of the project (publishable key: public media only). `ETag` → 304. Following the processing of a video: read the media item again with `If-None-Match` (no more than once every 5 s, while `processing.status` is `pending` or `processing`); the `ETag` changes with the progress.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/media/:mediaId — un média actif du projet (portée media:read ;
 * clé publique : média public seulement). ETag faible → 304, qui suit aussi l'avancement du traitement
 * d'une vidéo (serializers.ts, `mediaEtag`). 404 MEDIA_NOT_FOUND.
 */
export default defineApiHandler(async (event, principal) => {
  const { project, publicOnly } = await requireApiProject(event, principal, 'media:read')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', publicOnly)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')

  const expires = apiLinkExpiry()
  const etag = mediaEtag(media, expires)
  setResponseHeader(event, 'ETag', etag)
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  return toApiMedia(media, mediaBaseUrl(event), expires)
})
