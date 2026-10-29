import { otpauthQrSvg } from '../../../lib/mfa/qr'
import { formatSecretForDisplay, generateTotpSecret, otpauthUri } from '../../../lib/mfa/totp'

/**
 * POST /api/auth/mfa/setup — prépare l'activation de la double authentification : nouveau secret, gardé
 * dans un cookie scellé (10 min) jusqu'à sa confirmation par POST /api/auth/mfa/enable. Depuis une connexion
 * que la politique oblige à configurer (défi « setup »), ou depuis « Mon compte » (session, mode sudo).
 * 200 { secret, otpauthUri, qrSvg } (secret groupé par 4 caractères pour la saisie manuelle) · 403
 * REAUTH_REQUIRED · 409 MFA_ALREADY_ENABLED · 409 MFA_UNAVAILABLE (clé de chiffrement absente) · 410
 * MFA_CHALLENGE_EXPIRED.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { user } = await resolveMfaSetupAccount(event)
  if (user.mfaSecret) throw mfaError(409, 'MFA_ALREADY_ENABLED')
  if (!mfaAvailable(event)) throw mfaError(409, 'MFA_UNAVAILABLE')

  const secret = generateTotpSecret()
  await startMfaSetup(event, user, secret)
  const uri = otpauthUri({ secret, account: user.email, issuer: mfaIssuer(event) })
  return { secret: formatSecretForDisplay(secret), otpauthUri: uri, qrSvg: otpauthQrSvg(uri) }
})
