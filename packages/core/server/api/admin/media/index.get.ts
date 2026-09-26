import { mediaListQuerySchema } from '#shared/schemas/media'
import { listMedia } from '../../../lib/media/service'

/**
 * GET /api/admin/media?q=&kind=&visibility=&status=active|trash&sort=&page=
 * Médiathèque paginée (24 par page). Filtres invalides ignorés.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  const query = await getValidatedQuery(event, value => mediaListQuerySchema.parse(value))
  return listMedia(query)
})
