import { deleteFolderQuerySchema } from '#shared/schemas/folders'
import { deleteFolder } from '../../../lib/folders/service'

/**
 * DELETE /api/admin/folders/:id[?content=parent] — supprime un dossier (portée media:write).
 * Sans option : seulement s'il est vide (409 FOLDER_NOT_EMPTY). `content=parent` : sous-dossiers
 * et médias remontent d'abord dans le dossier parent (409 FOLDER_NAME_TAKEN en cas d'homonyme).
 * → { media, folders } (nombre d'éléments remontés) · 404 FOLDER_NOT_FOUND.
 */
export default defineEventHandler(async (event) => {
  const { folder } = await requireFolderAccess(event, getRouterParam(event, 'id') ?? '', 'media:write')
  const { content } = await getValidatedQuery(event, value => deleteFolderQuerySchema.parse(value))
  return deleteFolder(folder, { moveContentToParent: content === 'parent' })
})
