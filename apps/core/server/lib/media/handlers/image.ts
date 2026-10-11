import type { Readable } from 'node:stream'
import sharp from 'sharp'
import { TRANSFORM_MIME_TYPES } from '#shared/utils/transforms'
import { mediaError } from '../errors'
import type { TransformPlan } from '../transform-plan'
import type { MediaTypeHandler } from './types'

/**
 * Plafond de pixels décodés (toutes pages d'une image animée comprises) : protège contre les
 * « bombes de décompression », petits fichiers qui occuperaient des gigaoctets une fois décodés.
 */
const MAX_PIXELS = 100_000_000
/** Effort d'encodage AVIF (0 à 9, défaut de sharp : 4) : réduit, l'AVIF étant coûteux en calcul. */
const AVIF_EFFORT = 2

/** Côté maximal d'une image d'affiche de vidéo (phase D2) : au-delà, réduite. */
export const POSTER_MAX_DIMENSION = 3840
const POSTER_QUALITY = 90

// Cache d'opérations libvips désactivé : il garde les fichiers d'entrée ouverts (verrouillés
// sous Windows, ce qui empêche la suppression des fichiers temporaires) pour un gain nul ici.
sharp.cache(false)

/**
 * Image d'affiche d'une vidéo (phase D2) : première image, orientation appliquée, 3840 px au plus,
 * transparence aplatie sur du noir, JPEG sans métadonnées (EXIF, GPS d'une photo). Le fichier a déjà
 * été vérifié par `inspect` (dimensions) ; à appeler dans la file des traitements.
 */
export async function normalizePoster(path: string): Promise<{ data: Buffer, width: number, height: number }> {
  try {
    const { data, info } = await sharp(path, { limitInputPixels: MAX_PIXELS })
      .autoOrient()
      .resize({ width: POSTER_MAX_DIMENSION, height: POSTER_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#000000' })
      .jpeg({ quality: POSTER_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  }
  catch {
    throw mediaError(422, 'UNREADABLE_FILE')
  }
}

export const imageHandler: MediaTypeHandler = {
  kind: 'IMAGE',

  async inspect(path) {
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
    try {
      // Lecture de l'en-tête seulement (aucun décodage) : sans limite, pour pouvoir signaler
      // précisément une image trop grande ci-dessous.
      meta = await sharp(path, { limitInputPixels: false }).metadata()
    }
    catch {
      throw mediaError(422, 'UNREADABLE_FILE')
    }
    if (!meta.width || !meta.height) throw mediaError(422, 'UNREADABLE_FILE')

    const pages = meta.pages ?? 1
    const frameHeight = meta.pageHeight ?? meta.height
    if (meta.width * frameHeight * pages > MAX_PIXELS) {
      throw mediaError(422, 'DIMENSIONS_TOO_LARGE', { maxPixels: MAX_PIXELS })
    }

    // Orientation EXIF 5 à 8 : l'image s'affiche pivotée d'un quart de tour.
    const rotated = (meta.orientation ?? 1) >= 5
    return {
      width: rotated ? frameHeight : meta.width,
      height: rotated ? meta.width : frameHeight,
      duration: null,
      metadata: {
        format: meta.format ?? null,
        orientation: meta.orientation ?? null,
        space: meta.space ?? null,
        hasAlpha: meta.hasAlpha ?? false,
        pages,
        animated: pages > 1,
        density: meta.density ?? null,
        hasExif: Boolean(meta.exif),
        hasIccProfile: Boolean(meta.icc),
      },
    }
  },

  async transform(source: Readable, plan: TransformPlan) {
    // Première image seulement, orientation EXIF appliquée ; la sortie ne contient aucune
    // métadonnée (EXIF, GPS, profil : conversion en sRVB).
    let pipeline = sharp({ limitInputPixels: MAX_PIXELS }).autoOrient()

    // Ordre validé : rotation puis miroir. sharp applique toujours le miroir avant la rotation
    // explicite ; après un quart de tour, un miroir horizontal équivaut à un miroir vertical
    // appliqué avant (et inversement).
    const quarter = plan.rotate === 90 || plan.rotate === 270
    const horizontal = plan.flip?.includes('h') ?? false
    const vertical = plan.flip?.includes('v') ?? false
    if (quarter ? vertical : horizontal) pipeline = pipeline.flop()
    if (quarter ? horizontal : vertical) pipeline = pipeline.flip()
    if (plan.rotate) pipeline = pipeline.rotate(plan.rotate)

    if (plan.extract) {
      const { x, y, width, height } = plan.extract
      pipeline = pipeline.extract({ left: x, top: y, width, height })
    }
    if (plan.resize) {
      const { width, height, fit, position, background } = plan.resize
      pipeline = pipeline.resize({
        width,
        height,
        fit,
        position,
        background: background ? `#${background}` : { r: 0, g: 0, b: 0, alpha: 0 },
      })
    }
    if (plan.flatten) pipeline = pipeline.flatten({ background: `#${plan.flatten}` })

    const quality = plan.quality ?? undefined
    switch (plan.format) {
      case 'jpg':
        pipeline = pipeline.jpeg({ quality, mozjpeg: true })
        break
      case 'png':
        // Sans perte, sauf qualité demandée : palette (quantification).
        pipeline = pipeline.png(quality ? { palette: true, quality } : {})
        break
      case 'webp':
        pipeline = pipeline.webp({ quality })
        break
      case 'avif':
        pipeline = pipeline.avif({ quality, effort: AVIF_EFFORT })
        break
    }

    source.pipe(pipeline)
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    return { data, mimeType: TRANSFORM_MIME_TYPES[plan.format], extension: plan.format, width: info.width, height: info.height }
  },
}
