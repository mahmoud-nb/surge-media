import { findMedia, toMediaDetail } from '../../../lib/media/service'
import { mediaBaseUrl, mediaPath } from '../../../lib/media/urls'
import { hasDerivedFiles } from '../../../lib/media/variants'
import { spaceTransformOptions } from '../../../lib/transforms/service'

/**
 * GET /api/admin/media/:id — métadonnées complètes (corbeille comprise), adresse publique
 * absolue (média public hors corbeille, sinon null), espace du média et portées de
 * l'utilisateur dans cet espace (l'interface masque les actions interdites). Pour une image :
 * `transforms` = ce que propose le générateur d'adresses (politique de l'espace, préréglages
 * utilisables, formats, dimension maximale) ; null sinon.
 * 404 si le média n'existe pas ou si son espace est invisible pour l'utilisateur.
 */
export default defineEventHandler(async (event) => {
  const { media, access } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const publicUrl = media.visibility === 'PUBLIC' && !media.deletedAt ? `${mediaBaseUrl(event)}${mediaPath(media)}` : null
  const transforms = hasDerivedFiles(media) ? await spaceTransformOptions(media.projectId) : null
  return { media: toMediaDetail(media), publicUrl, transforms, ...describeAccess(access) }
})
