import type { Media } from './types'

/** Avance par défaut de la relecture d'un média privé sur l'échéance de ses URL signées : 2 min. */
export const DEFAULT_REFRESH_BEFORE_MS = 120_000

/**
 * Délai (ms) avant de relire un média dont les URL signées expirent (`urlExpiresAt`, ~1 h) : `refreshBeforeMs`
 * avant l'échéance, 10 s au moins, au plus la limite de `setTimeout` (~24,8 jours). Null si le média
 * n'expire pas ou si la relecture est désactivée (`refreshBeforeMs` ≤ 0).
 */
export function refreshDelay(media: Pick<Media, 'urlExpiresAt'>, refreshBeforeMs = DEFAULT_REFRESH_BEFORE_MS, now = Date.now()): number | null {
  if (!media.urlExpiresAt || refreshBeforeMs <= 0) return null
  const delay = Date.parse(media.urlExpiresAt) - refreshBeforeMs - now
  return Math.max(10_000, Math.min(delay, 2_147_000_000))
}
