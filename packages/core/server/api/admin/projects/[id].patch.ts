import { updateProjectSchema } from '#shared/schemas/projects'
import { getProjectSummary, updateProject } from '../../../lib/projects/service'

/**
 * PATCH /api/admin/projects/:id — { name?, slug?, description?, archived? } (portée
 * project:settings, propriétaires). `archived: true` passe le projet en lecture seule (clés
 * d'API refusées) ; `false` le réactive. 409 SLUG_TAKEN.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:settings')
  const input = await readValidatedBody(event, body => updateProjectSchema.parse(body))
  await updateProject(access, input)
  return getProjectSummary((await resolveSpaceAccess(access.user, access.space))!)
})
