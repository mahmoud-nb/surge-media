import { removeMember } from '../../../../../lib/projects/service'

/**
 * DELETE /api/admin/projects/:id/members/:userId — retrait d'un membre (portée
 * project:members + confirmation récente du mot de passe, 403 REAUTH_REQUIRED). Un membre
 * peut toujours quitter le projet lui-même (project:read, sans confirmation).
 * 204 · 404 · 409 LAST_OWNER.
 */
export default defineEventHandler(async (event) => {
  const userId = getRouterParam(event, 'userId') ?? ''
  const user = await requireAuth(event)
  const self = userId === user.id
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), self ? 'project:read' : 'project:members')
  if (!self) await requireRecentPassword(event)
  const member = await removeMember(access.project!.id, userId)
  await recordAudit(event, {
    action: 'member.removed',
    projectId: access.project!.id,
    targetType: 'user',
    targetId: userId,
    data: { label: member.user.email, role: member.role, self },
  })
  setResponseStatus(event, 204)
  return null
})
