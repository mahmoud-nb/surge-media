import { deleteTag, findTag } from '../../../lib/tags/service'

/**
 * DELETE /api/admin/tags/:id (`tags:global` pour une étiquette globale, `tags:manage` dans son projet
 * sinon) → 204. L'étiquette quitte tous les médias qui la portaient (corbeille comprise).
 * 404 TAG_NOT_FOUND · 403.
 */
export default defineEventHandler(async (event) => {
  const { tag } = await requireTagManagement(event, await findTag(getRouterParam(event, 'id') ?? ''))
  const { mediaCount } = await deleteTag(tag)
  await recordAudit(event, {
    action: 'tag.deleted',
    projectId: tag.projectId,
    targetType: 'tag',
    targetId: tag.id,
    data: { label: tag.name, slug: tag.slug, level: tag.projectId ? 'project' : 'global', mediaCount },
  })
  setResponseStatus(event, 204)
  return null
})
