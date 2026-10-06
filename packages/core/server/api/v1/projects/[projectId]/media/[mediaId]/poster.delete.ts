import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { removeMediaPoster } from '../../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'deleteMediaPoster',
    'tags': ['media'],
    'summary': 'Retirer l\'image d\'affiche d\'une vidéo',
    'description': 'Version incrémentée (nouvelles URL) ; `poster`, `previewUrl` et `urlTemplate` redeviennent `null`, le point d\'intérêt est effacé. Sans affiche : média inchangé.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['MEDIA_NOT_FOUND', 'VERSION_CONFLICT', 'KIND_MISMATCH', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 200: { $ref: '#/components/responses/Media' } },
    'x-i18n': {
      en: {
        summary: 'Remove the poster image of a video',
        description: 'Version incremented (new URLs); `poster`, `previewUrl` and `urlTemplate` become `null` again, the focal point is cleared. Without a poster: media item unchanged.',
      },
    },
  },
})

/** DELETE /api/v1/projects/:projectId/media/:mediaId/poster — retire l'affiche d'une vidéo (portée media:write). → Media */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  if (media.kind !== 'VIDEO') throw apiProblem('KIND_MISMATCH', 'Only videos have a poster image.')
  const updated = await removeMediaPoster(media)
  const expires = apiLinkExpiry()
  setResponseHeader(event, 'ETag', mediaEtag(updated, expires))
  return toApiMedia(updated, mediaBaseUrl(event), expires)
})
