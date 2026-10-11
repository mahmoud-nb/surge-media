import type { ApiMediaListQuery, ApiProjectListQuery } from '#shared/schemas/api'
import type { ApiMediaSort } from '#shared/utils/api'
import { credentialScopes, hasPermission, spaceScopes, type TokenScope } from '#shared/utils/permissions'
import { normalizeSearchText } from '#shared/utils/search'
import type { Media, Prisma } from '../../generated/prisma/client'
import { type Principal, principalProjectScopes } from '../access/principal'
import { folderWhere } from '../folders/service'
import { getProjectState } from '../projects/state'
import { type Cursor, decodeCursor, encodeCursor } from './cursor'
import { apiProblem } from './problem'
import { API_MEDIA_INCLUDE, type ApiMediaRecord, type ApiProjectSource } from './serializers'

/**
 * Lectures de l'API v1. Les requêtes partent toujours du périmètre imposé par le serveur (projet de
 * l'URL, hors corbeille, médias publics pour une clé publique) ; les filtres demandés (dont le
 * dossier) s'y ajoutent (ET), jamais ne s'y substituent. Pagination par curseur (keyset) sur (champ de tri, id).
 */

const SORTS: Record<ApiMediaSort, { field: 'createdAt' | 'originalName' | 'size', direction: 'asc' | 'desc' }> = {
  newest: { field: 'createdAt', direction: 'desc' },
  oldest: { field: 'createdAt', direction: 'asc' },
  name: { field: 'originalName', direction: 'asc' },
  size: { field: 'size', direction: 'desc' },
}

function cursorValue(media: Media, sort: ApiMediaSort): string | number {
  const { field } = SORTS[sort]
  return field === 'createdAt' ? media.createdAt.toISOString() : media[field]
}

/** Condition « après le curseur » pour un tri (champ, sens) suivi de l'id dans le même sens. */
function afterCursor(cursor: Cursor, field: string, direction: 'asc' | 'desc', value: unknown): Prisma.MediaWhereInput {
  const op = direction === 'desc' ? 'lt' : 'gt'
  return { OR: [{ [field]: { [op]: value } }, { [field]: value, id: { [op]: cursor.id } }] }
}

function decodeMediaCursor(raw: string, sort: ApiMediaSort): { cursor: Cursor, value: Date | string | number } {
  const cursor = decodeCursor(raw, sort)
  const { field } = SORTS[sort]
  if (cursor) {
    if (field === 'createdAt' && typeof cursor.value === 'string' && !Number.isNaN(Date.parse(cursor.value))) {
      return { cursor, value: new Date(cursor.value) }
    }
    if (field === 'size' && typeof cursor.value === 'number') return { cursor, value: cursor.value }
    if (field === 'originalName' && typeof cursor.value === 'string') return { cursor, value: cursor.value }
  }
  throw apiProblem('INVALID_CURSOR', 'The cursor is malformed or was issued for another sort order.')
}

export interface MediaPage {
  items: ApiMediaRecord[]
  nextCursor: string | null
  total?: number
}

/** Médias actifs d'un projet (hors corbeille) selon les filtres de l'API v1. */
export async function listApiMedia(projectId: string, query: ApiMediaListQuery, publicOnly: boolean): Promise<MediaPage> {
  const base: Prisma.MediaWhereInput = { projectId, deletedAt: null }
  if (publicOnly) {
    if (query.visibility === 'private') return { items: [], nextCursor: null, ...(query.withTotal ? { total: 0 } : {}) }
    base.visibility = 'PUBLIC'
  }
  else if (query.visibility) {
    base.visibility = query.visibility.toUpperCase() as Media['visibility']
  }
  if (query.kind) base.kind = query.kind.toUpperCase() as Media['kind']
  // Dossier (et descendants si récursif) ; 404 FOLDER_NOT_FOUND pour un dossier d'un autre espace.
  if (query.folder) Object.assign(base, await folderWhere({ type: 'project', id: projectId }, query.folder === 'root' ? null : query.folder, Boolean(query.recursive)))

  const prisma = await usePrisma()

  // Réhydratation d'une sélection : ces médias, dans l'ordre demandé, sans pagination.
  if (query.ids) {
    const found = await prisma.media.findMany({ where: { ...base, id: { in: query.ids } }, include: API_MEDIA_INCLUDE })
    const byId = new Map(found.map(media => [media.id, media]))
    const items = query.ids.map(id => byId.get(id)).filter((media): media is ApiMediaRecord => Boolean(media))
    return { items, nextCursor: null, ...(query.withTotal ? { total: items.length } : {}) }
  }

  const filters: Prisma.MediaWhereInput[] = [base]
  if (query.q) {
    const term = normalizeSearchText(query.q)
    filters.push({ OR: [{ searchTitle: { contains: term } }, { searchName: { contains: term } }, { searchAlt: { contains: term } }] })
  }
  const where: Prisma.MediaWhereInput = { AND: filters }

  const { field, direction } = SORTS[query.sort]
  const pageWhere: Prisma.MediaWhereInput = query.cursor
    ? (() => {
        const { cursor, value } = decodeMediaCursor(query.cursor, query.sort)
        return { AND: [...filters, afterCursor(cursor, field, direction, value)] }
      })()
    : where

  const [rows, total] = await Promise.all([
    prisma.media.findMany({
      where: pageWhere,
      orderBy: [{ [field]: direction }, { id: direction }],
      take: query.limit + 1,
      include: API_MEDIA_INCLUDE,
    }),
    query.withTotal ? prisma.media.count({ where }) : Promise.resolve(undefined),
  ])
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  const nextCursor = rows.length > query.limit && last
    ? encodeCursor({ sort: query.sort, value: cursorValue(last, query.sort), id: last.id })
    : null
  return { items, nextCursor, ...(total === undefined ? {} : { total }) }
}

