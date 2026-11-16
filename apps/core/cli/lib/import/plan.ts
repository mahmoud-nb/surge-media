import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sniffMimeType } from '../../../server/lib/media/sniff'
import { isValidFolderName } from '../../../shared/schemas/folders'
import { FOLDER_MAX_DEPTH, FOLDER_NAME_MAX_LENGTH } from '../../../shared/utils/folders'
import { acceptedMimeTypes, CONVERTED_MIME_TYPES, DEFAULT_UPLOAD_SIZES, MEDIA_SIZE_CEILING, mediaKindForMime } from '../../../shared/utils/media'
import { folderSegments, type ManifestDraft } from './manifest'

/**
 * `surge-media import plan` : parcourt un dossier et prépare le manifeste, sans serveur. Les types sont
 * reconnus d'après le contenu, comme à l'envoi (même module `sniff`) ; les limites de taille sont celles
 * par défaut — l'essai à blanc de `import run` applique ensuite celles du serveur.
 *
 * Ignorés, et comptés : les liens symboliques (ils pourraient sortir du dossier), les fichiers et dossiers
 * cachés (`.DS_Store`, `.git`…) et les fichiers spéciaux.
 */

export type PlanRejection = 'UNSUPPORTED_TYPE' | 'SOURCE_EMPTY' | 'FILE_TOO_LARGE' | 'SOURCE_UNREADABLE'

export interface PlanFile {
  /** Chemin relatif au dossier parcouru, séparateur `/`. */
  source: string
  size: number
  mimeType: string
  /** Format vidéo accepté seulement pendant que le traitement des vidéos est actif (MKV, AVI…). */
  converted: boolean
  /** Au-delà de la limite d'envoi par défaut de son genre : refusé si le serveur ne l'a pas relevée. */
  overDefaultLimit: boolean
  /** Dossier proposé (`--folders-from-path`), vide sinon ou si le chemin ne fait pas un dossier valable. */
  folder: string
}

export interface PlanReport {
  files: PlanFile[]
  rejected: { source: string, reason: PlanRejection, detail: string | null }[]
  totalBytes: number
  skipped: { symlinks: number, hidden: number, special: number }
  /** Fichiers dont le chemin ne donne pas un dossier valable (trop profond, nom refusé). */
  foldersDropped: number
}

/** Chemin de dossier que le serveur accepte tel quel ; sinon le fichier est proposé hors dossier. */
export function validFolderPath(path: string): boolean {
  const segments = folderSegments(path)
  return segments.length <= FOLDER_MAX_DEPTH && segments.every(segment => segment.length <= FOLDER_NAME_MAX_LENGTH && isValidFolderName(segment))
}

export async function scanDirectory(root: string, options: { foldersFromPath: boolean, onFile?: (count: number) => void }): Promise<PlanReport> {
  const report: PlanReport = { files: [], rejected: [], totalBytes: 0, skipped: { symlinks: 0, hidden: 0, special: 0 }, foldersDropped: 0 }
  const accepted = new Set(acceptedMimeTypes(true))
  let seen = 0

  async function walk(directory: string, relative: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    // Ordre stable : deux parcours du même dossier donnent le même manifeste.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        report.skipped.hidden++
        continue
      }
      if (entry.isSymbolicLink()) {
        report.skipped.symlinks++
        continue
      }
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path, [...relative, entry.name])
        continue
      }
      if (!entry.isFile()) {
        report.skipped.special++
        continue
      }
      options.onFile?.(++seen)
      const source = [...relative, entry.name].join('/')
      let size: number
      let mimeType: string | undefined
      try {
        size = (await stat(path)).size
        mimeType = size > 0 ? await sniffMimeType(path) : undefined
      }
      catch (error) {
        report.rejected.push({ source, reason: 'SOURCE_UNREADABLE', detail: (error as NodeJS.ErrnoException).code ?? null })
        continue
      }
      if (size === 0) {
        report.rejected.push({ source, reason: 'SOURCE_EMPTY', detail: null })
        continue
      }
      if (!mimeType || !accepted.has(mimeType)) {
        report.rejected.push({ source, reason: 'UNSUPPORTED_TYPE', detail: mimeType ?? null })
        continue
      }
      if (size > MEDIA_SIZE_CEILING) {
        report.rejected.push({ source, reason: 'FILE_TOO_LARGE', detail: String(MEDIA_SIZE_CEILING) })
        continue
      }
      const kind = mediaKindForMime(mimeType)
      const limit = kind ? DEFAULT_UPLOAD_SIZES[kind] : undefined
      const folderPath = relative.join('/')
      const folderOk = !options.foldersFromPath || validFolderPath(folderPath)
      if (!folderOk) report.foldersDropped++
      report.files.push({
        source,
        size,
        mimeType,
        converted: (CONVERTED_MIME_TYPES as readonly string[]).includes(mimeType),
        overDefaultLimit: limit !== undefined && size > limit,
        folder: options.foldersFromPath && folderOk ? folderPath : '',
      })
      report.totalBytes += size
    }
  }

  await walk(root, [])
  return report
}

export function planDraft(file: PlanFile): ManifestDraft {
  return { source: file.source, folder: file.folder }
}

/** Débit d'envoi par défaut du serveur (`NUXT_API_RATE_LIMIT_UPLOADS`), pour estimer la durée. */
export const DEFAULT_UPLOADS_PER_MINUTE = 60

/** Durée minimale d'un import à ce débit, en minutes (au moins 1). */
export function estimatedMinutes(files: number, uploadsPerMinute = DEFAULT_UPLOADS_PER_MINUTE): number {
  return Math.max(1, Math.ceil(files / uploadsPerMinute))
}
