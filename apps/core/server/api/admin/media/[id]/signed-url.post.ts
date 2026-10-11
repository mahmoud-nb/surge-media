import { signedUrlSchema } from '#shared/schemas/media'
import { mediaError } from '../../../../lib/media/errors'
import { findMedia } from '../../../../lib/media/service'
import { signMediaAccess } from '../../../../lib/media/signing'
import { videoSources } from '../../../../lib/media/sources'
import { mediaBaseUrl, mediaPath, posterPath, renditionPath, signedMediaPath, trackPath } from '../../../../lib/media/urls'

/**
 * POST /api/admin/media/:id/signed-url — { expiresIn: secondes (60 à 7 jours) } → lien
 * temporaire absolu vers un média privé, utilisable directement (balise <img>, partage).
 * Pour un média public, renvoie son URL permanente (expiresAt: null). Vidéo : aussi l'affiche
 * (`posterUrl`), les pistes de texte (`tracks`) et les sources du lecteur (`sources`, phase D3 : rendus
 * puis original, server/lib/media/sources.ts), signées jusqu'à la même échéance (extrait <video>
 * complet) ; le droit `file` de l'original couvre ses rendus. 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const { expiresIn } = await readValidatedBody(event, body => signedUrlSchema.parse(body))
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')

  const base = mediaBaseUrl(event)
  const isPublic = media.visibility === 'PUBLIC'
  const { path, expiresAt } = isPublic ? { path: mediaPath(media), expiresAt: null } : signedMediaPath(media, expiresIn)
  const expires = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null
  /** Adresse absolue, signée pour `variant` jusqu'à la même échéance si le média est privé. */
  const link = (relative: string, variant: string) => `${base}${relative}${expires === null ? '' : `?${signMediaAccess(media, { variant }, expires)}`}`
  return {
    url: `${base}${path}`,
    expiresAt,
    posterUrl: media.posterKey ? link(posterPath(media), 'full') : null,
    tracks: media.textTracks.map(track => ({ id: track.id, url: link(trackPath(media, track.id), `track:${track.id}`) })),
    sources: videoSources(media, media.renditions, name => link(name ? renditionPath(media, name) : mediaPath(media), 'original')),
  }
})
