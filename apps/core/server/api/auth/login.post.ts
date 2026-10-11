import type { H3Event } from 'h3'
import { loginSchema } from '#shared/schemas/auth'
import type { User } from '../../generated/prisma/client'

// Échecs comptés par adresse e-mail (anti force brute ciblée) et par IP (anti balayage).
const WINDOW_MS = 15 * 60_000
const failuresByEmail = createRateLimiter({ max: 5, windowMs: WINDOW_MS })
const failuresByIp = createRateLimiter({ max: 50, windowMs: WINDOW_MS })

async function authenticate(event: H3Event, email: string, password: string): Promise<User | null> {
  const prisma = await usePrisma()
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    const admin = await authenticateBootstrapAdmin(event, email, password)
    return admin ?? verifyDummyPassword(password).then(() => null)
  }
  if (!user.isActive || !user.passwordHash) {
    return verifyDummyPassword(password).then(() => null)
  }
  return (await verifyUserPassword(user.passwordHash, password)) ? user : null
}

/**
 * POST /api/auth/login — { email, password } → ouvre une session d'administration.
 * 400 données invalides · 401 identifiants refusés (message volontairement générique)
 * · 429 trop de tentatives (en-tête Retry-After).
 */
export default defineEventHandler(async (event) => {
  const { email, password } = await readValidatedBody(event, body => loginSchema.parse(body))
  const ip = getRequestIP(event) ?? 'unknown'

  const retryAfter = Math.max(failuresByEmail.retryAfter(email), failuresByIp.retryAfter(ip))
  if (retryAfter > 0) {
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const user = await authenticate(event, email, password)
  if (!user) {
    failuresByEmail.hit(email)
    failuresByIp.hit(ip)
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  failuresByEmail.reset(email)
  await startSession(event, user)
  return { user: toSessionUser(user) }
})
