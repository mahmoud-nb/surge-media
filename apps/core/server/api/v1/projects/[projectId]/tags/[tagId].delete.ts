import { defineApiHandler, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { deleteTag, findApiTag } from '../../../../../lib/tags/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'deleteTag',
    'tags': ['tags'],
    'summary': 'Supprimer une étiquette',
    'description': 'L\'étiquette du projet quitte tous les médias qui la portaient. Une étiquette globale est en lecture seule (`TAG_READ_ONLY`).',
    'x-scopes': ['tags:manage'],
    'x-credentials': ['secret', 'personal'],
    'x-errors': ['TAG_NOT_FOUND', 'TAG_READ_ONLY', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': { 204: { $ref: '#/components/responses/NoContent' } },
    'x-i18n': {
      en: {
        summary: 'Delete a tag',
        description: 'The tag of the project leaves every media item that carried it. A global tag is read-only (`TAG_READ_ONLY`).',
      },
    },
  },
})

/**
 * DELETE /api/v1/projects/:projectId/tags/:tagId (portée tags:manage) → 204 · 404 TAG_NOT_FOUND ·
 * 403 TAG_READ_ONLY (globale).
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'tags:manage')
  const tag = await findApiTag(project.id, getRouterParam(event, 'tagId') ?? '')
  if (!tag) throw apiProblem('TAG_NOT_FOUND')
  if (!tag.projectId) throw apiProblem('TAG_READ_ONLY')
  const { mediaCount } = await deleteTag(tag)
  await recordAudit(event, { action: 'tag.deleted', projectId: project.id, targetType: 'tag', targetId: tag.id, data: { label: tag.name, slug: tag.slug, level: 'project', mediaCount } })
  setResponseStatus(event, 204)
  return null
})
