/**
 * Rôles, permissions et portées : source de vérité unique, auto-importée côté app et côté
 * serveur. Le serveur applique ces règles (server/utils/access.ts, requireAuth) ; l'interface
 * ne fait que masquer ce qui est interdit.
 *
 * Deux niveaux :
 *  - le rôle de plateforme (User.role) donne des permissions globales et les portées dans la
 *    bibliothèque de l'organisation ;
 *  - le rôle de projet (ProjectMember.role) donne les portées dans ce projet, plafonnées par
 *    le rôle de plateforme. Un ADMIN est propriétaire de tous les projets sans en être membre.
 * Un rôle n'est qu'un ensemble de portées : les jetons d'accès utilisent le même vocabulaire.
 */

// ─── Plateforme ──────────────────────────────────────────────────────────────

/** Doit rester identique à l'enum `Role` de prisma/schema.prisma (vérifié à la compilation). */
export const ROLES = ['ADMIN', 'EDITOR', 'DEVELOPER'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'library:manage', // médias de la bibliothèque de l'organisation
  'projects:create', // créer des projets (le créateur en devient propriétaire)
  'projects:all', // accès à tous les projets comme propriétaire, sans en être membre
  'tokens:personal', // jetons d'accès personnels
  'api:docs', // documentation interactive de l'API et jeton de console (requêtes de test)
  'users:manage', // comptes et rôles de plateforme
  'audit:read', // journal d'audit de toute l'installation
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  EDITOR: ['library:manage'],
  DEVELOPER: ['library:manage', 'projects:create', 'tokens:personal', 'api:docs'],
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false
}

// ─── Portées ─────────────────────────────────────────────────────────────────

/** Portées sur les médias d'un espace (bibliothèque ou projet). */
export const MEDIA_SCOPES = ['media:read', 'media:upload', 'media:write', 'media:delete'] as const
export type MediaScope = (typeof MEDIA_SCOPES)[number]

/** Portées sur un projet lui-même. */
export const PROJECT_SCOPES = ['project:read', 'project:credentials', 'project:members', 'project:settings'] as const
export type ProjectScope = (typeof PROJECT_SCOPES)[number]

export type Scope = MediaScope | ProjectScope

/** Doit rester identique à l'enum `ProjectRole` de prisma/schema.prisma ; du plus au moins privilégié. */
export const PROJECT_ROLES = ['OWNER', 'DEVELOPER', 'EDITOR'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]

export const PROJECT_ROLE_SCOPES: Record<ProjectRole, readonly Scope[]> = {
  OWNER: [...PROJECT_SCOPES, ...MEDIA_SCOPES],
  DEVELOPER: ['project:read', 'project:credentials', ...MEDIA_SCOPES],
  EDITOR: ['project:read', ...MEDIA_SCOPES],
}

/** Rôle de projet le plus élevé que peut exercer chaque rôle de plateforme. */
export const PROJECT_ROLE_CEILING: Record<Role, ProjectRole> = {
  ADMIN: 'OWNER',
  DEVELOPER: 'OWNER',
  EDITOR: 'EDITOR',
}

/** Portées conservées dans un projet archivé : lecture, désarchivage et suppression. */
export const ARCHIVED_PROJECT_SCOPES: readonly Scope[] = ['project:read', 'project:settings', 'media:read']

/** Rang d'un rôle de projet (plus il est élevé, plus le rôle est privilégié). */
function projectRoleRank(role: ProjectRole): number {
  return PROJECT_ROLES.length - PROJECT_ROLES.indexOf(role)
}

/** Rôles de projet attribuables à un utilisateur selon son rôle de plateforme. */
export function assignableProjectRoles(platformRole: Role): ProjectRole[] {
  const ceiling = projectRoleRank(PROJECT_ROLE_CEILING[platformRole])
  return PROJECT_ROLES.filter(role => projectRoleRank(role) <= ceiling)
}

/**
 * Rôle exercé dans un projet : propriétaire pour qui a `projects:all` (ADMIN), sinon le rôle de
 * membre plafonné par le rôle de plateforme ; null si l'utilisateur n'a pas accès au projet.
 */
export function effectiveProjectRole(platformRole: Role, memberRole: ProjectRole | null | undefined): ProjectRole | null {
  if (hasPermission(platformRole, 'projects:all')) return 'OWNER'
  if (!memberRole) return null
  const ceiling = PROJECT_ROLE_CEILING[platformRole]
  return projectRoleRank(memberRole) > projectRoleRank(ceiling) ? ceiling : memberRole
}

