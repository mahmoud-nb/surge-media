import {
  descendantIds,
  folderMoveProblem,
  folderNameKey,
  FOLDER_MAX_DEPTH,
  FOLDERS_PER_SPACE_MAX,
  folderDepth,
  indexFolders,
} from '#shared/utils/folders'
import type { Folder, Prisma } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { folderError } from '../../utils/folders'
import { createLruCache } from '../cache/lru'
import { bumpRevision, getRevision, revisionScope } from '../cache/revisions'
import { mediaChanged } from '../media/cache'

/**
 * Dossiers d'un espace (architecture § 11) : lecture de l'arbre, création, renommage, déplacement,
 * suppression, filtre des listes de médias et rangement des médias. Les règles de forme (cycle,
 * profondeur, noms) sont dans le module pur shared/utils/folders.ts ; ce module les applique aux
 * données et traduit les refus en erreurs métier (`folderError`).
 *
 * L'arbre d'un espace est gardé en mémoire par révision de l'espace (CacheRevision) : toute
 * écriture de dossier ou de média incrémente la révision, les anciennes entrées ne servent plus.
 */

export type FolderRecord = Pick<Folder, 'id' | 'projectId' | 'parentId' | 'name' | 'createdAt' | 'updatedAt'>

const FOLDER_SELECT = { id: true, projectId: true, parentId: true, name: true, createdAt: true, updatedAt: true } as const
const treeCache = createLruCache<FolderRecord[]>({ max: 2000, ttlMs: 300_000 })

function projectIdOf(space: Space): string | null {
  return space.type === 'project' ? space.id : null
}

