import { apiTagUpdateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { toApiTag } from '../../../../../lib/api/serializers'
import { findApiTag, updateTag } from '../../../../../lib/tags/service'

const AUDITED_FIELDS = ['name', 'slug', 'color'] as const

defineRouteMeta({
  openAPI: {
    'operationId': 'updateTag',
    'tags': ['tags'],
    'summary': 'Modifier une étiquette',
    'description': 'Nom, slug ou couleur d\'une étiquette du projet. Le slug ne change pas quand on renomme : modifiez-le explicitement (les filtres qui l\'utilisent devront suivre). Une étiquette globale est en lecture seule (`TAG_READ_ONLY`).',
    'x-scopes': ['tags:manage'],
    'x-credentials': ['secret', 'personal'],
    'x-errors': ['INVALID_REQUEST', 'TAG_NOT_FOUND', 'TAG_READ_ONLY', 'TAG_NAME_TAKEN', 'TAG_SLUG_TAKEN', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'requestBody': { $ref: '#/components/requestBodies/TagUpdate' },
    'responses': { 200: { $ref: '#/components/responses/Tag' } },
    'x-i18n': {
      en: {
        summary: 'Update a tag',
        description: 'Name, slug or color of a tag of the project. The slug does not change on rename: change it explicitly (filters that use it will have to follow). A global tag is read-only (`TAG_READ_ONLY`).',
      },
    },
  },
})

/**
 * PATCH /api/v1/projects/:projectId/tags/:tagId — { name?, slug?, color? } (portée tags:manage).
 * → Tag · 404 TAG_NOT_FOUND · 403 TAG_READ_ONLY (globale) · 409 TAG_NAME_TAKEN / TAG_SLUG_TAKEN.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'tags:manage')
  const tag = await findApiTag(project.id, getRouterParam(event, 'tagId') ?? '')
  if (!tag) throw apiProblem('TAG_NOT_FOUND')
  if (!tag.projectId) throw apiProblem('TAG_READ_ONLY')
  const body = await readApiBody(event, apiTagUpdateSchema)
  const updated = await updateTag(tag, body)

  const changes = Object.fromEntries(AUDITED_FIELDS
    .filter(field => updated[field] !== tag[field])
    .map(field => [field, { from: tag[field], to: updated[field] }]))
  if (Object.keys(changes).length) {
    await recordAudit(event, { action: 'tag.updated', projectId: project.id, targetType: 'tag', targetId: tag.id, data: { label: updated.name, level: 'project', changes } })
  }
  return toApiTag(updated)
})
