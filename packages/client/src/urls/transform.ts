/**
 * Transformations d'images de SurgeMedia (`/m/<id>/v<n>/<segment>/<nom>.<format>`), côté client : segment
 * en **forme canonique** (celle du serveur : une URL non canonique reçoit une redirection 301) et taille
 * réelle du fichier produit (le serveur n'agrandit jamais une image). Logique reprise du core
 * (apps/core/shared/utils/transforms.ts, server/lib/media/transform-plan.ts) et recoupée avec lui par les
 * tests (tests/transform.test.ts).
 */

export type TransformFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
export type TransformGravity
  = | 'focal'
    | 'center'
    | 'north'
    | 'northeast'
    | 'east'
    | 'southeast'
    | 'south'
    | 'southwest'
    | 'west'
    | 'northwest'
    | 'attention'
    | 'entropy'
export type TransformRotation = 0 | 90 | 180 | 270
export type TransformFlip = 'h' | 'v' | 'hv'

/** Zone à extraire, en pixels de l'image orientée puis tournée. */
export interface TransformRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface TransformOptions {
  /** Largeur et hauteur cibles (pixels) ; jamais d'agrandissement. */
  width?: number
  height?: number
  /** Stratégie quand largeur et hauteur sont fixées (`cover` par défaut). */
  fit?: TransformFit
  /** Ancrage de `cover` (`focal` par défaut : point d'intérêt du média, sinon le centre). */
  gravity?: TransformGravity
  crop?: TransformRegion
  rotate?: TransformRotation
  flip?: TransformFlip
  /** Qualité 1 à 100 (défaut du serveur selon le format). */
  quality?: number
  /** Fond `rrggbb` (`fit: 'contain'`, transparence convertie en JPEG). */
  background?: string
  /** Densité de pixels (1 à 3 par pas de 0,5) : multiplie largeur et hauteur. */
  dpr?: number
}

/** Dimension maximale par défaut d'un dérivé (`NUXT_MEDIA_TRANSFORM_MAX_DIMENSION`). */
export const DEFAULT_MAX_DIMENSION = 4096
const MAX_DPR = 3

/** Transformation normalisée : valeurs validées, densité appliquée, défauts retirés. */
interface NormalizedTransform {
  width: number | null
  height: number | null
  fit: TransformFit
  gravity: TransformGravity
  crop: TransformRegion | null
  rotate: TransformRotation
  flip: TransformFlip | null
  quality: number | null
  background: string | null
}

function positiveInteger(value: number | undefined, name: string): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value) || value < 1) throw new RangeError(`${name} must be a positive number.`)
  return Math.round(value)
}

/**
 * Normalise des options comme le serveur : dimensions bornées à `maxDimension` (réduites ensemble pour
 * garder le rapport), densité appliquée puis retirée, ajustement et ancrage seulement avec les deux
 * dimensions. Une valeur impossible lève une `RangeError` (erreur de programmation).
 */
