import type { Readable } from 'node:stream'

/**
 * Lecture bornée du corps des requêtes (JSON, formulaires) : taille maximale et délai de lecture.
 *
 * h3 1.15 (`readRawBody`) accumule tout le corps en mémoire, sans limite ni délai : une route publique
 * (`POST /api/auth/login`) pouvait recevoir un corps de n'importe quelle taille, et un corps envoyé
 * goutte à goutte n'était coupé qu'au bout des 300 s de Node (`requestTimeout`). Le middleware
 * `body-limit` confie la lecture à cette fonction ; les envois de fichiers (multipart) ne passent
 * jamais par là : ils sont lus en flux par `receiveUpload`, avec leurs propres limites.
 */

/** Taille maximale d'un corps lu en mémoire (octets) : les corps de l'administration et de l'API v1 font quelques Kio. */
export const BODY_MAX_SIZE = 1024 * 1024

/** Délai pour recevoir un corps entier, à partir du moment où la route le lit (≥ 35 Kio/s pour 1 Mio). */
export const BODY_READ_TIMEOUT_MS = 30_000

/** Corps refusé : trop volumineux (413) ou trop lent (408). */
export class BodyReadError extends Error {
  constructor(readonly reason: 'too_large' | 'timeout') {
    super(reason === 'too_large' ? 'Request body too large' : 'Request body timeout')
    this.name = 'BodyReadError'
  }
}

export interface BodyReadOptions {
  maxBytes: number
  timeoutMs: number
  /** Taille annoncée (`Content-Length`) : refus immédiat si elle dépasse la limite. */
  declaredLength?: number
}

/**
 * Lit tout le flux en mémoire, sans dépasser `maxBytes` ni `timeoutMs`. En cas de refus, la lecture
 * s'arrête (flux mis en pause) : le reste du corps n'est jamais chargé. Fonction pure, testée.
 */
export function readLimitedBody(source: Readable, options: BodyReadOptions): Promise<Buffer> {
  if (options.declaredLength !== undefined && options.declaredLength > options.maxBytes) {
    return Promise.reject(new BodyReadError('too_large'))
  }
  // Client déjà parti, ou corps déjà lu par ailleurs : rien n'arrivera plus.
  if (source.destroyed || source.readableEnded) return Promise.reject(new Error('Request body unavailable'))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    const finish = (error?: Error) => {
      clearTimeout(timer)
      source.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose)
      if (!error) return resolve(Buffer.concat(chunks, size))
      source.pause()
      reject(error)
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > options.maxBytes) return finish(new BodyReadError('too_large'))
      chunks.push(buffer)
    }
    const onEnd = () => finish()
    const onError = (error: Error) => finish(error)
    // Fermé avant la fin (client parti) : aucune donnée partielle n'est rendue.
    const onClose = () => finish(new Error('Request aborted'))
    const timer = setTimeout(() => finish(new BodyReadError('timeout')), options.timeoutMs)

    source.on('data', onData).once('end', onEnd).once('error', onError).once('close', onClose)
  })
}
