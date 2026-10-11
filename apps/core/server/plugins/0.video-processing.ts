import { hostname } from 'node:os'
import { WORKER_PRESENCE_MS } from '#shared/utils/video-processing'
import { catchUpProcessing } from '../lib/media/service'
import { useMediaStorage } from '../lib/storage'
import { ffmpegProblemMessage, type FfmpegCapabilities, resetFfmpegCapabilities, useFfmpegCapabilities } from '../lib/video-processing/ffmpeg'
import { purgeWorkerPresence, removeWorkerPresence, writeWorkerPresence } from '../lib/video-processing/jobs'
import { cleanupJobDirectories, createVideoJobRunner, expireDeadHolderLeases } from '../lib/video-processing/pipeline'
import { registerJobRunner, superviseJobRunner, type SupervisorState } from '../lib/video-processing/runner'
import { useVideoProcessingSettings } from '../lib/video-processing/settings'
import { invalidateVideoProcessingStatus, setVideoProcessingStopped } from '../lib/video-processing/status'
import { useWorkerId } from '../lib/video-processing/worker-id'

/**
 * Traitement des vidéos par ffmpeg (phase D3, architecture § 30, DD25 et DD26) : démarre la boucle des
 * tâches de ce processus quand il doit en exécuter.
 *   - `off` : rien (comportement de D2) ;
 *   - serveur web en mode `external` : rien, il ne fait que créer les tâches (service des médias) ;
 *   - serveur web en mode `embedded`, ou processus de travail (NUXT_SERVER_ROLE=worker) : boucle confiée
 *     au superviseur (runner.ts) — contrôle de ffmpeg (≥ 6, libx264, aac, ffprobe ; un échec désactive le
 *     traitement avec un message, jamais l'arrêt du serveur), puis préparation (stockage partagé vérifié
 *     pour un processus de travail, dossiers temporaires abandonnés supprimés, rattrapage des médias « en
 *     attente » sans tâche) et boucle. Base indisponible au lancement : nouvel essai, de plus en plus
 *     espacé. ffmpeg devenu inutilisable en cours de route (RunnerHalt) : boucle arrêtée, détection
 *     refaite chaque minute, boucle relancée dès qu'il est de nouveau là.
 *
 * Tant que la boucle ne tourne pas (arrêtée, désactivée), ce processus ne se dit jamais « actif » : en
 * mode `embedded`, les formats convertis sont refusés et aucune tâche n'est créée à l'envoi
 * (status.ts) ; un processus de travail publie sa présence avec `halted`, que le serveur web ne compte
 * pas. Sa présence est écrite toutes les 60 s (« Réglages », /api/health) et effacée à l'arrêt.
 *
 * Nommé « 0. » pour passer avant `database.ts` : les crochets `close` s'exécutent dans l'ordre
 * d'enregistrement, et l'arrêt des tâches (ffmpeg tué, tâche rendue à la file, dossier temporaire
 * supprimé) écrit encore en base avant la déconnexion de Prisma. En développement, Nitro recharge le
 * serveur (fil de travail) à chaque modification : `close` est appelé à chaque fois. Ctrl+C sur
 * `nuxt dev`, lui, arrête tout sans `close` : ffmpeg, laissé dans le groupe du terminal en développement
 * (run.ts, `detached`), reçoit le même signal, et le bail de la tâche est rendu échu au démarrage suivant
 * (pipeline.ts, `expireDeadHolderLeases`).
 */

/**
 * Le stockage est-il partagé avec le serveur web (§ 30.2) ? Fichier d'un des médias les plus récents
 * lisible. Médiathèque vide : rien à vérifier (et rien à traiter).
 */
