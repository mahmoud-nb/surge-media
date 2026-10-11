import { apiTextTrackUpdateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../../lib/api/queries'
import { apiLinkExpiry, toApiTextTrack } from '../../../../../../../lib/api/serializers'
import { toTrackUpdate } from '../../../../../../../lib/api/tracks'
import { updateTextTrack } from '../../../../../../../lib/media/tracks'
import { mediaBaseUrl } from '../../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'updateTextTrack',
    'tags': ['media'],
    'summary': 'Modifier une piste de texte',
    'description': 'Type, langue, libellé, `default` : le fichier et son URL ne changent pas. Une piste par défaut au plus par groupe (les autres la perdent). Pour corriger le texte, envoyez une nouvelle piste et supprimez l\'ancienne.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['INVALID_REQUEST', 'MEDIA_NOT_FOUND', 'TRACK_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'requestBody': { $ref: '#/components/requestBodies/TrackUpdate' },
    'responses': { 200: { $ref: '#/components/responses/TextTrack' } },
    'x-i18n': {
      en: {
        summary: 'Update a text track',
        description: 'Kind, language, label, `default`: the file and its URL do not change. One default track at most per group (the others lose it). To fix the text, upload a new track and delete the old one.',
      },
    },
  },
})

/** PATCH /api/v1/projects/:projectId/media/:mediaId/tracks/:trackId — métadonnées d'une piste (portée media:write). */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  const body = await readApiBody(event, apiTextTrackUpdateSchema)
  const track = await updateTextTrack(media, getRouterParam(event, 'trackId') ?? '', toTrackUpdate(body))
  return toApiTextTrack(media, track, mediaBaseUrl(event), apiLinkExpiry())
})
