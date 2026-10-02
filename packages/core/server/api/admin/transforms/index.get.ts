import { transformsQuerySchema } from '#shared/schemas/transforms'
import { describeTransforms } from '../../../lib/transforms/service'

/**
 * GET /api/admin/transforms?project= — politique des transformations libres et préréglages d'un
 * niveau : projet (`project:read`) ou installation sans `project` (`settings:manage` : politique de
 * la bibliothèque, préréglages globaux). → { level, policy, presets (intégrés, globaux — `shadowed`
 * si masqués par le projet —, du projet), limits, canEdit }.
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => transformsQuerySchema.parse(value))
  const { projectId, canEdit } = await requireTransformsAccess(event, project, false)
  return { level: projectId ? 'project' as const : 'installation' as const, canEdit, ...(await describeTransforms(projectId)) }
})
