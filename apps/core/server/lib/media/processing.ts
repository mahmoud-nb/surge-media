import { availableParallelism } from 'node:os'

/**
 * Concurrence bornée des traitements de fichiers (sharp/libvips : analyse à l'envoi, génération des
 * dérivés), architecture § 9.2. Au plus `concurrency` traitements simultanés (≈ nombre de cœurs),
 * les suivants attendent dans une file de `queue` places ; file pleine → 503 SERVER_BUSY avec
 * Retry-After, plutôt qu'un serveur saturé en mémoire et en calcul. En mémoire du processus.
 *
 * `createSemaphore` est pur (testé dans tests/processing.test.ts).
 */

export class QueueFullError extends Error {
  constructor() {
    super('Processing queue is full')
    this.name = 'QueueFullError'
  }
}

export interface Semaphore {
  /** Exécute la tâche dès qu'une place se libère ; QueueFullError si la file d'attente est pleine. */
  run: <T>(task: () => Promise<T>) => Promise<T>
  readonly active: number
  readonly pending: number
}

export function createSemaphore(options: { concurrency: number, queue: number }): Semaphore {
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  let active = 0
  const waiting: (() => void)[] = []

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active++
      return
    }
    if (waiting.length >= options.queue) throw new QueueFullError()
    // La place est transmise directement par `release` (active inchangé).
    await new Promise<void>(resolve => waiting.push(resolve))
  }

  function release(): void {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return {
    async run(task) {
      await acquire()
      try {
        return await task()
      }
      finally {
        release()
      }
    },
    get active() {
      return active
    },
    get pending() {
      return waiting.length
    },
  }
}

/** Délai conseillé (Retry-After, secondes) quand la file est pleine. */
export const BUSY_RETRY_AFTER = 5

let processing: Semaphore | undefined

/** File des traitements, dimensionnée par NUXT_MEDIA_PROCESSING_CONCURRENCY (0 = nombre de cœurs) et _QUEUE. */
export function useMediaProcessing(): Semaphore {
  if (!processing) {
    const config = useRuntimeConfig().media.processing as { concurrency: number | string, queue: number | string }
    const concurrency = Number(config.concurrency) || availableParallelism()
    processing = createSemaphore({ concurrency, queue: Math.max(0, Number(config.queue) || 0) })
  }
  return processing
}

/** Traitement dans la file ; file pleine → erreur métier 503 SERVER_BUSY (`data.retryAfter`). */
export async function runProcessing<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await useMediaProcessing().run(task)
  }
  catch (error) {
    if (error instanceof QueueFullError) {
      throw createError({ statusCode: 503, statusMessage: 'SERVER_BUSY', data: { code: 'SERVER_BUSY', retryAfter: BUSY_RETRY_AFTER } })
    }
    throw error
  }
}
