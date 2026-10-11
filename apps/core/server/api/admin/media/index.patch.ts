import { assignFolderSchema } from '#shared/schemas/folders'
import { spaceQuerySchema } from '#shared/schemas/media'
import { assignMediaFolder } from '../../../lib/folders/service'

/**
 * PATCH /api/admin/media?project= — { ids: string[] (1 à 100), folderId: string | null } : range
 * des médias actifs de l'espace dans un dossier (null = racine) ; portée media:write. Les
 * identifiants d'un autre espace ou de la corbeille sont ignorés. → { moved }
 * 404 FOLDER_NOT_FOUND · 403 (PROJECT_ARCHIVED).
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:write')
  const { ids, folderId } = await readValidatedBody(event, body => assignFolderSchema.parse(body))
  return { moved: await assignMediaFolder(access.space, ids, folderId) }
})
