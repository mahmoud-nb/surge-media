import { listOrigins } from '../../../../../lib/projects/origins'

/** GET /api/admin/projects/:id/origins — origines autorisées (CORS) ; portée project:credentials. */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  return { origins: await listOrigins(access.project!.id) }
})
