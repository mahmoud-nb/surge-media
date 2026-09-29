import { apiProjectListQuerySchema } from '#shared/schemas/api'
import { defineApiHandler, parseApiQuery } from '../../../lib/api/context'
import { listApiProjects } from '../../../lib/api/queries'
import { toApiProject } from '../../../lib/api/serializers'

/**
 * GET /api/v1/projects?limit&cursor — projets actifs accessibles : celui d'une clé, la sélection
 * d'un jeton personnel (limitée aux droits actuels de son propriétaire), avec les portées
 * effectives dans chacun. → { items: Project[], nextCursor }
 */
export default defineApiHandler(async (event, { credential }) => {
  const query = parseApiQuery(event, apiProjectListQuerySchema)
  const page = await listApiProjects(credential, query)
  return { items: page.items.map(({ project, scopes }) => toApiProject(project, scopes)), nextCursor: page.nextCursor }
})
