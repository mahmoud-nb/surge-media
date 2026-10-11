import { updateFolderSchema } from '#shared/schemas/folders'
import { updateFolder } from '../../../lib/folders/service'

/**
 * PATCH /api/admin/folders/:id — { name?, parentId? } : renomme et/ou déplace le dossier dans son
 * espace (parentId null = racine) ; portée media:write. → { folder }
 * 404 FOLDER_NOT_FOUND · 409 FOLDER_NAME_TAKEN · 422 FOLDER_CYCLE / FOLDER_DEPTH_EXCEEDED.
 */
export default defineEventHandler(async (event) => {
  const { folder } = await requireFolderAccess(event, getRouterParam(event, 'id') ?? '', 'media:write')
  const input = await readValidatedBody(event, body => updateFolderSchema.parse(body))
  return { folder: toFolderSummary(await updateFolder(folder, input)) }
})
