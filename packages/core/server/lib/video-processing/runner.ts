import { JOB_POLL_MS } from '#shared/utils/video-processing'

/**
 * Boucle d'exécution des tâches vidéo d'un processus (phase D3, § 31.2) : jusqu'à `concurrency` tâches à
 * la fois (NUXT_VIDEO_CONCURRENCY, 1 par défaut : mesures du § 29.2), une recherche de tâche toutes les
 * 5 s quand la file est vide (requête indexée, négligeable), réveil immédiat par `notify()` (mode
 * `embedded` : le service des médias l'appelle après avoir créé une tâche, `notifyJobQueued`).
 *
 * Arrêt (`stop`, crochet `close` de Nitro : SIGTERM, rechargement en développement) : plus aucune prise,
 * chaque tâche en cours reçoit un signal d'arrêt (raison `RunnerStopping`) — le pipeline tue ffmpeg
 * (arbre de processus), rend la tâche à la file sans compter d'essai et supprime son dossier temporaire.
 * `stop` attend tout cela, au plus `stopTimeoutMs` (le délai d'arrêt de Nitro est de 30 s), et ne rejette
 * jamais : une erreur dans un crochet `close` empêcherait les suivants (déconnexion de Prisma).
 *
 * Tout est injecté (prise, exécution, attente, horloge) : la boucle est testée sans base ni ffmpeg
 * (tests/video-queue.test.ts).
 */

/** Raison d'arrêt transmise aux tâches en cours quand le processus s'arrête. */
export class RunnerStopping extends Error {
  constructor() {
    super('Arrêt du processus : tâche rendue à la file.')
    this.name = 'RunnerStopping'
  }
}

/**
 * Erreur d'une exécution qui doit arrêter ce processus de travail (ffmpeg devenu introuvable ou
 * inutilisable) : la tâche a déjà été rendue à la file ; les autres processus la prendront.
 */
export class RunnerHalt extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunnerHalt'
  }
}

export interface JobRunnerOptions<J> {
  /** Tâches simultanées (≥ 1). */
  concurrency: number
  /** Prend la prochaine tâche prête, null si la file est vide. */
  claim: () => Promise<J | null>
  /** Exécute une tâche ; `signal` = arrêt du processus. Ne doit pas rejeter, sauf `RunnerHalt`. */
  execute: (job: J, signal: AbortSignal) => Promise<void>
  /** Attente entre deux recherches, interrompue par `signal` (réveil, arrêt). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Horloge (ms), pour la cadence de l'entretien. */
  now?: () => number
  pollMs?: number
  /** Entretien (baux échus, dossiers temporaires abandonnés), au plus toutes les `maintenanceMs`. */
  maintenance?: () => Promise<void>
  maintenanceMs?: number
  /** Attente maximale des tâches interrompues à l'arrêt. */
  stopTimeoutMs?: number
  onError?: (error: unknown) => void
}

export type JobRunnerState = 'idle' | 'running' | 'stopping' | 'stopped'

export interface JobRunner {
  start: () => void
  /** Arrête la boucle et les tâches en cours ; résout toujours (au plus `stopTimeoutMs`). */
  stop: () => Promise<void>
  /** Une tâche vient d'être créée : recherche immédiate (si une place est libre). */
  notify: () => void
  readonly state: JobRunnerState
  /** Tâches en cours. */
  readonly active: number
}

const DEFAULT_STOP_TIMEOUT_MS = 20_000
const DEFAULT_MAINTENANCE_MS = 30_000

/** Attente interrompue par un signal ; minuterie détachée (n'empêche pas le processus de s'arrêter). */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
  })
}

export function createJobRunner<J>(options: JobRunnerOptions<J>): JobRunner {
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  const sleep = options.sleep ?? abortableSleep
  const now = options.now ?? Date.now
  const pollMs = options.pollMs ?? JOB_POLL_MS
  const maintenanceMs = options.maintenanceMs ?? DEFAULT_MAINTENANCE_MS
  const onError = options.onError ?? ((error: unknown) => console.error('[surge-media] Traitement des vidéos :', error))

  let state: JobRunnerState = 'idle'
  let loop: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  /** Réveil demandé (création de tâche, place libérée) : la prochaine attente est sautée. */
  let woken = false
  let wake: AbortController | null = null
  let lastMaintenance = Number.NEGATIVE_INFINITY
  const running = new Map<Promise<void>, AbortController>()

  function signalWake(): void {
    woken = true
    wake?.abort()
  }

  function launch(job: J): void {
    const controller = new AbortController()
    const task = (async () => {
      try {
        await options.execute(job, controller.signal)
      }
      catch (error) {
        onError(error)
        if (error instanceof RunnerHalt) void stop()
      }
    })()
    running.set(task, controller)
    void task.then(() => {
      running.delete(task)
      signalWake()
    })
  }

  async function maintain(): Promise<void> {
    if (!options.maintenance || now() - lastMaintenance < maintenanceMs) return
    lastMaintenance = now()
    try {
      await options.maintenance()
    }
    catch (error) {
      onError(error)
    }
  }

  async function run(): Promise<void> {
    while (state === 'running') {
      await maintain()
      woken = false
      let failed = false
      while (state === 'running' && running.size < concurrency) {
        let job: J | null
        try {
          job = await options.claim()
        }
        catch (error) {
          // Base indisponible : nouvel essai au prochain tour, sans boucler.
          onError(error)
          failed = true
          break
        }
        if (job === null) break
        launch(job)
      }
      if (state !== 'running') break
      // Réveil arrivé pendant la recherche (tâche créée juste après la lecture) : nouvelle recherche.
      if (woken && !failed && running.size < concurrency) continue
      wake = new AbortController()
      if (woken) wake.abort()
      await sleep(pollMs, wake.signal)
      wake = null
    }
  }

  function start(): void {
    if (state !== 'idle') return
    state = 'running'
    loop = run().catch(onError)
  }

  function stop(): Promise<void> {
    if (stopping) return stopping
    if (state === 'idle') {
      state = 'stopped'
      stopping = Promise.resolve()
      return stopping
    }
    state = 'stopping'
    for (const controller of running.values()) controller.abort(new RunnerStopping())
    wake?.abort()
    stopping = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
        timer.unref?.()
      })
      await Promise.race([Promise.allSettled([loop, ...running.keys()]), timeout])
      clearTimeout(timer)
      state = 'stopped'
    })()
    return stopping
  }

  return {
    start,
    stop,
    notify: () => {
      if (state === 'running') signalWake()
    },
    get state() {
      return state
    },
    get active() {
      return running.size
    },
  }
}

// ─── Réveil depuis le service des médias (mode `embedded`) ───────────────────

let current: JobRunner | null = null

/** Boucle de ce processus (plugin 0.video-processing.ts), null quand elle est arrêtée. */
export function registerJobRunner(runner: JobRunner | null): void {
  current = runner
}

/**
 * Une tâche vient d'être créée (après validation de la transaction) : réveil de la boucle de ce
 * processus, s'il en a une. Sans effet sur un serveur web en mode `external` (les processus de travail
 * la trouvent à leur prochaine recherche, 5 s au plus).
 */
export function notifyJobQueued(): void {
  current?.notify()
}
