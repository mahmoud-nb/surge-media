import { updateProjectSchema } from '#shared/schemas/projects'
import { getProjectSummary, updateProject } from '../../../lib/projects/service'

const AUDITED_FIELDS = ['name', 'slug', 'description'] as const

/**
 * PATCH /api/admin/projects/:id — { name?, slug?, description?, archived? } (portée
 * project:settings, propriétaires). `archived: true` passe le projet en lecture seule (clés
 * d'API refusées) ; `false` le réactive. 409 SLUG_TAKEN.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:settings')
  const input = await readValidatedBody(event, body => updateProjectSchema.parse(body))
  const before = access.project!
  await updateProject(access, input)

  const changes = Object.fromEntries(AUDITED_FIELDS
    .filter(field => input[field] !== undefined && input[field] !== before[field])
    .map(field => [field, { from: before[field], to: input[field] }]))
  const label = input.name ?? before.name
  if (Object.keys(changes).length) {
    await recordAudit(event, { action: 'project.updated', projectId: before.id, targetType: 'project', targetId: before.id, data: { label, changes } })
  }
  if (input.archived !== undefined && input.archived !== Boolean(before.archivedAt)) {
    await recordAudit(event, { action: input.archived ? 'project.archived' : 'project.restored', projectId: before.id, targetType: 'project', targetId: before.id, data: { label } })
  }
  return getProjectSummary((await resolveSpaceAccess(access.user, access.space))!)
})
