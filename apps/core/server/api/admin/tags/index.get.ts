import { tagsQuerySchema } from '#shared/schemas/tags'
import { listTags } from '../../../lib/tags/service'

/**
 * GET /api/admin/tags?project= — étiquettes (architecture-tags.md) :
 *   - sans `project` : étiquettes globales (tout compte qui voit la bibliothèque) ; `mediaCount` sur
 *     toute l'installation pour l'ADMIN, null pour les autres (ils ne voient pas tous les projets) ;
 *   - avec `project` : globales + celles du projet (`media:read`), `mediaCount` dans le projet,
 *     espace et portées de l'utilisateur.
 * Confidentielles seulement pour la permission `tags:confidential`. `canManage` : l'utilisateur peut
 * gérer la liste du niveau demandé (`tags:global` ou `tags:manage`) ; `canManageGlobal` : la liste globale.
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => tagsQuerySchema.parse(value))
  if (!project) {
    const user = await requireAuth(event, 'library:read')
    const canManageGlobal = hasPermission(user.role, 'tags:global')
    const tags = await listTags({ projectId: null, viewer: tagViewerFor(user), counts: hasPermission(user.role, 'projects:all') ? 'all' : 'none' })
    return { tags, canManage: canManageGlobal, canManageGlobal, canSeeConfidential: tagViewerFor(user).confidential }
  }
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:read')
  const viewer = tagViewerFor(access.user)
  const tags = await listTags({ projectId: project, viewer, counts: 'project' })
  return {
    tags,
    canManage: hasScope(access.scopes, 'tags:manage'),
    canManageGlobal: hasPermission(access.user.role, 'tags:global'),
    canSeeConfidential: viewer.confidential,
    ...describeAccess(access),
  }
})
