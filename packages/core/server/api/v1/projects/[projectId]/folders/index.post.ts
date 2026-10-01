import { apiFolderCreateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { toApiFolder } from '../../../../../lib/api/serializers'
import { createFolder } from '../../../../../lib/folders/service'

/**
 * POST /api/v1/projects/:projectId/folders — { name, parentId? } : nouveau dossier (portée
 * media:write), à la racine du projet ou sous `parentId`. → 201 Folder
 * 400 INVALID_REQUEST · 404 FOLDER_NOT_FOUND (parent) · 409 FOLDER_NAME_TAKEN / FOLDER_LIMIT_REACHED ·
 * 422 FOLDER_DEPTH_EXCEEDED.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const body = await readApiBody(event, apiFolderCreateSchema)
  const folder = await createFolder({ type: 'project', id: project.id }, body)
  setResponseStatus(event, 201)
  return toApiFolder(folder)
})
