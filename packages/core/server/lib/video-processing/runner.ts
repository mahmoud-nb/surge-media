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
 * Une prise encore en cours au moment de l'arrêt peut se terminer après lui : la tâche, déjà à ce
 * processus en base, est lancée avec un signal d'arrêt déjà déclenché, donc rendue aussitôt, et l'arrêt
 * l'attend aussi. `stop` attend tout cela, au plus `stopTimeoutMs` (le délai d'arrêt de Nitro est de
 * 30 s), et ne rejette jamais : une erreur dans un crochet `close` empêcherait les suivants (déconnexion
 * de Prisma).
 *
 * Le superviseur (`superviseJobRunner`) démarre la boucle quand ffmpeg est utilisable, retente un
 * démarrage qui échoue (base indisponible au lancement) et, après un arrêt `RunnerHalt` (ffmpeg devenu
 * introuvable), refait la détection jusqu'à pouvoir relancer une boucle : un processus ne reste jamais
 * « actif » sans rien exécuter.
 *
 * Tout est injecté (prise, exécution, attente, horloge, minuteries) : boucle et superviseur sont testés
 * sans base ni ffmpeg (tests/video-queue.test.ts).
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
  /** Une exécution a levé `RunnerHalt` : la boucle s'arrête (appelé une fois, superviseur). */
  onHalt?: (error: RunnerHalt) => void
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
  let halted = false
  /** Tâches en cours : promesse résolue une fois la tâche retirée de la table (attendue par `stop`). */
  const running = new Map<Promise<void>, AbortController>()

  function signalWake(): void {
    woken = true
    wake?.abort()
  }

  function halt(error: RunnerHalt): void {
    if (halted) return
    halted = true
    void stop()
    options.onHalt?.(error)
  }

  function launch(job: J): void {
    const controller = new AbortController()
    // Prise terminée après le début de l'arrêt : la tâche est déjà à ce processus en base ; un signal déjà
    // déclenché la fait rendre à la file aussitôt, sans calcul (jamais laissée « en cours » jusqu'au bail).
    if (state !== 'running') controller.abort(new RunnerStopping())
    const task = (async () => {
      try {
        await options.execute(job, controller.signal)
      }
      catch (error) {
        onError(error)
        if (error instanceof RunnerHalt) halt(error)
      }
    })()
    const settled: Promise<void> = task.then(() => {
      running.delete(settled)
      signalWake()
    })
    running.set(settled, controller)
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
      // La boucle d'abord (une prise en cours peut encore lancer une tâche), puis toutes les tâches, y
      // compris celles lancées après l'appel : la table est relue jusqu'à être vide.
      const drained = (async () => {
        await loop
        while (running.size > 0) await Promise.allSettled([...running.keys()])
      })()
      await Promise.race([drained, timeout])
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

// ─── Superviseur : démarrage, nouvel essai, reprise après un arrêt ───────────

/**
 * État du traitement dans ce processus :
 *   - `starting` : démarrage en cours (ou nouvel essai différé après un échec passager) ;
 *   - `running` : boucle active ;
 *   - `halted` : boucle arrêtée par `RunnerHalt` (ffmpeg devenu inutilisable), détection refaite
 *     régulièrement, boucle relancée dès que ffmpeg est de nouveau utilisable ;
 *   - `disabled` : ffmpeg inutilisable au démarrage, ou stockage non partagé (processus de travail) —
 *     réglage à corriger, puis redémarrage (§ 30.1) ;
 *   - `stopped` : arrêt du processus.
 */
export type SupervisorState = 'idle' | 'starting' | 'running' | 'halted' | 'disabled' | 'stopped'

export interface RunnerSupervisorOptions {
  /** ffmpeg utilisable ? `recovering` : après un arrêt, la détection doit être refaite (cache oublié). */
  detect: (recovering: boolean) => Promise<boolean>
  /** Avant chaque démarrage de la boucle (stockage partagé, présence) : false = ne pas démarrer ; lève = nouvel essai différé. */
  prepare: () => Promise<boolean>
  /** Nouvelle boucle ; `onHalt` doit lui être transmis (option de `createJobRunner`). */
  createRunner: (onHalt: (error: RunnerHalt) => void) => JobRunner
  /** Changement d'état (journal, présence, état du traitement vu par ce processus) ; `runner` : la boucle active. */
  onState?: (state: SupervisorState, runner: JobRunner | null) => void
  onError?: (error: unknown) => void
  /** Premier délai avant un nouvel essai de démarrage, doublé à chaque échec jusqu'à `retryMaxMs`. */
  retryMs?: number
  retryMaxMs?: number
  /** Délai entre deux détections après un arrêt. */
  recoveryMs?: number
  /** Attente maximale d'un démarrage en cours quand l'arrêt arrive. */
  stopWaitMs?: number
  /** Minuteries (tests). */
  setTimer?: (task: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export interface RunnerSupervisor {
  start: () => void
  /** Arrête la boucle et tout nouvel essai ; résout toujours. */
  stop: () => Promise<void>
  readonly state: SupervisorState
}

const DEFAULT_RETRY_MS = 5_000
const DEFAULT_RETRY_MAX_MS = 60_000
const DEFAULT_RECOVERY_MS = 60_000
const DEFAULT_STOP_WAIT_MS = 5_000

export function superviseJobRunner(options: RunnerSupervisorOptions): RunnerSupervisor {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS
  const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
  const recoveryMs = options.recoveryMs ?? DEFAULT_RECOVERY_MS
  const onError = options.onError ?? ((error: unknown) => console.error('[surge-media] Traitement des vidéos :', error))
  const setTimer = options.setTimer ?? ((task: () => void, ms: number) => {
    const timer = setTimeout(task, ms)
    timer.unref?.()
    return timer
  })
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  let state: SupervisorState = 'idle'
  let stopRequested = false
  let runner: JobRunner | null = null
  let timer: unknown = null
  /** Tentative de démarrage en cours (attendue, bornée, par `stop`). */
  let attempting: Promise<void> | null = null

  function setState(next: SupervisorState): void {
    state = next
    options.onState?.(next, next === 'running' ? runner : null)
  }

  function schedule(ms: number, recovering: boolean, retry: number): void {
    timer = setTimer(() => {
      timer = null
      launchAttempt(recovering, retry)
    }, ms)
  }

  function launchAttempt(recovering: boolean, retry: number): void {
    if (stopRequested) return
    attempting = attempt(recovering, retry)
      .catch(onError)
      .finally(() => {
        attempting = null
      })
  }

  async function attempt(recovering: boolean, retry: number): Promise<void> {
    const usable = await options.detect(recovering).catch(() => false)
    if (stopRequested) return
    if (!usable) {
      // Au démarrage : réglage à corriger (message déjà donné). Après un arrêt : nouvelle détection plus tard.
      if (recovering) schedule(recoveryMs, true, 0)
      else setState('disabled')
      return
    }
    try {
      if (!await options.prepare()) {
        if (!stopRequested) setState('disabled')
        return
      }
    }
    catch (error) {
      // Base ou stockage indisponibles au lancement : nouvel essai, de plus en plus espacé.
      onError(error)
      if (!stopRequested) schedule(Math.min(retryMaxMs, retryMs * 2 ** retry), recovering, retry + 1)
      return
    }
    // Boucle arrêtée par RunnerHalt : ses tâches sont rendues avant qu'une nouvelle boucle en prenne.
    await runner?.stop()
    if (stopRequested) return
    const next: JobRunner = options.createRunner(() => halted(next))
    runner = next
    next.start()
    setState('running')
  }

  function halted(source: JobRunner): void {
    if (source !== runner || state !== 'running' || stopRequested) return
    setState('halted')
    schedule(recoveryMs, true, 0)
  }

  return {
    start() {
      if (state !== 'idle') return
      setState('starting')
      launchAttempt(false, 0)
    },
    async stop() {
      if (stopRequested) return
      stopRequested = true
      if (timer !== null) clearTimer(timer)
      timer = null
      if (attempting) {
        let wait: ReturnType<typeof setTimeout> | undefined
        await Promise.race([attempting, new Promise((resolve) => {
          wait = setTimeout(resolve, options.stopWaitMs ?? DEFAULT_STOP_WAIT_MS)
          wait.unref?.()
        })])
        clearTimeout(wait)
      }
      await runner?.stop().catch(() => {})
      setState('stopped')
    },
    get state() {
      return state
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
