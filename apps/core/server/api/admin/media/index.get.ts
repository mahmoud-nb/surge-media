import { mediaListQuerySchema } from '#shared/schemas/media'
import { listAllMedia, listMedia } from '../../../lib/media/service'
import { readableSpaces } from '../../../lib/media/spaces'

/**
 * GET /api/admin/media?project=&folder=&recursive=1&q=&kind=&visibility=&tags=&match=any|all&untagged=1&status=active|trash&sort=&page=
 * Médias d'un espace : `project` = identifiant d'un projet, absent = bibliothèque de
 * l'organisation ; `folder` = dossier affiché (absent = racine), `recursive` = sous-dossiers
 * compris (404 FOLDER_NOT_FOUND pour un dossier d'un autre espace). 24 par page ; filtres invalides ignorés. Renvoie aussi l'espace et les
 * portées de l'utilisateur. 404 si l'espace est invisible pour lui.
 *
 * `scope=all` (page « Médias », architecture-media-view.md) : médias actifs de la bibliothèque (si
 * lisible) et des projets actifs lisibles, mêmes filtres sans dossier ni corbeille ; renvoie `spaces`
 * (chaque espace, son nombre de médias actifs, les portées de l'utilisateur) au lieu de l'espace.
 * Jamais d'erreur d'accès : sans espace lisible, liste vide.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, value => mediaListQuerySchema.parse(value))
  if (query.scope === 'all') {
    const user = await requireAuth(event)
    return listAllMedia(await readableSpaces(user), query, tagViewerFor(user))
  }
  const access = await requireSpaceAccess(event, spaceFor(query.project), 'media:read')
  return { ...await listMedia(access.space, query, tagViewerFor(access.user)), ...describeAccess(access) }
})
