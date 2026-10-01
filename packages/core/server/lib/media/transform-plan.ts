import {
  TRANSFORM_DEFAULT_QUALITY,
  type TransformFlip,
  type TransformFormat,
  type Transformation,
  type TransformRegion,
  type TransformRotation,
} from '#shared/utils/transforms'

/**
 * Opération effective d'une transformation sur un média précis (fonction pure, testée dans
 * tests/transforms.test.ts) : la demande canonique est confrontée aux dimensions de l'image.
 *
 *  - zone hors de l'image (après orientation et rotation) → erreur (400 INVALID_TRANSFORM) ;
 *  - **jamais d'agrandissement** : une demande plus grande que la source est réduite du même facteur
 *    en **gardant le rapport demandé** (sharp, avec `withoutEnlargement`, rendrait l'image entière
 *    sans recadrage) ;
 *  - sortie bornée à `maxDimension` (une image plus grande que la borne est réduite d'office) ;
 *  - redimensionnements proportionnels exprimés en dimensions exactes (`fill`), recadrage par point
 *    d'intérêt calculé ici (zone extraite), autres ancrages confiés à sharp.
 *
 * `key` identifie le fichier produit : des demandes différentes qui produisent la même image
 * (`w_1600` et `w_5000` sur une image de 1200 px) partagent un seul dérivé.
 */

export interface TransformSource {
  /** Dimensions de l'image orientée (EXIF appliqué), telles qu'enregistrées sur le média. */
  width: number
  height: number
  hasAlpha: boolean
  /** Point d'intérêt (0 à 1, origine en haut à gauche de l'image orientée). */
  focal: { x: number, y: number } | null
}

export interface TransformPlan {
  rotate: TransformRotation
  flip: TransformFlip | null
  /** Zone extraite après rotation et miroir (recadrage demandé et/ou point d'intérêt). */
  extract: TransformRegion | null
  resize: {
    width: number
    height: number
    fit: 'fill' | 'cover' | 'contain'
    /** Ancrage sharp (`fit: cover`) : centre, points cardinaux, `attention`, `entropy`. */
    position?: string
    /** Fond `rrggbb` de `contain`, ou null pour un fond transparent. */
    background?: string | null
  } | null
  /** Aplatissement de la transparence sur cette couleur (sortie JPEG d'une image avec alpha). */
  flatten: string | null
  format: TransformFormat
  /** Qualité d'encodage ; PNG : null = sans perte, sinon palette. */
  quality: number | null
  /** Dimensions de l'image produite. */
  width: number
  height: number
  /** Identifiant de l'opération effective, format compris (`size_800x533,q_80.webp`). */
  key: string
}

export type TransformPlanResult = { ok: true, plan: TransformPlan } | { ok: false, message: string }

const size = (value: number) => Math.max(1, Math.round(value))

/** `w × h` est-il une simple réduction de `W × H` (même rapport, à l'arrondi près) ? */
function proportional(sourceWidth: number, sourceHeight: number, width: number, height: number): boolean {
  return size((sourceHeight * width) / sourceWidth) === height || size((sourceWidth * height) / sourceHeight) === width
}

/** Point d'intérêt (image orientée) → coordonnées après rotation horaire et miroir. */
function mapFocal(focal: { x: number, y: number }, rotate: TransformRotation, flip: TransformFlip | null): { x: number, y: number } {
  let { x, y } = focal
  if (rotate === 90) [x, y] = [1 - y, x]
  else if (rotate === 180) [x, y] = [1 - x, 1 - y]
  else if (rotate === 270) [x, y] = [y, 1 - x]
  if (flip?.includes('h')) x = 1 - x
  if (flip?.includes('v')) y = 1 - y
  return { x, y }
}

