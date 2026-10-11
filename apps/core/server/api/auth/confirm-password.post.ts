import { confirmPasswordSchema } from '#shared/schemas/credentials'

// Échecs comptés par compte : la session est déjà ouverte, on borne les essais sur son mot de passe.
const failures = createRateLimiter({ max: 5, windowMs: 15 * 60_000 })

/**
 * POST /api/auth/confirm-password — { password, trustDevice? } → confirme le mot de passe de
 * l'utilisateur connecté avant une action sensible (« mode sudo », REAUTH_WINDOW_SECONDS).
 * `trustDevice` : ce navigateur devient un appareil de confiance (cookie HTTP-only, durée
 * NUXT_PUBLIC_TRUSTED_DEVICE_DAYS ; ignoré si l'option est désactivée), journalisé.
 * 200 { verifiedUntil, trustedUntil } · 401 (pas de session) · 422 PASSWORD_INCORRECT (la session
 * reste valide : pas de 401, qui déconnecterait l'interface) · 429 trop d'essais (Retry-After).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { password, trustDevice: trust } = await readValidatedBody(event, body => confirmPasswordSchema.parse(body))

  const retryAfter = failures.retryAfter(user.id)
  if (retryAfter > 0) {
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  if (!user.passwordHash || !(await verifyUserPassword(user.passwordHash, password))) {
    failures.hit(user.id)
    throw authError(422, 'PASSWORD_INCORRECT')
  }

  failures.reset(user.id)
  const verifiedAt = await markPasswordVerified(event)
  let trustedUntil: Date | null = null
  if (trust && configuredTrustedDeviceDays(event) > 0) {
    trustedUntil = await trustDevice(event, user)
    await recordAudit(event, {
      action: 'user.device_trusted',
      targetType: 'user',
      targetId: user.id,
      data: { label: user.email, days: configuredTrustedDeviceDays(event) },
    })
  }
  return { verifiedUntil: new Date(verifiedAt.getTime() + REAUTH_WINDOW_SECONDS * 1000), trustedUntil }
})
