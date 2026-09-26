/**
 * GET /api/admin/config/media — règles d'envoi pour l'interface (validation immédiate côté
 * navigateur, textes d'aide). Le serveur reste seul juge (contrôles de POST /api/admin/media).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'media:manage')
  return {
    maxUploadSize: Number(useRuntimeConfig(event).media.maxUploadSize),
    acceptedTypes: ACCEPTED_MEDIA_TYPES,
    signedUrlDurations: SIGNED_URL_DURATIONS,
  }
})
