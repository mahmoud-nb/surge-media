import { createTagSchema, tagsQuerySchema } from '#shared/schemas/tags'
import { createTag, toTagSummary } from '../../../lib/tags/service'

/**
 * POST /api/admin/tags?project= — { name, slug?, color?, confidential? } : étiquette du projet
 * (`tags:manage`) ou, sans `project`, étiquette globale (permission `tags:global`). Slug absent :
 * proposé d'après le nom. `confidential` exige la permission `tags:confidential`. → 201 { tag }.
 * 400 (validation) · 403 · 409 TAG_NAME_TAKEN / TAG_SLUG_TAKEN (globale : `projects` en conflit) /
 * TAG_LIMIT_REACHED.
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => tagsQuerySchema.parse(value))
  const user = project
    ? (await requireSpaceAccess(event, spaceFor(project), 'tags:manage')).user
    : await requireAuth(event, 'tags:global')
  const input = await readValidatedBody(event, body => createTagSchema.parse(body))
  if (input.confidential && !tagViewerFor(user).confidential) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  const tag = await createTag(project ?? null, input)
  await recordAudit(event, {
    action: 'tag.created',
    projectId: tag.projectId,
    targetType: 'tag',
    targetId: tag.id,
    data: { label: tag.name, slug: tag.slug, color: tag.color, confidential: tag.confidential, level: tag.projectId ? 'project' : 'global' },
  })
  setResponseStatus(event, 201)
  return { tag: toTagSummary(tag, 0) }
})
