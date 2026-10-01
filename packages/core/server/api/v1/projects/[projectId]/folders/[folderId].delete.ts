import { apiFolderDeleteQuerySchema } from '#shared/schemas/api'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { deleteFolder, requireFolderInSpace } from '../../../../../lib/folders/service'

/**
 * DELETE /api/v1/projects/:projectId/folders/:folderId[?content=parent] — supprime un dossier
 * (portée media:write). Sans option : dossier vide exigé (409 FOLDER_NOT_EMPTY ; les médias de la
 * corbeille reviennent hors dossier). `content=parent` : sous-dossiers et médias remontent d'abord
 * dans le dossier parent (409 FOLDER_NAME_TAKEN en cas d'homonyme). → 204 · 404 FOLDER_NOT_FOUND.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const { content } = parseApiQuery(event, apiFolderDeleteQuerySchema)
  const folder = await requireFolderInSpace({ type: 'project', id: project.id }, getRouterParam(event, 'folderId') ?? '')
  await deleteFolder(folder, { moveContentToParent: content === 'parent' })
  setResponseStatus(event, 204)
  return null
})
