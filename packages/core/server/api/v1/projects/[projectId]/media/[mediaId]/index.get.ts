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
    'description': 'Un média actif du projet (clé publique : média public seulement). `ETag` → 304.',
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
        description: 'An active media item of the project (publishable key: public media only). `ETag` → 304.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/media/:mediaId — un média actif du projet (portée media:read ;
 * clé publique : média public seulement). ETag faible → 304. 404 MEDIA_NOT_FOUND.
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
