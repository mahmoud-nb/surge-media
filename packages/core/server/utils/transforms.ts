import type { H3Event } from 'h3'
import type { TransformPreset } from '../generated/prisma/client'
import { transformError } from '../lib/transforms/service'
import type { SpaceAccess } from './access'

/**
 * Accès aux réglages de transformation d'un niveau (phase C, C2) :
 *   - projet : lecture `project:read`, écriture `project:settings` (404 si le projet est invisible) ;
 *   - installation (`project` absent) : permission de plateforme `settings:manage` (ADMIN).
 */
export interface TransformsAccess {
  projectId: string | null
  /** Projet de l'accès (null pour l'installation). */
  access: SpaceAccess | null
  canEdit: boolean
}

export async function requireTransformsAccess(event: H3Event, projectId: string | null | undefined, write: boolean): Promise<TransformsAccess> {
  if (!projectId) {
    await requireAuth(event, 'settings:manage')
    return { projectId: null, access: null, canEdit: true }
  }
  const access = await requireSpaceAccess(event, spaceFor(projectId), write ? 'project:settings' : 'project:read')
  return { projectId, access, canEdit: hasScope(access.scopes, 'project:settings') }
}

/**
 * Préréglage enregistré modifiable par l'utilisateur : 404 PRESET_NOT_FOUND s'il n'existe pas ou si
 * son projet est invisible, 403 sans la portée (ou la permission) requise.
 */
export async function requirePresetAccess(event: H3Event, preset: TransformPreset | null): Promise<TransformsAccess & { preset: TransformPreset }> {
  if (!preset) throw transformError(404, 'PRESET_NOT_FOUND')
  if (!preset.projectId) {
    await requireAuth(event, 'settings:manage')
    return { projectId: null, access: null, canEdit: true, preset }
  }
  const user = await requireAuth(event)
  const access = await resolveSpaceAccess(user, spaceFor(preset.projectId))
  if (!access) throw transformError(404, 'PRESET_NOT_FOUND')
  assertScope(access, 'project:settings')
  return { projectId: preset.projectId, access, canEdit: true, preset }
}
