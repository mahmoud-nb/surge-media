/**
 * DELETE /api/admin/users/:id/trusted-devices — retire la confiance de tous les appareils d'un compte
 * (users:manage) : ses actions sensibles redemanderont le mot de passe. Journalisé si un appareil est
 * concerné. 200 { revoked } · 404.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')
  // Son propre compte : le cookie de ce navigateur est aussi effacé.
  const revoked = await revokeTrustedDevices(target.id, actor.id === target.id ? event : undefined)
  if (revoked > 0) {
    await recordAudit(event, { action: 'user.devices_revoked', targetType: 'user', targetId: target.id, data: { label: target.email, scope: 'all', count: revoked } })
  }
  return { revoked }
})
