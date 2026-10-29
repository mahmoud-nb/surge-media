import { mfaPolicySchema } from '#shared/schemas/auth'

/**
 * PUT /api/admin/security — { mfaPolicy } : change la politique de double authentification (mode sudo).
 * Les sessions ouvertes ne sont pas coupées : la règle s'applique à la connexion suivante (12 h au plus).
 * 200 { mfaPolicy } · 403 REAUTH_REQUIRED · 409 MFA_UNAVAILABLE (exiger le MFA sans clé de chiffrement).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  await requireRecentPassword(event)
  const { mfaPolicy } = await readValidatedBody(event, body => mfaPolicySchema.parse(body))
  if (mfaPolicy !== 'optional' && !mfaAvailable(event)) throw mfaError(409, 'MFA_UNAVAILABLE')

  const previous = await readMfaPolicy()
  if (previous !== mfaPolicy) {
    await writeMfaPolicy(mfaPolicy)
    await recordAudit(event, { action: 'settings.updated', data: { changes: { mfaPolicy: { from: previous, to: mfaPolicy } } } })
  }
  return { mfaPolicy }
})
