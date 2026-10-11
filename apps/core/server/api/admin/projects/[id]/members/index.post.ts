import { addMemberSchema } from '#shared/schemas/projects'
import { addMember } from '../../../../../lib/projects/service'

/**
 * POST /api/admin/projects/:id/members — { userId, role } (portée project:members +
 * confirmation récente du mot de passe, 403 REAUTH_REQUIRED).
 * 201 { member } · 404 USER_NOT_FOUND (inconnu ou désactivé) · 409 ALREADY_MEMBER ·
 * 422 ROLE_NOT_ASSIGNABLE (rôle supérieur au plafond de son rôle de plateforme).
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:members')
  const { userId, role } = await readValidatedBody(event, body => addMemberSchema.parse(body))
  await requireRecentPassword(event)
  const member = await addMember(access.project!.id, userId, role)
  await recordAudit(event, {
    action: 'member.added',
    projectId: access.project!.id,
    targetType: 'user',
    targetId: userId,
    data: { label: member.user.email, role },
  })
  setResponseStatus(event, 201)
  return { member }
})
