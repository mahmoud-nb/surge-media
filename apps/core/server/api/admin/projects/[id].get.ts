import { getProjectSummary } from '../../../lib/projects/service'

/**
 * GET /api/admin/projects/:id — projet, rôle et portées de l'utilisateur, nombre de médias
 * (actifs et en corbeille) et de membres. 404 si le projet est invisible pour l'utilisateur.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:read')
  return getProjectSummary(access)
})
