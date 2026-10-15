import type { SurgeClient } from './client'
import { isSurgeApiError } from './errors'
import type { Media } from './types'

/** Le serveur prépare-t-il encore cette vidéo (tâche en attente ou en cours) ? */
export function isProcessing(media: Pick<Media, 'processing'>): boolean {
  const status = media.processing?.status
  return status === 'pending' || status === 'processing'
}

export interface WatchMediaOptions {
  /** Intervalle entre deux relectures (5 s par défaut ; relecture légère grâce à l'ETag). */
  intervalMs?: number
  signal?: AbortSignal
  /** Média relu, appelé seulement s'il a changé (version, état, avancement, URL). */
  onUpdate: (media: Media) => void
  /** Erreur qui arrête le suivi (média introuvable, accès refusé) ; les erreurs passagères sont réessayées. */
  onError?: (error: unknown) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** Attend que l'onglet redevienne visible (immédiat hors navigateur ou onglet visible). */
function visible(signal?: AbortSignal): Promise<void> {
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    function done() {
      if (document.hidden && !signal?.aborted) return
      document.removeEventListener('visibilitychange', done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    document.addEventListener('visibilitychange', done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function fingerprint(media: Media): string {
  return JSON.stringify([media.version, media.updatedAt, media.processing, media.sources.map(source => source.url), media.poster?.url ?? null])
}

/**
 * Suit le traitement d'une vidéo : relit le média toutes les `intervalMs` (onglet visible seulement) tant
 * qu'il est en attente ou en cours, et appelle `onUpdate` à chaque changement. S'arrête quand le
 * traitement est terminé (prêt ou échec), sur `signal`, ou sur une erreur définitive (403, 404).
 */
export async function watchMedia(client: SurgeClient, media: Media, options: WatchMediaOptions): Promise<void> {
  const interval = options.intervalMs ?? 5000
  let last = fingerprint(media)
  let current = media
  let delay = interval
  while (isProcessing(current) && !options.signal?.aborted) {
    await sleep(delay, options.signal)
    await visible(options.signal)
    if (options.signal?.aborted) return
    try {
      const next = await client.media.get(current.id, { signal: options.signal })
      delay = interval
      const print = fingerprint(next)
      current = next
      if (print !== last) {
        last = print
        options.onUpdate(next)
      }
    }
    catch (error) {
      if (options.signal?.aborted) return
      if (isSurgeApiError(error) && [401, 403, 404].includes(error.status) && error.code !== 'TOKEN_EXPIRED') {
        options.onError?.(error)
        return
      }
      // Erreur passagère (réseau, serveur occupé) : nouvel essai, au plus toutes les minutes.
      delay = Math.min(60_000, Math.max(interval, (isSurgeApiError(error) ? error.retryAfter ?? 0 : 0) * 1000, delay * 2))
    }
  }
}
