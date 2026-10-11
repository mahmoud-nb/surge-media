import { forgetTrustedDevicesSchema } from '#shared/schemas/credentials'

/**
 * DELETE /api/auth/trusted-devices — { scope: 'current' | 'all' } : retire la confiance accordée à ce
 * navigateur, ou à tous les appareils du compte connecté (cookie effacé dans les deux cas). Retirer un
 * droit ne demande pas de confirmation du mot de passe. Journalisé si un appareil est concerné.
 * 200 { revoked }.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { scope } = await readValidatedBody(event, body => forgetTrustedDevicesSchema.parse(body))
  const revoked = scope === 'all' ? await revokeTrustedDevices(user.id, event) : await forgetCurrentDevice(event, user)
  if (revoked > 0) {
    await recordAudit(event, { action: 'user.devices_revoked', targetType: 'user', targetId: user.id, data: { label: user.email, scope, count: revoked } })
  }
  return { revoked }
})
