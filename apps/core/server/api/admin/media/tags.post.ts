import { spaceQuerySchema } from '#shared/schemas/media'
import { mediaTagsBulkSchema } from '#shared/schemas/tags'
import { bulkTagMedia } from '../../../lib/tags/service'

/**
 * POST /api/admin/media/tags?project= — { ids: string[] (1 à 100), add?: string[], remove?: string[] } :
 * affectation des étiquettes en lot aux médias actifs de l'espace (portée media:write ; architecture-tags.md).
 * Les médias d'un autre espace ou de la corbeille sont ignorés ; un média qui dépasserait 50 étiquettes
 * reste tel quel (`skipped`). → { updated, skipped }
 * 400 (validation) · 404 TAG_NOT_FOUND (`tags` : étiquette inconnue, d'un autre projet ou confidentielle
 * pour l'utilisateur) · 403 (PROJECT_ARCHIVED).
 */
export default defineEventHandler(async (event) => {
  const { project } = await getValidatedQuery(event, value => spaceQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(project), 'media:write')
  const { ids, add, remove } = await readValidatedBody(event, body => mediaTagsBulkSchema.parse(body))
  return bulkTagMedia(access.space, ids, add, remove, tagViewerFor(access.user))
})
