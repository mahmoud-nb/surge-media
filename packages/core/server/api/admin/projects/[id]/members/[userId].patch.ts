import { updateMemberSchema } from '#shared/schemas/projects'
import { updateMemberRole } from '../../../../../lib/projects/service'

/**
 * PATCH /api/admin/projects/:id/members/:userId — { role } (portée project:members).
 * 404 · 409 LAST_OWNER (rétrogradation du dernier propriétaire) · 422 ROLE_NOT_ASSIGNABLE.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:members')
  const { role } = await readValidatedBody(event, body => updateMemberSchema.parse(body))
  return { member: await updateMemberRole(access.project!.id, getRouterParam(event, 'userId') ?? '', role) }
})
