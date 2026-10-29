import { mfaVerifySchema } from '#shared/schemas/auth'

/**
 * POST /api/auth/mfa/verify — { code | recoveryCode, trustDevice? } : second facteur d'une connexion en
 * attente (défi « code » posé par POST /api/auth/login) → ouvre la session. `trustDevice` (avec un code de
 * l'application seulement) : ce navigateur ne redemandera plus le code jusqu'à l'échéance de sa confiance.
 * 200 { user, recoveryCodesLeft? } (`recoveryCodesLeft` après un code de secours) · 409 MFA_UNAVAILABLE ·
 * 410 MFA_CHALLENGE_EXPIRED (revenir au mot de passe) · 422 MFA_CODE_INVALID · 429 (Retry-After).
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { challenge, user } = await requireMfaChallenge(event, 'code')
  const input = await readValidatedBody(event, body => mfaVerifySchema.parse(body))

  const attempts = mfaAttempts(event, user.id, challenge.challengeId)
  attempts.check()
  const proof = await verifyMfaProof(event, user, input)
  if (!proof.ok) {
    attempts.fail()
    if (mfaChallengeFailures.retryAfter(challenge.challengeId) > 0) {
      // Trop d'essais sur ce défi : retour au mot de passe.
      await clearMfaChallenge(event)
      throw mfaError(410, 'MFA_CHALLENGE_EXPIRED')
    }
    throw mfaError(422, 'MFA_CODE_INVALID')
  }

  attempts.succeed()
  await clearMfaChallenge(event)
  await startSession(event, user)
  event.context.authUser = user

  if (proof.remaining !== undefined) {
    await recordAudit(event, { action: 'user.mfa_recovery_used', targetType: 'user', targetId: user.id, data: { label: user.email, remaining: proof.remaining } })
    await notifyMfaChange(event, user, 'recoveryUsed', { remaining: proof.remaining })
    return { user: toSessionUser(user), recoveryCodesLeft: proof.remaining }
  }
  if (input.trustDevice && configuredTrustedDeviceDays(event) > 0) {
    await trustDevice(event, user, { secondFactor: true })
    await recordAudit(event, { action: 'user.device_trusted', targetType: 'user', targetId: user.id, data: { label: user.email, days: configuredTrustedDeviceDays(event), secondFactor: true } })
  }
  return { user: toSessionUser(user) }
})
