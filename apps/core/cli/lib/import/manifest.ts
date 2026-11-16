import { createHash } from 'node:crypto'
import { isValidFolderName } from '../../../shared/schemas/folders'
import { FOLDER_MAX_DEPTH, FOLDER_NAME_MAX_LENGTH } from '../../../shared/utils/folders'
import { MEDIA_VISIBILITIES, normalizeSourceRef, SOURCE_REF_MAX_LENGTH } from '../../../shared/utils/media'
import { MEDIA_TAG_LIMIT, TAG_SLUG_MAX_LENGTH, TAG_SLUG_PATTERN } from '../../../shared/utils/tags'
import { csvLine, CsvError, parseCsv } from './csv'

/**
 * Manifeste de `surge-media import` (.claude/architecture-import.md, § 4) : un fichier par ligne. Seule la
 * colonne `source` est obligatoire ; les en-têtes ne sont jamais traduits. Tout le manifeste est validé
 * avant le premier envoi : une faute à la ligne 4 000 ne doit pas se découvrir après deux heures d'import.
 */

export const MANIFEST_COLUMNS = ['source', 'ref', 'title', 'alt', 'visibility', 'folder', 'tags', 'filename'] as const
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number]

/** Longueur maximale des textes d'un média (VARCHAR(191) sous MySQL). */
const TEXT_MAX_LENGTH = 191
/** Séparateur des étiquettes dans la colonne `tags` (la virgule sépare les colonnes). */
export const MANIFEST_TAG_SEPARATOR = '|'
const VISIBILITIES = MEDIA_VISIBILITIES.map(value => value.toLowerCase())

export type SourceKind = 'file' | 'http'

export interface ManifestRow {
  /** Ligne du manifeste (messages d'erreur). */
  line: number
  /** Chemin relatif à la racine, ou URL `http(s)://`, tel qu'écrit. */
  source: string
  kind: SourceKind
  /** Référence d'origine envoyée au serveur (`sourceRef`) : colonne `ref`, sinon `source`. */
  ref: string
  title: string | null
  alt: string | null
  visibility: 'public' | 'private' | null
  /** Dossier du projet, segment par segment ; vide = hors dossier. */
  folder: string[]
  tags: string[]
  /** Nom de fichier à enregistrer ; null = dernier segment de `source`. */
  filename: string | null
}

export type ManifestIssueCode
  = | 'csv'
    | 'empty'
    | 'sourceColumnMissing'
    | 'unknownColumn'
    | 'duplicateColumn'
    | 'tooManyFields'
    | 'sourceMissing'
    | 'sourceScheme'
    | 'sourceInvalid'
    | 'refInvalid'
    | 'refDuplicate'
    | 'textTooLong'
    | 'visibilityInvalid'
    | 'tagInvalid'
    | 'tagsTooMany'
    | 'folderInvalid'
    | 'folderTooDeep'

export interface ManifestIssue {
  line: number
  code: ManifestIssueCode
  /** Valeurs du message traduit (`column`, `value`, `max`, `other`…). */
  params: Record<string, string | number>
}

export interface ParsedManifest {
  rows: ManifestRow[]
  issues: ManifestIssue[]
}

/**
 * Référence d'origine d'une ligne. Colonne `ref` : prise telle quelle (normalisée) ou refusée. Sans
 * colonne `ref` : la source ; trop longue pour la colonne du serveur, elle est remplacée par son
 * empreinte (`sha256:…`), stable d'une exécution à l'autre — la table de correspondance garde la source.
 */
