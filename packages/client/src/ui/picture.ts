import type { Media, TransformFormat } from '../types'
import { type ImageSourceRequest, type ImageSourceSet, imageSourceSet, type ImageTransform, parseAspect } from '../urls/image-sources'
import { FORMAT_MIME_TYPES } from '../urls/media-url'
import { pictureFormats } from '../urls/picture'
import { type ImageOptions, imageRequest } from './image'
import type { DisplaySettings } from './settings'

/** Cadrage d'une media query (direction artistique). */
export interface PictureArtSource {
  /** Media query (`(max-width: 640px)`). */
  media: string
  aspect?: number | string
  fit?: 'cover' | 'contain' | 'inside'
  transform?: ImageTransform
  widths?: number[]
  sizes?: string
  preset?: string
  presets?: string[]
}

/** Propriétés d'un `<picture>` : celles d'une image, les formats proposés et les cadrages. */
export interface PictureOptions extends Omit<ImageOptions, 'format'> {
  /** Formats proposés (parmi ceux activés sur le serveur). */
  formats?: readonly TransformFormat[]
  /** Cadrages par media query, du plus spécifique au plus général. */
  sources?: readonly PictureArtSource[]
}

/** Attributs d'une balise `<source>` (`key` : clé stable pour les listes des frameworks). */
export interface PictureSourceTag {
  key: string
  media?: string
  type: string
  srcset: string
  sizes?: string
  width?: number
  height?: number
}

export interface PictureSources {
  /** Balises `<source>`, dans l'ordre du document. */
  sources: PictureSourceTag[]
  /** Attributs de l'`<img>` de repli (JPEG, sinon PNG). */
  fallback: ImageSourceSet
}

function sourceTag(request: ImageSourceRequest, query: string | undefined): PictureSourceTag {
  const set = imageSourceSet(request)
  return {
    key: `${query ?? ''}|${request.format}`,
    media: query,
    type: FORMAT_MIME_TYPES[request.format],
    srcset: set.srcset ?? set.src,
    sizes: set.srcset ? set.sizes : undefined,
    width: set.width,
    height: set.height,
  }
}

/**
 * Contenu d'un `<picture>` : pour chaque cadrage (media query), une `<source>` par format proposé et activé
 * sur le serveur (AVIF, WebP) puis une au format de repli ; ensuite une `<source>` par format, sans media
 * query ; enfin l'image de repli. Un cadrage ne reprend de l'image que la transformation, les largeurs et
 * `sizes` qu'il ne redéfinit pas. Rendu serveur déterministe.
 */
export function pictureSources(media: Media, options: PictureOptions, display: DisplaySettings): PictureSources {
  const enabled = display.formats.filter(format => !options.formats || options.formats.includes(format))
  const formats = pictureFormats(enabled.length > 0 ? enabled : display.formats)
  const base = imageRequest(media, options, display)
  const sources: PictureSourceTag[] = []
  for (const art of options.sources ?? []) {
    const request: Omit<ImageSourceRequest, 'format'> = {
      ...base,
      aspect: parseAspect(art.aspect) ?? undefined,
      fit: art.fit,
      transform: art.transform ?? base.transform,
      widths: art.widths ?? base.widths,
      sizes: art.sizes ?? base.sizes,
      preset: art.preset,
      presetNames: art.presets,
      width: undefined,
      height: undefined,
    }
    for (const format of [...formats.sources, formats.fallback]) sources.push(sourceTag({ ...request, format }, art.media))
  }
  for (const format of formats.sources) sources.push(sourceTag({ ...base, format }, undefined))
  return { sources, fallback: imageSourceSet({ ...base, format: formats.fallback }) }
}
