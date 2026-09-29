import { findMedia, toMediaDetail } from '../../../lib/media/service'
import { mediaBaseUrl, mediaPath } from '../../../lib/media/urls'

/**
 * GET /api/admin/media/:id — métadonnées complètes (corbeille comprise), adresse publique
 * absolue (média public hors corbeille, sinon null), espace du média et portées de
 * l'utilisateur dans cet espace (l'interface masque les actions interdites).
 * 404 si le média n'existe pas ou si son espace est invisible pour l'utilisateur.
 */
export default defineEventHandler(async (event) => {
  const { media, access } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const publicUrl = media.visibility === 'PUBLIC' && !media.deletedAt ? `${mediaBaseUrl(event)}${mediaPath(media)}` : null
  return { media: toMediaDetail(media), publicUrl, ...describeAccess(access) }
})
