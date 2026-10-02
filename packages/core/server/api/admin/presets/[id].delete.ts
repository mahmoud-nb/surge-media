import { deletePreset, findPreset } from '../../../lib/transforms/service'

/**
 * DELETE /api/admin/presets/:id (`project:settings` pour un préréglage de projet, `settings:manage`
 * pour un global) → 204. Ses URL répondent ensuite 404 (ou servent le préréglage global du même nom
 * qu'il masquait) ; les fichiers déjà générés restent jusqu'au prochain remplacement du média.
 */
export default defineEventHandler(async (event) => {
  const { preset } = await requirePresetAccess(event, await findPreset(getRouterParam(event, 'id') ?? ''))
  await deletePreset(preset)
  await recordAudit(event, {
    action: 'preset.deleted',
    projectId: preset.projectId,
    targetType: 'preset',
    targetId: preset.id,
    data: { label: preset.name, transformation: preset.transformation },
  })
  setResponseStatus(event, 204)
  return null
})
