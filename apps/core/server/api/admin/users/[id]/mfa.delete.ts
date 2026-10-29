/**
 * DELETE /api/admin/users/:id/mfa — un administrateur réinitialise la double authentification d'un autre
 * compte (téléphone et codes de secours perdus) : secret, codes de secours et appareils de confiance
 * retirés ; le titulaire est prévenu par e-mail (si le SMTP est configuré) et reconfigure à sa prochaine
 * connexion si la politique l'exige. Mode sudo. Pour son propre compte : « Mon compte » (un code y est
 * demandé), sinon une session volée suffirait à retirer le second facteur.
 * 200 { mfaEnabled: false } · 403 REAUTH_REQUIRED · 403 MFA_SELF_RESET · 404 · 409 MFA_NOT_ENABLED.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')
  if (target.id === actor.id) throw mfaError(403, 'MFA_SELF_RESET')
  await requireRecentPassword(event)
  if (!target.mfaSecret) throw mfaError(409, 'MFA_NOT_ENABLED')

  await disableUserMfa(target.id)
  await recordAudit(event, { action: 'user.mfa_reset', targetType: 'user', targetId: target.id, data: { label: target.email, by: 'admin' } })
  await notifyMfaChange(event, target, 'reset', { by: actor.name || actor.email })
  return { mfaEnabled: false }
})
