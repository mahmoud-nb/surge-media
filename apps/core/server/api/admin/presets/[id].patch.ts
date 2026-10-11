import { updatePresetSchema } from '#shared/schemas/transforms'
import { findPreset, toPresetSummary, updatePreset } from '../../../lib/transforms/service'

const AUDITED_FIELDS = ['name', 'transformation', 'description'] as const

/**
 * PATCH /api/admin/presets/:id — { name?, transformation?, description? } (`project:settings` pour un
 * préréglage de projet, `settings:manage` pour un global). Ses URL servent ensuite le nouveau rendu
 * (nouveau fichier ; caches rafraîchis sous NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE).
 * 404 PRESET_NOT_FOUND · 400 INVALID_TRANSFORM · 409 PRESET_NAME_TAKEN.
 */
export default defineEventHandler(async (event) => {
  const { preset } = await requirePresetAccess(event, await findPreset(getRouterParam(event, 'id') ?? ''))
  const input = await readValidatedBody(event, body => updatePresetSchema.parse(body))
  const updated = await updatePreset(preset, input)

  const changes = Object.fromEntries(AUDITED_FIELDS
    .filter(field => updated[field] !== preset[field])
    .map(field => [field, { from: preset[field], to: updated[field] }]))
  if (Object.keys(changes).length) {
    await recordAudit(event, { action: 'preset.updated', projectId: preset.projectId, targetType: 'preset', targetId: preset.id, data: { label: updated.name, changes } })
  }
  return { preset: toPresetSummary(updated) }
})
