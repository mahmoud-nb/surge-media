import { mfaDisableSchema } from '#shared/schemas/auth'

/**
 * DELETE /api/auth/mfa — { code | recoveryCode } : le titulaire désactive sa double authentification (mode
 * sudo, et un code prouve qu'il détient encore son second facteur). Secret, codes de secours et appareils
 * de confiance sont retirés. 200 { enabled: false } · 401 · 403 REAUTH_REQUIRED · 409 MFA_NOT_ENABLED ·
 * 409 MFA_REQUIRED_BY_POLICY · 409 MFA_UNAVAILABLE · 422 MFA_CODE_INVALID · 429.
 */
export default defineEventHandler(async (event) => {
  const user = await requireRecentPassword(event)
  if (!user.mfaSecret) throw mfaError(409, 'MFA_NOT_ENABLED')
  if (await mfaRequiredForUser(event, user)) throw mfaError(409, 'MFA_REQUIRED_BY_POLICY')
  const input = await readValidatedBody(event, body => mfaDisableSchema.parse(body))

  const attempts = mfaAttempts(event, user.id)
  attempts.check()
  if (!(await verifyMfaProof(event, user, input)).ok) {
    attempts.fail()
    throw mfaError(422, 'MFA_CODE_INVALID')
  }

  attempts.succeed()
  await disableUserMfa(user.id, event)
  await recordAudit(event, { action: 'user.mfa_disabled', targetType: 'user', targetId: user.id, data: { label: user.email, by: 'self' } })
  await notifyMfaChange(event, user, 'disabled')
  return { enabled: false }
})
