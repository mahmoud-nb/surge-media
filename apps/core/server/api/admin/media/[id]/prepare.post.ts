import { useVideoPreparation } from '../../../../lib/media/handlers/video'
import { findMedia, prepareStoredMedia, toMediaDetail } from '../../../../lib/media/service'

/**
 * POST /api/admin/media/:id/prepare — « Optimiser » une vidéo déjà stockée (envoyée avant la phase D2,
 * ou réglage changé depuis) : index placé en tête et métadonnées d'origine retirées, selon
 * NUXT_MEDIA_VIDEO_PREPARE (architecture phase D, § 18.6). Mêmes droits que le remplacement du fichier
 * (portée media:write). Fichier modifié : nouvelle version (anciennes URL redirigées) ; rien à faire :
 * même version, vidéo marquée comme examinée. 400 si ce n'est pas une vidéo MP4/MOV ou si la
 * préparation est désactivée ; 409 IN_TRASH, VERSION_CONFLICT.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  if (media.kind !== 'VIDEO' || !['video/mp4', 'video/quicktime'].includes(media.mimeType)) {
    throw createError({ statusCode: 400, statusMessage: 'Only MP4 and MOV videos can be prepared.' })
  }
  const options = useVideoPreparation()
  if (!options.faststart && !options.metadata) {
    throw createError({ statusCode: 400, statusMessage: 'Video preparation is disabled on this server (NUXT_MEDIA_VIDEO_PREPARE).' })
  }
  return { media: toMediaDetail(await prepareStoredMedia(media)) }
})
