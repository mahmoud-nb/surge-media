import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import busboy from 'busboy'
import type { H3Event } from 'h3'
import { mediaKindForMime } from '#shared/utils/media'
import { mediaError } from './errors'
import { demoUploadGuard } from '../demo/quota'
import { largestSize, type UploadRules } from './limits'
import { detectMimeType, SNIFF_HEADER_BYTES } from './sniff'

/** Envoi abandonné si aucune donnée n'arrive pendant ce délai (connexion perdue sans fermeture). */
export const UPLOAD_IDLE_TIMEOUT_MS = 60_000

/** Marge accordée à l'enveloppe multipart (en-têtes des parties, champs texte) au-delà du fichier. */
const MULTIPART_OVERHEAD = 64 * 1024

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

/** Dossier temporaire d'un fichier reçu ; `cleanup` ne lève jamais. */
async function temporaryDirectory(): Promise<{ directory: string, cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'surge-media-upload-'))
  // Ne fait jamais échouer la requête : un fichier temporaire resté en place (verrou passager
  // sous Windows) est seulement signalé ; le système nettoie son dossier temporaire.
  const cleanup = () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((error: unknown) => console.warn(`[surge-media] Fichier temporaire non supprimé (${directory}) :`, error))
  return { directory, cleanup }
}

/**
 * Copie temporaire d'un fichier déjà stocké, présentée comme un fichier reçu (préparation d'une vidéo
 * envoyée avant la phase D2 : même chemin qu'un remplacement).
 */
export async function temporaryCopy(source: Readable, filename: string): Promise<ReceivedUpload> {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const path = join(directory, 'file')
    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    await pipeline(source, meter, createWriteStream(path))
    return { path, size, checksum: hash.digest('hex'), filename, fields: {}, cleanup }
  }
  catch (error) {
    await cleanup()
    throw error
  }
}

/**
 * Lit la suite d'un corps refusé sans l'écrire : la réponse part aussitôt et la connexion reste
 * utilisable (une connexion fermée avec des données non lues est souvent vue par le client comme une
 * erreur réseau, sans la réponse). Coupée au-delà de `maxBytes` ou après 60 s sans donnée.
 */
function drainRequest(request: IncomingMessage, maxBytes: number): void {
  // Corps déjà entièrement reçu (fichier refusé plus court que l'en-tête examiné) : rien à attendre. Un
  // minuteur armé ici ne serait jamais arrêté et couperait plus tard la connexion, réutilisée entre-temps.
  if (request.complete || request.readableEnded) {
    request.resume()
    return
  }
  let drained = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    clearTimeout(idle)
    request.off('data', onData)
  }
  const arm = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      stop()
      request.destroy()
    }, UPLOAD_IDLE_TIMEOUT_MS)
  }
  const onData = (chunk: Buffer) => {
    drained += chunk.length
    if (drained <= maxBytes) return arm()
    stop()
    request.destroy()
  }
  request.on('data', onData)
  request.once('end', stop)
  request.once('close', stop)
  request.resume()
  arm()
}

/**
 * Lit un envoi multipart/form-data en flux : un seul fichier (champ « file »), jamais chargé en
 * mémoire, empreinte SHA-256 calculée au fil de l'eau. Le type est reconnu dès les premiers octets du
 * fichier (`detectMimeType`) : type non accepté → 415 aussitôt ; autre genre que celui du média
 * remplacé → 422 KIND_MISMATCH ; puis la limite de taille du genre s'applique pendant la lecture
 * (413 FILE_TOO_LARGE, `data.maxSize`). Après un refus, rien n'est plus écrit (voir `drainRequest`).
 * Envoi arrêté après 60 s sans donnée reçue (408 UPLOAD_TIMEOUT). Le type MIME et le nom annoncés
 * par le client ne sont jamais utilisés pour la validation.
 */
