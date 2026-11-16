import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ManifestRow } from './manifest'

/**
 * Sources d'un import : chaque ligne du manifeste devient un fichier local, lu deux fois (empreinte et
 * type, puis envoi) sans jamais être chargé en mémoire. Un fichier du disque est lu sur place ; une URL
 * est téléchargée dans un dossier temporaire, supprimé après l'envoi.
 *
 * L'outil tourne chez l'exploitant, qui choisit ses sources : pas d'enjeu SSRF côté serveur. Les
 * garde-fous protègent l'exploitant de son propre manifeste : un chemin ne sort jamais de la racine
 * (ni par `..`, ni par un lien symbolique), une URL ne quitte pas `http(s)`, un téléchargement est borné
 * en taille, en redirections et en silence.
 */

/**
 * Codes d'un échec de lecture. Tous sont rejoués par une nouvelle exécution (`failed`) : ils se corrigent
 * hors de l'outil (fichier remis en place, manifeste ou racine corrigés, réseau revenu).
 */
export type SourceErrorCode
  = | 'SOURCE_NOT_FOUND'
    | 'SOURCE_OUTSIDE_ROOT'
    | 'SOURCE_NOT_A_FILE'
    | 'SOURCE_UNREADABLE'
    | 'SOURCE_EMPTY'
    | 'DOWNLOAD_FAILED'
    | 'DOWNLOAD_TOO_LARGE'
    | 'DOWNLOAD_TIMEOUT'
    | 'DOWNLOAD_REDIRECTS'

export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode, readonly detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'SourceError'
  }
}

export interface LocalFile {
  path: string
  size: number
  /** Nom de fichier à enregistrer (colonne `filename`, sinon dernier segment de la source). */
  filename: string
  /** Supprime la copie temporaire d'une source distante ; ne lève jamais. */
  cleanup: () => Promise<void>
}

export const DOWNLOAD_MAX_REDIRECTS = 5
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

/**
 * Chemin réel d'une source du disque. Relatif à `root` (un chemin absolu n'est accepté que s'il s'y
 * trouve) ; refusé s'il en sort, y compris par un lien symbolique, ou s'il n'est pas un fichier ordinaire.
 */
export async function resolveFileSource(root: string, source: string): Promise<{ path: string, size: number }> {
  const base = resolve(root)
  const target = resolve(base, source)
  if (!isInside(base, target)) throw new SourceError('SOURCE_OUTSIDE_ROOT')
  let real: string
  try {
    real = await realpath(target)
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new SourceError(code === 'ENOENT' || code === 'ENOTDIR' ? 'SOURCE_NOT_FOUND' : 'SOURCE_UNREADABLE', code ?? null)
  }
  if (!isInside(await realpath(base), real)) throw new SourceError('SOURCE_OUTSIDE_ROOT')
  const info = await stat(real)
  if (!info.isFile()) throw new SourceError('SOURCE_NOT_A_FILE')
  if (info.size === 0) throw new SourceError('SOURCE_EMPTY')
  return { path: real, size: info.size }
}

/** URL sans identifiants ni paramètres (une signature ou un jeton peuvent s'y trouver) : pour les messages. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  }
  catch {
    return '(invalid URL)'
  }
}

/** Nom de fichier tiré du chemin d'une URL (`…/2024/plage%20été.jpg` → `plage été.jpg`), `media` à défaut. */
export function filenameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''
    return decodeURIComponent(segment) || 'media'
  }
  catch {
    return 'media'
  }
}

export interface DownloadOptions {
  /** Taille au-delà de laquelle le téléchargement est arrêté (plus grande limite d'envoi du serveur). */
  maxBytes: number
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  idleTimeoutMs?: number
}

/**
 * Télécharge une URL dans `directory/file`. Redirections suivies à la main (`DOWNLOAD_MAX_REDIRECTS`,
 * `http(s)` seulement) ; arrêt au-delà de `maxBytes` (annoncé ou constaté) et après
 * `DOWNLOAD_IDLE_TIMEOUT_MS` sans donnée.
 */
