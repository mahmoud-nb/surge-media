import { DEFAULT_LOCALE, resolveLocale } from '@surge-media/client'
import { en } from './en'
import { fr, type Messages } from './fr'

export type { Messages }

/** Objet partiel en profondeur (surcharge de quelques textes). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Catalogues fournis : français (défaut) et anglais. */
export const BUILTIN_MESSAGES: Readonly<Record<string, Messages>> = { fr, en }

export type Translate = (key: string, params?: Record<string, string | number>) => string

function lookup(messages: unknown, path: readonly string[]): string | undefined {
  let node: unknown = messages
  for (const part of path) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * Traduction d'une clé (`video.download`) : langue demandée, sa langue de base, la langue de repli, puis
 * le français ; surcharges de l'application d'abord. Clé inconnue partout : la clé elle-même.
 */
export function createTranslate(
  locale: string,
  overrides: Readonly<Record<string, DeepPartial<Messages>>> = {},
  fallbackLocale = DEFAULT_LOCALE,
): Translate {
  const available = [...new Set([...Object.keys(BUILTIN_MESSAGES), ...Object.keys(overrides)])]
  const chain = [...new Set([resolveLocale(locale, available, fallbackLocale), resolveLocale(fallbackLocale, available), DEFAULT_LOCALE])]
  return (key, params) => {
    const path = key.split('.')
    let text: string | undefined
    for (const code of chain) {
      text = lookup(overrides[code], path) ?? lookup(BUILTIN_MESSAGES[code], path)
      if (text !== undefined) break
    }
    if (text === undefined) return key
    return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
  }
}
