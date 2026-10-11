import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { trashMedia } from '../../../../../../lib/media/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'deleteMedia',
    'tags': ['media'],
    'summary': 'Mettre un média à la corbeille',
    'description': 'Le média n\'est plus diffusé ni listé ; restauration ou suppression définitive depuis l\'administration.',
    'x-scopes': ['media:delete'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['MEDIA_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 204: { $ref: '#/components/responses/NoContent' } },
    'x-i18n': {
      en: {
        summary: 'Move a media item to the trash',
        description: 'The media item is no longer delivered nor listed; restore it or delete it permanently from the administration.',
      },
    },
  },
})

/**
 * DELETE /api/v1/projects/:projectId/media/:mediaId — mise à la corbeille (portée media:delete) :
 * le média n'est plus diffusé ni listé ; restauration et suppression définitive depuis
 * l'administration. → 204 · 404 MEDIA_NOT_FOUND (inexistant ou déjà dans la corbeille).
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:delete')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  await trashMedia(media)
  setResponseStatus(event, 204)
  return null
})
