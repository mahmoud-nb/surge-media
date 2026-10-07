import { useFfmpegCapabilities } from './ffmpeg'
import { countJobs, type JobCounts, readWorkerPresence, type WorkerPresence } from './jobs'
import { useVideoProcessingSettings } from './settings'

/**
 * État du traitement des vidéos vu par un processus (phase D3) : le traitement est-il **actif** (formats
 * convertis acceptés, tâches créées à l'envoi), qui traite la file, combien de tâches attendent.
 *
 * Actif (§ 33, raffinement 7) :
 *   - `off` : jamais ; aucune tâche créée, `processingState` reste null (comportement de D2) ;
 *   - `embedded` : quand ffmpeg a été détecté utilisable par ce processus (§ 30.1 : un échec désactive le
 *     traitement, jamais l'arrêt du serveur) — sinon les tâches s'accumuleraient sans être traitées ;
 *   - `external` : quand un processus de travail a écrit sa présence dans les 5 dernières minutes
 *     (WORKER_SEEN_WINDOW_MS) ; le serveur web ne lance jamais ffmpeg.
 * Mis en cache 30 s par processus : la question est posée à chaque envoi.
 */

const ACTIVE_CACHE_MS = 30_000
/** Échec de lecture (base indisponible) : réponse « inactif » gardée peu de temps. */
const ACTIVE_ERROR_CACHE_MS = 5_000

let activeCache: { value: boolean, expires: number } | undefined
let activePending: Promise<boolean> | undefined

async function computeActive(): Promise<boolean> {
  const settings = useVideoProcessingSettings()
  if (settings.mode === 'off') return false
  if (settings.mode === 'embedded') return (await useFfmpegCapabilities()).ok
  const workers = await readWorkerPresence(await usePrisma(), new Date())
  return workers.some(worker => worker.active)
}

/** Traitement des vidéos actif pour ce processus (voir l'en-tête), mis en cache 30 s. */
export async function videoProcessingActive(): Promise<boolean> {
  if (useVideoProcessingSettings().mode === 'off') return false
  if (activeCache && activeCache.expires > Date.now()) return activeCache.value
  activePending ??= computeActive()
    .then((value) => {
      activeCache = { value, expires: Date.now() + ACTIVE_CACHE_MS }
      return value
    })
    .catch((error: unknown) => {
      console.error('[surge-media] État du traitement des vidéos illisible :', error)
      activeCache = { value: false, expires: Date.now() + ACTIVE_ERROR_CACHE_MS }
      return false
    })
    .finally(() => {
      activePending = undefined
    })
  return activePending
}

/** Oublie l'état mis en cache (présence écrite par ce processus, tests). */
export function invalidateVideoProcessingStatus(): void {
  activeCache = undefined
}

/** Processus de travail connus (présences de moins d'un jour), les plus récents d'abord. */
export async function listWorkers(): Promise<WorkerPresence[]> {
  return readWorkerPresence(await usePrisma(), new Date())
}

/** Tâches par statut : `{ queued, running, done, failed, cancelled }`. */
export async function jobCounts(): Promise<JobCounts> {
  return countJobs(await usePrisma())
}

/**
 * Vidéos jamais traitées (`processingState` null : envoyées avant D3 ou traitement inactif à l'envoi),
 * hors corbeille : nombre et durée totale connue (s), pour « Traiter les vidéos existantes ».
 */
export async function backfillCandidates(): Promise<{ count: number, totalDuration: number }> {
  const prisma = await usePrisma()
  const result = await prisma.media.aggregate({
    where: { kind: 'VIDEO', processingState: null, deletedAt: null },
    _count: { _all: true },
    _sum: { duration: true },
  })
  return { count: result._count._all, totalDuration: Math.round((result._sum.duration ?? 0) * 1000) / 1000 }
}

/**
 * Chemins servis par un processus de travail (NUXT_SERVER_ROLE=worker) : la sonde de santé seulement
 * (conteneurs) ; tout le reste répond 404 (server/middleware/0.server-role.ts).
 */
export function servedByWorker(pathname: string): boolean {
  return pathname === '/api/health'
}
