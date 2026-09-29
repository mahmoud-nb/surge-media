import { mediaListQuerySchema } from '#shared/schemas/media'
import { listMedia } from '../../../lib/media/service'

/**
 * GET /api/admin/media?project=&q=&kind=&visibility=&status=active|trash&sort=&page=
 * Médias d'un espace : `project` = identifiant d'un projet, absent = bibliothèque de
 * l'organisation. 24 par page ; filtres invalides ignorés. Renvoie aussi l'espace et les
 * portées de l'utilisateur. 404 si l'espace est invisible pour lui.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, value => mediaListQuerySchema.parse(value))
  const access = await requireSpaceAccess(event, spaceFor(query.project), 'media:read')
  return { ...await listMedia(access.space, query), ...describeAccess(access) }
})
