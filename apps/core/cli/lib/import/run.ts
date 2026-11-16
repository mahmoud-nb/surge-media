import { sniffMimeType } from '../../../server/lib/media/sniff'
import { ApiError, type ApiClient, type ApiFolder, type ApiMedia, isFatalApiError, permanentUrl, type UploadTypeRule } from './api'
import type { ManifestRow } from './manifest'
import { fileChecksum, type LocalFile, type OpenOptions, openSource, SourceError } from './sources'
import { FINAL_STATUSES, type ImportEntry, type ImportStatus } from './state'

/**
 * Déroulé d'un import (.claude/architecture-import.md, IM5 à IM10) : dossiers et étiquettes préparés, puis
 * une file bornée traite les lignes du manifeste. Chaque ligne : lire la source, reconnaître son type,
 * chercher sa référence sur le serveur (import relancé), dédoublonner par empreinte, envoyer. Le résultat
 * de chaque ligne est rendu à l'appelant aussitôt (écrit dans l'état) : rien n'est gardé pour la fin.
 */

type Client = Pick<ApiClient, 'findBySourceRef' | 'findByChecksum' | 'upload' | 'media'>
type FolderClient = Pick<ApiClient, 'folders' | 'createFolder'>
type TagClient = Pick<ApiClient, 'tags' | 'createTag'>

/** Refus du serveur qu'un nouvel essai ne changera pas : le fichier lui-même ne convient pas. */
const REJECTION_CODES = new Set(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'UNREADABLE_FILE', 'DIMENSIONS_TOO_LARGE', 'INVALID_REQUEST', 'NO_FILE'])

/** Clé d'un chemin de dossier : le serveur tient deux noms frères pour identiques sans la casse. */
export function folderKey(segments: readonly string[]): string {
  return segments.map(segment => segment.toLowerCase()).join('/')
}

export interface PreparedFolders {
  /** Identifiant du dossier de chaque chemin connu (`folderKey`). */
  ids: Map<string, string>
  /** Chemins absents du projet (non créés : option absente, ou essai à blanc). */
  missing: string[]
  /** Dossiers qu'il faudrait créer pour ces chemins, parents compris (plus que `missing` : un par niveau absent). */
  toCreate: number
  created: number
}

/**
 * Dossiers du projet demandés par le manifeste. `create` : les chemins absents sont créés, parent avant
 * enfant, l'un après l'autre (jamais deux créations du même nom en parallèle).
 */
export async function prepareFolders(client: FolderClient, projectId: string, rows: readonly Pick<ManifestRow, 'folder'>[], create: boolean): Promise<PreparedFolders> {
  const paths = new Map<string, string[]>()
  for (const row of rows) if (row.folder.length > 0) paths.set(folderKey(row.folder), row.folder)
  const result: PreparedFolders = { ids: new Map(), missing: [], toCreate: 0, created: 0 }
  if (paths.size === 0) return result
  const absent = new Set<string>()

  const children = new Map<string, ApiFolder>()
  const childKey = (parentId: string | null, name: string) => `${parentId ?? ''}/${name.normalize('NFC').toLowerCase()}`
  for (const folder of await client.folders(projectId)) children.set(childKey(folder.parentId, folder.name), folder)

  // Chemins courts d'abord : un parent existe avant ses enfants.
  for (const segments of [...paths.values()].sort((a, b) => a.length - b.length)) {
    let parentId: string | null = null
    let found = true
    for (const [depth, name] of segments.entries()) {
      let folder = children.get(childKey(parentId, name))
      if (!folder && create) {
        folder = await client.createFolder(projectId, name, parentId)
        children.set(childKey(parentId, name), folder)
        result.created++
      }
      if (!folder) {
        // Ce niveau et tous ceux d'en dessous manquent.
        for (let level = depth; level < segments.length; level++) absent.add(folderKey(segments.slice(0, level + 1)))
        found = false
        break
      }
      parentId = folder.id
    }
    if (found && parentId) result.ids.set(folderKey(segments), parentId)
    else result.missing.push(segments.join('/'))
  }
  result.toCreate = absent.size
  return result
}

export interface PreparedTags {
  missing: string[]
  created: number
}

