import { useVideoPreparation } from '../../../lib/media/handlers/video'
import { useUploadSizes } from '../../../lib/media/limits'
import { videoProcessingActive } from '../../../lib/video-processing/status'

/**
 * GET /api/admin/config/media — règles d'envoi pour l'interface (validation immédiate côté
 * navigateur, textes d'aide). Le serveur reste seul juge (contrôles de POST /api/admin/media).
 * `maxUploadSizes` : limite par genre ; `maxUploadSize` : la plus grande (compatibilité).
 * `videoPreparation` : opérations faites sur les MP4/MOV à l'envoi (NUXT_MEDIA_VIDEO_PREPARE).
 * `acceptedTypes` : types acceptés en ce moment (vidéos : MKV, AVI… en plus quand le traitement est actif).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const maxUploadSizes = useUploadSizes()
  const acceptedTypes = await videoProcessingActive()
    ? { ...ACCEPTED_MEDIA_TYPES, VIDEO: { ...ACCEPTED_MEDIA_TYPES.VIDEO, ...CONVERTED_VIDEO_TYPES } }
    : ACCEPTED_MEDIA_TYPES
  return {
    maxUploadSize: Math.max(...Object.values(maxUploadSizes)),
    maxUploadSizes,
    acceptedTypes,
    signedUrlDurations: SIGNED_URL_DURATIONS,
    videoPreparation: VIDEO_PREPARATIONS.filter(operation => useVideoPreparation()[operation]),
  }
})
