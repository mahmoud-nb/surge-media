import { findMedia, requestProcessing, toMediaDetail } from '../../../../lib/media/service'

/**
 * POST /api/admin/media/:id/process — « Relancer » le traitement d'une vidéo (phase D3, § 35) : tâche en
 * échec, rendus à refaire avec d'autres réglages, ou première fois pour une vidéo envoyée avant D3. Tâche
 * active annulée, nouvelle tâche pour le fichier actuel (service.ts, `requestProcessing`). Mêmes droits
 * que la modification du média (portée media:write). 422 KIND_MISMATCH (image), 409 IN_TRASH,
 * 409 PROCESSING_DISABLED (traitement inactif), 409 VERSION_CONFLICT (fichier remplacé entre-temps).
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  return { media: toMediaDetail(await requestProcessing(media), await sessionTagViewer(event)) }
})
