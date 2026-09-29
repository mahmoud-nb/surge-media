import type { CreatePersonalTokenData, CreateProjectKeyData } from '#shared/schemas/credentials'
import { ROTATION_OVERLAP_SECONDS, type RotationOverlap } from '#shared/utils/credentials'
import type { AccessToken, Prisma, User } from '../../generated/prisma/client'
import { invalidateCredential } from '../access/credentials'
import { generateAccessToken } from '../access/tokens'

/**
 * Identifiants d'API : clés de projet (publiques et secrètes, étiquetées par environnement) et
 * jetons personnels. Les contrôles d'accès (portées, confirmation du mot de passe) sont faits par
 * les routes ; ce module applique les règles du cycle de vie :
 *   - la valeur complète n'est renvoyée qu'à la création (sauf clé publique, réaffichable) ;
 *   - portées immuables ; révocation immédiate ; suppression seulement d'un identifiant inactif ;
 *   - rotation d'une clé : la nouvelle hérite du nom, de l'environnement, des portées et de la
 *     durée de validité ; l'ancienne reste valable pendant la période de recouvrement choisie.
 * L'usage des identifiants (API v1, dernière utilisation) arrive en B3.
 */

const DAY_MS = 86_400_000

const CREATOR = { select: { id: true, name: true, email: true, isActive: true } } as const
const TOKEN_INCLUDE = {
  createdBy: CREATOR,
  replacedBy: { select: { id: true, name: true, prefix: true } },
  projects: { select: { project: { select: { id: true, name: true, archivedAt: true } } }, orderBy: { project: { name: 'asc' } } },
} satisfies Prisma.AccessTokenInclude

type TokenWithRelations = Prisma.AccessTokenGetPayload<{ include: typeof TOKEN_INCLUDE }>

function commonSummary(token: TokenWithRelations) {
  return {
    id: token.id,
    type: token.type,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes.split(' ') as TokenScope[],
    status: tokenStatus(token),
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    lastUsedIp: token.lastUsedIp,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
  }
}

/** Clé de projet telle que présentée à l'administration (jamais d'empreinte). */
export function toKeySummary(token: TokenWithRelations) {
  return {
    ...commonSummary(token),
    type: token.type as ProjectKeyType,
    environment: token.environment ?? '',
    /** Valeur complète d'une clé publique (non secrète) ; null pour une clé secrète. */
    publicValue: token.type === 'PUBLISHABLE' ? token.publicValue : null,
    replacedBy: token.replacedBy,
    createdBy: token.createdBy,
  }
}
export type KeySummary = ReturnType<typeof toKeySummary>

/** Jeton personnel tel que présenté à son propriétaire. */
export function toPersonalTokenSummary(token: TokenWithRelations) {
  return {
    ...commonSummary(token),
    allProjects: token.allProjects,
    includeLibrary: token.includeLibrary,
    projects: token.projects.map(({ project }) => project),
  }
}

/** Libellé d'un identifiant pour le journal d'audit (reste lisible après sa suppression). */
export function tokenAuditLabel(token: Pick<AccessToken, 'name' | 'prefix'>): string {
  return `${token.name} (${token.prefix}…)`
}

function lifetimeExpiry(days: string, now: number): Date | null {
  return days === 'never' ? null : new Date(now + Number(days) * DAY_MS)
}

// ─── Clés de projet ──────────────────────────────────────────────────────────