function normalize(options: TransformOptions, maxDimension: number): NormalizedTransform {
  let width = positiveInteger(options.width, 'width')
  let height = positiveInteger(options.height, 'height')
  const largest = Math.max(width ?? 0, height ?? 0)
  if (largest > maxDimension) {
    const k = maxDimension / largest
    if (width) width = Math.max(1, Math.round(width * k))
    if (height) height = Math.max(1, Math.round(height * k))
  }
  const dpr = options.dpr ?? 1
  if (!(dpr >= 1 && dpr <= MAX_DPR) || (dpr * 2) % 1 !== 0) throw new RangeError(`dpr must be 1 to ${MAX_DPR} in steps of 0.5.`)
  if (dpr !== 1 && (width || height)) {
    const scaled = Math.max(width ?? 0, height ?? 0) * dpr
    const factor = scaled > maxDimension ? (dpr * maxDimension) / scaled : dpr
    if (width) width = Math.max(1, Math.round(width * factor))
    if (height) height = Math.max(1, Math.round(height * factor))
  }
  const box = Boolean(width && height)
  const fit = box ? options.fit ?? 'cover' : 'cover'
  const gravity = box && fit === 'cover' ? options.gravity ?? 'focal' : 'focal'

  const quality = positiveInteger(options.quality, 'quality')
  if (quality !== null && quality > 100) throw new RangeError('quality must be 1 to 100.')
  let background: string | null = null
  if (options.background !== undefined) {
    background = options.background.replace(/^#/, '').toLowerCase()
    if (!/^[0-9a-f]{6}$/.test(background)) throw new RangeError('background must be a colour as rrggbb.')
  }
  const rotate = options.rotate ?? 0
  if (![0, 90, 180, 270].includes(rotate)) throw new RangeError('rotate must be 0, 90, 180 or 270.')
  let crop: TransformRegion | null = null
  if (options.crop) {
    const { x, y } = options.crop
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new RangeError('crop x and y must be integers from 0.')
    crop = { x, y, width: positiveInteger(options.crop.width, 'crop.width')!, height: positiveInteger(options.crop.height, 'crop.height')! }
  }
  return { width, height, fit, gravity, crop, rotate, flip: options.flip ?? null, quality, background }
}

function format(t: NormalizedTransform): string {
  const parts: string[] = []
  if (t.rotate) parts.push(`r_${t.rotate}`)
  if (t.flip) parts.push(`flip_${t.flip}`)
  if (t.crop) parts.push(`crop_${t.crop.x}-${t.crop.y}-${t.crop.width}-${t.crop.height}`)
  if (t.width) parts.push(`w_${t.width}`)
  if (t.height) parts.push(`h_${t.height}`)
  const box = Boolean(t.width && t.height)
  if (box && t.fit !== 'cover') parts.push(`fit_${t.fit}`)
  if (box && t.fit === 'cover' && t.gravity !== 'focal') parts.push(`g_${t.gravity}`)
  if (t.quality) parts.push(`q_${t.quality}`)
  if (t.background) parts.push(`bg_${t.background}`)
  return parts.join(',')
}

/**
 * Paramètres de transformation en forme canonique (`w_800,h_450,q_70`) ; chaîne vide = aucune
 * transformation (segment `full`).
 */
export function buildTransform(options: TransformOptions, maxDimension = DEFAULT_MAX_DIMENSION): string {
  return format(normalize(options, maxDimension))
}

/** Segment d'URL d'une transformation canonique : la transformation vide s'écrit `full`. */
export function transformSegment(canonical: string): string {
  return canonical === '' ? 'full' : canonical
}

const size = (value: number) => Math.max(1, Math.round(value))

/**
 * Dimensions du fichier que le serveur produira pour ces options sur une image `source` (orientée) :
 * jamais d'agrandissement, borne `maxDimension` (portage de `planTransform`). Null si la zone de
 * recadrage sort de l'image.
 */
export function outputSize(
  options: TransformOptions,
  source: { width: number, height: number },
  maxDimension = DEFAULT_MAX_DIMENSION,
): { width: number, height: number } | null {
  const t = normalize(options, maxDimension)
  const quarter = t.rotate === 90 || t.rotate === 270
  const rotatedWidth = quarter ? source.height : source.width
  const rotatedHeight = quarter ? source.width : source.height
  let W = rotatedWidth
  let H = rotatedHeight
  if (t.crop) {
    if (t.crop.x + t.crop.width > rotatedWidth || t.crop.y + t.crop.height > rotatedHeight) return null
    W = t.crop.width
    H = t.crop.height
  }

  let out = { width: W, height: H }
  let scaled = true
  if (t.width && t.height) {
    const w = t.width
    const h = t.height
    if (t.fit === 'cover' || t.fit === 'fill') {
      const k = Math.min(1, W / w, H / h)
      out = { width: size(w * k), height: size(h * k) }
      scaled = proportional(W, H, out.width, out.height)
    }
    else if (t.fit === 'contain') {
      const k = Math.min(1, Math.max(W / w, H / h))
      out = { width: size(w * k), height: size(h * k) }
      scaled = proportional(W, H, out.width, out.height)
    }
    else {
      const s = t.fit === 'inside' ? Math.min(1, w / W, h / H) : Math.min(1, Math.max(w / W, h / H))
      out = { width: size(W * s), height: size(H * s) }
    }
  }
  else if (t.width) {
    const s = Math.min(1, t.width / W)
    out = { width: size(W * s), height: size(H * s) }
  }
  else if (t.height) {
    const s = Math.min(1, t.height / H)
    out = { width: size(W * s), height: size(H * s) }
  }
  if (scaled && (out.width > maxDimension || out.height > maxDimension)) {
    const s = Math.min(maxDimension / W, maxDimension / H)
    out = { width: size(W * s), height: size(H * s) }
  }
  return out
}

function proportional(sourceWidth: number, sourceHeight: number, width: number, height: number): boolean {
  return size((sourceHeight * width) / sourceWidth) === height || size((sourceWidth * height) / sourceHeight) === width
}

/**
 * Lecture simple d'une transformation canonique (`transformation` d'un préréglage) : dimensions et
 * ajustement, pour calculer la largeur d'un préréglage dans un srcset. Paramètre inconnu : ignoré.
 */
export function parseTransform(segment: string): TransformOptions {
  const options: TransformOptions = {}
  for (const part of segment === 'full' ? [] : segment.split(',')) {
    const [key, value = ''] = part.split(/_(.*)/s)
    const number = Number(value)
    switch (key) {
      case 'w': options.width = number; break
      case 'h': options.height = number; break
      case 'fit': options.fit = value as TransformFit; break
      case 'g': options.gravity = value as TransformGravity; break
      case 'r': options.rotate = number as TransformRotation; break
      case 'flip': options.flip = value as TransformFlip; break
      case 'q': options.quality = number; break
      case 'bg': options.background = value; break
      case 'dpr': options.dpr = number; break
      case 'crop': {
        const [x, y, width, height] = value.split('-').map(Number)
        if (x !== undefined && y !== undefined && width && height) options.crop = { x, y, width, height }
        break
      }
    }
  }
  return options
}
