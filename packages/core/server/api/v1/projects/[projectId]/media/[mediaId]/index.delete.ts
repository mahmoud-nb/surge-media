import { defineApiHandler, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { trashMedia } from '../../../../../../lib/media/service'

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
