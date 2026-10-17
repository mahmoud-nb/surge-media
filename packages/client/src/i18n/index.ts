import type { ProblemExtensions } from '../errors'
import { formatBytes } from '../format'
import { typeLabels } from '../upload/file-types'
import { en } from './en'
import { type ClientMessages, type ErrorCode, fr } from './fr'

export type { ClientMessages, ErrorCode }

/** Langue par défaut du projet (et de repli) : le français. */
export const DEFAULT_LOCALE = 'fr'

/** Catalogues fournis par le client. */
export const CLIENT_MESSAGES: Readonly<Record<string, ClientMessages>> = { fr, en }

/**
 * Langue disponible la plus proche : la langue demandée (`en-GB`), sa langue de base (`en`), sinon la
 * langue de repli (le français par défaut).
 */
export function resolveLocale(locale: string | null | undefined, available: readonly string[], fallback = DEFAULT_LOCALE): string {
  if (locale) {
    const normalized = locale.toLowerCase()
    const exact = available.find(code => code.toLowerCase() === normalized)
    if (exact) return exact
    const base = available.find(code => code.toLowerCase() === normalized.split('-')[0])
    if (base) return base
  }
  return fallback
}

/** Texte avec ses paramètres (`{max}`) remplacés ; paramètre inconnu laissé tel quel. */
export function interpolate(text: string, params: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/**
 * Message lisible d'un code d'erreur (code inconnu : message générique), dans la langue demandée,
 * précisé par les membres d'extension d'une erreur d'envoi : taille maximale, types acceptés.
 */
export function errorMessage(code: string, locale?: string | null, extensions: ProblemExtensions = {}): string {
  const resolved = resolveLocale(locale, Object.keys(CLIENT_MESSAGES))
  const messages = CLIENT_MESSAGES[resolved] ?? fr
  const message = (messages.errors as Record<string, string>)[code] ?? messages.errors.UNKNOWN
  const details: string[] = []
  if (code === 'FILE_TOO_LARGE' && extensions.maxSize !== undefined) {
    details.push(interpolate(messages.details.maxSize, { max: formatBytes(extensions.maxSize, resolved) }))
  }
  if (code === 'UNSUPPORTED_TYPE' && extensions.accepted) {
    details.push(extensions.accepted.length > 0
      ? interpolate(messages.details.accepted, { types: typeLabels(extensions.accepted) })
      : messages.details.acceptedNone)
  }
  return [message, ...details].join(' ')
}
