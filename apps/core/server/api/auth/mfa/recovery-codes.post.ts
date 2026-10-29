/**
 * POST /api/auth/mfa/recovery-codes — remplace les codes de secours du compte connecté (mode sudo) ; les
 * anciens ne servent plus. 200 { recoveryCodes } · 401 · 403 REAUTH_REQUIRED · 409 MFA_NOT_ENABLED.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = await requireRecentPassword(event)
  if (!user.mfaSecret) throw mfaError(409, 'MFA_NOT_ENABLED')

  const recoveryCodes = await regenerateRecoveryCodes(user.id)
  await recordAudit(event, { action: 'user.mfa_recovery_regenerated', targetType: 'user', targetId: user.id, data: { label: user.email } })
  return { recoveryCodes }
})
