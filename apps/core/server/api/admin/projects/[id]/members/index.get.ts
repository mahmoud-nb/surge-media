import { listMembers } from '../../../../../lib/projects/service'

/**
 * GET /api/admin/projects/:id/members — membres du projet : compte, rôle enregistré, rôle
 * exercé (plafonné par le rôle de plateforme) et rôles attribuables (portée project:read).
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:read')
  return { members: await listMembers(access.project!.id), ...describeAccess(access) }
})
