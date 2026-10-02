import { TRANSFORM_FORMATS, TRANSFORM_MAX_DIMENSION, type TransformFormat } from '#shared/utils/transforms'

/**
 * Bornes des transformations à la demande (runtimeConfig.media.transform, variables
 * NUXT_MEDIA_TRANSFORM_*), lues une fois par processus. Architecture phase C § 6.
 */
export interface TransformSettings {
  /** Dimension de sortie maximale (largeur et hauteur). */
  maxDimension: number
  /** Formats de sortie activés. */
  formats: readonly TransformFormat[]
  /** Dérivés au plus par version de média au-delà desquels une transformation libre est refusée. */
  maxVariants: number
  /** Nouvelles générations libres non signées par IP et par minute (0 = sans limite). */
  rateLimit: number
  /** Durée de cache (secondes) des URL d'un préréglage global ou de projet (modifiable, donc pas `immutable`). */
  presetMaxAge: number
}

let settings: TransformSettings | undefined

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

export function useTransformSettings(): TransformSettings {
  if (!settings) {
    const config = useRuntimeConfig().media.transform as Record<string, unknown>
    const formats = String(config.formats ?? '')
      .split(',')
      .map(format => format.trim().toLowerCase())
      .filter((format): format is TransformFormat => (TRANSFORM_FORMATS as readonly string[]).includes(format))
    const rateLimit = Number(config.rateLimit)
    settings = {
      maxDimension: positiveInteger(config.maxDimension, TRANSFORM_MAX_DIMENSION),
      // Liste vide ou invalide : tous les formats.
      formats: formats.length > 0 ? [...new Set(formats)] : TRANSFORM_FORMATS,
      maxVariants: positiveInteger(config.maxVariants, 50),
      rateLimit: Number.isInteger(rateLimit) && rateLimit >= 0 ? rateLimit : 60,
      presetMaxAge: positiveInteger(config.presetMaxAge, 604_800),
    }
  }
  return settings
}
