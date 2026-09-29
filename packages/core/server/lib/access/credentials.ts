import type { H3Event } from 'h3'
import type { TokenType } from '#shared/utils/credentials'
import {
  credentialScopes,
  hasPermission,
  type ProjectRole,
  type Role,
  spaceScopes,
  TOKEN_SCOPES,
  type TokenScope,
} from '#shared/utils/permissions'
import type { ProjectState } from '../projects/state'
import { createLruCache } from '../cache/lru'
import { hashAccessToken, parseAccessToken } from './tokens'

/**
 * Résolution des identifiants d'API présentés en `Authorization: Bearer` (API v1 et /m/) :
 *   1. format + CRC vérifiés sans base (parseAccessToken) ;
 *   2. empreinte SHA-256 → identité, gardée 60 s en mémoire (invalidée localement à la révocation,
 *      à la rotation, à la suppression, et pour tous les jetons d'un compte modifié) ;
 *   3. état : révoqué, expiré, propriétaire désactivé.
 * Les portées effectives dans un espace viennent du moteur pur `credentialScopes`
 * (shared/utils/permissions.ts). Architecture : .claude/architecture-phase-b.md § 3.4, § 4, § 9.6.
 */

export interface CredentialRecord {
  id: string
  type: TokenType
  name: string
  prefix: string
  environment: string | null
  /** Projet d'une clé ; null pour un jeton personnel. */
  projectId: string | null
  allProjects: boolean
  includeLibrary: boolean
  /** Sélection de projets d'un jeton personnel (si pas « tous mes projets »). */
  projectIds: string[]
  scopes: TokenScope[]
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  lastUsedAt: Date | null
  /** Propriétaire d'un jeton personnel (état relu au plus toutes les 60 s). */
  owner: { id: string, name: string | null, role: Role, isActive: boolean } | null
}

export type CredentialFailure = 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED'
export type CredentialResolution = { ok: true, credential: CredentialRecord } | { ok: false, code: CredentialFailure }

const cache = createLruCache<CredentialRecord | null>({ max: 10_000, ttlMs: 60_000 })
/** Dernière utilisation enregistrée au plus toutes les 5 minutes (pas une écriture par requête). */
const LAST_USED_INTERVAL_MS = 5 * 60_000

async function loadCredential(hash: string): Promise<CredentialRecord | null> {
  const prisma = await usePrisma()
  const token = await prisma.accessToken.findUnique({
    where: { tokenHash: hash },
    include: {
      user: { select: { id: true, name: true, role: true, isActive: true } },
      projects: { select: { projectId: true } },
    },
  })
  if (!token) return null
  return {
    id: token.id,
    type: token.type,
    name: token.name,
    prefix: token.prefix,
    environment: token.environment,
    projectId: token.projectId,
    allProjects: token.allProjects,
    includeLibrary: token.includeLibrary,
    projectIds: token.projects.map(({ projectId }) => projectId),
    scopes: token.scopes.split(' ').filter((scope): scope is TokenScope => (TOKEN_SCOPES as readonly string[]).includes(scope)),
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    owner: token.user,
  }
}

/** Valeur présentée → identité valable, ou code d'erreur 401. */
export async function resolveCredential(value: string, now = Date.now()): Promise<CredentialResolution> {
  if (!parseAccessToken(value)) return { ok: false, code: 'TOKEN_INVALID' }
  const hash = hashAccessToken(value)
  let credential = cache.get(hash)
  if (credential === undefined) {
    credential = await loadCredential(hash)
    cache.set(hash, credential)
  }
  if (!credential) return { ok: false, code: 'TOKEN_INVALID' }
  if (credential.revokedAt) return { ok: false, code: 'TOKEN_REVOKED' }
  if (credential.expiresAt && credential.expiresAt.getTime() <= now) return { ok: false, code: 'TOKEN_EXPIRED' }
  // Compte désactivé : ses jetons personnels cessent de fonctionner (les clés de projet restent actives).
  if (credential.type === 'PERSONAL' && !credential.owner?.isActive) return { ok: false, code: 'TOKEN_REVOKED' }
  return { ok: true, credential }
}

export function invalidateCredential(hash: string): void {
  cache.delete(hash)
}

/** Rôle, statut ou existence d'un compte modifiés : ses jetons personnels sont relus. */
export function invalidateUserCredentials(userId: string): void {
  cache.deleteWhere(credential => credential?.owner?.id === userId)
}

/** Note la dernière utilisation (date, IP), au plus toutes les 5 minutes ; ne bloque jamais la requête. */
export function touchCredential(credential: CredentialRecord, ip: string | undefined, now = Date.now()): void {
  if (credential.lastUsedAt && now - credential.lastUsedAt.getTime() < LAST_USED_INTERVAL_MS) return
  const usedAt = new Date(now)
  credential.lastUsedAt = usedAt
  const threshold = new Date(now - LAST_USED_INTERVAL_MS)
  void usePrisma()
    .then(prisma => prisma.accessToken.updateMany({
      where: { id: credential.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] },
      data: { lastUsedAt: usedAt, lastUsedIp: ip?.slice(0, 191) ?? null },
    }))
    .catch(error => console.error('[surge-media] Dernière utilisation d\'un identifiant non enregistrée :', error))
}

/** Jeton personnel ou clé secrète : jamais depuis un navigateur (secret exposé dans une page). */
export function isSecretCredential(credential: Pick<CredentialRecord, 'type'>): boolean {
  return credential.type !== 'PUBLISHABLE'
}

/**
 * Requête émise par un navigateur : en-têtes `Origin` ou `Sec-Fetch-Site`, posés par le navigateur
 * et impossibles à retirer depuis un script. Pas `Sec-Fetch-Mode` : le fetch de Node (undici)
 * l'envoie aussi, un serveur légitime serait refusé.
 */
export function isBrowserRequest(event: H3Event): boolean {
  return Boolean(getRequestHeader(event, 'origin') || getRequestHeader(event, 'sec-fetch-site'))
}

/** Portées effectives d'un identifiant dans un projet (liste vide = invisible) ; l'archivage est traité par l'appelant. */
export async function credentialProjectScopes(credential: CredentialRecord, project: Pick<ProjectState, 'id'>): Promise<TokenScope[]> {
  if (credential.type !== 'PERSONAL') {
    return credentialScopes({ type: credential.type, scopes: credential.scopes, ownProject: credential.projectId === project.id })
  }
  const owner = credential.owner
  const inSelection = credential.allProjects || credential.projectIds.includes(project.id)
  if (!owner || !inSelection) return []
  let memberRole: ProjectRole | undefined
  if (!hasPermission(owner.role, 'projects:all')) {
    const prisma = await usePrisma()
    const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: owner.id } }, select: { role: true } })
    memberRole = member?.role
  }
  const ownerScopes = spaceScopes(owner.role, { type: 'project', memberRole, archived: false })
  return credentialScopes({ type: 'PERSONAL', scopes: credential.scopes, inSelection, ownerScopes })
}

/** Portées d'un identifiant dans la bibliothèque : seulement un jeton personnel qui l'inclut. */
export function credentialLibraryScopes(credential: CredentialRecord): TokenScope[] {
  if (credential.type !== 'PERSONAL' || !credential.includeLibrary || !credential.owner) return []
  return credentialScopes({
    type: 'PERSONAL',
    scopes: credential.scopes,
    inSelection: true,
    ownerScopes: spaceScopes(credential.owner.role, { type: 'library' }),
  })
}
