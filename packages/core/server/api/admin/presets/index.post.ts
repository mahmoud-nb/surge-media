import { createPresetSchema, transformsQuerySchema } from '#shared/schemas/transforms'
import { createPreset, toPresetSummary } from '../../../lib/transforms/service'

/**
 * POST /api/admin/presets?project= — { name, transformation, description? } : préréglage du projet
 * (`project:settings`) ou, sans `project`, préréglage global (`settings:manage`). La transformation
 * est enregistrée sous sa forme canonique, sans format. 201 { preset }.
 * 400 INVALID_TRANSFORM (`param`, `detail`) · 409 PRESET_NAME_TAKEN / PRESET_LIMIT_REACHED.
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => transformsQuerySchema.parse(value))
  const { projectId } = await requireTransformsAccess(event, project, true)
  const input = await readValidatedBody(event, body => createPresetSchema.parse(body))
  const preset = await createPreset(projectId, input)
  await recordAudit(event, {
    action: 'preset.created',
    projectId,
    targetType: 'preset',
    targetId: preset.id,
    data: { label: preset.name, transformation: preset.transformation, level: projectId ? 'project' : 'global' },
  })
  setResponseStatus(event, 201)
  return { preset: toPresetSummary(preset) }
})
