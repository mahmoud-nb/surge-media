import type { TransformMode } from '../policy'
import type { Media, Preset, TransformFormat } from '../types'
import { mediaUrl } from './media-url'
import { densityCandidates, derivedSourceSize, presetCandidates, type SrcsetCandidate, srcsetAttribute, widthCandidates } from './srcset'
import { outputSize, parseTransform, type TransformFit, type TransformOptions } from './transform'

/**
 * Attributs d'une image (`<img>` ou `<source>`) pour un média et un format : `src`, `srcset`, `sizes` et
 * dimensions, selon la politique du projet (paramètres libres ou préréglages). Fonction pure, sans framework :
 * le cœur des composants d'image de toutes les librairies (@surge-media/vue, puis React et Svelte, et celles
 * que les utilisateurs écrivent pour d'autres frameworks). Rendu serveur déterministe.
 */

/** Paramètres de rendu laissés à l'appelant (le reste est calculé). */
export type ImageTransform = Omit<TransformOptions, 'width' | 'height' | 'dpr' | 'fit'>

export interface ImageSourceRequest {
  media: Media
  format: TransformFormat
  mode: TransformMode
  maxDimension: number
  /** Préréglages connus (intégrés + projet). */
  presets: readonly Preset[]
  /** Taille d'affichage fixe (pixels CSS) : srcset en densités, sauf si `sizes` est donné. */
  width?: number
  height?: number
  /** Rapport largeur / hauteur imposé (recadrage). */
  aspect?: number
  fit?: Extract<TransformFit, 'cover' | 'contain' | 'inside'>
  transform?: ImageTransform
  /** Un préréglage. */
  preset?: string
  /** Plusieurs préréglages : srcset en largeurs (politique `presets`). */
  presetNames?: readonly string[]
  widths?: readonly number[]
  sizes?: string
}

export interface ImageSourceSet {
  src: string
  srcset?: string
  sizes?: string
  /** Dimensions des attributs `width` / `height` (rapport réservé, aucun décalage au chargement). */
  width?: number
  height?: number
  /** Largeur fluide (`max-width: 100%`) plutôt que taille fixe. */
  responsive: boolean
}

/** Préréglages par défaut quand seuls les préréglages sont permis : l'aperçu puis l'image entière. */
const FALLBACK_PRESETS = ['preview', 'full'] as const

/** Rapport `16/9`, `1.5` ou `16:9` → nombre ; null s'il est illisible. */
export function parseAspect(value: number | string | undefined): number | null {
  if (value === undefined || value === '') return null
  if (typeof value === 'number') return value > 0 && Number.isFinite(value) ? value : null
  const [a, b] = value.split(/[/:]/).map(part => Number(part.trim()))
  const ratio = b === undefined ? a : a! / b
  return ratio !== undefined && ratio > 0 && Number.isFinite(ratio) ? ratio : null
}

/** URL du candidat à donner à `src` : le plus proche de 1024 px sans le dépasser, sinon le plus petit. */
function fallbackCandidate(candidates: readonly SrcsetCandidate[]): SrcsetCandidate {
  const sized = candidates.filter(candidate => (candidate.width ?? 0) <= 1024)
  return sized.at(-1) ?? candidates[0]!
}

function fromCandidates(candidates: readonly SrcsetCandidate[], sizes: string | undefined): ImageSourceSet | null {
  if (candidates.length === 0) return null
  const largest = candidates.at(-1)!
  return {
    src: fallbackCandidate(candidates).url,
    srcset: srcsetAttribute(candidates),
    sizes: sizes ?? '100vw',
    width: largest.width ?? undefined,
    height: largest.height ?? undefined,
    responsive: true,
  }
}

/** Dimensions d'affichage d'une taille fixe : celles données, sinon déduites du rapport de l'image produite. */
function displaySize(width: number | undefined, height: number | undefined, produced: { width?: number | null, height?: number | null } | undefined) {
  if (width && height) return { width, height }
  if (produced?.width && produced.height) {
    if (width) return { width, height: Math.round((width * produced.height) / produced.width) }
    if (height) return { width: Math.round((height * produced.width) / produced.height), height }
  }
  return { width, height }
}

export function imageSourceSet(request: ImageSourceRequest): ImageSourceSet {
  const { media, format, maxDimension } = request
  const source = derivedSourceSize(media)
  const fixed = Boolean((request.width || request.height) && !request.sizes)

  // Sans dérivé possible (vidéo sans affiche…) : le fichier tel quel.
  if (!media.urlTemplate) {
    return { src: media.url, width: request.width ?? media.width ?? undefined, height: request.height ?? media.height ?? undefined, responsive: !fixed }
  }

  // Un préréglage nommé.
  if (request.preset) {
    const preset = request.presets.find(item => item.name === request.preset)
    const produced = preset && source ? outputSize(parseTransform(preset.transformation), source, maxDimension) : null
    const size = fixed ? displaySize(request.width, request.height, produced ?? undefined) : { width: produced?.width, height: produced?.height }
    return { src: mediaUrl(media, { preset: request.preset, format })!, width: size.width ?? undefined, height: size.height ?? undefined, responsive: !fixed }
  }

  // Plusieurs préréglages, ou préréglages imposés par la politique du projet.
  const names = request.presetNames?.length ? request.presetNames : request.mode === 'presets' ? FALLBACK_PRESETS : null
  if (names) {
    const set = fromCandidates(presetCandidates(media, names, request.presets, { format, maxDimension }), request.sizes)
    if (set) return fixed ? { ...set, ...displaySize(request.width, request.height, set), responsive: false } : set
    return { src: mediaUrl(media, { preset: names[0], format })!, responsive: !fixed }
  }

  // Paramètres libres.
  const aspect = request.aspect ?? (request.width && request.height ? request.width / request.height : undefined)
  const fit = request.fit ?? (aspect ? 'cover' : undefined)
  const transform: Omit<TransformOptions, 'width' | 'height' | 'dpr'> = { ...request.transform, ...(fit ? { fit } : {}) }

  if (fixed) {
    const width = request.width ?? (aspect && request.height ? Math.round(request.height * aspect) : undefined)
    const height = request.height ?? (aspect && request.width ? Math.round(request.width / aspect) : undefined)
    const candidates = densityCandidates(media, { width, height, transform, format, maxDimension })
    const first = candidates[0]!
    const size = displaySize(width, height, first)
    return {
      src: first.url,
      srcset: candidates.length > 1 ? srcsetAttribute(candidates) : undefined,
      width: size.width,
      height: size.height,
      responsive: false,
    }
  }
  return fromCandidates(widthCandidates(media, { widths: request.widths, aspect, transform, format, maxDimension }), request.sizes)
    ?? { src: media.url, width: media.width ?? undefined, height: media.height ?? undefined, responsive: true }
}