export async function listProjectKeys(projectId: string) {
  const prisma = await usePrisma()
  const keys = await prisma.accessToken.findMany({
    where: { projectId, type: { in: ['PUBLISHABLE', 'SECRET'] } },
    include: TOKEN_INCLUDE,
    orderBy: [{ environment: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
  })
  return keys.map(toKeySummary)
}

export async function createProjectKey(projectId: string, actor: User, input: CreateProjectKeyData) {
  const generated = generateAccessToken(input.type)
  const secret = input.type === 'SECRET'
  const prisma = await usePrisma()
  const key = await prisma.accessToken.create({
    data: {
      type: input.type,
      name: input.name,
      projectId,
      environment: input.environment,
      prefix: generated.prefix,
      tokenHash: generated.hash,
      publicValue: secret ? null : generated.value,
      scopes: tokenScopes(secret ? input.scopes : []).join(' '),
      expiresAt: secret ? lifetimeExpiry(input.lifetime, Date.now()) : null,
      createdById: actor.id,
    },
    include: TOKEN_INCLUDE,
  })
  return { key: toKeySummary(key), value: generated.value }
}

/** Clé d'un projet (404 si elle n'existe pas ou appartient à un autre projet). */
export async function findProjectKey(projectId: string, keyId: string) {
  const prisma = await usePrisma()
  const key = await prisma.accessToken.findFirst({
    where: { id: keyId, projectId, type: { in: ['PUBLISHABLE', 'SECRET'] } },
    include: TOKEN_INCLUDE,
  })
  if (!key) throw createError({ statusCode: 404, statusMessage: 'Key not found' })
  return key
}

/**
 * Rotation : nouvelle clé (même nom, environnement, portées et durée de validité) ; l'ancienne
 * est révoquée immédiatement (`now`) ou reste valable pendant la période de recouvrement.
 */
export async function rotateProjectKey(key: TokenWithRelations, actor: User, overlap: RotationOverlap) {
  if (tokenStatus(key) !== 'active') throw credentialError(409, 'TOKEN_NOT_ACTIVE')
  if (key.replacedById) throw credentialError(409, 'TOKEN_REPLACED')

  const now = Date.now()
  const generated = generateAccessToken(key.type)
  const lifetime = key.expiresAt ? key.expiresAt.getTime() - key.createdAt.getTime() : null
  const overlapEnd = new Date(now + ROTATION_OVERLAP_SECONDS[overlap] * 1000)

  const prisma = await usePrisma()
  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.accessToken.create({
      data: {
        type: key.type,
        name: key.name,
        projectId: key.projectId,
        environment: key.environment,
        prefix: generated.prefix,
        tokenHash: generated.hash,
        publicValue: key.type === 'PUBLISHABLE' ? generated.value : null,
        scopes: key.scopes,
        expiresAt: lifetime === null ? null : new Date(now + lifetime),
        createdById: actor.id,
      },
      include: TOKEN_INCLUDE,
    })
    await tx.accessToken.update({
      where: { id: key.id },
      data: overlap === 'now'
        ? { replacedById: next.id, revokedAt: new Date(now) }
        : { replacedById: next.id, expiresAt: key.expiresAt && key.expiresAt < overlapEnd ? key.expiresAt : overlapEnd },
    })
    return next
  })
  invalidateCredential(key.tokenHash)
  return { key: toKeySummary(created), value: generated.value }
}

// ─── Jetons personnels ───────────────────────────────────────────────────────

export async function listPersonalTokens(user: User) {
  const prisma = await usePrisma()
  const tokens = await prisma.accessToken.findMany({
    where: { userId: user.id, type: 'PERSONAL' },
    include: TOKEN_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  })
  return tokens.map(toPersonalTokenSummary)
}

/**
 * Nouveau jeton personnel. Chaque projet choisi doit être visible et actif pour l'utilisateur
 * (422 PROJECT_UNAVAILABLE) ; « tous mes projets » suit ses adhésions au fil du temps. Les droits
 * réels restent ceux du propriétaire au moment de l'usage (portées du jeton ∩ portées du compte).
 */
export async function createPersonalToken(user: User, input: CreatePersonalTokenData) {
  const projectIds = input.allProjects ? [] : [...new Set(input.projectIds)]
  for (const id of projectIds) {
    const access = await resolveSpaceAccess(user, spaceFor(id))
    if (!access || access.project?.archivedAt) throw credentialError(422, 'PROJECT_UNAVAILABLE')
  }
  if (input.includeLibrary && !hasPermission(user.role, 'library:manage')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const generated = generateAccessToken('PERSONAL')
  const prisma = await usePrisma()
  const token = await prisma.accessToken.create({
    data: {
      type: 'PERSONAL',
      name: input.name,
      userId: user.id,
      allProjects: input.allProjects,
      includeLibrary: input.includeLibrary,
      prefix: generated.prefix,
      tokenHash: generated.hash,
      scopes: tokenScopes(input.scopes).join(' '),
      expiresAt: lifetimeExpiry(input.lifetime, Date.now()),
      createdById: user.id,
      projects: { create: projectIds.map(projectId => ({ projectId })) },
    },
    include: TOKEN_INCLUDE,
  })
  return { token: toPersonalTokenSummary(token), value: generated.value }
}

/** Jeton personnel de l'utilisateur (404 sinon, y compris le jeton d'un autre compte). */
export async function findPersonalToken(user: User, tokenId: string) {
  const prisma = await usePrisma()
  const token = await prisma.accessToken.findFirst({ where: { id: tokenId, userId: user.id, type: 'PERSONAL' }, include: TOKEN_INCLUDE })
  if (!token) throw createError({ statusCode: 404, statusMessage: 'Token not found' })
  return token
}

// ─── Révocation et suppression (tous types) ──────────────────────────────────

/** Révocation immédiate d'un identifiant actif (409 TOKEN_NOT_ACTIVE sinon). */
export async function revokeToken(token: AccessToken): Promise<void> {
  if (tokenStatus(token) !== 'active') throw credentialError(409, 'TOKEN_NOT_ACTIVE')
  const prisma = await usePrisma()
  await prisma.accessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } })
  invalidateCredential(token.tokenHash)
}

/** Suppression d'un identifiant expiré ou révoqué (409 TOKEN_ACTIVE s'il est encore actif). */
export async function deleteToken(token: AccessToken): Promise<void> {
  if (tokenStatus(token) === 'active') throw credentialError(409, 'TOKEN_ACTIVE')
  const prisma = await usePrisma()
  await prisma.accessToken.delete({ where: { id: token.id } })
  invalidateCredential(token.tokenHash)
}
