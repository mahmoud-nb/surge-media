import { transformMode } from '../policy'
import type { Media, MediaKind } from '../types'
import { focusPosition } from '../urls/focal'
import { type ImageSourceSet, imageSourceSet } from '../urls/image-sources'
import { imageFormat } from '../urls/picture'
import type { IconName } from './icons'
import type { DisplaySettings } from './settings'

/**
 * Logique d'une vignette carrée (galeries, sélecteurs) sans framework : image recadrée sur le point
 * d'intérêt ou affiche d'une vidéo, icône et nom du genre, tailles des icônes, styles en ligne.
 */

/**
 * Image d'une vignette de `size` pixels CSS : recadrée par le serveur ; quand seuls les préréglages sont
 * permis, l'aperçu (480 px) recadré par le navigateur.
 */
export function thumbnailSource(media: Media, size: number, display: DisplaySettings): ImageSourceSet {
  const mode = transformMode(display.policy, media)
  return imageSourceSet({
    media,
    format: imageFormat(display.formats, display.imageFormat),
    mode,
    maxDimension: display.maxDimension,
    presets: display.presets,
    width: size,
    height: size,
    ...(mode === 'presets' ? { preset: 'preview' } : {}),
  })
}

/** Icône du genre (vignette sans image). */
export function kindIcon(kind: MediaKind): IconName {
  return kind === 'image' ? 'image' : kind === 'video' ? 'film' : 'file'
}

/** Clé du texte du genre (`thumbnail.kinds.*`), nom accessible d'une vignette sans image ni texte alternatif. */
export function kindLabelKey(kind: MediaKind): string {
  return `thumbnail.kinds.${kind === 'image' || kind === 'video' ? kind : 'other'}`
}

/** Tailles des icônes d'une vignette de `size` pixels : genre (sans image) et lecture (vidéo). */
export function thumbnailIconSizes(size: number): { kind: number, play: number } {
  return { kind: Math.max(16, Math.round(size / 4)), play: Math.max(12, Math.round(size / 8)) }
}

/** Cadre carré d'une vignette. */
export function thumbnailFrameStyle(size: number) {
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    width: `${size}px`,
    height: `${size}px`,
    flex: 'none',
  } as const
}

/** Image d'une vignette : recadrée sur le point d'intérêt (celui du média, appliqué à l'affiche d'une vidéo). */
export function thumbnailImageStyle(media: Pick<Media, 'kind' | 'width' | 'height' | 'focalPoint' | 'poster'>) {
  const framed = media.kind === 'video' && media.poster ? { ...media.poster, focalPoint: media.focalPoint } : media
  return { width: '100%', height: '100%', objectFit: 'cover', objectPosition: focusPosition(framed, 1) } as const
}