async function storageShared(): Promise<boolean> {
  const prisma = await usePrisma()
  const recent = await prisma.media.findMany({ select: { storageKey: true }, orderBy: [{ createdAt: 'desc' }], take: 3 })
  if (recent.length === 0) return true
  const storage = await useMediaStorage()
  for (const media of recent) {
    if (await storage.stat(media.storageKey)) return true
  }
  console.error('[surge-media] Processus de travail : fichiers des médias introuvables dans le stockage configuré (NUXT_MEDIA_STORAGE_*). '
    + 'Le stockage doit être partagé avec le serveur web (S3, ou disque monté au même endroit) : traitement des vidéos non démarré.')
  return false
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return
  const settings = useVideoProcessingSettings()
  const worker = settings.role === 'worker'
  if (settings.mode === 'off') {
    if (worker) console.warn('[surge-media] NUXT_SERVER_ROLE=worker avec NUXT_VIDEO_PROCESSING=off : ce processus n\'a aucune tâche à exécuter.')
    return
  }
  if (!worker && settings.mode === 'external') return

  const workerId = useWorkerId()
  let capabilities: FfmpegCapabilities | null = null
  let state: SupervisorState = 'idle'
  let presence: ReturnType<typeof setInterval> | undefined
  /** Présence publiée au moins une fois (sinon rien à effacer à l'arrêt). */
  let published = false

  /** Présence d'un processus de travail ; `halted` tant que sa boucle ne tourne pas. */
  const beat = async (): Promise<void> => {
    const prisma = await usePrisma()
    const now = new Date()
    await writeWorkerPresence(prisma, workerId, {
      host: hostname(),
      pid: process.pid,
      version: capabilities?.version ?? null,
      encoders: capabilities?.encoders ?? [],
      concurrency: settings.concurrency,
      halted: state !== 'running',
    }, now)
    published = true
    await purgeWorkerPresence(prisma, now)
    invalidateVideoProcessingStatus()
  }
  const beatQuietly = (): void => {
    beat().catch((error: unknown) => console.error('[surge-media] Présence du processus de travail non écrite :', error))
  }

  const supervisor = superviseJobRunner({
    async detect(recovering) {
      if (recovering) resetFfmpegCapabilities()
      capabilities = await useFfmpegCapabilities()
      if (!capabilities.ok && !recovering) {
        const problems = capabilities.problems.map(ffmpegProblemMessage).join(' ; ')
        console.warn(`[surge-media] Traitement des vidéos désactivé : ${problems}. Voir NUXT_FFMPEG_PATH, NUXT_FFPROBE_PATH.`)
      }
      return capabilities.ok
    },
    async prepare() {
      if (worker && !await storageShared()) return false
      if (import.meta.dev) await expireDeadHolderLeases()
      const removed = await cleanupJobDirectories()
      if (removed > 0) console.info(`[surge-media] Traitement des vidéos : ${removed} dossier(s) temporaire(s) abandonné(s) supprimé(s).`)
      const caught = await catchUpProcessing()
      if (caught > 0) console.info(`[surge-media] Traitement des vidéos : ${caught} tâche(s) recréée(s) (médias en attente sans tâche).`)
      return true
    },
    createRunner: onHalt => createVideoJobRunner(settings, workerId, onHalt),
    onState(next, runner) {
      const previous = state
      state = next
      registerJobRunner(runner)
      // Inactif ici tant que la boucle est arrêtée ou désactivée ; un démarrage en cours compte comme actif
      // (les tâches créées attendent dans la file persistante). « Réglages » distingue les deux arrêts :
      // seul `halted` est suivi d'une nouvelle détection.
      setVideoProcessingStopped(next === 'halted' || next === 'disabled' ? next : null)
      if (next === 'running') {
        console.info(`[surge-media] Traitement des vidéos ${previous === 'halted' ? 'repris' : 'actif'} (${worker ? 'processus de travail' : 'mode embedded'}, ffmpeg ${capabilities?.version ?? '?'}, ${settings.concurrency} tâche(s) à la fois, ${settings.threads} fil(s)).`)
      }
      else if (next === 'halted') {
        console.error('[surge-media] Traitement des vidéos arrêté sur ce processus : nouvelle détection de ffmpeg chaque minute.')
      }
      if (!worker || next === 'stopped') return
      // Présence : publiée dès que la boucle tourne, et aussitôt mise à jour quand elle s'arrête (le
      // serveur web ne doit pas compter un processus qui ne traite plus rien).
      if (next === 'running' || published) beatQuietly()
      if (next === 'running' && !presence) {
        presence = setInterval(beatQuietly, WORKER_PRESENCE_MS)
        presence.unref()
      }
    },
  })
  supervisor.start()

  // Ne rejette jamais : une erreur ici empêcherait les crochets suivants (déconnexion de Prisma).
  nitroApp.hooks.hook('close', async () => {
    clearInterval(presence)
    await supervisor.stop().catch(() => {})
    registerJobRunner(null)
    if (worker && published) {
      await usePrisma()
        .then(prisma => removeWorkerPresence(prisma, workerId))
        .catch((error: unknown) => console.error('[surge-media] Présence du processus de travail non effacée :', error))
    }
  })
})
