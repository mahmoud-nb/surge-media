import { apiProjectListQuerySchema } from '#shared/schemas/api'
import { defineApiHandler, parseApiQuery } from '../../../lib/api/context'
import { listApiProjects } from '../../../lib/api/queries'
import { toApiProject } from '../../../lib/api/serializers'
import { useTransformSettings } from '../../../lib/media/transform-settings'

defineRouteMeta({
  openAPI: {
    'operationId': 'listProjects',
    'tags': ['projects'],
    'summary': 'Projets accessibles',
    'description': 'Projets actifs de l\'identifiant, triés par nom et paginés par curseur : le projet d\'une clé ou d\'un jeton délégué ; pour un jeton personnel, sa sélection (ou tous les projets) parmi ceux dont son propriétaire est membre.',
    'x-scopes': ['project:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-query': 'ProjectListQuery',
    'x-errors': ['INVALID_REQUEST', 'INVALID_CURSOR'],
    'responses': { 200: { $ref: '#/components/responses/ProjectList' } },
    'x-i18n': {
      en: {
        summary: 'Accessible projects',
        description: 'Active projects of the credential, sorted by name and paginated with a cursor: the project of a key or delegated token; for a personal token, its selection (or every project) among those its owner belongs to.',
      },
    },
  },
})

/**
 * GET /api/v1/projects?limit&cursor — projets actifs accessibles : celui d'une clé ou d'un jeton
 * délégué (s'il a project:read), la sélection d'un jeton personnel (limitée aux droits actuels de son
 * propriétaire), avec les portées effectives dans chacun. → { items: Project[], nextCursor }
 */
export default defineApiHandler(async (event, principal) => {
  const query = parseApiQuery(event, apiProjectListQuerySchema)
  const page = await listApiProjects(principal, query)
  const transforms = useTransformSettings()
  return { items: page.items.map(({ project, scopes }) => toApiProject(project, scopes, transforms)), nextCursor: page.nextCursor }
})
