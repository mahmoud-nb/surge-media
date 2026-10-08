import { hostname } from 'node:os'
import { WORKER_PRESENCE_MS } from '#shared/utils/video-processing'
import { catchUpProcessing } from '../lib/media/service'
import { useMediaStorage } from '../lib/storage'
import { ffmpegProblemMessage, useFfmpegCapabilities } from '../lib/video-processing/ffmpeg'
import { purgeWorkerPresence, writeWorkerPresence, type WorkerPresenceInfo } from '../lib/video-processing/jobs'
import { cleanupJobDirectories, createVideoJobRunner } from '../lib/video-processing/pipeline'
import { type JobRunner, registerJobRunner } from '../lib/video-processing/runner'
import { useVideoProcessingSettings } from '../lib/video-processing/settings'
import { invalidateVideoProcessingStatus } from '../lib/video-processing/status'
import { useWorkerId } from '../lib/video-processing/worker-id'

/**
 * Traitement des vidéos par ffmpeg (phase D3, architecture § 30, DD25 et DD26) : démarre la boucle des
 * tâches de ce processus quand il doit en exécuter.
 *   - `off` : rien (comportement de D2) ;
 *   - serveur web en mode `external` : rien, il ne fait que créer les tâches (service des médias) ;
 *   - serveur web en mode `embedded`, ou processus de travail (NUXT_SERVER_ROLE=worker) : contrôle de
 *     ffmpeg (≥ 6, libx264, aac, ffprobe ; un échec désactive le traitement avec un message, jamais
 *     l'arrêt du serveur), dossiers temporaires abandonnés supprimés, rattrapage des médias « en
 *     attente » sans tâche, puis boucle. Processus de travail : stockage partagé vérifié (fichier d'un
 *     média récent lisible) et présence écrite toutes les 60 s (« Réglages », /api/health ; elle rend le
 *     mode `external` actif pour le serveur web).
 *
 * Nommé « 0. » pour passer avant `database.ts` : les crochets `close` s'exécutent dans l'ordre
 * d'enregistrement, et l'arrêt des tâches (ffmpeg tué, tâche rendue à la file, dossier temporaire
 * supprimé) écrit encore en base avant la déconnexion de Prisma. En développement, Nitro recharge le
 * serveur (fil de travail) à chaque modification : `close` est appelé à chaque fois, ffmpeg n'est jamais
 * laissé orphelin.
 */

/** Attente maximale du démarrage en cours quand l'arrêt arrive (rattrapage, première présence). */
const START_WAIT_MS = 5_000

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

  let closed = false
  let runner: JobRunner | null = null
  let presence: ReturnType<typeof setInterval> | undefined

  const start = async (): Promise<void> => {
    const capabilities = await useFfmpegCapabilities()
    if (!capabilities.ok) {
      const problems = capabilities.problems.map(ffmpegProblemMessage).join(' ; ')
      console.warn(`[surge-media] Traitement des vidéos désactivé : ${problems}. Voir NUXT_FFMPEG_PATH, NUXT_FFPROBE_PATH.`)
      return
    }
    if (closed || (worker && !await storageShared())) return
    const workerId = useWorkerId()
    const removed = await cleanupJobDirectories()
    if (removed > 0) console.info(`[surge-media] Traitement des vidéos : ${removed} dossier(s) temporaire(s) abandonné(s) supprimé(s).`)

    if (worker) {
      const info: WorkerPresenceInfo = { host: hostname(), pid: process.pid, version: capabilities.version, encoders: capabilities.encoders, concurrency: settings.concurrency }
      const beat = async () => {
        const prisma = await usePrisma()
        const now = new Date()
        await writeWorkerPresence(prisma, workerId, info, now)
        await purgeWorkerPresence(prisma, now)
        invalidateVideoProcessingStatus()
      }
      await beat()
      presence = setInterval(() => {
        beat().catch((error: unknown) => console.error('[surge-media] Présence du processus de travail non écrite :', error))
      }, WORKER_PRESENCE_MS)
      presence.unref()
    }

    const caught = await catchUpProcessing()
    if (caught > 0) console.info(`[surge-media] Traitement des vidéos : ${caught} tâche(s) recréée(s) (médias en attente sans tâche).`)
    if (closed) return
    runner = createVideoJobRunner(settings, workerId)
    registerJobRunner(runner)
    runner.start()
    console.info(`[surge-media] Traitement des vidéos actif (${worker ? 'processus de travail' : 'mode embedded'}, ffmpeg ${capabilities.version}, ${settings.concurrency} tâche(s) à la fois, ${settings.threads} fil(s)).`)
  }

  const starting = start().catch((error: unknown) => console.error('[surge-media] Démarrage du traitement des vidéos impossible :', error))

  // Ne rejette jamais : une erreur ici empêcherait les crochets suivants (déconnexion de Prisma).
  nitroApp.hooks.hook('close', async () => {
    closed = true
    clearInterval(presence)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([starting, new Promise((resolve) => {
      timer = setTimeout(resolve, START_WAIT_MS)
    })])
    clearTimeout(timer)
    registerJobRunner(null)
    await runner?.stop().catch(() => {})
  })
})
