import type { Readable } from 'node:stream'
import sharp from 'sharp'
import { mediaError } from '../errors'
import type { MediaTypeHandler } from './types'

/**
 * Plafond de pixels décodés (toutes pages d'une image animée comprises) : protège contre les
 * « bombes de décompression », petits fichiers qui occuperaient des gigaoctets une fois décodés.
 */
const MAX_PIXELS = 100_000_000
const PREVIEW_SIZE = 480

// Cache d'opérations libvips désactivé : il garde les fichiers d'entrée ouverts (verrouillés
// sous Windows, ce qui empêche la suppression des fichiers temporaires) pour un gain nul ici.
sharp.cache(false)

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

  async preview(source: Readable) {
    // Première image seulement, orientation EXIF appliquée ; la sortie ne contient aucune
    // métadonnée (EXIF, GPS…).
    const transformer = sharp({ limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: PREVIEW_SIZE, height: PREVIEW_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
    source.pipe(transformer)
    const { data, info } = await transformer.toBuffer({ resolveWithObject: true })
    return { data, mimeType: 'image/webp', extension: 'webp', width: info.width, height: info.height }
  },
}
