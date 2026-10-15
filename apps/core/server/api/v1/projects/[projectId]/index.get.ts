import { defineApiHandler, requireApiProject } from '../../../../lib/api/context'
import { toApiProject } from '../../../../lib/api/serializers'
import { useTransformSettings } from '../../../../lib/media/transform-settings'

defineRouteMeta({
  openAPI: {
    'operationId': 'getProject',
    'tags': ['projects'],
    'summary': 'Projet',
    'description': 'Projet et portées effectives de l\'identifiant dans ce projet. Un projet hors du périmètre de l\'identifiant répond 404 (son existence n\'est pas révélée) ; un projet archivé, 403.',
    'x-scopes': ['project:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-errors': ['PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 200: { $ref: '#/components/responses/Project' } },
    'x-i18n': {
      en: {
        summary: 'Project',
        description: 'Project and effective scopes of the credential in it. A project outside the reach of the credential returns 404 (its existence is not revealed); an archived project, 403.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId — projet et portées effectives de l'identifiant (project:read).
 * 404 PROJECT_NOT_FOUND (inexistant ou hors périmètre) · 403 PROJECT_ARCHIVED.
 */
export default defineApiHandler(async (event, principal) => {
  const { project, scopes } = await requireApiProject(event, principal, 'project:read')
  return toApiProject(project, scopes, useTransformSettings())
})
