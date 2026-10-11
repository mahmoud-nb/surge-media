import { projectListQuerySchema } from '#shared/schemas/projects'
import { listProjects } from '../../../lib/projects/service'

/**
 * GET /api/admin/projects?q=&status=active|archived&page=
 * Projets visibles par l'utilisateur (tous pour un ADMIN, sinon ceux dont il est membre),
 * avec son rôle et le nombre de médias et de membres. 20 par page, tri par nom.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = await getValidatedQuery(event, value => projectListQuerySchema.parse(value))
  return listProjects(user, query)
})
