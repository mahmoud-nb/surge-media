import { confirmPasswordSchema } from '#shared/schemas/credentials'

// Échecs comptés par compte : la session est déjà ouverte, on borne les essais sur son mot de passe.
const failures = createRateLimiter({ max: 5, windowMs: 15 * 60_000 })

/**
 * POST /api/auth/confirm-password — { password } → confirme le mot de passe de l'utilisateur
 * connecté avant une action sensible (« mode sudo », REAUTH_WINDOW_SECONDS).
 * 200 { verifiedUntil } · 401 (pas de session) · 422 PASSWORD_INCORRECT (la session reste
 * valide : pas de 401, qui déconnecterait l'interface) · 429 trop d'essais (Retry-After).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { password } = await readValidatedBody(event, body => confirmPasswordSchema.parse(body))

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
  return { verifiedUntil: new Date(verifiedAt.getTime() + REAUTH_WINDOW_SECONDS * 1000) }
})
