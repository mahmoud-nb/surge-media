import { findMedia, toMediaDetail } from '../../../lib/media/service'
import { videoSources } from '../../../lib/media/sources'
import { mediaBaseUrl, mediaPath, posterPath, renditionPath, trackPath } from '../../../lib/media/urls'
import { hasDerivedFiles } from '../../../lib/media/variants'
import { spaceTransformOptions } from '../../../lib/transforms/service'

/**
 * GET /api/admin/media/:id — métadonnées complètes (corbeille comprise), adresse publique
 * absolue (média public hors corbeille, sinon null) et celles de l'affiche et des pistes d'une vidéo, espace du média et portées de
 * l'utilisateur dans cet espace (l'interface masque les actions interdites). Pour une image :
 * `transforms` = ce que propose le générateur d'adresses (politique de l'espace, préréglages
 * utilisables, formats, dimension maximale) ; null sinon. `publicSources` (phase D3) : sources d'une
 * vidéo publique (rendus puis original, server/lib/media/sources.ts) en adresses absolues permanentes,
 * pour l'extrait `<video>` ; [] sinon.
 * 404 si le média n'existe pas ou si son espace est invisible pour l'utilisateur.
 */
export default defineEventHandler(async (event) => {
  const { media, access } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const isPublic = media.visibility === 'PUBLIC' && !media.deletedAt
  const base = mediaBaseUrl(event)
  const publicUrl = isPublic ? `${base}${mediaPath(media)}` : null
  const publicPosterUrl = isPublic && media.posterKey ? `${base}${posterPath(media)}` : null
  const publicTrackUrls = isPublic ? media.textTracks.map(track => ({ id: track.id, url: `${base}${trackPath(media, track.id)}` })) : []
  const publicSources = isPublic ? videoSources(media, media.renditions, name => `${base}${name ? renditionPath(media, name) : mediaPath(media)}`) : []
  const transforms = hasDerivedFiles(media) ? await spaceTransformOptions(media.projectId) : null
  return { media: toMediaDetail(media), publicUrl, publicPosterUrl, publicTrackUrls, publicSources, transforms, ...describeAccess(access) }
})