/** Étiquettes (slugs) demandées par le manifeste ; `create` : les absentes sont créées, nommées d'après leur slug. */
export async function prepareTags(client: TagClient, projectId: string, rows: readonly Pick<ManifestRow, 'tags'>[], create: boolean): Promise<PreparedTags> {
  const wanted = new Set(rows.flatMap(row => row.tags))
  const result: PreparedTags = { missing: [], created: 0 }
  if (wanted.size === 0) return result
  const known = new Set((await client.tags(projectId)).map(tag => tag.slug))
  for (const slug of [...wanted].sort()) {
    if (known.has(slug)) continue
    if (create) {
      await client.createTag(projectId, slug)
      result.created++
    }
    else {
      result.missing.push(slug)
    }
  }
  return result
}

/** URL de diffusion sur le domaine public choisi (`--public-url`) : le chemin `/m/…` est gardé tel quel. */
export function withPublicUrl(url: string, publicUrl: string | null): string {
  if (!publicUrl) return url
  const path = new URL(url).pathname
  const index = path.indexOf('/m/')
  return `${publicUrl.replace(/\/+$/, '')}${index === -1 ? path : path.slice(index)}`
}

export interface RunOptions {
  rows: readonly ManifestRow[]
  /** Résultats déjà connus (état relu) : complétés au fil de l'eau. */
  entries: Map<string, ImportEntry>
  client: Client
  projectId: string
  /** Types acceptés par le serveur en ce moment, avec leur taille maximale (`GET /me`). */
  rules: readonly UploadTypeRule[]
  /** Racine des chemins relatifs du manifeste. */
  root: string
  folderIds: ReadonlyMap<string, string>
  concurrency: number
  dedupe: boolean
  /** Essai à blanc : tout sauf l'envoi ; un fichier à envoyer est rendu `created` sans identifiant. */
  dryRun: boolean
  retryRejected: boolean
  defaultVisibility: 'public' | 'private' | null
  publicUrl: string | null
  /** Arrêt immédiat (second Ctrl+C) : coupe les requêtes en cours. */
  signal?: AbortSignal
  /** Arrêt propre (premier Ctrl+C) : plus aucune nouvelle ligne, les envois en cours se terminent. */
  shouldStop?: () => boolean
  onResult?: (row: ManifestRow, entry: ImportEntry) => void
  /** Téléchargement des sources `s3://` ; requis si le manifeste en contient. */
  s3?: OpenOptions['s3']
  /** Lecture des sources (remplaçable dans les tests). */
  open?: (row: ManifestRow) => Promise<LocalFile>
  now?: () => Date
}

export interface RunOutcome {
  /** Lignes traitées pendant cette exécution. */
  processed: number
  /** Arrêt demandé avant la fin. */
  interrupted: boolean
  /** Erreur qui a arrêté tout l'import (identifiant refusé, projet inaccessible…). */
  fatal: ApiError | null
}

/** Lignes qu'une exécution doit traiter : jamais vues, en échec, ou refusées si on le redemande. */
export function pendingRows(rows: readonly ManifestRow[], entries: ReadonlyMap<string, ImportEntry>, retryRejected: boolean): ManifestRow[] {
  return rows.filter((row) => {
    const status = entries.get(row.ref)?.status
    if (!status) return true
    if (status === 'rejected') return retryRejected
    return !FINAL_STATUSES.includes(status)
  })
}

/** Média trouvé ou créé, tel que le garde le dédoublonnage ; `id` null pendant un essai à blanc. */
interface KnownMedia {
  id: string | null
  version: number | null
  url: string | null
}

