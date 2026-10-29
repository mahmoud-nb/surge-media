import { mfaEnableSchema } from '#shared/schemas/auth'
import { normalizeTotpCode } from '#shared/utils/mfa'
import { verifyTotp } from '../../../lib/mfa/totp'

/**
 * POST /api/auth/mfa/enable — { code } : confirme le secret préparé par POST /api/auth/mfa/setup avec un
 * premier code de l'application, active la double authentification et remet les codes de secours (à
 * montrer une seule fois). Depuis une connexion (défi « setup »), ouvre aussi la session.
 * 200 { recoveryCodes, user? } · 403 REAUTH_REQUIRED · 409 MFA_ALREADY_ENABLED · 409 MFA_UNAVAILABLE ·
 * 410 MFA_CHALLENGE_EXPIRED · 410 MFA_SETUP_EXPIRED (recommencer) · 422 MFA_CODE_INVALID · 429.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { user, fromLogin } = await resolveMfaSetupAccount(event)
  if (user.mfaSecret) throw mfaError(409, 'MFA_ALREADY_ENABLED')
  if (!mfaAvailable(event)) throw mfaError(409, 'MFA_UNAVAILABLE')
  const { code } = await readValidatedBody(event, body => mfaEnableSchema.parse(body))
  const secret = await requireMfaSetup(event, user)

  const attempts = mfaAttempts(event, user.id)
  attempts.check()
  const normalized = normalizeTotpCode(code)
  const step = normalized ? verifyTotp(secret, normalized, { nowMs: Date.now() }) : null
  if (step === null) {
    attempts.fail()
    throw mfaError(422, 'MFA_CODE_INVALID')
  }

  attempts.succeed()
  const recoveryCodes = await enableUserMfa(event, user, secret, step)
  await clearMfaSetup(event)
  if (fromLogin) {
    await clearMfaChallenge(event)
    await startSession(event, user)
  }
  event.context.authUser = user
  await recordAudit(event, { action: 'user.mfa_enabled', targetType: 'user', targetId: user.id, data: { label: user.email } })
  await notifyMfaChange(event, user, 'enabled')
  return fromLogin ? { recoveryCodes, user: toSessionUser(user) } : { recoveryCodes }
})
