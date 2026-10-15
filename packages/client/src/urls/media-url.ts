import type { Media, TransformFormat } from '../types'
import { buildTransform, DEFAULT_MAX_DIMENSION, type TransformOptions, transformSegment } from './transform'

/** Nom de préréglage valable dans une URL (`preview`, `full`, `card-480`…). */
export const PRESET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/** Types MIME des formats de sortie. */
export const FORMAT_MIME_TYPES: Readonly<Record<TransformFormat, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

export interface MediaUrlOptions {
  /** Préréglage (`preview`, `full`, ou un préréglage du projet), à la place de `transform`. */
  preset?: string
  /** Paramètres (objet, mis en forme canonique) ou segment déjà canonique (`w_800,h_450`). */
  transform?: TransformOptions | string
  /** Format de sortie (`webp` par défaut). */
  format?: TransformFormat
  /** Dimension maximale des dérivés sur le serveur (`Project.transformMaxDimension`). */
  maxDimension?: number
}

/** Segment d'URL d'une demande : préréglage, ou paramètres canoniques (`full` sans paramètre). */
export function requestSegment(options: Pick<MediaUrlOptions, 'preset' | 'transform' | 'maxDimension'>): string {
  if (options.preset !== undefined) {
    if (!PRESET_NAME_PATTERN.test(options.preset)) throw new RangeError(`Invalid preset name "${options.preset}".`)
    return options.preset
  }
  const transform = options.transform ?? ''
  return typeof transform === 'string'
    ? transformSegment(transform)
    : transformSegment(buildTransform(transform, options.maxDimension ?? DEFAULT_MAX_DIMENSION))
}

/**
 * URL d'un dérivé d'après le gabarit `urlTemplate` du média (signature `derived` conservée pour un média
 * privé) ; null quand le média n'a pas de dérivé (vidéo sans affiche).
 */
export function mediaUrl(media: Pick<Media, 'urlTemplate'>, options: MediaUrlOptions = {}): string | null {
  if (!media.urlTemplate) return null
  return media.urlTemplate
    .replace('{transform}', requestSegment(options))
    .replace('{format}', options.format ?? 'webp')
}

/**
 * Image d'affiche d'une vidéo : à la largeur demandée (dérivé de l'affiche, `format` webp par défaut) ou
 * l'affiche entière en JPEG ; null sans affiche.
 */
export function posterUrl(
  media: Pick<Media, 'urlTemplate' | 'poster'>,
  options: { width?: number, format?: TransformFormat, maxDimension?: number } = {},
): string | null {
  if (!media.poster) return null
  if (options.width && media.urlTemplate) {
    return mediaUrl(media, { transform: { width: options.width }, format: options.format, maxDimension: options.maxDimension })
  }
  return media.poster.url
}
