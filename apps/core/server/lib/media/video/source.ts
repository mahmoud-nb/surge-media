import { open } from 'node:fs/promises'

/**
 * Lecture par positions d'un fichier vidéo (ou d'un tampon, dans les tests) : le lecteur d'en-têtes
 * ne lit que les quelques octets dont il a besoin, jamais le fichier entier (mémoire constante, même
 * pour 2 Gio). Bornes de sécurité : nombre de lectures et taille d'une lecture.
 */

export interface ByteSource {
  readonly size: number
  /** Octets [offset, offset + length), moins si la fin est atteinte. */
  read: (offset: number, length: number) => Promise<Buffer>
}

/** Lecture refusée : fichier illisible (structure incohérente, bornes dépassées) ou sans piste vidéo. */
export class VideoProbeError extends Error {
  constructor(readonly reason: 'unreadable' | 'no-video', detail: string) {
    super(detail)
    this.name = 'VideoProbeError'
  }
}

export function unreadable(detail: string): VideoProbeError {
  return new VideoProbeError('unreadable', detail)
}

/** Lectures au plus par fichier (un fichier hostile ne fait pas boucler l'analyse). */
const MAX_READS = 20_000
/** Taille maximale d'une lecture (boîtes ou éléments lus en entier : `stsd`, `udta`, `CodecPrivate`…). */
export const MAX_READ_LENGTH = 1024 * 1024

/** Source bornée (nombre et taille des lectures) au-dessus d'une fonction de lecture. */
export function guardedSource(size: number, read: (offset: number, length: number) => Promise<Buffer>): ByteSource {
  let reads = 0
  return {
    size,
    async read(offset, length) {
      if (++reads > MAX_READS) throw unreadable('Too many structures to read.')
      if (length > MAX_READ_LENGTH) throw unreadable('Header structure too large.')
      if (offset < 0 || offset >= size || length <= 0) return Buffer.alloc(0)
      return read(offset, Math.min(length, size - offset))
    },
  }
}

export function bufferSource(buffer: Buffer): ByteSource {
  return guardedSource(buffer.length, async (offset, length) => buffer.subarray(offset, offset + length))
}

/** Ouvre un fichier en lecture le temps de `task`. */
export async function withFileSource<T>(path: string, task: (source: ByteSource) => Promise<T>): Promise<T> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    return await task(guardedSource(size, async (offset, length) => {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    }))
  }
  finally {
    await handle.close()
  }
}
