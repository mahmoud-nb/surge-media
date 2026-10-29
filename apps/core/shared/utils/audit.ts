/**
 * Journal d'audit : actions enregistrées (server/utils/audit.ts) et catégories de filtrage.
 * Une action = « <catégorie>.<verbe> » ; son libellé est traduit par `audit.actions.<action>`.
 */

export const AUDIT_ACTIONS = [
  'project.created',
  'project.updated',
  'project.archived',
  'project.restored',
  'project.deleted',
  'member.added',
  'member.role_changed',
  'member.removed',
  'key.created',
  'key.rotated',
  'key.revoked',
  'key.deleted',
  'token.created',
  'token.revoked',
  'token.deleted',
  'origin.added',
  'origin.removed',
  'media.visibility_changed',
  'media.moved',
  'media.deleted',
  // « Traiter les vidéos existantes » (phase D3) : data.count = tâches créées.
  'media.processing_backfill',
  'user.created',
  'user.updated',
  'user.deleted',
  'user.password_link',
  'user.sessions_revoked',
  'user.device_trusted',
  'user.devices_revoked',
  'user.link_emailed',
  // Double authentification : data.by = self | admin | cli (désactivation, réinitialisation),
  // data.remaining = codes de secours restants. Jamais de secret ni de code.
  'user.mfa_enabled',
  'user.mfa_disabled',
  'user.mfa_reset',
  'user.mfa_recovery_used',
  'user.mfa_recovery_regenerated',
  'preset.created',
  'preset.updated',
  'preset.deleted',
  'settings.updated',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_CATEGORIES = ['project', 'member', 'key', 'token', 'origin', 'media', 'user', 'preset', 'settings'] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export function auditCategory(action: string): AuditCategory | null {
  const category = action.split('.')[0]
  return (AUDIT_CATEGORIES as readonly string[]).includes(category ?? '') ? category as AuditCategory : null
}