export async function receiveUpload(event: H3Event, rules: UploadRules): Promise<ReceivedUpload> {
  const headers = event.node.req.headers
  if (!headers['content-type']?.toLowerCase().startsWith('multipart/form-data')) {
    throw mediaError(400, 'MULTIPART_REQUIRED')
  }
  // Aucun type admis (jeton délégué limité à des types que l'installation n'accepte pas en ce moment :
  // MKV sans traitement des vidéos actif) : tout fichier serait refusé, 415 d'emblée. Sans ce cas, la
  // plus grande limite vaudrait 0 et le même refus deviendrait un 413 FILE_TOO_LARGE « 0 octet ».
  if (rules.acceptedTypes.length === 0) throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted: [] })
  // Mode démo : volume du cycle épuisé → 429 DEMO_QUOTA avant de lire quoi que ce soit.
  demoUploadGuard()?.check(event)
  // Refus immédiat si la taille annoncée dépasse nettement la plus grande limite admise (type encore inconnu).
  const largest = largestSize(rules)
  const declared = Number(headers['content-length'])
  if (Number.isFinite(declared) && declared > largest + MULTIPART_OVERHEAD) {
    throw mediaError(413, 'FILE_TOO_LARGE', { maxSize: largest })
  }

  const { directory, cleanup } = await temporaryDirectory()

  try {
    return await new Promise<ReceivedUpload>((resolveUpload, rejectUpload) => {
      const request = event.node.req
      const parser = busboy({
        headers,
        defParamCharset: 'utf8',
        // Un octet de plus que la plus grande limite : le compteur ci-dessous refuse le premier.
        limits: { files: 1, fileSize: largest + 1, fields: 10, fieldSize: 4096, parts: 12 },
      })
      const fields: Record<string, string> = {}
      let file: Promise<Omit<ReceivedUpload, 'fields' | 'cleanup'>> | undefined
      let fileStream: Readable | undefined
      let tooLarge = false
      let settled = false

      // Inactivité : aucune donnée reçue pendant UPLOAD_IDLE_TIMEOUT_MS (réseau perdu sans fermeture) →
      // 408, connexion fermée ; le fichier temporaire est libéré sans attendre le délai global de Node.
      let idle: ReturnType<typeof setTimeout> | undefined
      const touch = () => {
        clearTimeout(idle)
        idle = setTimeout(() => {
          request.unpipe(parser)
          fileStream?.destroy()
          setResponseHeader(event, 'Connection', 'close')
          reject(mediaError(408, 'UPLOAD_TIMEOUT', { timeout: UPLOAD_IDLE_TIMEOUT_MS / 1000 }))
        }, UPLOAD_IDLE_TIMEOUT_MS)
      }
      const settle = () => {
        if (settled) return false
        settled = true
        clearTimeout(idle)
        request.off('data', touch)
        return true
      }
      const resolve = (upload: ReceivedUpload) => {
        if (settle()) resolveUpload(upload)
      }
      const reject = (error: unknown) => {
        if (settle()) rejectUpload(error)
      }
      /** Refus pendant la lecture du fichier : réponse immédiate, suite du corps vidangée. */
      const refuse = (error: Error) => {
        if (settled) return
        request.unpipe(parser)
        reject(error)
        drainRequest(request, largest + MULTIPART_OVERHEAD)
      }

      parser.on('file', (name, stream, info) => {
        if (name !== 'file' || file) {
          stream.resume()
          return
        }
        fileStream = stream
        const path = join(directory, 'upload')
        const hash = createHash('sha256')
        let size = 0
        // Limite du genre, connue dès les premiers octets (null : type pas encore reconnu).
        let limit: number | null = null
        const header: Buffer[] = []
        let headerLength = 0
        const decide = (): Error | null => {
          const mimeType = detectMimeType(Buffer.concat(header).subarray(0, SNIFF_HEADER_BYTES))
          header.length = 0
          if (!mimeType || !rules.acceptedTypes.includes(mimeType)) {
            return mediaError(415, 'UNSUPPORTED_TYPE', { accepted: [...rules.acceptedTypes] })
          }
          if (rules.expectedKind && mediaKindForMime(mimeType) !== rules.expectedKind) return mediaError(422, 'KIND_MISMATCH')
          limit = rules.maxSizeFor(mimeType)
          return null
        }
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length
            hash.update(chunk)
            if (limit === null) {
              header.push(chunk)
              headerLength += chunk.length
              const error = headerLength >= SNIFF_HEADER_BYTES ? decide() : null
              if (error) {
                refuse(error)
                return callback(error)
              }
            }
            if (limit !== null && size > limit) {
              const error = mediaError(413, 'FILE_TOO_LARGE', { maxSize: limit })
              refuse(error)
              return callback(error)
            }
            callback(null, chunk)
          },
          flush(callback) {
            // Fichier plus court que l'en-tête examiné (un fichier vide donne NO_FILE plus loin).
            const error = limit === null && size > 0 ? decide() : null
            if (error) refuse(error)
            callback(error)
          },
        })
        stream.on('limit', () => (tooLarge = true))
        file = pipeline(stream, meter, createWriteStream(path)).then(() => ({
          path,
          size,
          checksum: hash.digest('hex'),
          filename: sanitizeFilename(info.filename ?? ''),
        }))
        // Échec après un refus déjà rendu (type, taille, inactivité) : ne pas laisser de rejet non traité.
        file.catch(() => {})
      })
      parser.on('field', (name, value) => {
        fields[name] = value
      })
      parser.on('error', reject)
      request.once('aborted', () => reject(createError({ statusCode: 400, statusMessage: 'Upload aborted' })))
      parser.on('close', () => {
        if (!file) return reject(mediaError(400, 'NO_FILE'))
        file.then((received) => {
          if (tooLarge) return reject(mediaError(413, 'FILE_TOO_LARGE', { maxSize: largest }))
          if (received.size === 0) return reject(mediaError(400, 'NO_FILE'))
          demoUploadGuard()?.record(event, received.size)
          resolve({ ...received, fields, cleanup })
        }, reject)
      })
      request.pipe(parser)
      request.on('data', touch)
      touch()
    })
  }
  catch (error) {
    await cleanup()
    throw error
  }
}

