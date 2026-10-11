import { transformsQuerySchema, updateTransformPolicySchema } from '#shared/schemas/transforms'
import { describeTransforms, setTransformPolicy } from '../../../lib/transforms/service'

/**
 * PATCH /api/admin/transforms?project= — { policy: OPEN | SIGNED | PRESETS } : politique des
 * transformations libres du projet (`project:settings`) ou, sans `project`, de la bibliothèque
 * (`settings:manage`). Journalisé (`project.updated` ou `settings.updated`).
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => transformsQuerySchema.parse(value))
  const { projectId, access } = await requireTransformsAccess(event, project, true)
  const { policy } = await readValidatedBody(event, body => updateTransformPolicySchema.parse(body))

  const previous = await setTransformPolicy(projectId, policy)
  if (previous !== policy) {
    if (projectId) {
      await recordAudit(event, {
        action: 'project.updated',
        projectId,
        targetType: 'project',
        targetId: projectId,
        data: { label: access?.project?.name, changes: { transformPolicy: { from: previous, to: policy } } },
      })
    }
    else {
      await recordAudit(event, { action: 'settings.updated', data: { changes: { libraryPolicy: { from: previous, to: policy } } } })
    }
  }
  return { level: projectId ? 'project' as const : 'installation' as const, canEdit: true, ...(await describeTransforms(projectId)) }
})
