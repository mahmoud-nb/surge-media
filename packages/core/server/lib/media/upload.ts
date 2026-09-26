import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import busboy from 'busboy'
import type { H3Event } from 'h3'
import { mediaError } from './errors'

/** Fichier reçu, écrit dans un dossier temporaire (à supprimer avec `cleanup`). */
export interface ReceivedUpload {
  path: string
  size: number
  /** Empreinte SHA-256 (hexadécimal), calculée pendant la réception. */
  checksum: string
  /** Nom fourni par le client : simple métadonnée, jamais utilisé comme chemin. */
  filename: string
  /** Champs texte du formulaire (title, altText, visibility…). */
  fields: Record<string, string>
  cleanup: () => Promise<void>
}

/** Nom affichable : sans chemin ni caractères de contrôle, normalisé (NFC), 191 caractères maximum. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (clean.length <= 191) return clean || 'media'
  const dot = clean.lastIndexOf('.')
  const extension = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ''
  return clean.slice(0, 191 - extension.length) + extension
}

/**
 * Lit un envoi multipart/form-data en flux : un seul fichier (champ « file »), taille plafonnée
 * pendant la lecture (413 sans jamais charger le fichier en mémoire), empreinte SHA-256
 * calculée au fil de l'eau. Le type MIME et le nom annoncés par le client ne sont pas utilisés
 * pour la validation.
 */
export async function receiveUpload(event: H3Event, maxSize: number): Promise<ReceivedUpload> {
  const headers = event.node.req.headers
  if (!headers['content-type']?.toLowerCase().startsWith('multipart/form-data')) {
    throw mediaError(400, 'MULTIPART_REQUIRED')
  }
  // Refus immédiat si la taille annoncée dépasse nettement la limite (marge pour l'enveloppe multipart).
  const declared = Number(headers['content-length'])
  if (Number.isFinite(declared) && declared > maxSize + 64 * 1024) {
    throw mediaError(413, 'FILE_TOO_LARGE', { maxSize })
  }

  const directory = await mkdtemp(join(tmpdir(), 'surge-media-upload-'))
  // Ne fait jamais échouer la requête : un fichier temporaire resté en place (verrou passager
  // sous Windows) est seulement signalé ; le système nettoie son dossier temporaire.
  const cleanup = () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((error: unknown) => console.warn(`[surge-media] Fichier temporaire non supprimé (${directory}) :`, error))

  try {
    return await new Promise<ReceivedUpload>((resolve, reject) => {
      const parser = busboy({
        headers,
        defParamCharset: 'utf8',
        limits: { files: 1, fileSize: maxSize, fields: 10, fieldSize: 4096, parts: 12 },
      })
      const fields: Record<string, string> = {}
      let file: Promise<Omit<ReceivedUpload, 'fields' | 'cleanup'>> | undefined
      let tooLarge = false

      parser.on('file', (name, stream, info) => {
        if (name !== 'file' || file) {
          stream.resume()
          return
        }
        const path = join(directory, 'upload')
        const hash = createHash('sha256')
        let size = 0
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length
            hash.update(chunk)
            callback(null, chunk)
          },
        })
        stream.on('limit', () => (tooLarge = true))
        file = pipeline(stream, meter, createWriteStream(path)).then(() => ({
          path,
          size,
          checksum: hash.digest('hex'),
          filename: sanitizeFilename(info.filename ?? ''),
        }))
      })
      parser.on('field', (name, value) => {
        fields[name] = value
      })
      parser.on('error', reject)
      event.node.req.once('aborted', () => reject(createError({ statusCode: 400, statusMessage: 'Upload aborted' })))
      parser.on('close', () => {
        if (!file) return reject(mediaError(400, 'NO_FILE'))
        file.then((received) => {
          if (tooLarge) return reject(mediaError(413, 'FILE_TOO_LARGE', { maxSize }))
          if (received.size === 0) return reject(mediaError(400, 'NO_FILE'))
          resolve({ ...received, fields, cleanup })
        }, reject)
      })
      event.node.req.pipe(parser)
    })
  }
  catch (error) {
    await cleanup()
    throw error
  }
}
