import { useFfmpegCapabilities } from '../../../lib/video-processing/ffmpeg'
import { useVideoProcessingSettings } from '../../../lib/video-processing/settings'
import { backfillCandidates, jobCounts, listWorkers, videoProcessingActive, videoProcessingHalted } from '../../../lib/video-processing/status'

/**
 * GET /api/admin/video-processing — état du traitement des vidéos pour « Réglages » (phase D3, § 35,
 * § 37), réservé aux administrateurs (permission de plateforme `settings:manage`) :
 *   - `mode`, `role`, `active` (formats convertis acceptés, tâches créées à l'envoi), `halted` (boucle de
 *     ce processus arrêtée faute de ffmpeg utilisable, mode `embedded`) ;
 *   - `settings` : réglages NUXT_VIDEO_* en vigueur (jamais les chemins des binaires) ;
 *   - `ffmpeg` : capacités détectées par ce processus, null quand il ne lance jamais ffmpeg (mode `off`,
 *     ou serveur web en mode `external` : voir alors `workers[].version`) ;
 *   - `workers` : processus de travail connus (présences de moins d'un jour), les plus récents d'abord ;
 *   - `jobs` : tâches par statut ; `backfill` : vidéos jamais traitées (nombre, durée totale en s), pour
 *     « Traiter les vidéos existantes ».
 * Jamais mis en cache.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  const settings = useVideoProcessingSettings()
  const runsFfmpeg = settings.mode === 'embedded' || (settings.mode === 'external' && settings.role === 'worker')
  const [active, capabilities, workers, jobs, backfill] = await Promise.all([
    videoProcessingActive(),
    runsFfmpeg ? useFfmpegCapabilities() : null,
    listWorkers(),
    jobCounts(),
    backfillCandidates(),
  ])
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    mode: settings.mode,
    role: settings.role,
    active,
    halted: videoProcessingHalted(),
    settings: {
      concurrency: settings.concurrency,
      threads: settings.threads,
      rendition: settings.rendition,
      preset: settings.preset,
      crf: settings.crf,
      av1: settings.av1,
      maxDuration: settings.maxDuration,
    },
    ffmpeg: capabilities && {
      ok: capabilities.ok,
      version: capabilities.version,
      major: capabilities.major,
      encoders: capabilities.encoders,
      hdrFilters: capabilities.hdrFilters,
      av1: capabilities.av1,
      problems: capabilities.problems,
    },
    workers: workers.map(worker => ({
      id: worker.id,
      host: worker.host,
      seenAt: worker.seenAt,
      version: worker.version,
      concurrency: worker.concurrency,
      active: worker.active,
      halted: worker.halted,
    })),
    jobs,
    backfill,
  }
})
