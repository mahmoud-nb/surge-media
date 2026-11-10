import { apiTagCreateSchema } from '#shared/schemas/api'
import { tagSlug } from '#shared/utils/tags'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { toApiTag } from '../../../../../lib/api/serializers'
import { createTag } from '../../../../../lib/tags/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'createTag',
    'tags': ['tags'],
    'summary': 'Créer une étiquette',
    'description': 'Étiquette propre au projet (les étiquettes globales se gèrent dans l\'administration). Nom unique, sans tenir compte de la casse ni des accents, parmi les étiquettes globales et celles du projet ; même règle pour le slug, déduit du nom s\'il est absent. 500 étiquettes par projet au plus.',
    'x-scopes': ['tags:manage'],
    'x-credentials': ['secret', 'personal'],
    'x-errors': ['INVALID_REQUEST', 'TAG_NAME_TAKEN', 'TAG_SLUG_TAKEN', 'TAG_LIMIT_REACHED', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'requestBody': { $ref: '#/components/requestBodies/TagCreate' },
    'responses': { 201: { $ref: '#/components/responses/TagCreated' } },
    'x-i18n': {
      en: {
        summary: 'Create a tag',
        description: 'Tag specific to the project (global tags are managed in the administration). Name unique, regardless of case and accents, among global tags and those of the project; same rule for the slug, derived from the name when absent. At most 500 tags per project.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/tags — { name, slug?, color? } : étiquette du projet (portée
 * tags:manage ; jamais confidentielle par l'API). → 201 Tag · 400 INVALID_REQUEST · 409 TAG_NAME_TAKEN /
 * TAG_SLUG_TAKEN / TAG_LIMIT_REACHED.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'tags:manage')
  const body = await readApiBody(event, apiTagCreateSchema)
  const slug = body.slug ?? tagSlug(body.name)
  if (!slug) throw apiProblem('INVALID_REQUEST', 'A slug cannot be derived from this name: provide one.')
  const tag = await createTag(project.id, { name: body.name, slug, color: body.color })
  await recordAudit(event, {
    action: 'tag.created',
    projectId: project.id,
    targetType: 'tag',
    targetId: tag.id,
    data: { label: tag.name, slug: tag.slug, color: tag.color, confidential: false, level: 'project' },
  })
  setResponseStatus(event, 201)
  return toApiTag(tag)
})
