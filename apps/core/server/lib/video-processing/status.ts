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
 *     traitement, jamais l'arrêt du serveur) et que sa boucle n'est pas arrêtée (`setVideoProcessingStopped` :
 *     ffmpeg inutilisable au démarrage, ou devenu inutilisable en cours de route) — sinon les tâches
 *     s'accumuleraient sans être traitées ;
 *   - `external` : quand un processus de travail en état de traiter (présence sans `halted`) a écrit sa
 *     présence dans les 5 dernières minutes (WORKER_SEEN_WINDOW_MS) ; le serveur web ne lance jamais ffmpeg.
 * Mis en cache 30 s par processus : la question est posée à chaque envoi. Un changement vu par ce
 * processus (présence écrite, boucle arrêtée ou relancée) oublie le cache aussitôt.
 */

const ACTIVE_CACHE_MS = 30_000
/** Échec de lecture (base indisponible) : réponse « inactif » gardée peu de temps. */
const ACTIVE_ERROR_CACHE_MS = 5_000

let activeCache: { value: boolean, expires: number } | undefined
let activePending: Promise<boolean> | undefined
/** Incrémenté à chaque oubli : un calcul commencé avant ne remet pas en cache une réponse périmée. */
let generation = 0
/**
 * Boucle de ce processus arrêtée (plugin 0.video-processing.ts, états du superviseur de runner.ts) :
 * `halted` = ffmpeg devenu inutilisable en cours de route (RunnerHalt), détection refaite chaque minute ;
 * `disabled` = inutilisable dès le démarrage (ou stockage non partagé), rien n'est refait : réglage à
 * corriger, puis redémarrage. null : boucle en route (ou démarrage en cours).
 */
export type VideoProcessingStop = 'halted' | 'disabled'
let stopped: VideoProcessingStop | null = null

async function computeActive(): Promise<boolean> {
  const settings = useVideoProcessingSettings()
  if (settings.mode === 'off') return false
  if (settings.mode === 'embedded') return stopped === null && (await useFfmpegCapabilities()).ok
  const workers = await readWorkerPresence(await usePrisma(), new Date())
  return workers.some(worker => worker.active)
}

/** Traitement des vidéos actif pour ce processus (voir l'en-tête), mis en cache 30 s. */
export async function videoProcessingActive(): Promise<boolean> {
  if (useVideoProcessingSettings().mode === 'off') return false
  if (activeCache && activeCache.expires > Date.now()) return activeCache.value
  if (activePending) return activePending
  const started = generation
  const remember = (value: boolean, ms: number) => {
    if (generation === started) activeCache = { value, expires: Date.now() + ms }
    return value
  }
  activePending = computeActive()
    .then(value => remember(value, ACTIVE_CACHE_MS))
    .catch((error: unknown) => {
      console.error('[surge-media] État du traitement des vidéos illisible :', error)
      return remember(false, ACTIVE_ERROR_CACHE_MS)
    })
    .finally(() => {
      if (generation === started) activePending = undefined
    })
  return activePending
}

/** Oublie l'état mis en cache (présence écrite ou boucle arrêtée par ce processus, tests). */
export function invalidateVideoProcessingStatus(): void {
  generation++
  activeCache = undefined
  activePending = undefined
}

/**
 * Boucle de ce processus arrêtée (`halted`, `disabled`) ou en route (null) : en mode `embedded`, le
 * traitement est inactif ici tant qu'elle est arrêtée (formats convertis refusés, aucune tâche créée à
 * l'envoi). Après `halted`, le superviseur refait la détection chaque minute et relance la boucle.
 */
export function setVideoProcessingStopped(value: VideoProcessingStop | null): void {
  if (stopped === value) return
  stopped = value
  invalidateVideoProcessingStatus()
}

/**
 * Boucle de ce processus arrêtée en cours de route, nouvelle détection de ffmpeg chaque minute
 * (« Réglages ») ; faux quand ffmpeg était inutilisable dès le démarrage (rien n'est redétecté).
 */
export function videoProcessingHalted(): boolean {
  return stopped === 'halted'
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
