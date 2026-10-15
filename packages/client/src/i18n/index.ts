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

/** Message lisible d'un code d'erreur (code inconnu : message générique), dans la langue demandée. */
export function errorMessage(code: string, locale?: string | null): string {
  const messages = CLIENT_MESSAGES[resolveLocale(locale, Object.keys(CLIENT_MESSAGES))] ?? fr
  return (messages.errors as Record<string, string>)[code] ?? messages.errors.UNKNOWN
}
