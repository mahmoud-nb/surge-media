import type { H3Event } from 'h3'

/**
 * Chemins servis avec la configuration d'exécution partagée et gelée (plugin `runtime-config.ts`) :
 * diffusion des médias, API (administration, v1, sessions) et fichiers de l'application. Aucun de ces
 * gestionnaires ne modifie la configuration ; les pages reçoivent une copie (rendu Vue, modules).
 */
const SHARED_PREFIXES = ['/m/', '/api/', '/_nuxt/'] as const

export function sharesRuntimeConfig(path: string): boolean {
  return SHARED_PREFIXES.some(prefix => path.startsWith(prefix))
}

/**
 * Événement h3 parmi les arguments d'un crochet vu par `beforeEach` : hookable 5 y place le nom du
 * crochet en tête (`['request', event]`, contrairement à ses types), d'autres versions non (`[event]`).
 */
export function hookEvent(args: readonly unknown[]): H3Event | undefined {
  return args.find((arg): arg is H3Event => typeof arg === 'object' && arg !== null && 'context' in arg)
}
