/**
 * Suivi du traitement d'une vidéo dans sa fiche (phase D3, architecture § 37) : interroge
 * GET /api/admin/media/:id/processing toutes les 5 s, et seulement :
 *   - dans le navigateur (rien au rendu serveur), après le montage ;
 *   - tant que `target()` désigne un média (la fiche le fait tant que la tâche est en attente ou en
 *     cours, hors corbeille) : arrêt dès qu'il devient null, reprise sur un autre média ;
 *   - quand l'onglet est visible : pause s'il est masqué, nouvelle lecture dès son retour.
 * Une requête à la fois : la minuterie n'est relancée qu'après la réponse et son traitement
 * (`onResult`, qui peut recharger la fiche). Une réponse arrivée après l'arrêt, ou pour un média
 * qui n'est plus suivi, est ignorée. Arrêt définitif au démontage de la page.
 */
import type { JobStep, MediaJobStatusValue, ProcessingStateValue, VideoJobErrorCode, VideoJobWarning } from '#shared/utils/video-processing'
import { JOB_POLL_MS } from '#shared/utils/video-processing'

/** Dernière tâche d'une vidéo, telle que la renvoie l'API de l'administration (dates sérialisées). */
export interface ProcessingJobView {
  /** Statut de la tâche (et non l'état du média, `processingState`). */
  status: MediaJobStatusValue
  step: JobStep | null
  /** Avancement de l'étape en cours (0 à 1), null s'il est inconnu. */
  progress: number | null
  /** Essais déjà échoués. */
  attempts: number
  errorCode: VideoJobErrorCode | null
  /** Résumé de l'erreur, déjà assaini par le serveur (jamais de chemin). */
  errorDetail: string | null
  warnings: VideoJobWarning[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Prochain essai au plus tôt (tâche remise en file après un échec passager). */
  runAfter: string
  updatedAt: string
}

/** Réponse de GET /api/admin/media/:id/processing (et extrait de la fiche après « Relancer »). */
export interface ProcessingSnapshot {
  version: number
  processingState: ProcessingStateValue | null
  processing: ProcessingJobView | null
}

/** Tâche en attente ou en cours : la fiche suit son avancement. */
export function processingInProgress(state: ProcessingStateValue | null | undefined): boolean {
  return state === 'PENDING' || state === 'PROCESSING'
}

export interface ProcessingPollOptions {
  /** Média à suivre, null = aucun suivi. */
  target: () => string | null
  fetch: (mediaId: string, signal: AbortSignal) => Promise<ProcessingSnapshot>
  /** Réponse reçue pour `mediaId`, encore suivi ; attendue avant la lecture suivante. */
  onResult: (mediaId: string, snapshot: ProcessingSnapshot) => void | Promise<void>
  interval?: number
}

export function useProcessingPoll(options: ProcessingPollOptions) {
  const interval = options.interval ?? JOB_POLL_MS
  let mounted = false
  /** Média suivi en ce moment (null : arrêt). */
  let current: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | null = null

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    request?.abort()
    request = null
  }

  function schedule(delay: number) {
    clearTimeout(timer)
    timer = setTimeout(() => void poll(), delay)
  }

  /** (Re)part sur `target` : minuterie et requête de l'ancien média abandonnées. */
  function follow(target: string | null, delay = interval) {
    cancel()
    current = target
    if (current && document.visibilityState === 'visible') schedule(delay)
  }

  async function poll() {
    timer = undefined
    const target = current
    if (!target || request || document.visibilityState !== 'visible') return
    const controller = new AbortController()
    request = controller
    let stop = false
    try {
      const snapshot = await options.fetch(target, controller.signal)
      if (controller.signal.aborted || current !== target) return
      await options.onResult(target, snapshot)
    }
    catch (error) {
      if (controller.signal.aborted) return
      // Média purgé ou devenu invisible : inutile d'insister. Réseau, serveur occupé : lecture suivante.
      const status = apiError(error).status
      stop = status === 403 || status === 404
    }
    finally {
      if (request === controller) request = null
    }
    if (stop) current = null
    // `onResult` a pu recharger la fiche : on relit la cible plutôt que d'attendre l'observateur.
    else if (current === target && options.target() === target && timer === undefined) schedule(interval)
  }

  function onVisibilityChange() {
    if (!mounted) return
    if (document.visibilityState === 'visible') follow(options.target(), 0)
    else cancel()
  }

  watch(options.target, (target) => {
    if (mounted && target !== current) follow(target)
  })

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    follow(options.target())
  })

  onBeforeUnmount(() => {
    mounted = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    current = null
    cancel()
  })
}
