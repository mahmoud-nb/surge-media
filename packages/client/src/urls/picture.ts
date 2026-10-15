import type { TransformFormat } from '../types'

/** Tous les formats de sortie que le serveur sait produire (activés par défaut). */
export const ALL_FORMATS: readonly TransformFormat[] = ['avif', 'webp', 'jpg', 'png']

/**
 * Formats d'un `<picture>` parmi ceux activés sur le serveur : sources AVIF puis WebP, image de repli en
 * JPEG (sinon PNG, sinon le premier format activé). Une source vers un format désactivé répondrait 400 :
 * le navigateur ne passerait pas à la suivante.
 */
export function pictureFormats(enabled: readonly TransformFormat[] = ALL_FORMATS): { sources: TransformFormat[], fallback: TransformFormat } {
  const available = enabled.length > 0 ? enabled : ALL_FORMATS
  const fallback = (['jpg', 'png'] as const).find(format => available.includes(format)) ?? available[0]!
  const sources = (['avif', 'webp'] as const).filter(format => available.includes(format) && format !== fallback)
  return { sources, fallback }
}

/** Format d'une image seule (`<img>`) : le préféré s'il est activé, sinon WebP, JPEG, PNG, AVIF. */
export function imageFormat(enabled: readonly TransformFormat[] = ALL_FORMATS, preferred?: TransformFormat): TransformFormat {
  const available = enabled.length > 0 ? enabled : ALL_FORMATS
  if (preferred && available.includes(preferred)) return preferred
  return (['webp', 'jpg', 'png', 'avif'] as const).find(format => available.includes(format)) ?? available[0]!
}