export function planTransform(
  t: Transformation,
  source: TransformSource,
  format: TransformFormat,
  maxDimension: number,
): TransformPlanResult {
  const quarter = t.rotate === 90 || t.rotate === 270
  const rotatedWidth = quarter ? source.height : source.width
  const rotatedHeight = quarter ? source.width : source.height

  // 1. Zone demandée, en pixels de l'image orientée puis tournée.
  let region: TransformRegion = { x: 0, y: 0, width: rotatedWidth, height: rotatedHeight }
  if (t.crop) {
    const { x, y, width, height } = t.crop
    if (x + width > rotatedWidth || y + height > rotatedHeight) {
      return { ok: false, message: `The crop area exceeds the image (${rotatedWidth}×${rotatedHeight} after rotation).` }
    }
    region = { ...t.crop }
  }
  const W = region.width
  const H = region.height

  // 2. Dimensions de sortie, sans agrandissement.
  let out = { width: W, height: H }
  let mode: 'scale' | 'fill' | 'cover' | 'contain' = 'scale'
  if (t.width && t.height) {
    const w = t.width
    const h = t.height
    if (t.fit === 'cover' || t.fit === 'fill') {
      const k = Math.min(1, W / w, H / h)
      out = { width: size(w * k), height: size(h * k) }
      mode = proportional(W, H, out.width, out.height) ? 'scale' : t.fit
    }
    else if (t.fit === 'contain') {
      // Boîte réduite tant que l'image devrait y être agrandie.
      const k = Math.min(1, Math.max(W / w, H / h))
      out = { width: size(w * k), height: size(h * k) }
      mode = proportional(W, H, out.width, out.height) ? 'scale' : 'contain'
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

  // 3. Borne de sortie (seule une réduction proportionnelle peut la dépasser : les boîtes demandées y sont déjà).
  if (mode === 'scale' && (out.width > maxDimension || out.height > maxDimension)) {
    const s = Math.min(maxDimension / W, maxDimension / H)
    out = { width: size(W * s), height: size(H * s) }
  }

  // 4. Recadrage `cover` : point d'intérêt (zone calculée ici), sinon ancrage de sharp.
  let resize: TransformPlan['resize'] = null
  if (mode === 'cover' && t.gravity === 'focal' && source.focal) {
    const point = mapFocal(source.focal, t.rotate, t.flip)
    const px = point.x * rotatedWidth - region.x
    const py = point.y * rotatedHeight - region.y
    const wider = W / H > out.width / out.height
    const width = wider ? Math.min(W, size((H * out.width) / out.height)) : W
    const height = wider ? H : Math.min(H, size((W * out.height) / out.width))
    const left = Math.min(Math.max(Math.round(px - width / 2), 0), W - width)
    const top = Math.min(Math.max(Math.round(py - height / 2), 0), H - height)
    region = { x: region.x + left, y: region.y + top, width, height }
    resize = { width: out.width, height: out.height, fit: 'fill' }
  }
  else if (mode === 'cover') {
    const position = t.gravity === 'focal' || t.gravity === 'center' ? 'centre' : t.gravity
    resize = { width: out.width, height: out.height, fit: 'cover', position }
  }
  else if (mode === 'contain') {
    resize = { width: out.width, height: out.height, fit: 'contain', background: t.background ?? (format === 'jpg' ? 'ffffff' : null) }
  }
  else if (out.width !== region.width || out.height !== region.height) {
    resize = { width: out.width, height: out.height, fit: 'fill' }
  }

  const extract = region.x === 0 && region.y === 0 && region.width === rotatedWidth && region.height === rotatedHeight ? null : region
  const flatten = format === 'jpg' && source.hasAlpha ? (t.background ?? 'ffffff') : null
  const quality = t.quality ?? TRANSFORM_DEFAULT_QUALITY[format]

  const parts: string[] = []
  if (t.rotate) parts.push(`r_${t.rotate}`)
  if (t.flip) parts.push(`flip_${t.flip}`)
  if (extract) parts.push(`crop_${extract.x}-${extract.y}-${extract.width}-${extract.height}`)
  if (resize) {
    parts.push(`size_${resize.width}x${resize.height}`)
    if (resize.fit === 'cover') parts.push(`fit_cover`, `g_${resize.position}`)
    if (resize.fit === 'contain') parts.push(`fit_contain`, `bg_${resize.background ?? 'none'}`)
  }
  if (flatten) parts.push(`flatten_${flatten}`)
  if (quality) parts.push(`q_${quality}`)

  return {
    ok: true,
    plan: {
      rotate: t.rotate,
      flip: t.flip,
      extract,
      resize,
      flatten,
      format,
      quality,
      width: out.width,
      height: out.height,
      key: `${parts.join(',') || 'full'}.${format}`,
    },
  }
}
