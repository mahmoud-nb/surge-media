import { apiFolderCreateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { toApiFolder } from '../../../../../lib/api/serializers'
import { createFolder } from '../../../../../lib/folders/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'createFolder',
    'tags': ['folders'],
    'summary': 'Créer un dossier',
    'description': 'À la racine du projet ou sous `parentId`. Nom unique parmi les dossiers frères (sans tenir compte de la casse) ; 8 niveaux et 1 000 dossiers par projet au plus.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'FOLDER_NOT_FOUND',
      'FOLDER_NAME_TAKEN',
      'FOLDER_LIMIT_REACHED',
      'FOLDER_DEPTH_EXCEEDED',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/FolderCreate' },
    'responses': { 201: { $ref: '#/components/responses/FolderCreated' } },
    'x-i18n': {
      en: {
        summary: 'Create a folder',
        description: 'At the project root or under `parentId`. Name unique among sibling folders (case-insensitive); at most 8 levels and 1,000 folders per project.',
      },
    },
  },
})

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
