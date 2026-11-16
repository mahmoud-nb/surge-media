import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { csvLine } from './csv'
import type { ManifestRow } from './manifest'

/**
 * État d'un import (`<manifeste>.state.jsonl`) et table de correspondance (`<manifeste>.mapping.csv`).
 *
 * L'état est un journal : une ligne JSON ajoutée par fichier traité, la dernière ligne d'une référence
 * fait foi. Sa première ligne dit pour quel serveur et quel projet il vaut : relancé contre un autre, il
 * ferait passer pour importés des fichiers qui ne le sont pas. Perdu, il se reconstitue : le serveur
 * refuse une référence déjà présente (409 SOURCE_REF_EXISTS) et l'outil la retrouve par `?sourceRef=`.
 *
 * Ni l'un ni l'autre ne contient d'identifiant d'accès ; ils listent les chemins et les URL du client
 * (droits 0600 à la création).
 */

/**
 * Résultat d'une ligne du manifeste :
 * - `created` : média créé par cet import ;
 * - `exists` : la référence était déjà portée par un média du projet (import relancé) ;
 * - `deduplicated` : même contenu qu'un média déjà présent ou qu'une autre ligne, rattaché sans envoi ;
 * - `rejected` : refus définitif (type non accepté, fichier trop volumineux, illisible…) ;
 * - `failed` : échec qu'une nouvelle exécution retentera (source absente, réseau, serveur occupé).
 */
export const IMPORT_STATUSES = ['created', 'exists', 'deduplicated', 'rejected', 'failed'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** Statuts qu'une nouvelle exécution ne reprend pas. */
export const FINAL_STATUSES: readonly ImportStatus[] = ['created', 'exists', 'deduplicated', 'rejected']

export interface ImportEntry {
  ref: string
  source: string
  status: ImportStatus
  mediaId: string | null
  version: number | null
  /** URL de diffusion permanente de l'original (sans signature). */
  url: string | null
  /** Code de l'API ou de l'outil pour un refus ou un échec (`UNSUPPORTED_TYPE`, `SOURCE_NOT_FOUND`…). */
  code: string | null
  /** Précision lisible (anglais de l'API, ou message du système), jamais un secret. */
  detail: string | null
  at: string
}

export interface StateHeader {
  type: 'header'
  /** Origine du serveur (`https://media.example.com`). */
  server: string
  projectId: string
  startedAt: string
}

export interface LoadedState {
  header: StateHeader | null
  /** Dernière entrée de chaque référence. */
  entries: Map<string, ImportEntry>
}

function isEntry(value: unknown): value is ImportEntry {
  const entry = value as Partial<ImportEntry> | null
  return Boolean(entry) && typeof entry!.ref === 'string' && typeof entry!.source === 'string'
    && (IMPORT_STATUSES as readonly unknown[]).includes(entry!.status)
}

/** Lit un état ; une dernière ligne tronquée (arrêt brutal pendant l'écriture) est ignorée. */
export function parseState(text: string): LoadedState {
  const state: LoadedState = { header: null, entries: new Map() }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    }
    catch {
      continue
    }
    if ((value as { type?: unknown } | null)?.type === 'header') state.header ??= value as StateHeader
    else if (isEntry(value)) state.entries.set(value.ref, value)
  }
  return state
}

export function loadState(path: string): LoadedState {
  return existsSync(path) ? parseState(readFileSync(path, 'utf8')) : { header: null, entries: new Map() }
}

function secure(path: string): void {
  // `mode` ne vaut qu'à la création ; sans effet utile sous Windows.
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}

/** Nouvel état (écrase l'ancien) : seulement l'en-tête. */
export function startState(path: string, header: Omit<StateHeader, 'type'>): void {
  writeFileSync(path, `${JSON.stringify({ type: 'header', ...header })}\n`, { mode: 0o600 })
  secure(path)
}

/** Ajoute une entrée, écrite aussitôt : un arrêt brutal ne perd au plus que la ligne en cours. */
export function appendState(path: string, entry: ImportEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

export const MAPPING_COLUMNS = ['source', 'sourceRef', 'status', 'mediaId', 'version', 'url', 'code'] as const

/**
 * Table de correspondance, dans l'ordre du manifeste : de quoi réécrire les URL de la base du client
 * (ancienne source → identifiant et URL du média). Une ligne pas encore traitée a le statut `pending`.
 */
export function renderMapping(rows: readonly Pick<ManifestRow, 'source' | 'ref'>[], entries: ReadonlyMap<string, ImportEntry>): string {
  let content = csvLine(MAPPING_COLUMNS)
  for (const row of rows) {
    const entry = entries.get(row.ref)
    content += csvLine([row.source, row.ref, entry?.status ?? 'pending', entry?.mediaId, entry?.version, entry?.url, entry?.code])
  }
  return content
}

export function writeMapping(path: string, rows: readonly Pick<ManifestRow, 'source' | 'ref'>[], entries: ReadonlyMap<string, ImportEntry>): void {
  writeFileSync(path, renderMapping(rows, entries), { mode: 0o600 })
  secure(path)
}

/** Nombre de lignes du manifeste par statut (`pending` : pas encore traitées). */
export function countByStatus(rows: readonly Pick<ManifestRow, 'ref'>[], entries: ReadonlyMap<string, ImportEntry>): Record<ImportStatus | 'pending', number> {
  const counts = { created: 0, exists: 0, deduplicated: 0, rejected: 0, failed: 0, pending: 0 }
  for (const row of rows) counts[entries.get(row.ref)?.status ?? 'pending']++
  return counts
}
