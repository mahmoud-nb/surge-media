/**
 * Rôles et permissions de l'interface d'administration (source de vérité unique,
 * auto-importée côté app et côté serveur). Le serveur applique ces règles via
 * `requireAuth(event, permission)` ; l'interface ne fait que masquer ce qui est interdit.
 */

/** Doit rester identique à l'enum `Role` de prisma/schema.prisma (vérifié à la compilation). */
export const ROLES = ['ADMIN', 'EDITOR', 'DEVELOPER'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'media:manage', // médias et dossiers
  'tokens:manage', // jetons d'accès API
  'api:manage', // projets, origines CORS, intégrations
  'users:manage', // comptes et rôles
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  EDITOR: ['media:manage'],
  DEVELOPER: ['media:manage', 'tokens:manage', 'api:manage'],
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false
}
