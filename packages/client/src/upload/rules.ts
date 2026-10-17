import { SurgeApiError } from '../errors'
import type { MediaKind, UploadRules, UploadTypeRule } from '../types'
import { EXTENSION_ALIASES, extensionsOf, FILE_TYPE_ALIASES, fileExtension, UPLOAD_FILE_TYPES } from './file-types'

/**
 * Règles d'envoi côté navigateur (`GET /me`, champ `upload`) : pré-contrôle d'un fichier, attribut `accept`
 * et textes d'aide (repris de l'administration, apps/core/app/composables/useMediaUpload.ts). Le contrôle
 * se fie au type annoncé par le système et à l'extension : le serveur reste seul juge du contenu.
 */

/** Fichier à contrôler : un `File` du navigateur, ou tout objet de même forme. */
export interface FileLike {
  name?: string
  type: string
  size: number
}

/** Type annoncé sans valeur utile (fichier inconnu du système) : l'extension décide. */
function genericType(type: string): boolean {
  return type === '' || type === 'application/octet-stream'
}

/** Types des règles retenus pour les genres demandés (tous par défaut). */
export function rulesTypes(rules: UploadRules, kinds?: readonly MediaKind[]): UploadTypeRule[] {
  return rules.types.filter(type => !kinds || kinds.includes(type.kind))
}

/** Genres que les règles permettent d'envoyer, dans leur ordre (restreints à `kinds`). */
export function uploadKinds(rules: UploadRules, kinds?: readonly MediaKind[]): MediaKind[] {
  return [...new Set(rulesTypes(rules, kinds).map(type => type.kind))]
}

/** Plus grande taille admise pour un genre, en octets (0 si les règles n'en acceptent aucun type). */
export function maxSizeFor(rules: UploadRules, kind: MediaKind): number {
  return Math.max(0, ...rulesTypes(rules, [kind]).map(type => type.maxSize))
}

/** Extensions canoniques acceptées (`jpg`, `mp4`…), dédoublonnées ; `converted: false` écarte les formats convertis. */
export function acceptedExtensions(rules: UploadRules, kinds?: readonly MediaKind[], options: { converted?: boolean } = {}): string[] {
  const types = rulesTypes(rules, kinds).filter(type => options.converted !== false || !type.converted)
  return [...new Set(types.map(type => type.extension))]
}

/**
 * Valeur de l'attribut `accept` d'un champ de fichier : types MIME acceptés et leurs alias, puis les
 * extensions (les sélecteurs ne rattachent pas toujours un type aux formats convertis, `.mts`, `.ts`…).
 */
export function acceptAttribute(rules: UploadRules, kinds?: readonly MediaKind[]): string {
  const types = rulesTypes(rules, kinds)
  const mimeTypes = types.map(type => type.mimeType)
  const aliases = Object.entries(FILE_TYPE_ALIASES).filter(([, target]) => mimeTypes.includes(target)).map(([alias]) => alias)
  const extensions = types.flatMap(type => [type.extension, ...(EXTENSION_ALIASES[type.mimeType] ?? [])]).map(extension => `.${extension}`)
  return [...new Set([...mimeTypes, ...aliases, ...extensions])].join(',')
}

/**
 * Type des règles qui correspond à un fichier : son type annoncé (ou l'alias de celui-ci), sinon son
 * extension — seulement pour un type annoncé vide ou générique, ou pour un format converti (les systèmes
 * annoncent pour eux des types fantaisistes : « text/vnd.trolltech.linguist » pour un `.ts`). null sinon.
 */
export function matchFileType(file: FileLike, rules: UploadRules, kinds?: readonly MediaKind[]): UploadTypeRule | null {
  const types = rulesTypes(rules, kinds)
  const announced = FILE_TYPE_ALIASES[file.type] ?? file.type
  const byType = types.find(type => type.mimeType === announced)
  if (byType) return byType
  const extension = fileExtension(file.name ?? '')
  const byExtension = extension ? types.find(type => extensionsOf(type.mimeType).includes(extension)) : undefined
  if (!byExtension) return null
  return genericType(file.type) || byExtension.converted ? byExtension : null
}

/** Genre probable d'un fichier (règles, type annoncé, extension) ; null s'il est inconnu. */
export function fileKind(file: FileLike, rules?: UploadRules | null): MediaKind | null {
  const matched = rules ? matchFileType(file, rules) : null
  if (matched) return matched.kind
  const announced = FILE_TYPE_ALIASES[file.type] ?? file.type
  const known = UPLOAD_FILE_TYPES[announced]
  if (known) return known.kind
  if (announced.startsWith('image/')) return 'image'
  if (announced.startsWith('video/')) return 'video'
  const extension = fileExtension(file.name ?? '')
  const byExtension = Object.keys(UPLOAD_FILE_TYPES).find(type => extensionsOf(type).includes(extension))
  return byExtension ? UPLOAD_FILE_TYPES[byExtension]!.kind : null
}

function unsupported(types: readonly UploadTypeRule[]): SurgeApiError {
  return new SurgeApiError({ status: 0, code: 'UNSUPPORTED_TYPE', extensions: { accepted: types.map(type => type.mimeType) } })
}

function tooLarge(maxSize: number): SurgeApiError {
  return new SurgeApiError({ status: 0, code: 'FILE_TOO_LARGE', extensions: { maxSize } })
}

/**
 * Contrôle d'un fichier avant l'envoi : null s'il peut partir, sinon l'erreur que le serveur rendrait
 * (`NO_FILE`, `UNSUPPORTED_TYPE` avec les types acceptés, `FILE_TOO_LARGE` avec la taille maximale), avec un
 * statut 0 (erreur du client). Un fichier de type inconnu du système, sans extension connue, part avec la
 * plus grande limite : le serveur reconnaîtra son contenu.
 */
export function checkFile(file: FileLike, rules: UploadRules, kinds?: readonly MediaKind[]): SurgeApiError | null {
  if (file.size === 0) return new SurgeApiError({ status: 0, code: 'NO_FILE' })
  const types = rulesTypes(rules, kinds)
  if (types.length === 0) return unsupported(types)
  const matched = matchFileType(file, rules, kinds)
  if (matched) return file.size > matched.maxSize ? tooLarge(matched.maxSize) : null
  // Type annoncé précis, ou extension d'un type que surgeMedia connaît mais que ces règles refusent.
  const extension = fileExtension(file.name ?? '')
  const knownExtension = Object.keys(UPLOAD_FILE_TYPES).some(type => extensionsOf(type).includes(extension))
  if (!genericType(file.type) || knownExtension) return unsupported(types)
  const largest = Math.max(...types.map(type => type.maxSize))
  return file.size > largest ? tooLarge(largest) : null
}