/** Espace vu par le moteur de portées (les données nécessaires, sans accès à la base). */
export type SpaceContext =
  | { type: 'library' }
  | { type: 'project', memberRole: ProjectRole | null | undefined, archived: boolean }

/** Portées d'un utilisateur dans un espace ; liste vide = espace invisible pour lui. */
export function spaceScopes(platformRole: Role, space: SpaceContext): Scope[] {
  if (space.type === 'library') {
    return hasPermission(platformRole, 'library:manage') ? [...MEDIA_SCOPES] : []
  }
  const role = effectiveProjectRole(platformRole, space.memberRole)
  if (!role) return []
  const scopes = PROJECT_ROLE_SCOPES[role]
  return space.archived ? scopes.filter(scope => ARCHIVED_PROJECT_SCOPES.includes(scope)) : [...scopes]
}

export function hasScope(scopes: readonly string[], scope: Scope): boolean {
  return scopes.includes(scope)
}

// ─── Identifiants d'API ──────────────────────────────────────────────────────

/**
 * Portées qu'un identifiant d'API (jeton personnel, clé) peut porter : jamais de gestion des accès
 * (membres, clés, origines, réglages). `project:read` et `media:read` sont toujours inclus.
 */
export const TOKEN_SCOPES = ['project:read', ...MEDIA_SCOPES] as const satisfies readonly Scope[]
export type TokenScope = (typeof TOKEN_SCOPES)[number]

/** Portées incluses d'office dans tout identifiant. */
export const TOKEN_BASE_SCOPES = ['project:read', 'media:read'] as const satisfies readonly TokenScope[]

/** Portées que l'on peut ajouter à un jeton personnel ou à une clé secrète. */
export const TOKEN_OPTIONAL_SCOPES = ['media:upload', 'media:write', 'media:delete'] as const satisfies readonly TokenScope[]
export type TokenOptionalScope = (typeof TOKEN_OPTIONAL_SCOPES)[number]

/** Portées complètes d'un identifiant : portées de base + portées choisies, dans l'ordre canonique. */
export function tokenScopes(optional: readonly string[]): TokenScope[] {
  return TOKEN_SCOPES.filter(scope => (TOKEN_BASE_SCOPES as readonly string[]).includes(scope) || optional.includes(scope))
}

/**
 * Ce qu'il faut savoir d'un identifiant pour calculer ses portées dans un espace (projet actif,
 * ou bibliothèque pour un jeton personnel) — sans accès à la base :
 *   - jeton personnel : l'espace fait-il partie de sa sélection, et quelles portées son
 *     propriétaire y a-t-il aujourd'hui (spaceScopes) ;
 *   - clé secrète ou publique : l'espace est-il son projet ;
 *   - jeton délégué : l'espace est-il son projet, et quelles portées son émetteur (clé secrète ou
 *     jeton personnel) y a-t-il aujourd'hui.
 */
export type CredentialContext =
  | { type: 'PERSONAL', scopes: readonly string[], inSelection: boolean, ownerScopes: readonly Scope[] }
  | { type: 'SECRET', scopes: readonly string[], ownProject: boolean }
  | { type: 'PUBLISHABLE', ownProject: boolean }
  | { type: 'DELEGATED', scopes: readonly string[], ownProject: boolean, issuerScopes: readonly TokenScope[] }

/**
 * Portées effectives d'un identifiant dans un espace ; liste vide = espace invisible (404).
 * Un jeton personnel ne dépasse jamais les droits actuels de son propriétaire, un jeton délégué ceux
 * de son émetteur ; une clé publique ne lit que les médias publics (restriction appliquée par
 * l'appelant sur les requêtes). Un jeton délégué n'a que les portées demandées à son émission (pas
 * de lecture d'office : un jeton d'envoi seul ne liste pas les médias).
 */
export function credentialScopes(credential: CredentialContext): TokenScope[] {
  switch (credential.type) {
    case 'PERSONAL':
      if (!credential.inSelection) return []
      return TOKEN_SCOPES.filter(scope => credential.scopes.includes(scope) && credential.ownerScopes.includes(scope))
    case 'SECRET':
      return credential.ownProject ? TOKEN_SCOPES.filter(scope => credential.scopes.includes(scope)) : []
    case 'PUBLISHABLE':
      return credential.ownProject ? [...TOKEN_BASE_SCOPES] : []
    case 'DELEGATED':
      if (!credential.ownProject) return []
      return TOKEN_SCOPES.filter(scope => credential.scopes.includes(scope) && credential.issuerScopes.includes(scope))
  }
}
