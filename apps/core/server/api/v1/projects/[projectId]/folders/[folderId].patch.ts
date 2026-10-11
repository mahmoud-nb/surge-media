import { apiFolderUpdateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { toApiFolder } from '../../../../../lib/api/serializers'
import { requireFolderInSpace, updateFolder } from '../../../../../lib/folders/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'updateFolder',
    'tags': ['folders'],
    'summary': 'Renommer ou déplacer un dossier',
    'description': 'Champs absents inchangés ; `parentId: null` : à la racine. Jamais dans le dossier lui-même ni dans l\'un de ses sous-dossiers.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'FOLDER_NOT_FOUND',
      'FOLDER_NAME_TAKEN',
      'FOLDER_CYCLE',
      'FOLDER_DEPTH_EXCEEDED',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/FolderUpdate' },
    'responses': { 200: { $ref: '#/components/responses/Folder' } },
    'x-i18n': {
      en: {
        summary: 'Rename or move a folder',
        description: 'Absent fields stay unchanged; `parentId: null`: to the root. Never into the folder itself or one of its subfolders.',
      },
    },
  },
})

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
