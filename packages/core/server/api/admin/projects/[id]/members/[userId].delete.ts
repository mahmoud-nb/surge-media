import { removeMember } from '../../../../../lib/projects/service'

/**
 * DELETE /api/admin/projects/:id/members/:userId — retrait d'un membre (portée
 * project:members). Un membre peut toujours quitter le projet lui-même (project:read).
 * 204 · 404 · 409 LAST_OWNER.
 */
export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId') ?? ''
  const user = await requireAuth(event)
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), userId === user.id ? 'project:read' : 'project:members')
  await removeMember(access.project!.id, userId)
  setResponseStatus(event, 204)
  return null
})
