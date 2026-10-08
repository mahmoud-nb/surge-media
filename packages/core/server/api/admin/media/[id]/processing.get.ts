import { PROCESSING_INCLUDE } from '../../../../lib/media/sources'
import { processingDetail } from '../../../../lib/video-processing/jobs'

/**
 * GET /api/admin/media/:id/processing — avancement du traitement d'une vidéo (phase D3), interrogé toutes
 * les 5 s par la fiche tant que la tâche est en attente ou en cours : `{ version, processingState,
 * processing }` (dernière tâche, comme `MediaDetail.processing`). Requête légère (ni rendus, ni pistes,
 * ni signature) : la fiche ne recharge le média entier que si la version ou l'état changent (sans
 * réinitialiser ses formulaires ni ses liens). Mêmes règles d'accès que GET /api/admin/media/:id
 * (portée media:read, corbeille comprise). Jamais mis en cache.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const { media } = await requireMediaAccess(event, async () => (await usePrisma()).media.findUnique({
    where: { id },
    select: { projectId: true, version: true, processingState: true, jobs: PROCESSING_INCLUDE.jobs },
  }), 'media:read')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { version: media.version, processingState: media.processingState, processing: processingDetail(media.jobs[0] ?? null) }
})