export async function downloadSource(url: string, directory: string, options: DownloadOptions): Promise<{ path: string, size: number }> {
  const request = options.fetch ?? globalThis.fetch
  const idleMs = options.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS
  const idle = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, idle.signal]) : idle.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(), idleMs)
  }

  try {
    arm()
    let current = url
    let response: Response | undefined
    for (let hop = 0; hop <= DOWNLOAD_MAX_REDIRECTS; hop++) {
      if (!/^https?:$/.test(new URL(current).protocol)) throw new SourceError('DOWNLOAD_FAILED', 'unsupported protocol')
      response = await request(current, { redirect: 'manual', signal, headers: { accept: '*/*' } })
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      if (!location) break
      await response.body?.cancel()
      current = new URL(location, current).href
      response = undefined
      arm()
    }
    if (!response) throw new SourceError('DOWNLOAD_REDIRECTS', String(DOWNLOAD_MAX_REDIRECTS))
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new SourceError('DOWNLOAD_FAILED', `HTTP ${response.status}`)
    }
    const announced = Number(response.headers.get('content-length'))
    if (Number.isFinite(announced) && announced > options.maxBytes) {
      await response.body.cancel()
      throw new SourceError('DOWNLOAD_TOO_LARGE', String(options.maxBytes))
    }

    const path = join(directory, 'file')
    let size = 0
    const body = response.body
    await pipeline(
      async function* () {
        for await (const chunk of body) {
          size += chunk.byteLength
          if (size > options.maxBytes) throw new SourceError('DOWNLOAD_TOO_LARGE', String(options.maxBytes))
          arm()
          yield chunk
        }
      },
      createWriteStream(path),
    )
    if (size === 0) throw new SourceError('SOURCE_EMPTY')
    return { path, size }
  }
  catch (error) {
    if (error instanceof SourceError) throw error
    // Arrêt demandé par l'appelant (Ctrl+C) : l'erreur d'origine remonte telle quelle.
    if (options.signal?.aborted) throw error
    if (idle.signal.aborted) throw new SourceError('DOWNLOAD_TIMEOUT', String(Math.round(idleMs / 1000)))
    const cause = (error as { cause?: { code?: string } }).cause?.code
    throw new SourceError('DOWNLOAD_FAILED', cause ?? (error as Error).message)
  }
  finally {
    clearTimeout(timer)
  }
}

export interface OpenOptions extends DownloadOptions {
  /** Racine des chemins relatifs du manifeste. */
  root: string
  /**
   * Téléchargement d'une source `s3://` dans `path` (cli/lib/import/s3.ts) ; absent quand le manifeste n'en
   * contient pas — la commande refuse de démarrer sans lui s'il en contient.
   */
  s3?: (source: string, path: string, options: { maxBytes: number, signal?: AbortSignal }) => Promise<{ size: number }>
}

/** Fichier local d'une ligne du manifeste ; `cleanup()` à appeler dans tous les cas. */
export async function openSource(row: Pick<ManifestRow, 'source' | 'kind' | 'filename'>, options: OpenOptions): Promise<LocalFile> {
  if (row.kind === 'file') {
    const file = await resolveFileSource(options.root, row.source)
    return { ...file, filename: row.filename ?? basename(file.path), cleanup: async () => {} }
  }
  const directory = await mkdtemp(join(tmpdir(), 'surge-media-import-'))
  const cleanup = async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
  try {
    if (row.kind === 's3') {
      if (!options.s3) throw new SourceError('SOURCE_UNREADABLE', 's3 source not configured')
      const path = join(directory, 'file')
      const { size } = await options.s3(row.source, path, { maxBytes: options.maxBytes, signal: options.signal })
      // Dernier segment de la clé, tel quel : une clé n'est pas une URL (`%`, `?` et `#` y sont ordinaires).
      return { path, size, filename: row.filename ?? row.source.split('/').filter(Boolean).at(-1) ?? 'media', cleanup }
    }
    const file = await downloadSource(row.source, directory, options)
    return { ...file, filename: row.filename ?? filenameFromUrl(row.source), cleanup }
  }
  catch (error) {
    await cleanup()
    throw error
  }
}

/** Empreinte SHA-256 (hexadécimal minuscule) d'un fichier, lue en flux. */
export async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Fichier ordinaire, ni lien symbolique ni fichier spécial (parcours d'un dossier par `import plan`). */
export async function isRegularFile(path: string): Promise<boolean> {
  return (await lstat(path)).isFile()
}
