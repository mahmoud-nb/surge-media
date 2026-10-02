import type { TransformFormat } from './transforms'

/**
 * Extraits HTML d'intégration d'une image transformée (générateur d'adresses de la fiche média,
 * phase C4) : <img> simple, <picture> à plusieurs formats, srcset 1x/2x. Fonctions pures (testées
 * dans tests/transforms.test.ts), réutilisables par une documentation ou un SDK.
 */

export type ImageSnippetKind = 'img' | 'picture' | 'srcset'

export interface ImageSnippetInput {
  /** Adresse du dérivé (signée si nécessaire), dans le format choisi. */
  url: string
  /** Adresse de la variante 2x (même transformation, densité doublée), si elle existe. */
  url2x?: string | null
  /** Dimensions du résultat (attributs width/height : pas de décalage au chargement). */
  width?: number | null
  height?: number | null
  alt: string
  /** Formats activés sur le serveur. */
  formats: readonly TransformFormat[]
  /** Format de l'adresse fournie. */
  format: TransformFormat
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
 * sinon le format choisi) quand au moins une source diffère du repli ; srcset 1x/2x si `url2x`.
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
  if (input.url2x) {
    snippets.push({ kind: 'srcset', code: img(input.url, ` srcset="${htmlAttribute(input.url)} 1x, ${htmlAttribute(input.url2x)} 2x"`) })
  }
  return snippets
}
