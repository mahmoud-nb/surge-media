import { defineApiHandler, requireApiProject } from '../../../../lib/api/context'
import { toApiProject } from '../../../../lib/api/serializers'

/**
 * GET /api/v1/projects/:projectId — projet et portées effectives de l'identifiant (project:read).
 * 404 PROJECT_NOT_FOUND (inexistant ou hors périmètre) · 403 PROJECT_ARCHIVED.
 */
export default defineApiHandler(async (event, principal) => {
  const { project, scopes } = await requireApiProject(event, principal, 'project:read')
  return toApiProject(project, scopes)
})
