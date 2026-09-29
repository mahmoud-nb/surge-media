import { updateMemberSchema } from '#shared/schemas/projects'
import { updateMemberRole } from '../../../../../lib/projects/service'

/**
 * PATCH /api/admin/projects/:id/members/:userId — { role } (portée project:members +
 * confirmation récente du mot de passe, 403 REAUTH_REQUIRED).
 * 404 · 409 LAST_OWNER (rétrogradation du dernier propriétaire) · 422 ROLE_NOT_ASSIGNABLE.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:members')
  const { role } = await readValidatedBody(event, body => updateMemberSchema.parse(body))
  await requireRecentPassword(event)
  const { member, previousRole } = await updateMemberRole(access.project!.id, getRouterParam(event, 'userId') ?? '', role)
  if (previousRole !== role) {
    await recordAudit(event, {
      action: 'member.role_changed',
      projectId: access.project!.id,
      targetType: 'user',
      targetId: member.user.id,
      data: { label: member.user.email, from: previousRole, to: role },
    })
  }
  return { member }
})
