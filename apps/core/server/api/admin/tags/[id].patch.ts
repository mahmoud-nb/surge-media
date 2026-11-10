import { updateTagSchema } from '#shared/schemas/tags'
import { findTag, toTagSummary, updateTag } from '../../../lib/tags/service'

const AUDITED_FIELDS = ['name', 'slug', 'color', 'confidential'] as const

/**
 * PATCH /api/admin/tags/:id — { name?, slug?, color?, confidential? } (`tags:global` pour une
 * étiquette globale, `tags:manage` dans son projet sinon). Le slug ne suit pas un renommage.
 * Décocher `confidential` l'expose aussitôt aux autres rôles et à l'API v1.
 * 404 TAG_NOT_FOUND · 403 · 409 TAG_NAME_TAKEN / TAG_SLUG_TAKEN.
 */
export default defineEventHandler(async (event) => {
  const { tag, viewer } = await requireTagManagement(event, await findTag(getRouterParam(event, 'id') ?? ''))
  const input = await readValidatedBody(event, body => updateTagSchema.parse(body))
  if (input.confidential !== undefined && !viewer.confidential) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  const updated = await updateTag(tag, input)

  const changes = Object.fromEntries(AUDITED_FIELDS
    .filter(field => updated[field] !== tag[field])
    .map(field => [field, { from: tag[field], to: updated[field] }]))
  if (Object.keys(changes).length) {
    await recordAudit(event, {
      action: 'tag.updated',
      projectId: tag.projectId,
      targetType: 'tag',
      targetId: tag.id,
      data: { label: updated.name, level: tag.projectId ? 'project' : 'global', changes },
    })
  }
  return { tag: toTagSummary(updated, null) }
})
