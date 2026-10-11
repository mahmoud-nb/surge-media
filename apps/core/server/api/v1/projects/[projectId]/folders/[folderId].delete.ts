import { apiFolderDeleteQuerySchema } from '#shared/schemas/api'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { deleteFolder, requireFolderInSpace } from '../../../../../lib/folders/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'deleteFolder',
    'tags': ['folders'],
    'summary': 'Supprimer un dossier',
    'description': 'Dossier vide exigé (les médias de la corbeille sortent du dossier), ou `content=parent` pour remonter d\'abord ses sous-dossiers et médias dans le dossier parent.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-query': 'FolderDeleteQuery',
    'x-errors': [
      'INVALID_REQUEST',
      'FOLDER_NOT_FOUND',
      'FOLDER_NOT_EMPTY',
      'FOLDER_NAME_TAKEN',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'responses': { 204: { $ref: '#/components/responses/NoContent' } },
    'x-i18n': {
      en: {
        summary: 'Delete a folder',
        description: 'The folder must be empty (media in the trash leave the folder), or use `content=parent` to first move its subfolders and media up to the parent folder.',
      },
    },
  },
})

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
