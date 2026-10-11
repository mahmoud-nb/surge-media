import type { H3Event } from 'h3'
import type { Media, Project, ProjectRole as PrismaProjectRole, User } from '../generated/prisma/client'

// Échoue à la compilation si PROJECT_ROLES (shared/utils/permissions.ts) et l'enum Prisma divergent.
type SameProjectRoles = [ProjectRole, PrismaProjectRole] extends [PrismaProjectRole, ProjectRole] ? true : never
const projectRolesInSync: SameProjectRoles = true
void projectRolesInSync

/**
 * Contrôle d'accès aux espaces (bibliothèque de l'organisation, projets) pour l'interface
 * d'administration. Les portées viennent du moteur pur `spaceScopes` (shared/utils/permissions.ts) ;
 * ce module ne fait que charger les données nécessaires et traduire le résultat en erreurs HTTP :
 *   - espace inexistant ou invisible pour l'utilisateur → 404 (son existence n'est pas révélée) ;
 *   - portée manquante → 403 (PROJECT_ARCHIVED si c'est l'archivage qui la retire).
 */

export type Space = { type: 'library' } | { type: 'project', id: string }

export const LIBRARY: Space = { type: 'library' }

export interface SpaceAccess {
  user: User
  space: Space
  /** Projet de l'espace (null pour la bibliothèque). */
  project: Project | null
  /** Rôle exercé dans le projet (null pour la bibliothèque). */
  projectRole: ProjectRole | null
  scopes: Scope[]
}

/** Espace désigné par un identifiant de projet (null ou absent = bibliothèque). */
export function spaceFor(projectId: string | null | undefined): Space {
  return projectId ? { type: 'project', id: projectId } : LIBRARY
}

export function spaceOfMedia(media: Pick<Media, 'projectId'>): Space {
  return spaceFor(media.projectId)
}

export function sameSpace(a: Space, b: Space): boolean {
  return a.type === b.type && (a.type === 'library' || a.id === (b as { id: string }).id)
}

/** Espace d'un accès, tel que présenté à l'interface (avec les portées de l'utilisateur). */
export function describeAccess(access: SpaceAccess) {
  const { project } = access
  return {
    space: project
      ? { type: 'project' as const, project: { id: project.id, name: project.name, slug: project.slug, archivedAt: project.archivedAt } }
      : { type: 'library' as const, project: null },
    projectRole: access.projectRole,
    scopes: access.scopes,
  }
}

/** Accès d'un utilisateur à un espace, ou null si l'espace n'existe pas ou lui est invisible. */
export async function resolveSpaceAccess(user: User, space: Space): Promise<SpaceAccess | null> {
  if (space.type === 'library') {
    const scopes = spaceScopes(user.role, { type: 'library' })
    return scopes.length ? { user, space, project: null, projectRole: null, scopes } : null
  }

  const prisma = await usePrisma()
  const found = await prisma.project.findUnique({
    where: { id: space.id },
    include: { members: { where: { userId: user.id }, select: { role: true } } },
  })
  if (!found) return null
  const { members, ...project } = found
  const memberRole = members[0]?.role
  const projectRole = effectiveProjectRole(user.role, memberRole)
  if (!projectRole) return null
  const scopes = spaceScopes(user.role, { type: 'project', memberRole, archived: Boolean(project.archivedAt) })
  return { user, space, project, projectRole, scopes }
}

/** Refuse une portée absente (403), en expliquant quand c'est l'archivage du projet qui la retire. */
export function assertScope(access: SpaceAccess, scope: Scope): void {
  if (hasScope(access.scopes, scope)) return
  if (access.project?.archivedAt && access.projectRole && hasScope(PROJECT_ROLE_SCOPES[access.projectRole], scope)) {
    throw projectError(403, 'PROJECT_ARCHIVED')
  }
  throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
}

/** Session valide + espace visible (sinon 404) + portée demandée (sinon 403). */
export async function requireSpaceAccess(event: H3Event, space: Space, scope?: Scope): Promise<SpaceAccess> {
  const user = await requireAuth(event)
  const access = await resolveSpaceAccess(user, space)
  if (!access) {
    throw createError({ statusCode: 404, statusMessage: space.type === 'project' ? 'Project not found' : 'Not Found' })
  }
  if (scope) assertScope(access, scope)
  return access
}

/**
 * Média accessible dans son espace : 404 s'il n'existe pas ou si son espace est invisible pour
 * l'utilisateur, 403 si la portée manque.
 */
export async function requireMediaAccess<M extends Pick<Media, 'projectId'>>(
  event: H3Event,
  find: () => Promise<M | null>,
  scope: Scope,
): Promise<{ media: M, access: SpaceAccess }> {
  const user = await requireAuth(event)
  const media = await find()
  const access = media ? await resolveSpaceAccess(user, spaceOfMedia(media)) : null
  if (!media || !access || !hasScope(access.scopes, 'media:read')) {
    throw createError({ statusCode: 404, statusMessage: 'Media not found' })
  }
  assertScope(access, scope)
  return { media, access }
}
