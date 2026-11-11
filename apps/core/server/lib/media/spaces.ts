import { hasPermission, hasScope, type Scope, spaceScopes } from '#shared/utils/permissions'
import type { Prisma, User } from '../../generated/prisma/client'

/**
 * Espaces lisibles par un utilisateur, réunis (page « Médias », niveau « Tous les médias » ;
 * architecture : .claude/architecture-media-view.md, MV7). Les espaces viennent toujours de la session
 * (rôle de plateforme, adhésions), jamais d'une liste fournie par le navigateur. Un média reste dans un
 * seul espace : ce module ne fait que réunir des espaces en lecture.
 *
 * Les conditions Prisma (`mediaSpacesWhere`, `tagSpacesWhere`) sont pures : le tableau de bord, qui
 * compte les médias de tous les espaces visibles (projets archivés compris), les partage.
 */

/**
 * Projets d'un ensemble d'espaces :
 *   - `all` : tous (`projects:all`, l'ADMIN) sauf `excludedIds` (projets archivés, en général aucun ou peu) ;
 *   - `member` : ceux dont `userId` est membre (un autre rôle ne lit que ceux-là), archivés compris ou non ;
 *     `ids` = ces mêmes projets, déjà lus.
 * Les conditions passent par des identifiants plutôt que par la relation `project` : Prisma traduit une
 * condition sur la relation en `LEFT JOIN`, qui fait renoncer SQLite à l'index du tri (mesure : 540 ms au
 * lieu de 0 ms pour la première page de 100 000 médias, architecture-media-view.md, MV14). Au-delà de
 * `SPACE_IDS_MAX` identifiants, la relation reprend la main : plus lente, mais jamais au-delà de la limite
 * de paramètres de SQLite (999 par requête avec Prisma : P2029).
 */
export type ProjectSelection
  = | { all: true, excludedIds: readonly string[] }
    | { member: string, includeArchived: boolean, ids: readonly string[] }

/** Identifiants de projets au plus dans une condition (le reste des 999 paramètres pour les filtres). */
export const SPACE_IDS_MAX = 400

/**
 * Condition sur les projets d'une sélection (sans la bibliothèque), valable pour les médias comme pour
 * les étiquettes (même colonne `projectId`, même relation `project`) ; null = aucun projet.
 */
function projectsWhere(projects: ProjectSelection): (Prisma.MediaWhereInput & Prisma.TagWhereInput) | null {
  if ('all' in projects) {
    if (projects.excludedIds.length === 0) return { projectId: { not: null } }
    return projects.excludedIds.length <= SPACE_IDS_MAX
      ? { projectId: { notIn: [...projects.excludedIds] } }
      : { project: { archivedAt: null } }
  }
  if (projects.ids.length === 0) return null
  if (projects.ids.length <= SPACE_IDS_MAX) return { projectId: { in: [...projects.ids] } }
  return { project: { members: { some: { userId: projects.member } }, ...(projects.includeArchived ? {} : { archivedAt: null }) } }
}

/** Condition des médias de la bibliothèque (si `library`) et des projets choisis ; null = aucun espace. */
export function mediaSpacesWhere(library: boolean, projects: ProjectSelection): Prisma.MediaWhereInput | null {
  if ('all' in projects && projects.excludedIds.length === 0 && library) return {}
  const kept = projectsWhere(projects)
  if (!library) return kept
  return kept ? { OR: [{ projectId: null }, kept] } : { projectId: null }
}

/**
 * Étiquettes utilisables sur les médias de ces espaces : les globales (bibliothèque et tous les
 * projets) et celles des projets choisis.
 */
export function tagSpacesWhere(projects: ProjectSelection): Prisma.TagWhereInput {
  if ('all' in projects && projects.excludedIds.length === 0) return {}
  const kept = projectsWhere(projects)
  return kept ? { OR: [{ projectId: null }, kept] } : { projectId: null }
}

export interface ReadableProject {
  id: string
  name: string
  /** Portées de l'utilisateur dans le projet (spaceScopes). */
  scopes: Scope[]
}

export interface ReadableSpaces {
  /** Portées dans la bibliothèque ; null si elle est invisible pour l'utilisateur. */
  library: Scope[] | null
  /** Projets **actifs** où l'utilisateur lit les médias, par nom (MV3 : les archivés sont exclus). */
  projects: ReadableProject[]
  selection: ProjectSelection
}

/** Bibliothèque (si lisible) et projets actifs lisibles de l'utilisateur, avec ses portées dans chacun. */
export async function readableSpaces(user: Pick<User, 'id' | 'role'>): Promise<ReadableSpaces> {
  const libraryScopes = spaceScopes(user.role, { type: 'library' })
  const seesAll = hasPermission(user.role, 'projects:all')
  const prisma = await usePrisma()
  const rows = await prisma.project.findMany({
    where: seesAll ? {} : { members: { some: { userId: user.id } } },
    select: { id: true, name: true, archivedAt: true, members: { where: { userId: user.id }, select: { role: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  const projects = rows
    .filter(row => row.archivedAt === null)
    .map(row => ({ id: row.id, name: row.name, scopes: spaceScopes(user.role, { type: 'project', memberRole: row.members[0]?.role, archived: false }) }))
    .filter(project => hasScope(project.scopes, 'media:read'))
  const archivedIds = rows.filter(row => row.archivedAt !== null).map(row => row.id)
  return {
    library: hasScope(libraryScopes, 'media:read') ? libraryScopes : null,
    projects,
    selection: seesAll
      ? { all: true, excludedIds: archivedIds }
      : { member: user.id, includeArchived: false, ids: projects.map(project => project.id) },
  }
}

/** Espace tel que la page « Médias » le présente (tuiles, filtre, badges, destinations d'envoi). */
export type SpaceSummary
  = | { type: 'library', id: null, name: null, mediaCount: number, scopes: Scope[] }
    | { type: 'project', id: string, name: string, mediaCount: number, scopes: Scope[] }

/** Espaces lisibles avec leur nombre de médias actifs (`counts` : par `projectId`, null = bibliothèque). */
export function toSpaceSummaries(spaces: ReadableSpaces, counts: ReadonlyMap<string | null, number>): SpaceSummary[] {
  return [
    ...(spaces.library ? [{ type: 'library' as const, id: null, name: null, mediaCount: counts.get(null) ?? 0, scopes: spaces.library }] : []),
    ...spaces.projects.map(project => ({ type: 'project' as const, id: project.id, name: project.name, mediaCount: counts.get(project.id) ?? 0, scopes: project.scopes })),
  ]
}

/** Nombre de médias actifs par espace (`projectId`, null = bibliothèque), en une requête groupée. */
export async function spaceMediaCounts(where: Prisma.MediaWhereInput): Promise<Map<string | null, number>> {
  const prisma = await usePrisma()
  const rows = await prisma.media.groupBy({ by: ['projectId'], where: { AND: [where, { deletedAt: null }] }, _count: { _all: true } })
  return new Map(rows.map(row => [row.projectId, row._count._all]))
}
