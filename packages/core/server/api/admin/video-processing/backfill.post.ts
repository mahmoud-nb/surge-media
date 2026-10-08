import { backfillProcessing } from '../../../lib/media/service'

/**
 * POST /api/admin/video-processing/backfill — « Traiter les vidéos existantes » (phase D3, § 35) : une
 * tâche de priorité basse pour chaque vidéo jamais traitée (`processingState` null), hors corbeille ;
 * deux demandes simultanées ne créent pas deux tâches (service.ts, `backfillProcessing`). Réservé aux
 * administrateurs (`settings:manage`), journalisé (`media.processing_backfill`, nombre de tâches) quand
 * au moins une tâche a été créée. → `{ count }`. 409 PROCESSING_DISABLED si le traitement est inactif.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  const { count } = await backfillProcessing()
  if (count > 0) await recordAudit(event, { action: 'media.processing_backfill', data: { count } })
  return { count }
})