/** Média actif d'un projet (et public pour une clé publique), ou null. */
export async function findApiMedia(projectId: string, id: string, publicOnly: boolean): Promise<ApiMediaRecord | null> {
  const prisma = await usePrisma()
  const media = await prisma.media.findUnique({ where: { id }, include: API_MEDIA_INCLUDE })
  if (!media || media.projectId !== projectId || media.deletedAt) return null
  if (publicOnly && media.visibility !== 'PUBLIC') return null
  return media
}

/** Médias actifs d'un projet parmi `ids` (lot de liens signés), par identifiant ; les autres sont absents. */
export async function findApiMediaByIds(projectId: string, ids: readonly string[]): Promise<Map<string, ApiMediaRecord>> {
  const prisma = await usePrisma()
  const items = await prisma.media.findMany({ where: { id: { in: [...new Set(ids)] }, projectId, deletedAt: null }, include: API_MEDIA_INCLUDE })
  return new Map(items.map(media => [media.id, media]))
}

// ─── Projets ─────────────────────────────────────────────────────────────────

export interface ProjectPage {
  items: { project: ApiProjectSource, scopes: TokenScope[] }[]
  nextCursor: string | null
}

/**
 * Projets accessibles avec un identifiant (actifs seulement) : son projet pour une clé ou un jeton
 * délégué (celui-ci seulement avec project:read) ; pour un jeton personnel, sa sélection (ou tous
 * les projets de son propriétaire), limitée aux droits actuels du propriétaire. Tri par nom puis
 * identifiant.
 */
export async function listApiProjects(principal: Principal, query: ApiProjectListQuery): Promise<ProjectPage> {
  const { credential } = principal
  if (principal.delegated) {
    const project = await getProjectState(principal.delegated.projectId)
    if (!project || project.archived || query.cursor) return { items: [], nextCursor: null }
    const scopes = await principalProjectScopes(principal, project)
    return { items: scopes.includes('project:read') ? [{ project, scopes }] : [], nextCursor: null }
  }
  if (credential.type !== 'PERSONAL') {
    const project = credential.projectId ? await getProjectState(credential.projectId) : null
    if (!project || project.archived || query.cursor) return { items: [], nextCursor: null }
    const scopes = credentialScopes({ type: credential.type, scopes: credential.scopes, ownProject: true })
    return { items: [{ project, scopes }], nextCursor: null }
  }

  const owner = credential.owner
  if (!owner) return { items: [], nextCursor: null }
  const where: Prisma.ProjectWhereInput = { archivedAt: null }
  if (!credential.allProjects) where.id = { in: credential.projectIds }
  const seesAll = hasPermission(owner.role, 'projects:all')
  if (!seesAll) where.members = { some: { userId: owner.id } }

  const filters: Prisma.ProjectWhereInput[] = [where]
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor, 'name')
    if (!cursor || typeof cursor.value !== 'string') throw apiProblem('INVALID_CURSOR', 'The cursor is malformed.')
    filters.push({ OR: [{ name: { gt: cursor.value } }, { name: cursor.value, id: { gt: cursor.id } }] })
  }

  const prisma = await usePrisma()
  const rows = await prisma.project.findMany({
    where: { AND: filters },
    include: { members: { where: { userId: owner.id }, select: { role: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
  })
  const page = rows.slice(0, query.limit)
  const items = page.map((project) => {
    const ownerScopes = spaceScopes(owner.role, { type: 'project', memberRole: project.members[0]?.role, archived: false })
    const scopes = credentialScopes({ type: 'PERSONAL', scopes: credential.scopes, inSelection: true, ownerScopes })
    return { project, scopes }
  }).filter(item => item.scopes.length > 0)
  const last = page.at(-1)
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ sort: 'name', value: last.name, id: last.id }) : null,
  }
}
