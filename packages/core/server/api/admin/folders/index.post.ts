import { createFolderSchema } from '#shared/schemas/folders'
import { spaceQuerySchema } from '#shared/schemas/media'
import { createFolder } from '../../../lib/folders/service'

/**
 * POST /api/admin/folders?project= — { name, parentId? } : nouveau dossier à la racine de l'espace
 * ou sous `parentId` (portée media:write). 201 { folder }.
 * 404 FOLDER_NOT_FOUND (parent d'un autre espace) · 409 FOLDER_NAME_TAKEN / FOLDER_LIMIT_REACHED ·
 * 422 FOLDER_DEPTH_EXCEEDED · 403 (PROJECT_ARCHIVED).
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:write')
  const input = await readValidatedBody(event, body => createFolderSchema.parse(body))
  const folder = await createFolder(access.space, input)
  setResponseStatus(event, 201)
  return { folder: toFolderSummary(folder) }
})
