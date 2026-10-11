import { defineApiHandler, requireApiProject } from '../../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../../lib/api/queries'
import { deleteTextTrack } from '../../../../../../../lib/media/tracks'

defineRouteMeta({
  openAPI: {
    'operationId': 'deleteTextTrack',
    'tags': ['media'],
    'summary': 'Supprimer une piste de texte',
    'description': 'Fichier supprimé ; son URL publique peut rester dans les caches (CDN) jusqu\'à leur échéance.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['MEDIA_NOT_FOUND', 'TRACK_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 204: { $ref: '#/components/responses/NoContent' } },
    'x-i18n': {
      en: {
        summary: 'Delete a text track',
        description: 'File deleted; its public URL may stay in caches (CDN) until they expire.',
      },
    },
  },
})

/** DELETE /api/v1/projects/:projectId/media/:mediaId/tracks/:trackId — supprime une piste (portée media:write). → 204 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  await deleteTextTrack(media, getRouterParam(event, 'trackId') ?? '')
  setResponseStatus(event, 204)
  return null
})