/** Petit fichier reçu en mémoire (piste de sous-titres) : contenu, nom indicatif, champs du formulaire. */
export interface ReceivedSmallFile {
  data: Buffer
  filename: string
  fields: Record<string, string>
}

/**
 * Reçoit un petit fichier en mémoire (multipart, champ « file », `maxSize` octets au plus : 413
 * FILE_TOO_LARGE), sans fichier temporaire ni reconnaissance du type : le contenu est analysé ensuite
 * (pistes de texte, text-track.ts). Même délai d'inactivité que les envois (408 UPLOAD_TIMEOUT).
 */
export async function receiveSmallUpload(event: H3Event, maxSize: number): Promise<ReceivedSmallFile> {
  const headers = event.node.req.headers
  if (!headers['content-type']?.toLowerCase().startsWith('multipart/form-data')) {
    throw mediaError(400, 'MULTIPART_REQUIRED')
  }
  const declared = Number(headers['content-length'])
  if (Number.isFinite(declared) && declared > maxSize + MULTIPART_OVERHEAD) {
    throw mediaError(413, 'FILE_TOO_LARGE', { maxSize })
  }

  const request = event.node.req
  return new Promise<ReceivedSmallFile>((resolve, reject) => {
    const parser = busboy({ headers, defParamCharset: 'utf8', limits: { files: 1, fileSize: maxSize, fields: 10, fieldSize: 4096, parts: 12 } })
    const fields: Record<string, string> = {}
    const chunks: Buffer[] = []
    let filename: string | null = null
    let tooLarge = false
    let settled = false
    let idle: ReturnType<typeof setTimeout> | undefined
    const finish = (error: unknown, value?: ReceivedSmallFile) => {
      if (settled) return
      settled = true
      clearTimeout(idle)
      request.off('data', touch)
      if (error) {
        request.unpipe(parser)
        drainRequest(request, maxSize + MULTIPART_OVERHEAD)
        reject(error)
      }
      else resolve(value!)
    }
    const touch = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        setResponseHeader(event, 'Connection', 'close')
        finish(mediaError(408, 'UPLOAD_TIMEOUT', { timeout: UPLOAD_IDLE_TIMEOUT_MS / 1000 }))
      }, UPLOAD_IDLE_TIMEOUT_MS)
    }

    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || filename !== null) {
        stream.resume()
        return
      }
      filename = sanitizeFilename(info.filename ?? '')
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('limit', () => {
        tooLarge = true
        finish(mediaError(413, 'FILE_TOO_LARGE', { maxSize }))
      })
    })
    parser.on('field', (name, value) => {
      fields[name] = value
    })
    parser.on('error', error => finish(error))
    parser.on('close', () => {
      if (tooLarge) return
      const data = Buffer.concat(chunks)
      if (filename === null || data.length === 0) return finish(mediaError(400, 'NO_FILE'))
      finish(null, { data, filename, fields })
    })
    request.once('aborted', () => finish(createError({ statusCode: 400, statusMessage: 'Upload aborted' })))
    request.pipe(parser)
    request.on('data', touch)
    touch()
  })
}