export function manifestRef(source: string, ref: string): string | null {
  if (ref.trim() !== '') return normalizeSourceRef(ref)
  const normalized = source.normalize('NFC').trim()
  if (normalized === '' || /\p{Cc}/u.test(normalized)) return null
  if (normalized.length <= SOURCE_REF_MAX_LENGTH) return normalized
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`
}

/** Genre de source d'après sa forme ; null pour un schéma que l'outil ne lit pas (`s3://`, `ftp://`…). */
export function sourceKind(source: string): SourceKind | null {
  if (/^https?:\/\//i.test(source)) return 'http'
  // Un schéma d'URL a au moins deux lettres : `C:\photos\a.jpg` reste un chemin.
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(source)) return null
  return 'file'
}

/** Segments d'un chemin de dossier (`marque/2024/été`), normalisés comme le fait le serveur. */
export function folderSegments(path: string): string[] {
  return path.split('/').map(segment => segment.normalize('NFC').trim()).filter(segment => segment !== '')
}

export function parseManifest(text: string): ParsedManifest {
  const issues: ManifestIssue[] = []
  const issue = (line: number, code: ManifestIssueCode, params: ManifestIssue['params'] = {}) => {
    issues.push({ line, code, params })
  }

  let records
  try {
    records = parseCsv(text)
  }
  catch (error) {
    if (!(error instanceof CsvError)) throw error
    return { rows: [], issues: [{ line: error.line, code: 'csv', params: { reason: error.reason } }] }
  }
  const header = records.shift()
  if (!header) return { rows: [], issues: [{ line: 1, code: 'empty', params: {} }] }

  const columns = header.fields.map(name => name.trim().toLowerCase())
  const seen = new Set<string>()
  for (const name of columns) {
    if (!(MANIFEST_COLUMNS as readonly string[]).includes(name)) issue(header.line, 'unknownColumn', { column: name, columns: MANIFEST_COLUMNS.join(', ') })
    else if (seen.has(name)) issue(header.line, 'duplicateColumn', { column: name })
    seen.add(name)
  }
  if (!seen.has('source')) issue(header.line, 'sourceColumnMissing')
  if (issues.length > 0) return { rows: [], issues }

  const rows: ManifestRow[] = []
  const refLines = new Map<string, number>()
  for (const record of records) {
    const { line } = record
    if (record.fields.length > columns.length) {
      issue(line, 'tooManyFields', { count: record.fields.length, expected: columns.length })
      continue
    }
    const cell = (name: ManifestColumn) => record.fields[columns.indexOf(name)]?.trim() ?? ''
    const before = issues.length

    const source = cell('source')
    const kind = source === '' ? null : sourceKind(source)
    if (source === '') issue(line, 'sourceMissing')
    else if (kind === null) issue(line, 'sourceScheme', { value: source })
    else if (/\p{Cc}/u.test(source)) issue(line, 'sourceInvalid')

    const ref = source === '' ? null : manifestRef(source, cell('ref'))
    if (source !== '' && ref === null) issue(line, 'refInvalid', { max: SOURCE_REF_MAX_LENGTH })
    if (ref !== null) {
      const other = refLines.get(ref)
      if (other !== undefined) issue(line, 'refDuplicate', { value: ref, other })
      else refLines.set(ref, line)
    }

    for (const column of ['title', 'alt', 'filename'] as const) {
      if (cell(column).length > TEXT_MAX_LENGTH) issue(line, 'textTooLong', { column, max: TEXT_MAX_LENGTH })
    }

    const visibility = cell('visibility').toLowerCase()
    if (visibility !== '' && !VISIBILITIES.includes(visibility)) issue(line, 'visibilityInvalid', { value: visibility })

    const tags = [...new Set(cell('tags').split(MANIFEST_TAG_SEPARATOR).map(tag => tag.trim().toLowerCase()).filter(Boolean))]
    for (const tag of tags) {
      if (tag.length > TAG_SLUG_MAX_LENGTH || !TAG_SLUG_PATTERN.test(tag)) issue(line, 'tagInvalid', { value: tag })
    }
    if (tags.length > MEDIA_TAG_LIMIT) issue(line, 'tagsTooMany', { max: MEDIA_TAG_LIMIT })

    const folder = folderSegments(cell('folder'))
    const badSegment = folder.find(segment => segment.length > FOLDER_NAME_MAX_LENGTH || !isValidFolderName(segment))
    if (badSegment !== undefined) issue(line, 'folderInvalid', { value: badSegment, max: FOLDER_NAME_MAX_LENGTH })
    if (folder.length > FOLDER_MAX_DEPTH) issue(line, 'folderTooDeep', { max: FOLDER_MAX_DEPTH })

    if (issues.length > before || kind === null || ref === null) continue
    rows.push({
      line,
      source,
      kind,
      ref,
      title: cell('title') || null,
      alt: cell('alt') || null,
      visibility: visibility === '' ? null : visibility as 'public' | 'private',
      folder,
      tags,
      filename: cell('filename') || null,
    })
  }
  if (rows.length === 0 && issues.length === 0) issue(header.line, 'empty')
  return { rows, issues }
}

/** Ligne d'un manifeste écrit par `import plan` (les colonnes absentes sont laissées vides). */
export type ManifestDraft = Partial<Record<ManifestColumn, string>> & { source: string }

export function manifestHeader(): string {
  return csvLine(MANIFEST_COLUMNS)
}

export function manifestLine(draft: ManifestDraft): string {
  return csvLine(MANIFEST_COLUMNS.map(column => draft[column] ?? ''))
}
