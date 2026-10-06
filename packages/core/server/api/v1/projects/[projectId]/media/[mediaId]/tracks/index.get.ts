import { defineApiHandler, requireApiProject } from '../../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../../lib/api/queries'
import { apiLinkExpiry, toApiTextTrack } from '../../../../../../../lib/api/serializers'
import { mediaBaseUrl } from '../../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'listTextTracks',
    'tags': ['media'],
    'summary': 'Pistes de texte d\'une vidéo',
    'description': 'Sous-titres, descriptions et chapitres d\'une vidéo (aussi présents dans `Media.textTracks`), dans leur ordre d\'ajout ; vide pour une image. Clé publique : média public seulement.',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-errors': ['MEDIA_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 200: { $ref: '#/components/responses/TextTrackList' } },
    'x-i18n': {
      en: {
        summary: 'Text tracks of a video',
        description: 'Subtitles, descriptions and chapters of a video (also in `Media.textTracks`), in the order they were added; empty for an image. Publishable key: public media only.',
      },
    },
  },
})

/** GET /api/v1/projects/:projectId/media/:mediaId/tracks — pistes de texte d'une vidéo (portée media:read). */
export default defineApiHandler(async (event, principal) => {
  const { project, publicOnly } = await requireApiProject(event, principal, 'media:read')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', publicOnly)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  const base = mediaBaseUrl(event)
  const expires = apiLinkExpiry()
  return { items: media.textTracks.map(track => toApiTextTrack(media, track, base, expires)) }
})
