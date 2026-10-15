import type { Media, Preset, TransformFormat } from '../types'
import { mediaUrl } from './media-url'
import { DEFAULT_MAX_DIMENSION, outputSize, parseTransform, type TransformOptions } from './transform'

/**
 * Candidats d'un `srcset` : chaque URL avec la taille **réelle** du fichier que le serveur produira (il
 * n'agrandit jamais une image), d'où des descripteurs exacts et aucun doublon.
 */

export interface SrcsetCandidate {
  url: string
  /** Dimensions du fichier produit (null si celles de la source sont inconnues). */
  width: number | null
  height: number | null
  /** Descripteur du srcset : `640w` ou `2x`. */
  descriptor: string
}

/**
 * Préréglages intégrés au serveur, toujours servis quelle que soit la politique du projet
 * (apps/core/shared/utils/transforms.ts › BUILTIN_PRESETS).
 */
export const BUILTIN_PRESETS: readonly Preset[] = [
  { name: 'preview', transformation: 'w_480,h_480,fit_inside,q_72', description: null, level: 'builtin' },
  { name: 'full', transformation: '', description: null, level: 'builtin' },
]

/** Largeurs proposées par défaut (pixels). */
export const DEFAULT_WIDTHS: readonly number[] = [320, 480, 640, 768, 1024, 1280, 1600, 1920, 2560]
/** Densités proposées par défaut. */
export const DEFAULT_DENSITIES: readonly number[] = [1, 2, 3]

/**
 * Dimensions de l'image d'où partent les dérivés : l'image elle-même, ou l'affiche d'une vidéo ; null
 * si elles sont inconnues.
 */
export function derivedSourceSize(media: Pick<Media, 'kind' | 'width' | 'height' | 'poster'>): { width: number, height: number } | null {
  if (media.kind === 'video') return media.poster ? { width: media.poster.width, height: media.poster.height } : null
  return media.width && media.height ? { width: media.width, height: media.height } : null
}

export interface WidthSrcsetOptions {
  /** Largeurs voulues (`DEFAULT_WIDTHS` par défaut). */
  widths?: readonly number[]
  /** Rapport largeur / hauteur imposé (recadrage `cover` centré sur le point d'intérêt). */
  aspect?: number
  /** Autres paramètres (qualité, ajustement, rotation, zone…), sans largeur ni hauteur. */
  transform?: Omit<TransformOptions, 'width' | 'height' | 'dpr'>
  format?: TransformFormat
  maxDimension?: number
}

/**
 * Srcset en largeurs (`w`) : une URL par largeur voulue, limitée à ce que la source permet ; la plus
 * grande largeur atteignable est toujours proposée.
 */
export function widthCandidates(media: Pick<Media, 'kind' | 'width' | 'height' | 'poster' | 'urlTemplate'>, options: WidthSrcsetOptions = {}): SrcsetCandidate[] {
  if (!media.urlTemplate) return []
  const max = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const source = derivedSourceSize(media)
  const widths = [...new Set(options.widths ?? DEFAULT_WIDTHS)].filter(width => width > 0).sort((a, b) => a - b)
  const candidates: SrcsetCandidate[] = []
  const seen = new Set<number>()
  for (const width of widths) {
    const transform: TransformOptions = { ...options.transform, width }
    if (options.aspect) {
      transform.height = Math.max(1, Math.round(width / options.aspect))
      transform.fit ??= 'cover'
    }
    const out = source ? outputSize(transform, source, max) : null
    if (source && !out) continue
    const actual = out?.width ?? Math.min(width, max)
    if (seen.has(actual)) continue
    seen.add(actual)
    candidates.push({
      url: mediaUrl(media, { transform, format: options.format, maxDimension: max })!,
      width: out?.width ?? null,
      height: out?.height ?? null,
      descriptor: `${actual}w`,
    })
    // Source atteinte : les largeurs suivantes produiraient le même fichier.
    if (out && out.width < Math.min(width, max)) break
  }
  return candidates
}

export interface DensitySrcsetOptions {
  /** Taille d'affichage (pixels CSS) : au moins une des deux. */
  width?: number
  height?: number
  transform?: Omit<TransformOptions, 'width' | 'height' | 'dpr'>
  densities?: readonly number[]
  format?: TransformFormat
  maxDimension?: number
}

/**
 * Srcset en densités (`1x`, `2x`, `3x`) pour une taille d'affichage fixe : une densité n'est proposée
 * que si la source peut grandir d'au moins une demi-densité de plus (règle du générateur d'adresses :
 * sinon le serveur rendrait presque le même fichier). Toujours au moins `1x`.
 */
export function densityCandidates(media: Pick<Media, 'kind' | 'width' | 'height' | 'poster' | 'urlTemplate'>, options: DensitySrcsetOptions): SrcsetCandidate[] {
  if (!media.urlTemplate || (!options.width && !options.height)) return []
  const max = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const source = derivedSourceSize(media)
  const base: TransformOptions = { ...options.transform, width: options.width, height: options.height }
  let headroom = Number.POSITIVE_INFINITY
  if (source) {
    const region = base.crop ?? source
    const quarter = base.rotate === 90 || base.rotate === 270
    const sourceWidth = base.crop ? region.width : quarter ? source.height : source.width
    const sourceHeight = base.crop ? region.height : quarter ? source.width : source.height
    const ratios = [options.width ? sourceWidth / options.width : null, options.height ? sourceHeight / options.height : null]
      .filter((ratio): ratio is number => ratio !== null)
    headroom = options.width && options.height && base.fit === 'contain' ? Math.max(...ratios) : Math.min(...ratios)
  }
  const candidates: SrcsetCandidate[] = []
  for (const density of options.densities ?? DEFAULT_DENSITIES) {
    if (density !== 1 && headroom < density - 0.5) continue
    const transform = { ...base, dpr: density }
    const out = source ? outputSize(transform, source, max) : null
    candidates.push({
      url: mediaUrl(media, { transform, format: options.format, maxDimension: max })!,
      width: out?.width ?? null,
      height: out?.height ?? null,
      descriptor: `${density}x`,
    })
  }
  return candidates
}

/**
 * Srcset en largeurs construit à partir de préréglages (politique `presets`) : la largeur de chacun est
 * calculée d'après sa `transformation` ; préréglage inconnu ou sans largeur calculable : ignoré.
 */
export function presetCandidates(
  media: Pick<Media, 'kind' | 'width' | 'height' | 'poster' | 'urlTemplate'>,
  names: readonly string[],
  presets: readonly Preset[],
  options: { format?: TransformFormat, maxDimension?: number } = {},
): SrcsetCandidate[] {
  if (!media.urlTemplate) return []
  const max = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const source = derivedSourceSize(media)
  const candidates: SrcsetCandidate[] = []
  const seen = new Set<number>()
  for (const name of names) {
    const preset = presets.find(item => item.name === name)
    if (!preset) continue
    const transform = parseTransform(preset.transformation)
    const out = source ? outputSize(transform, source, max) : null
    const width = out?.width ?? transform.width
    if (!width || seen.has(width)) continue
    seen.add(width)
    candidates.push({ url: mediaUrl(media, { preset: name, format: options.format })!, width, height: out?.height ?? null, descriptor: `${width}w` })
  }
  return candidates.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
}

/** Valeur de l'attribut `srcset`. */
export function srcsetAttribute(candidates: readonly SrcsetCandidate[]): string {
  return candidates.map(candidate => `${candidate.url} ${candidate.descriptor}`).join(', ')
}
