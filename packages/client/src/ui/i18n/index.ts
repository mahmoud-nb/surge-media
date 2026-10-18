import { DEFAULT_LOCALE, interpolate, resolveLocale } from '../../i18n'
import { en } from './en'
import { type ComponentMessages, fr } from './fr'

export type { ComponentMessages }

/** Objet partiel en profondeur (surcharge de quelques textes). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Textes des composants fournis : français (défaut) et anglais. */
export const COMPONENT_MESSAGES: Readonly<Record<string, ComponentMessages>> = { fr, en }

/** Traduction d'une clé (`video.download`) avec ses paramètres (`{name}`). */
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
  overrides: Readonly<Record<string, DeepPartial<ComponentMessages>>> = {},
  fallbackLocale = DEFAULT_LOCALE,
): Translate {
  const available = [...new Set([...Object.keys(COMPONENT_MESSAGES), ...Object.keys(overrides)])]
  const chain = [...new Set([resolveLocale(locale, available, fallbackLocale), resolveLocale(fallbackLocale, available), DEFAULT_LOCALE])]
  return (key, params) => {
    const path = key.split('.')
    let text: string | undefined
    for (const code of chain) {
      text = lookup(overrides[code], path) ?? lookup(COMPONENT_MESSAGES[code], path)
      if (text !== undefined) break
    }
    if (text === undefined) return key
    return params ? interpolate(text, params) : text
  }
}
