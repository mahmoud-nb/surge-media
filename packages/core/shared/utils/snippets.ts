import type { TransformFormat } from './transforms'
import { videoSourceType } from './video'

/**
 * Extraits HTML d'intégration d'une image transformée (générateur d'adresses de la fiche média,
 * phase C4) : <img> simple, <picture> à plusieurs formats, srcset par densité (1x, 2x, 3x). Fonctions
 * pures (testées dans tests/transforms.test.ts), réutilisables par une documentation ou un SDK.
 */

export type ImageSnippetKind = 'img' | 'picture' | 'srcset'

export interface ImageSnippetInput {
  /** Adresse du dérivé (signée si nécessaire), dans le format choisi. */
  url: string
  /** Taille d'affichage en pixels CSS (attributs width/height : pas de décalage au chargement). */
  width?: number | null
  height?: number | null
  alt: string
  /** Formats activés sur le serveur. */
  formats: readonly TransformFormat[]
  /** Format de l'adresse fournie. */
  format: TransformFormat
  /** Variantes par densité, 1x en premier (même transformation, dimensions multipliées). */
  densities?: readonly { density: number, url: string }[] | null
}

/** Valeur d'attribut HTML échappée (les « & » des paramètres de signature compris). */
export function htmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Même dérivé dans un autre format : seule l'extension change (la signature éventuelle couvre la
 * transformation, jamais le format : architecture phase C, CD5).
 */
export function withTransformFormat(url: string, format: TransformFormat): string {
  return url.replace(/\.(jpg|png|webp|avif)(?=[?#]|$)/, `.${format}`)
}

/**
 * Extraits proposés : <img> ; <picture> (sources AVIF puis WebP si activés, repli JPEG, sinon PNG,
 * sinon le format choisi) quand au moins une source diffère du repli ; srcset quand au moins deux
 * densités sont fournies (l'image 1x sert de `src`).
 */
export function imageSnippets(input: ImageSnippetInput): { kind: ImageSnippetKind, code: string }[] {
  const size = input.width && input.height ? ` width="${input.width}" height="${input.height}"` : ''
  const alt = htmlAttribute(input.alt)
  const img = (src: string, extra = '') => `<img src="${htmlAttribute(src)}"${extra}${size} alt="${alt}" loading="lazy">`

  const snippets: { kind: ImageSnippetKind, code: string }[] = [{ kind: 'img', code: img(input.url) }]
  const fallback = (['jpg', 'png'] as const).find(format => input.formats.includes(format)) ?? input.format
  const sources = (['avif', 'webp'] as const).filter(format => input.formats.includes(format) && format !== fallback)
  if (sources.length > 0) {
    snippets.push({
      kind: 'picture',
      code: [
        '<picture>',
        ...sources.map(format => `  <source type="image/${format}" srcset="${htmlAttribute(withTransformFormat(input.url, format))}">`),
        `  ${img(withTransformFormat(input.url, fallback))}`,
        '</picture>',
      ].join('\n'),
    })
  }
  const densities = input.densities ?? []
  if (densities.length >= 2) {
    const srcset = densities.map(({ density, url }) => `${htmlAttribute(url)} ${density}x`).join(', ')
    snippets.push({ kind: 'srcset', code: img(densities[0]!.url, ` srcset="${srcset}"`) })
  }
  return snippets
}

export interface VideoSnippetInput {
  /** Adresse du fichier (signée si le média est privé). */
  url: string
  mimeType: string
  /** Chaîne RFC 6381 des codecs, si elle est connue (type de la source). */
  codecs: string | null
  /**
   * Sources du lecteur par ordre de préférence (phase D3 : rendus AV1 puis H.264, ou l'original), `type`
   * avec ses codecs ; absentes ou vides = l'original seul (`url`, `mimeType`, `codecs`).
   */
  sources?: readonly { url: string, type: string }[]
  /** Dimensions affichées : rapport d'aspect réservé avant le chargement. */
  width?: number | null
  height?: number | null
  /** Nom accessible du lecteur (texte alternatif ou titre), vide = aucun. */
  label: string
  /** Image d'affiche (attribut `poster`), absente = aucune. */
  poster?: string | null
  /** Pistes de texte (éléments `<track>`) : adresses absolues, signées si le média est privé. */
  tracks?: readonly { src: string, kind: string, srclang: string, label: string, default: boolean }[]
}

/**
 * Extrait HTML d'intégration d'une vidéo (phases D1 à D3) : lecteur natif avec ses commandes, sans
 * lecture automatique (WCAG 1.4.2), métadonnées seulement chargées à l'avance, un `<source>` par source
 * dans l'ordre de préférence (le navigateur prend la première qu'il sait lire : AV1, puis H.264), type
 * avec ses codecs pour qu'il sache s'il peut la lire sans la télécharger (un MOV est annoncé
 * `video/mp4`, shared/utils/video.ts). Pure, testée (tests/transforms.test.ts).
 */
export function videoSnippet(input: VideoSnippetInput): string {
  const attributes = [
    'controls',
    'preload="metadata"',
    'playsinline',
    ...(input.width && input.height ? [`width="${input.width}"`, `height="${input.height}"`, 'style="max-width: 100%; height: auto"'] : []),
    ...(input.poster ? [`poster="${htmlAttribute(input.poster)}"`] : []),
    // Pistes servies par un autre domaine que la page : lues seulement en mode CORS.
    ...(input.tracks?.length ? ['crossorigin="anonymous"'] : []),
    ...(input.label ? [`aria-label="${htmlAttribute(input.label)}"`] : []),
  ]
  const sources = input.sources?.length ? input.sources : [{ url: input.url, type: videoSourceType(input.mimeType, input.codecs) }]
  const tracks = (input.tracks ?? []).map(track =>
    `\n  <track kind="${htmlAttribute(track.kind)}" srclang="${htmlAttribute(track.srclang)}" label="${htmlAttribute(track.label)}" src="${htmlAttribute(track.src)}"${track.default ? ' default' : ''}>`)
  const sourceTags = sources.map(source => `\n  <source src="${htmlAttribute(source.url)}" type="${htmlAttribute(source.type)}">`)
  return `<video ${attributes.join(' ')}>${sourceTags.join('')}${tracks.join('')}\n</video>`
}
