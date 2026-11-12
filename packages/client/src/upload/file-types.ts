import type { MediaKind } from '../types'

/**
 * Types de fichiers que SurgeMedia sait recevoir (miroir de `apps/core/shared/utils/media.ts`, recoupé par
 * les tests de contrat) : extension canonique, genre, format converti après l'envoi (MKV, AVI…, lus par
 * leur rendu H.264 quand le traitement des vidéos est actif). Sert à nommer les types acceptés dans les
 * messages et à deviner le genre d'un fichier avant d'avoir les règles du serveur.
 */
export const UPLOAD_FILE_TYPES: Readonly<Record<string, { extension: string, kind: MediaKind, converted: boolean }>> = {
  'image/jpeg': { extension: 'jpg', kind: 'image', converted: false },
  'image/png': { extension: 'png', kind: 'image', converted: false },
  'image/webp': { extension: 'webp', kind: 'image', converted: false },
  'image/avif': { extension: 'avif', kind: 'image', converted: false },
  'image/gif': { extension: 'gif', kind: 'image', converted: false },
  'video/mp4': { extension: 'mp4', kind: 'video', converted: false },
  'video/webm': { extension: 'webm', kind: 'video', converted: false },
  'video/quicktime': { extension: 'mov', kind: 'video', converted: false },
  'video/x-matroska': { extension: 'mkv', kind: 'video', converted: true },
  'video/x-msvideo': { extension: 'avi', kind: 'video', converted: true },
  'video/3gpp': { extension: '3gp', kind: 'video', converted: true },
  'video/3gpp2': { extension: '3g2', kind: 'video', converted: true },
  'video/mp2t': { extension: 'ts', kind: 'video', converted: true },
  'video/ogg': { extension: 'ogv', kind: 'video', converted: true },
  'video/x-ms-wmv': { extension: 'wmv', kind: 'video', converted: true },
}

/**
 * Types annoncés par certains systèmes pour des formats acceptés (le serveur reconnaît le contenu, pas ce
 * type) : pris en compte par le pré-contrôle et l'attribut `accept` (repris de l'administration).
 */
export const FILE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  'video/x-m4v': 'video/mp4',
  'image/jpg': 'image/jpeg',
  'video/vnd.dlna.mpeg-tts': 'video/mp2t',
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
  'video/x-ms-asf': 'video/x-ms-wmv',
}

/** Extensions reconnues en plus de l'extension canonique d'un type (`.m4v`, `.jpeg`, `.mts` des caméscopes…). */
export const EXTENSION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['jpeg', 'jpe'],
  'video/mp4': ['m4v'],
  'video/quicktime': ['qt'],
  'video/mp2t': ['mts', 'm2ts'],
}

/** Extension d'un nom de fichier, en minuscules (sans le point) ; vide sans extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Extensions d'un type MIME : canonique puis alias. */
export function extensionsOf(mimeType: string): string[] {
  const known = UPLOAD_FILE_TYPES[mimeType]
  return known ? [known.extension, ...(EXTENSION_ALIASES[mimeType] ?? [])] : []
}

/** Nom lisible de types MIME (« JPG, PNG, MP4 ») : extensions canoniques en majuscules, dédoublonnées. */
export function typeLabels(mimeTypes: readonly string[]): string {
  const labels = mimeTypes.map(type => (UPLOAD_FILE_TYPES[type]?.extension ?? type).toUpperCase())
  return [...new Set(labels)].join(', ')
}