export async function runImport(options: RunOptions): Promise<RunOutcome> {
  const { client, projectId, entries } = options
  const now = options.now ?? (() => new Date())
  const maxBytes = Math.max(0, ...options.rules.map(rule => rule.maxSize))
  const open = options.open ?? ((row: ManifestRow) => openSource(row, { root: options.root, maxBytes, signal: options.signal, s3: options.s3 }))
  /** Empreinte → envoi en cours ou terminé de ce contenu (null : il a échoué, le suivant tente sa chance). */
  const byChecksum = new Map<string, Promise<KnownMedia | null>>()
  const outcome: RunOutcome = { processed: 0, interrupted: false, fatal: null }

  const known = (media: ApiMedia): KnownMedia => ({ id: media.id, version: media.version, url: withPublicUrl(permanentUrl(media.url), options.publicUrl) })
  const entry = (row: ManifestRow, status: ImportStatus, media: KnownMedia | null, code: string | null = null, detail: string | null = null): ImportEntry => ({
    ref: row.ref,
    source: row.source,
    status,
    mediaId: media?.id ?? null,
    version: media?.version ?? null,
    url: media?.url ?? null,
    code,
    detail,
    at: now().toISOString(),
  })

  async function processRow(row: ManifestRow): Promise<ImportEntry> {
    let file: LocalFile
    /** Rend le résultat de ce contenu aux lignes qui l'attendent ; un second appel est sans effet. */
    const waiting: { settle?: (media: KnownMedia | null) => void } = {}
    try {
      file = await open(row)
    }
    catch (error) {
      if (!(error instanceof SourceError)) throw error
      // Plus gros que la plus grande limite du serveur : aucun type ne l'accepterait.
      if (error.code === 'DOWNLOAD_TOO_LARGE') return entry(row, 'rejected', null, 'FILE_TOO_LARGE', error.detail)
      return entry(row, 'failed', null, error.code, error.detail)
    }
    try {
      const mimeType = await sniffMimeType(file.path)
      const rule = options.rules.find(candidate => candidate.mimeType === mimeType)
      if (!mimeType || !rule) return entry(row, 'rejected', null, 'UNSUPPORTED_TYPE', mimeType ?? null)
      if (file.size > rule.maxSize) return entry(row, 'rejected', null, 'FILE_TOO_LARGE', String(rule.maxSize))

      // Import relancé (ou état perdu) : la référence est déjà sur le serveur.
      const existing = await client.findBySourceRef(projectId, row.ref)
      if (existing) return entry(row, 'exists', known(existing))

      if (options.dedupe) {
        const checksum = await fileChecksum(file.path)
        for (;;) {
          const pending = byChecksum.get(checksum)
          if (!pending) break
          const media = await pending
          if (media) return entry(row, 'deduplicated', media)
          if (byChecksum.get(checksum) === pending) byChecksum.delete(checksum)
        }
        // Inscrit avant toute attente : une autre ligne du même contenu attendra ce résultat.
        byChecksum.set(checksum, new Promise((resolve) => {
          waiting.settle = resolve
        }))
        const same = await client.findByChecksum(projectId, checksum)
        if (same) {
          const media = known(same)
          waiting.settle?.(media)
          return entry(row, 'deduplicated', media)
        }
      }

      if (options.dryRun) {
        const media: KnownMedia = { id: null, version: null, url: null }
        waiting.settle?.(media)
        return entry(row, 'created', media)
      }
      try {
        const created = known(await client.upload(projectId, { path: file.path, filename: file.filename, mimeType }, {
          sourceRef: row.ref,
          title: row.title,
          altText: row.alt,
          visibility: row.visibility ?? options.defaultVisibility,
          folderId: options.folderIds.get(folderKey(row.folder)) ?? null,
          tags: row.tags,
        }))
        waiting.settle?.(created)
        return entry(row, 'created', created)
      }
      catch (error) {
        // Filet du serveur : la référence a été créée entre la recherche et l'envoi.
        if (error instanceof ApiError && error.code === 'SOURCE_REF_EXISTS' && typeof error.extensions.mediaId === 'string') {
          return entry(row, 'exists', known(await client.media(projectId, error.extensions.mediaId)))
        }
        throw error
      }
    }
    finally {
      // Sans résultat (échec, arrêt) : les lignes du même contenu qui attendaient tentent leur chance.
      waiting.settle?.(null)
      await file.cleanup()
    }
  }

  const todo = pendingRows(options.rows, entries, options.retryRejected)
  let next = 0
  const worker = async () => {
    for (;;) {
      if (outcome.fatal || options.signal?.aborted || options.shouldStop?.()) return
      const row = todo[next++]
      if (!row) return
      let result: ImportEntry
      try {
        result = await processRow(row)
      }
      catch (error) {
        if (options.signal?.aborted) return
        if (isFatalApiError(error)) {
          outcome.fatal ??= error
          return
        }
        result = error instanceof ApiError
          ? entry(row, REJECTION_CODES.has(error.code) ? 'rejected' : 'failed', null, error.code, error.detail)
          : entry(row, 'failed', null, 'UNEXPECTED', (error as Error).message)
      }
      entries.set(row.ref, result)
      outcome.processed++
      options.onResult?.(row, result)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker))
  outcome.interrupted = next < todo.length || Boolean(options.signal?.aborted)
  if (outcome.fatal) outcome.interrupted = true
  return outcome
}
