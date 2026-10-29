import type { UserListQuery } from '#shared/schemas/users'
import type { UserErrorCode, UserStatus } from '#shared/utils/users'
import { userStatus } from '#shared/utils/users'
import type { Prisma, User } from '../generated/prisma/client'

/** Relations jointes à un compte pour sa représentation publique. */
export const USER_SUMMARY_INCLUDE = {
  invitedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.UserInclude

type UserWithInviter = User & { invitedBy?: { id: string, name: string | null, email: string } | null }

/** Représentation publique d'un compte (jamais d'empreinte de mot de passe). */
export function toUserSummary(user: UserWithInviter) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    isActive: user.isActive,
    status: userStatus({ isActive: user.isActive, hasPassword: user.passwordHash !== null }),
    lastLoginAt: user.lastLoginAt,
    /** Double authentification active (jamais le secret). */
    mfaEnabled: user.mfaSecret !== null,
    createdAt: user.createdAt,
    /** Auteur de l'invitation (null : compte d'amorçage, ou auteur supprimé). */
    invitedBy: user.invitedBy ?? null,
  }
}

export type UserSummary = ReturnType<typeof toUserSummary>

const STATUS_FILTERS: Record<UserStatus, Prisma.UserWhereInput> = {
  active: { isActive: true, passwordHash: { not: null } },
  invited: { isActive: true, passwordHash: null },
  inactive: { isActive: false },
}

/**
 * Comptes visibles par `actor` : tous avec `users:manage` ; sinon (gestionnaire, `users:invite`)
 * seulement ceux qu'il a invités.
 */
export function visibleUsersWhere(actor: User): Prisma.UserWhereInput {
  return hasPermission(actor.role, 'users:manage') ? {} : { invitedById: actor.id }
}

export function userListWhere(query: UserListQuery, actor: User): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [visibleUsersWhere(actor)]
  if (query.q) {
    and.push({ OR: textSearch(['email', 'name'], query.q) })
  }
  if (query.role) and.push({ role: query.role })
  if (query.status) and.push(STATUS_FILTERS[query.status])
  return { AND: and }
}

/** Erreur métier : statut HTTP + code traduit par l'interface (`data.code`). */
export function userError(statusCode: 400 | 403 | 404 | 409 | 422, code: UserErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/**
 * Garde-fous des opérations sur un compte :
 *  - un administrateur ne peut ni changer son propre rôle, ni se désactiver, ni se supprimer ;
 *  - on ne retire jamais le dernier administrateur actif.
 */
export async function assertUserChangeAllowed(
  actor: User,
  target: User,
  change: { role?: User['role'], isActive?: boolean, delete?: boolean },
): Promise<void> {
  const demoted = change.role !== undefined && change.role !== 'ADMIN'
  const deactivated = change.isActive === false
  const removesAccess = demoted || deactivated || change.delete === true

  if (actor.id === target.id && (removesAccess || (change.role !== undefined && change.role !== target.role))) {
    throw userError(403, 'SELF_ACTION')
  }

  if (removesAccess && target.role === 'ADMIN' && target.isActive) {
    const prisma = await usePrisma()
    const otherAdmins = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: target.id } },
    })
    if (otherAdmins === 0) throw userError(409, 'LAST_ADMIN')
  }
}

/** Charge un compte par identifiant ou lève 404. */
export async function findUserOr404(id: string): Promise<User> {
  const prisma = await usePrisma()
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return user
}

/**
 * Compte visible par `actor` (voir visibleUsersWhere), avec l'auteur de son invitation ; 404 sinon
 * (un gestionnaire n'apprend pas l'existence des comptes qu'il n'a pas invités).
 */
export async function findVisibleUserOr404(actor: User, id: string) {
  const prisma = await usePrisma()
  const user = await prisma.user.findFirst({ where: { AND: [{ id }, visibleUsersWhere(actor)] }, include: USER_SUMMARY_INCLUDE })
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return user
}
