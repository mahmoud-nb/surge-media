import { transformMode } from '../policy'
import type { Media, TransformFormat } from '../types'
import { focusPosition } from '../urls/focal'
import { type ImageSourceRequest, type ImageSourceSet, imageSourceSet, type ImageTransform, parseAspect } from '../urls/image-sources'
import { imageFormat } from '../urls/picture'
import { DEV_MODE } from './dev'
import type { DisplaySettings } from './settings'

/**
 * Logique des composants d'image (`<img>`, `<picture>`) sans framework : URL d'après les propriétés du
 * composant et les réglages du projet, texte alternatif, repli en cas d'erreur, styles en ligne.
 */

/** Propriétés d'image communes aux composants (SmImage, SmPicture…). */
export interface ImageOptions {
  /** Taille d'affichage fixe en pixels CSS (srcset en densités 1x, 2x, 3x, sauf avec `sizes`). */
  width?: number
  height?: number
  /** Rapport imposé (`16/9`, `1`, `4:3`) : recadrage par le serveur, centré sur le point d'intérêt. */
  aspect?: number | string
  /** Ajustement dans le cadre (`cover` par défaut avec un rapport). */
  fit?: 'cover' | 'contain' | 'inside'
  /** Autres paramètres : qualité, rotation, miroir, zone, fond. */
  transform?: ImageTransform
  /** Préréglage du projet. */
  preset?: string
  /** Préréglages formant le srcset (politique « préréglages seulement »). */
  presets?: readonly string[]
  format?: TransformFormat
  widths?: readonly number[]
  sizes?: string
}

/** Requête d'URL d'image, sans le format, d'après les propriétés d'un composant et les réglages du projet. */
export function imageRequest(media: Media, options: ImageOptions, display: DisplaySettings): Omit<ImageSourceRequest, 'format'> {
  return {
    media,
    mode: transformMode(display.policy, media),
    maxDimension: display.maxDimension,
    presets: display.presets,
    width: options.width,
    height: options.height,
    aspect: parseAspect(options.aspect) ?? undefined,
    fit: options.fit,
    transform: options.transform,
    preset: options.preset,
    presetNames: options.presets,
    widths: options.widths ?? display.widths,
    sizes: options.sizes,
  }
}

/** Attributs d'un `<img>` : format demandé s'il est activé (sinon celui de l'application, puis WebP…). */
export function imageSource(media: Media, options: ImageOptions, display: DisplaySettings): ImageSourceSet {
  return imageSourceSet({ ...imageRequest(media, options, display), format: imageFormat(display.formats, options.format ?? display.imageFormat) })
}

const warned = new Set<string>()

/**
 * Texte alternatif : `decorative` → vide ; sinon `alt`, puis celui du média. Une image sans texte
 * alternatif ni `decorative` est signalée une fois en développement (WCAG 1.1.1).
 */
export function resolveAltText(media: Pick<Media, 'id' | 'altText'>, options: { alt?: string, decorative?: boolean } = {}): string {
  if (options.decorative) return ''
  if (options.alt !== undefined) return options.alt
  const alt = media.altText ?? ''
  if (!alt && DEV_MODE && !warned.has(media.id)) {
    warned.add(media.id)
    console.warn(`[surge-media] Media ${media.id} has no alternative text: pass \`alt\`, or \`decorative\` if the image is purely decorative.`)
  }
  return alt
}

/** Étape du repli d'une image (architecture phase E, ED20) : dérivé demandé, fichier original, erreur. */
export type ImageStage = 'source' | 'original' | 'error'

/**
 * Étape suivante après une erreur de chargement : le dérivé d'une image cède la place à l'original
 * (toujours servi, sans transformation) ; ensuite, ou pour une affiche de vidéo, l'état d'erreur.
 */
export function nextImageStage(stage: ImageStage, media: Pick<Media, 'kind'>): ImageStage {
  return stage === 'source' && media.kind === 'image' ? 'original' : 'error'
}

/** Ce qu'il faut lire d'un `<img>` (`HTMLImageElement`) pour savoir s'il a échoué avant l'hydratation. */
export interface LoadedImage {
  readonly complete: boolean
  readonly naturalWidth: number
  readonly currentSrc: string
  decode?: () => Promise<void>
}

/**
 * Erreur survenue avant que l'écouteur `error` existe (rendu serveur, puis hydratation) : vrai si l'image
 * est réellement illisible. `decode()` n'échoue que dans ce cas (une image chargée mais pas encore
 * décodée, dans un onglet masqué par exemple, a aussi une largeur nulle).
 */
export async function imageFailedEarly(image: LoadedImage): Promise<boolean> {
  if (!image.complete || image.naturalWidth > 0 || !image.currentSrc || typeof image.decode !== 'function') return false
  const source = image.currentSrc
  try {
    await image.decode()
    return false
  }
  catch {
    return image.currentSrc === source && image.naturalWidth === 0
  }
}

/** Style en ligne d'une image. */
export type ImageStyle = {
  width?: string
  height?: string
  maxWidth?: string
  objectFit?: 'cover' | 'contain'
  objectPosition?: string
}

/**
 * Style d'une image : `objectFit` → remplit son conteneur, recadrée par le navigateur sur le point
 * d'intérêt ; sinon largeur fluide si le srcset l'est (`max-width: 100%`).
 */
export function imageStyle(
  media: Pick<Media, 'width' | 'height' | 'focalPoint'>,
  set: Pick<ImageSourceSet, 'responsive'>,
  options: { objectFit?: 'cover' | 'contain', aspect?: number | string } = {},
): ImageStyle {
  if (options.objectFit) {
    return { width: '100%', height: '100%', objectFit: options.objectFit, objectPosition: focusPosition(media, parseAspect(options.aspect)) }
  }
  return set.responsive ? { maxWidth: '100%', height: 'auto' } : {}
}

/** Style du cadre d'une image en erreur. */
export type ImageFrameStyle = {
  display: 'inline-flex'
  alignItems: 'center'
  justifyContent: 'center'
  aspectRatio?: string
  width?: string
  maxWidth?: string
}

/** Cadre d'une image en erreur : la place de l'image réservée (rapport, largeur), texte alternatif centré. */
export function imageErrorFrameStyle(set: Pick<ImageSourceSet, 'width' | 'height' | 'responsive'>): ImageFrameStyle {
  const { width, height } = set
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
    ...(set.responsive ? { width: '100%', maxWidth: width ? `${width}px` : undefined } : { width: width ? `${width}px` : undefined }),
  }
}
