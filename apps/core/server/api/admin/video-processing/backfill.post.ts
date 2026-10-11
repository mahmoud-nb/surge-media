import { backfillProcessing } from '../../../lib/media/service'

/**
 * POST /api/admin/video-processing/backfill — « Traiter les vidéos existantes » (phase D3, § 35) : une
 * tâche de priorité basse pour chaque vidéo jamais traitée (`processingState` null), hors corbeille ;
 * deux demandes simultanées ne créent pas deux tâches (service.ts, `backfillProcessing`). Réservé aux
 * administrateurs (`settings:manage`), journalisé (`media.processing_backfill`, nombre de tâches) quand
 * au moins une tâche a été créée — aussi quand une erreur interrompt la boucle en route (`partial`), les
 * tâches déjà créées restant en file. → `{ count }`. 409 PROCESSING_DISABLED si le traitement est inactif.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  const progress = { count: 0 }
  try {
    await backfillProcessing(progress)
  }
  catch (error) {
    if (progress.count > 0) await recordAudit(event, { action: 'media.processing_backfill', data: { count: progress.count, partial: true } })
    throw error
  }
  if (progress.count > 0) await recordAudit(event, { action: 'media.processing_backfill', data: { count: progress.count } })
  return { count: progress.count }
})