function spaceOfFolder(folder: Pick<Folder, 'projectId'>): Space {
  return folder.projectId ? { type: 'project', id: folder.projectId } : { type: 'library' }
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/** Tous les dossiers d'un espace (arbre à plat), via le cache par révision. */
export async function listFolders(space: Space): Promise<FolderRecord[]> {
  const key = `${revisionScope(space)}:${await getRevision(space)}`
  const cached = treeCache.get(key)
  if (cached) return cached
  const prisma = await usePrisma()
  const folders = await prisma.folder.findMany({
    where: { projectId: projectIdOf(space) },
    select: FOLDER_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  treeCache.set(key, folders)
  return folders
}

export async function findFolder(id: string): Promise<Folder | null> {
  const prisma = await usePrisma()
  return prisma.folder.findUnique({ where: { id } })
}

/** Dossier de l'espace (lu en base, pour une écriture), sinon 404 FOLDER_NOT_FOUND. */
export async function requireFolderInSpace(space: Space, id: string): Promise<Folder> {
  const folder = await findFolder(id)
  if (!folder || folder.projectId !== projectIdOf(space)) throw folderError(404, 'FOLDER_NOT_FOUND')
  return folder
}

/** Nombre de médias actifs (hors corbeille) par dossier d'un espace. */
export async function folderMediaCounts(space: Space): Promise<Map<string, number>> {
  const prisma = await usePrisma()
  const groups = await prisma.media.groupBy({
    by: ['folderId'],
    where: { projectId: projectIdOf(space), deletedAt: null, folderId: { not: null } },
    _count: { _all: true },
  })
  return new Map(groups.map(group => [group.folderId!, group._count._all]))
}

/**
 * Condition de liste pour un dossier : `null` = racine de l'espace. Non récursif : les médias
 * directement dans ce dossier ; récursif : ce dossier et tous ses descendants (racine récursive =
 * tout l'espace). 404 FOLDER_NOT_FOUND si le dossier n'appartient pas à l'espace.
 */
export async function folderWhere(space: Space, folderId: string | null, recursive: boolean): Promise<Prisma.MediaWhereInput> {
  if (!folderId) return recursive ? {} : { folderId: null }
  const folders = await listFolders(space)
  const index = indexFolders(folders)
  if (!index.byId.has(folderId)) throw folderError(404, 'FOLDER_NOT_FOUND')
  return recursive ? { folderId: { in: descendantIds(index, folderId) } } : { folderId }
}

// ─── Écriture ────────────────────────────────────────────────────────────────

type Transaction = Prisma.TransactionClient

async function siblingNameTaken(tx: Transaction, space: Space, parentId: string | null, name: string, exceptId?: string): Promise<boolean> {
  const siblings = await tx.folder.findMany({ where: { projectId: projectIdOf(space), parentId }, select: { id: true, name: true } })
  const key = folderNameKey(name)
  return siblings.some(sibling => sibling.id !== exceptId && folderNameKey(sibling.name) === key)
}

async function spaceTree(tx: Transaction, space: Space) {
  const folders = await tx.folder.findMany({ where: { projectId: projectIdOf(space) }, select: { id: true, parentId: true, name: true } })
  return indexFolders(folders)
}

/** Nouveau dossier (racine ou sous `parentId`) : nom libre parmi les frères, profondeur, nombre par espace. */
export async function createFolder(space: Space, input: { name: string, parentId?: string | null }): Promise<Folder> {
  const prisma = await usePrisma()
  const parentId = input.parentId ?? null
  const folder = await prisma.$transaction(async (tx) => {
    const index = await spaceTree(tx, space)
    if (index.byId.size >= FOLDERS_PER_SPACE_MAX) throw folderError(409, 'FOLDER_LIMIT_REACHED')
    if (parentId && !index.byId.has(parentId)) throw folderError(404, 'FOLDER_NOT_FOUND')
    if (folderDepth(index, parentId) + 1 > FOLDER_MAX_DEPTH) throw folderError(422, 'FOLDER_DEPTH_EXCEEDED')
    if (await siblingNameTaken(tx, space, parentId, input.name)) throw folderError(409, 'FOLDER_NAME_TAKEN')
    return tx.folder.create({ data: { projectId: projectIdOf(space), parentId, name: input.name } })
  })
  await bumpRevision(space)
  return folder
}

/** Renommage et/ou déplacement dans le même espace (`parentId` null = racine, absent = inchangé). */
export async function updateFolder(folder: Folder, input: { name?: string, parentId?: string | null }): Promise<Folder> {
  const space = spaceOfFolder(folder)
  const name = input.name ?? folder.name
  const parentId = input.parentId === undefined ? folder.parentId : input.parentId
  if (name === folder.name && parentId === folder.parentId) return folder

  const prisma = await usePrisma()
  const updated = await prisma.$transaction(async (tx) => {
    if (parentId !== folder.parentId) {
      const index = await spaceTree(tx, space)
      if (parentId && !index.byId.has(parentId)) throw folderError(404, 'FOLDER_NOT_FOUND')
      const problem = folderMoveProblem(index, folder.id, parentId)
      if (problem) throw folderError(422, problem)
    }
    if (await siblingNameTaken(tx, space, parentId, name, folder.id)) throw folderError(409, 'FOLDER_NAME_TAKEN')
    return tx.folder.update({ where: { id: folder.id }, data: { name, parentId } })
  })
  await bumpRevision(space)
  return updated
}

/**
 * Suppression d'un dossier. Par défaut, seulement s'il ne contient ni sous-dossier ni média actif
 * (409 FOLDER_NOT_EMPTY ; les médias de la corbeille reviennent à la racine s'ils sont restaurés).
 * `moveContentToParent` : sous-dossiers et médias (corbeille comprise) remontent d'abord dans le
 * dossier parent (409 FOLDER_NAME_TAKEN si un sous-dossier y trouve un homonyme).
 * Renvoie le nombre de médias et de sous-dossiers remontés.
 */
export async function deleteFolder(folder: Folder, options: { moveContentToParent?: boolean } = {}): Promise<{ media: number, folders: number }> {
  const space = spaceOfFolder(folder)
  const prisma = await usePrisma()
  const moved = await prisma.$transaction(async (tx) => {
    const children = await tx.folder.findMany({ where: { parentId: folder.id }, select: { id: true, name: true } })
    if (!options.moveContentToParent) {
      const media = await tx.media.count({ where: { folderId: folder.id, deletedAt: null } })
      if (children.length > 0 || media > 0) throw folderError(409, 'FOLDER_NOT_EMPTY')
      await tx.folder.delete({ where: { id: folder.id } })
      return { media: 0, folders: 0 }
    }

    for (const child of children) {
      if (await siblingNameTaken(tx, space, folder.parentId, child.name, folder.id)) throw folderError(409, 'FOLDER_NAME_TAKEN')
    }
    const { count: folders } = await tx.folder.updateMany({ where: { parentId: folder.id }, data: { parentId: folder.parentId } })
    const { count: media } = await tx.media.updateMany({ where: { folderId: folder.id }, data: { folderId: folder.parentId } })
    await tx.folder.delete({ where: { id: folder.id } })
    return { media, folders }
  })
  await bumpRevision(space)
  return moved
}

/**
 * Range des médias actifs d'un espace dans un dossier (null = racine) ; les identifiants d'un autre
 * espace ou de la corbeille sont ignorés. Renvoie le nombre de médias rangés.
 */
export async function assignMediaFolder(space: Space, mediaIds: readonly string[], folderId: string | null): Promise<number> {
  if (folderId) await requireFolderInSpace(space, folderId)
  const ids = [...new Set(mediaIds)]
  const prisma = await usePrisma()
  const { count } = await prisma.media.updateMany({
    where: { id: { in: ids }, projectId: projectIdOf(space), deletedAt: null },
    data: { folderId },
  })
  if (count > 0) await mediaChanged(ids, space)
  return count
}
