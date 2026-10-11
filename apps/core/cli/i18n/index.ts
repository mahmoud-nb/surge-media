import { en } from './en'
import { fr, type MessageKey } from './fr'

export const LOCALES = ['fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'fr'

const catalogs: Record<Locale, Record<MessageKey, string>> = { fr, en }

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

function toLocale(value: string | undefined): Locale | undefined {
  const base = value?.toLowerCase().split(/[-_.@]/)[0]
  return LOCALES.find(locale => locale === base)
}

/** Valeur de `--lang` lue directement dans argv (la langue doit être connue avant de construire l'aide). */
export function langFromArgv(argv: string[]): string | undefined {
  const index = argv.findIndex(arg => arg === '--lang' || arg.startsWith('--lang='))
  if (index === -1) return undefined
  const arg = argv[index]!
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1]
}

/**
 * Langue de la CLI : `--lang`, puis SURGE_MEDIA_LANG, puis la locale du système,
 * puis le français (langue par défaut du projet).
 */
export function detectLocale(explicit?: string): Locale {
  const candidates = [
    explicit,
    process.env.SURGE_MEDIA_LANG,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]
  for (const candidate of candidates) {
    const locale = toLocale(candidate)
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

export function createTranslator(locale: Locale): Translate {
  const messages = catalogs[locale]
  return (key, params = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}
