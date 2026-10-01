import { apiFolderUpdateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { toApiFolder } from '../../../../../lib/api/serializers'
import { requireFolderInSpace, updateFolder } from '../../../../../lib/folders/service'

/**
 * PATCH /api/v1/projects/:projectId/folders/:folderId — { name?, parentId? } : renomme et/ou
 * déplace le dossier dans le projet (`parentId` null = racine ; portée media:write). → Folder
 * 400 INVALID_REQUEST · 404 FOLDER_NOT_FOUND · 409 FOLDER_NAME_TAKEN · 422 FOLDER_CYCLE /
 * FOLDER_DEPTH_EXCEEDED.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const folder = await requireFolderInSpace({ type: 'project', id: project.id }, getRouterParam(event, 'folderId') ?? '')
  const body = await readApiBody(event, apiFolderUpdateSchema)
  return toApiFolder(await updateFolder(folder, body))
})
