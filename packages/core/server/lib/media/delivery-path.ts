import {
  isPresetName,
  isTransformationSegment,
  parseTransformation,
  parseTransformFormat,
  transformationSegment,
  type TransformFormat,
  type Transformation,
  type TransformLimits,
} from '#shared/utils/transforms'
import { RENDITION_FORMATS, RENDITION_NAMES, type RenditionName } from '#shared/utils/video-processing'

/**
 * Analyse des chemins de diffusion /m/ (fonction pure, testée dans tests/transforms.test.ts,
 * tests/tracks-delivery.test.ts et tests/renditions-delivery.test.ts) :
 *
 *   <id>/v<n>/<nom>                        original (extension indicative)
 *   <id>/v<n>/<préréglage>/<nom>.<format>  préréglage nommé
 *   <id>/v<n>/<paramètres>/<nom>.<format>  transformation libre (clé_valeur, …)
 *   <id>/v<n>/tracks/<piste>.vtt            piste de texte d'une vidéo (phase D2)
 *   <id>/v<n>/renditions/<rendu>.<ext>      rendu d'une vidéo produit par ffmpeg (phase D3) :
 *                                          `h264.mp4` ou `av1.webm`, rien d'autre
 *
 * Une transformation ou une extension non canonique donne une redirection (301) vers la forme
 * canonique ; une transformation invalide, une erreur 400 ; tout autre chemin, null (404).
 */

/** Segment des pistes de texte dans les chemins de diffusion. */
export const TRACKS_SEGMENT = 'tracks'
/** Segment des rendus d'une vidéo dans les chemins de diffusion (nom de préréglage réservé). */
export const RENDITIONS_SEGMENT = 'renditions'

interface TargetBase {
  id: string
  version: number
  /** Nom de fichier de l'URL : indicatif, ignoré pour retrouver le fichier. */
  filename: string
}

export type DeliveryTarget =
  | TargetBase & { kind: 'original' }
  | TargetBase & { kind: 'track', trackId: string }
  | TargetBase & { kind: 'rendition', name: RenditionName, container: 'mp4' | 'webm' }
  | TargetBase & { kind: 'preset', preset: string, format: TransformFormat }
  | TargetBase & { kind: 'transform', transformation: Transformation, canonical: string, format: TransformFormat }

export type DeliveryPathResult =
  | { type: 'target', target: DeliveryTarget }
  /** Chemin canonique (sans « /m/ » ni chaîne de requête). */
  | { type: 'redirect', path: string }
  | { type: 'invalid', message: string }
  | null

export interface DeliveryPathOptions extends TransformLimits {
  /** Formats de sortie activés (NUXT_MEDIA_TRANSFORM_FORMATS). */
  formats: readonly TransformFormat[]
}

/**
 * Rendu désigné par un nom de fichier `<rendu>.<ext>` : seulement les noms connus, chacun dans son seul
 * conteneur (une seule URL par fichier, et aucun nom inventé ne va jusqu'à la base).
 */
function renditionFile(filename: string): { name: RenditionName, container: 'mp4' | 'webm' } | null {
  const name = RENDITION_NAMES.find(candidate => filename === `${candidate}.${RENDITION_FORMATS[candidate].container}`)
  return name ? { name, container: RENDITION_FORMATS[name].container } : null
}

export function parseDeliveryPath(path: string, options: DeliveryPathOptions): DeliveryPathResult {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 3 || segments.length > 4) return null
  const [id, versionSegment] = segments as [string, string]
  const version = /^v(\d{1,9})$/.exec(versionSegment)
  if (!/^[a-z0-9]{8,64}$/i.test(id) || !version) return null
  const base = { id, version: Number(version[1]), filename: segments.at(-1)! }
  if (segments.length === 3) return { type: 'target', target: { ...base, kind: 'original' } }

  const segment = segments[2]!
  // Piste de texte : « tracks » est un nom de préréglage réservé.
  if (segment === TRACKS_SEGMENT) {
    const track = /^([a-z0-9]{8,64})\.vtt$/i.exec(base.filename)
    return track ? { type: 'target', target: { ...base, kind: 'track', trackId: track[1]! } } : null
  }
  // Rendu d'une vidéo : « renditions » est aussi réservé (sinon analysé comme un préréglage, 400 pour .mp4).
  if (segment === RENDITIONS_SEGMENT) {
    const rendition = renditionFile(base.filename)
    return rendition ? { type: 'target', target: { ...base, kind: 'rendition', ...rendition } } : null
  }
  if (!isTransformationSegment(segment) && !isPresetName(segment)) return null

  const name = /^(.*)\.([a-z0-9]{1,8})$/i.exec(base.filename)
  const output = name ? parseTransformFormat(name[2]!) : null
  if (!name || !output) return { type: 'invalid', message: 'The file name must end with a supported image format (jpg, png, webp, avif).' }
  if (!options.formats.includes(output.format)) {
    return { type: 'invalid', message: `Output format "${output.format}" is not enabled on this server (${options.formats.join(', ')}).` }
  }
  const canonicalFile = `${name[1]}.${output.format}`

  if (!isTransformationSegment(segment)) {
    if (!output.canonical) return { type: 'redirect', path: `${id}/${versionSegment}/${segment}/${canonicalFile}` }
    return { type: 'target', target: { ...base, kind: 'preset', preset: segment, format: output.format } }
  }

  const parsed = parseTransformation(segment, options)
  if (!parsed.ok) return { type: 'invalid', message: parsed.message }
  const canonicalSegment = transformationSegment(parsed.canonical)
  if (canonicalSegment !== segment || !output.canonical) {
    return { type: 'redirect', path: `${id}/${versionSegment}/${canonicalSegment}/${canonicalFile}` }
  }
  return {
    type: 'target',
    target: { ...base, kind: 'transform', transformation: parsed.transformation, canonical: parsed.canonical, format: output.format },
  }
}

/**
 * Droit désigné par une cible dans les liens signés (signing.ts) : `original`, le nom d'un
 * préréglage, ou `t:<transformation canonique>` — jamais le format (une signature couvre les
 * sources AVIF, WebP et JPEG d'un même <picture>). Un rendu est la même vidéo que l'original, pour le
 * même public (§ 34) : il en prend le droit (`file`), donc jamais `derived` ni une signature permanente,
 * et un lien signé pour le fichier ouvre aussi ses rendus à la même échéance.
 */
export function deliveryVariant(target: DeliveryTarget): string {
  if (target.kind === 'original' || target.kind === 'rendition') return 'original'
  if (target.kind === 'track') return `track:${target.trackId}`
  if (target.kind === 'preset') return target.preset
  return `t:${target.canonical}`
}

/** Cible dérivée d'une image (préréglage ou paramètres), produite à la demande. */
export type DerivedTarget = Extract<DeliveryTarget, { kind: 'preset' | 'transform' }>

/** Segment de transformation d'une cible dérivée (préréglage ou paramètres canoniques). */
export function derivedSegment(target: DerivedTarget): string {
  return target.kind === 'preset' ? target.preset : transformationSegment(target.canonical)
}
