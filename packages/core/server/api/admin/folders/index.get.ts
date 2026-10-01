import { spaceQuerySchema } from '#shared/schemas/media'
import { folderMediaCounts, listFolders } from '../../../lib/folders/service'

/**
 * GET /api/admin/folders?project= — dossiers d'un espace (`project` absent = bibliothèque), à plat
 * (l'interface reconstruit l'arbre), avec le nombre de médias actifs de chacun, l'espace et les
 * portées de l'utilisateur (portée media:read). 404 si l'espace est invisible.
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:read')
  const [folders, counts] = await Promise.all([listFolders(access.space), folderMediaCounts(access.space)])
  return { folders: folders.map(folder => toFolderSummary(folder, counts.get(folder.id) ?? 0)), ...describeAccess(access) }
})
