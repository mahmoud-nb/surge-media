import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { User as SessionUser, UserSession } from '#auth-utils'
import { PASSWORD_MIN_LENGTH } from '#shared/schemas/auth'
import { hasPermission, type Permission, type Role } from '#shared/utils/permissions'
import type { Role as PrismaRole, User } from '../generated/prisma/client'

// Échoue à la compilation si ROLES (shared/utils/permissions.ts) et l'enum Prisma divergent.
type SameRoles = [Role, PrismaRole] extends [PrismaRole, Role] ? true : never
const rolesInSync: SameRoles = true
void rolesInSync

/** Durée de session par défaut (secondes) si NUXT_SESSION_MAX_AGE n'est pas défini. */
const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 12
/** Mise à jour de Session.lastSeenAt au plus toutes les 5 minutes (évite une écriture par requête). */
const LAST_SEEN_INTERVAL_MS = 5 * 60_000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Comparaison en temps constant de deux chaînes de longueurs quelconques. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

export function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, locale: user.locale }
}

/**
 * Ouvre une session d'administration : enregistrement en base (révocable) et cookie
 * scellé HTTP-only. `replaceUserSession` régénère le cookie (anti-fixation de session).
 */
export async function startSession(event: H3Event, user: User): Promise<void> {
  const prisma = await usePrisma()
  const token = randomBytes(32).toString('base64url')
  const maxAge = useRuntimeConfig(event).session.maxAge ?? DEFAULT_SESSION_MAX_AGE
  const now = new Date()

  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } })
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + maxAge * 1000),
      ipAddress: getRequestIP(event)?.slice(0, 191),
      userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 191),
    },
  })
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } })
  await replaceUserSession(event, { user: toSessionUser(user), secure: { token }, loggedInAt: now.getTime() })
}

/** Valide la session en base et renvoie l'utilisateur à jour, ou null (expirée, révoquée, compte désactivé). */
export async function resolveSession(session: Partial<UserSession>): Promise<User | null> {
  const token = session.secure?.token
  if (!token) return null

  const prisma = await usePrisma()
  const record = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!record || record.expiresAt <= new Date() || !record.user.isActive) return null

  if (Date.now() - record.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
    await prisma.session.update({ where: { id: record.id }, data: { lastSeenAt: new Date() } })
  }
  return record.user
}

/** Supprime la session en base (déconnexion, révocation). */
export async function revokeSession(session: Partial<UserSession>): Promise<void> {
  const token = session.secure?.token
  if (!token) return
  const prisma = await usePrisma()
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
}

/**
 * Protège une route API de l'administration : session valide en base, compte actif
 * et, si demandé, permission du rôle. Lève 401 ou 403.
 */
export async function requireAuth(event: H3Event, permission?: Permission): Promise<User> {
  let user = event.context.authUser as User | undefined
  if (!user) {
    const resolved = await resolveSession(await getUserSession(event))
    if (!resolved) {
      await clearUserSession(event)
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    user = event.context.authUser = resolved
  }
  if (permission && !hasPermission(user.role, permission)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return user
}

/** Erreur de confirmation du mot de passe : statut HTTP + code (`data.code`) traduit par l'interface. */
export function authError(statusCode: 403 | 422, code: AuthErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/** Enregistrement en base de la session courante (celle du cookie), ou null. */
async function currentSessionRecord(event: H3Event) {
  const { secure } = await getUserSession(event)
  if (!secure?.token) return null
  const prisma = await usePrisma()
  return prisma.session.findUnique({ where: { tokenHash: hashToken(secure.token) }, select: { id: true, passwordVerifiedAt: true } })
}

/**
 * Action sensible (« mode sudo ») : session valide ET mot de passe saisi il y a moins de
 * REAUTH_WINDOW_SECONDS (connexion ou confirmation) — ou appareil de confiance de ce compte
 * (server/utils/trusted-devices.ts) —, sinon 403 REAUTH_REQUIRED.
 * À appeler avant tout effet de bord ; l'interface rejoue l'action après confirmation.
 */
export async function requireRecentPassword(event: H3Event): Promise<User> {
  const user = await requireAuth(event)
  const session = await currentSessionRecord(event)
  if (!session) throw authError(403, 'REAUTH_REQUIRED')
  if (isRecentlyVerified(session.passwordVerifiedAt) || await findTrustedDevice(event, user)) return user
  throw authError(403, 'REAUTH_REQUIRED')
}

/** Note une saisie réussie du mot de passe pour la session courante ; renvoie sa date. */
export async function markPasswordVerified(event: H3Event): Promise<Date> {
  const session = await currentSessionRecord(event)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const prisma = await usePrisma()
  const verifiedAt = new Date()
  await prisma.session.update({ where: { id: session.id }, data: { passwordVerifiedAt: verifiedAt } })
  return verifiedAt
}

/**
 * Compte d'amorçage (première connexion) : NUXT_BOOTSTRAP_ADMIN_EMAIL et
 * NUXT_BOOTSTRAP_ADMIN_PASSWORD. Il n'est utilisable que tant qu'aucun utilisateur
 * n'existe : la première connexion crée l'administrateur en base, puis ces
 * variables sont ignorées et doivent être supprimées.
 */
export async function authenticateBootstrapAdmin(event: H3Event, email: string, password: string): Promise<User | null> {
  const config = useRuntimeConfig(event).bootstrapAdmin
  const bootstrapEmail = config.email.trim().toLowerCase()
  if (!bootstrapEmail || !config.password || bootstrapEmail !== email) return null
  if (config.password.length < PASSWORD_MIN_LENGTH) {
    console.warn(`[surge-media] Amorçage refusé : NUXT_BOOTSTRAP_ADMIN_PASSWORD doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
    return null
  }
  if (!safeEqual(password, config.password)) return null

  const prisma = await usePrisma()
  if (await prisma.user.count() > 0) return null

  try {
    return await prisma.user.create({
      data: { email, role: 'ADMIN', passwordHash: await hashUserPassword(password) },
    })
  }
  catch {
    // Deux premières connexions simultanées : l'autre requête a créé le compte.
    return prisma.user.findUnique({ where: { email } })
  }
}
