import { getRevision } from '../../../../../lib/cache/revisions'
import { defineApiHandler, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { etagMatches, toApiFolder, weakEtag } from '../../../../../lib/api/serializers'
import { listFolders } from '../../../../../lib/folders/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'listFolders',
    'tags': ['folders'],
    'summary': 'Arborescence des dossiers',
    'description': 'Tous les dossiers du projet, à plat (arbre par `parentId`), triés par nom : navigation d\'un sélecteur, filtre `folder` des listes. Jamais avec une clé publique (les noms de dossiers ne sont pas publics). `ETag` = révision du projet → 304.',
    'x-scopes': ['media:read'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['CREDENTIAL_NOT_ALLOWED', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': {
      200: { $ref: '#/components/responses/FolderList' },
      304: { $ref: '#/components/responses/NotModified' },
    },
    'x-i18n': {
      en: {
        summary: 'Folder tree',
        description: 'Every folder of the project, flat (tree via `parentId`), sorted by name: navigation of a picker, `folder` filter of lists. Never with a publishable key (folder names are not public). `ETag` = project revision → 304.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/folders — tous les dossiers du projet, à plat (arbre par
 * `parentId`, triés par nom) : navigation d'un sélecteur, filtre `folder` des listes. Portée
 * media:read ; jamais avec une clé publique (403 CREDENTIAL_NOT_ALLOWED : les noms de dossiers ne
 * sont pas publics). ETag = révision de l'espace → 304. → { items: Folder[] }
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type === 'publishable') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'The folder tree is not available to publishable keys.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const space = { type: 'project' as const, id: project.id }
  const etag = weakEtag(['folders', project.id, await getRevision(space)])
  setResponseHeader(event, 'ETag', etag)
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  return { items: (await listFolders(space)).map(toApiFolder) }
})
