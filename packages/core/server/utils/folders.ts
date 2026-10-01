import type { H3Event } from 'h3'
import type { FolderErrorCode } from '#shared/utils/folders'
import type { Folder } from '../generated/prisma/client'

/** Erreur métier des dossiers : statut HTTP + code (`data.code`) traduit par l'interface et l'API v1. */
export function folderError(statusCode: 404 | 409 | 422, code: FolderErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/**
 * Dossier accessible dans son espace (administration) : 404 FOLDER_NOT_FOUND s'il n'existe pas ou
 * si son espace est invisible pour l'utilisateur, 403 si la portée manque (PROJECT_ARCHIVED si c'est
 * l'archivage qui la retire).
 */
export async function requireFolderAccess(event: H3Event, id: string, scope: Scope): Promise<{ folder: Folder, access: SpaceAccess }> {
  const user = await requireAuth(event)
  const prisma = await usePrisma()
  const folder = await prisma.folder.findUnique({ where: { id } })
  const access = folder ? await resolveSpaceAccess(user, spaceFor(folder.projectId)) : null
  if (!folder || !access || !hasScope(access.scopes, 'media:read')) throw folderError(404, 'FOLDER_NOT_FOUND')
  assertScope(access, scope)
  return { folder, access }
}

/** Représentation d'un dossier pour l'administration. */
export function toFolderSummary(folder: Pick<Folder, 'id' | 'parentId' | 'name' | 'createdAt' | 'updatedAt'>, mediaCount = 0) {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    /** Médias actifs directement dans ce dossier. */
    mediaCount,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }
}
