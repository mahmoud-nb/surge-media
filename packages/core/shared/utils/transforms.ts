/**
 * Transformations d'images à la demande (phase C, `.claude/architecture-phase-c.md`) : grammaire du
 * segment de transformation des URL de diffusion, analyse et forme canonique. Fonctions pures,
 * partagées par le serveur (diffusion, API), l'interface (générateur d'URL) et les tests.
 *
 *   /m/<id>/v<n>/<préréglage>/<nom>.<format>   préréglage nommé : thumb, hero… (jamais de « _ »)
 *   /m/<id>/v<n>/<paramètres>/<nom>.<format>   paramètres clé_valeur séparés par « , » : w_800,h_600,q_75
 *
 * Le format de sortie est toujours donné par l'extension. La forme canonique est purement
 * syntaxique (indépendante du média **et du format**, pour qu'une signature couvre les sources AVIF,
 * WebP et JPEG d'un même <picture>) : clés dans l'ordre d'exécution (r, flip, crop, w, h, fit, g, q,
 * bg), valeurs par défaut et paramètres sans effet retirés, `dpr` appliqué aux dimensions. Une URL
 * non canonique est redirigée (301) vers elle.
 */

/** Formats de sortie (extension canonique). GIF et animations : plus tard. */
export const TRANSFORM_FORMATS = ['jpg', 'png', 'webp', 'avif'] as const
export type TransformFormat = (typeof TRANSFORM_FORMATS)[number]

export const TRANSFORM_MIME_TYPES: Record<TransformFormat, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** Extensions reconnues dans une URL → format canonique (`jpeg` est redirigé vers `jpg`). */
const FORMAT_ALIASES: Readonly<Record<string, TransformFormat>> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' }

/** Qualité par défaut des formats avec perte ; PNG : sans perte (un `q_` active la palette). */
export const TRANSFORM_DEFAULT_QUALITY: Readonly<Record<TransformFormat, number | null>> = { jpg: 80, png: null, webp: 80, avif: 50 }

export const TRANSFORM_FITS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const
export type TransformFit = (typeof TRANSFORM_FITS)[number]

/** Ancrage du recadrage (`fit_cover`). `focal` (défaut) : point d'intérêt du média, centre s'il n'en a pas. */
export const TRANSFORM_GRAVITIES = [
  'focal',
  'center',
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'attention',
  'entropy',
] as const
export type TransformGravity = (typeof TRANSFORM_GRAVITIES)[number]

export const TRANSFORM_ROTATIONS = [0, 90, 180, 270] as const
export type TransformRotation = (typeof TRANSFORM_ROTATIONS)[number]

export const TRANSFORM_FLIPS = ['h', 'v', 'hv'] as const
export type TransformFlip = (typeof TRANSFORM_FLIPS)[number]

/** Borne par défaut des dimensions de sortie (NUXT_MEDIA_TRANSFORM_MAX_DIMENSION). */
export const TRANSFORM_MAX_DIMENSION = 4096
export const TRANSFORM_MAX_DPR = 3
export const TRANSFORM_SEGMENT_MAX_LENGTH = 200
export const TRANSFORM_MAX_PARAMS = 10

/** Nom de préréglage : jamais de « _ » (pas d'ambiguïté avec les paramètres). */
export const PRESET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/**
 * Préréglages intégrés (noms réservés). `full` : image entière réencodée (conversion de format,
 * métadonnées retirées) ; c'est aussi la forme canonique d'une transformation vide.
 */
export const BUILTIN_PRESETS = {
  preview: 'w_480,h_480,fit_inside,q_72',
  full: '',
} as const
export type BuiltinPreset = keyof typeof BUILTIN_PRESETS

/**
 * Noms interdits aux préréglages globaux et de projet. `original` désigne le fichier d'origine dans les
 * signatures ; `tracks`, les pistes de texte des vidéos dans les chemins de diffusion.
 */
export const RESERVED_PRESET_NAMES: readonly string[] = [...Object.keys(BUILTIN_PRESETS), 'original', 'tracks']

export interface TransformRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Transformation analysée, déjà canonique (`dpr` appliqué, valeurs sans effet ramenées au défaut). */
export interface Transformation {
  /** Zone extraite, en pixels de l'image orientée et tournée. */
  crop: TransformRegion | null
  rotate: TransformRotation
  flip: TransformFlip | null
  width: number | null
  height: number | null
  /** Significatif seulement avec `width` et `height` (sinon `cover`). */
  fit: TransformFit
  /** Significatif seulement avec `fit: cover` et les deux dimensions (sinon `focal`). */
  gravity: TransformGravity
  quality: number | null
  /** Couleur `rrggbb` en minuscules. */
  background: string | null
}

export interface TransformLimits {
  maxDimension: number
}

export type TransformParseResult =
  | { ok: true, transformation: Transformation, canonical: string }
  | { ok: false, param: string | null, message: string }

export const IDENTITY_TRANSFORMATION: Readonly<Transformation> = Object.freeze({
  crop: null,
  rotate: 0,
  flip: null,
  width: null,
  height: null,
  fit: 'cover',
  gravity: 'focal',
  quality: null,
  background: null,
})

/** Le segment désigne-t-il des paramètres (sinon un préréglage) ? */
export function isTransformationSegment(segment: string): boolean {
  return segment.includes('_')
}

export function isPresetName(value: string): boolean {
  return PRESET_NAME_PATTERN.test(value)
}

/** Extension d'une URL → format de sortie (`canonical` : l'extension est déjà sous sa forme canonique). */
export function parseTransformFormat(extension: string): { format: TransformFormat, canonical: boolean } | null {
  const format = FORMAT_ALIASES[extension.toLowerCase()]
  return format ? { format, canonical: extension === format } : null
}

const KEY_ORDER = ['r', 'flip', 'crop', 'w', 'h', 'dpr', 'fit', 'g', 'q', 'bg'] as const
type TransformKey = (typeof KEY_ORDER)[number]

function fail(param: string | null, message: string): TransformParseResult {
  return { ok: false, param, message }
}

/** Entier sans signe de 1 à `digits` chiffres (zéros initiaux admis : la forme canonique les retire). */
function integer(value: string, digits: number): number | null {
  return new RegExp(`^\\d{1,${digits}}$`).test(value) ? Number(value) : null
}

/**
 * Analyse une liste de paramètres (`w_800,h_600,fit_contain`) ; chaîne vide = aucune transformation.
 * Erreur : paramètre inconnu, répété, valeur invalide ou hors bornes (message en anglais, destiné
 * aux développeurs, renvoyé dans `detail`).
 */
export function parseTransformation(segment: string, limits: TransformLimits = { maxDimension: TRANSFORM_MAX_DIMENSION }): TransformParseResult {
  if (segment.length > TRANSFORM_SEGMENT_MAX_LENGTH) {
    return fail(null, `The transformation is too long (${TRANSFORM_SEGMENT_MAX_LENGTH} characters at most).`)
  }
  const parts = segment === '' ? [] : segment.split(',')
  if (parts.length > TRANSFORM_MAX_PARAMS) return fail(null, `Too many parameters (${TRANSFORM_MAX_PARAMS} at most).`)

  const values = new Map<TransformKey, string>()
  for (const part of parts) {
    const match = /^([a-z]+)_(.+)$/.exec(part)
    if (!match) return fail(part || null, `Invalid parameter "${part}": expected key_value.`)
    const [, key, value] = match as unknown as [string, string, string]
    if (!(KEY_ORDER as readonly string[]).includes(key)) return fail(key, `Unknown parameter "${key}".`)
    if (values.has(key as TransformKey)) return fail(key, `Parameter "${key}" is repeated.`)
    values.set(key as TransformKey, value)
  }

  const t: Transformation = { ...IDENTITY_TRANSFORMATION }
  const max = limits.maxDimension

  const crop = values.get('crop')
  if (crop !== undefined) {
    const match = /^(\d{1,6})-(\d{1,6})-(\d{1,6})-(\d{1,6})$/.exec(crop)
    const [x, y, width, height] = match ? match.slice(1).map(Number) as [number, number, number, number] : []
    if (x === undefined || y === undefined || !width || !height) {
      return fail('crop', 'crop expects x-y-width-height in pixels (width and height at least 1).')
    }
    t.crop = { x, y, width, height }
  }

  const rotate = values.get('r')
  if (rotate !== undefined) {
    const angle = integer(rotate, 3)
    if (angle === null || !(TRANSFORM_ROTATIONS as readonly number[]).includes(angle)) return fail('r', 'r expects 90, 180 or 270.')
    t.rotate = angle as TransformRotation
  }

  const flip = values.get('flip')
  if (flip !== undefined) {
    if (!['h', 'v', 'hv', 'vh'].includes(flip)) return fail('flip', 'flip expects h, v or hv.')
    t.flip = flip === 'vh' ? 'hv' : flip as TransformFlip
  }

  for (const key of ['w', 'h'] as const) {
    const raw = values.get(key)
    if (raw === undefined) continue
    const size = integer(raw, 5)
    if (!size || size > max) return fail(key, `${key} expects an integer from 1 to ${max}.`)
    if (key === 'w') t.width = size
    else t.height = size
  }

  const dprValue = values.get('dpr')
  if (dprValue !== undefined) {
    const dpr = /^\d(\.\d{1,2})?$/.test(dprValue) ? Number(dprValue) : Number.NaN
    if (!(dpr >= 1 && dpr <= TRANSFORM_MAX_DPR) || (dpr * 2) % 1 !== 0) {
      return fail('dpr', `dpr expects 1 to ${TRANSFORM_MAX_DPR} in steps of 0.5.`)
    }
    // Densité appliquée aux dimensions, réduites ensemble du même facteur si la borne est atteinte.
    if (dpr !== 1 && (t.width || t.height)) {
      const largest = Math.max(t.width ?? 0, t.height ?? 0) * dpr
      const factor = largest > max ? (dpr * max) / largest : dpr
      if (t.width) t.width = Math.max(1, Math.round(t.width * factor))
      if (t.height) t.height = Math.max(1, Math.round(t.height * factor))
    }
  }

  const fit = values.get('fit')
  if (fit !== undefined) {
    if (!(TRANSFORM_FITS as readonly string[]).includes(fit)) return fail('fit', `fit expects ${TRANSFORM_FITS.join(', ')}.`)
    if (t.width && t.height) t.fit = fit as TransformFit
  }

  const gravity = values.get('g')
  if (gravity !== undefined) {
    if (!(TRANSFORM_GRAVITIES as readonly string[]).includes(gravity)) return fail('g', `g expects ${TRANSFORM_GRAVITIES.join(', ')}.`)
    if (t.width && t.height && t.fit === 'cover') t.gravity = gravity as TransformGravity
  }

  const quality = values.get('q')
  if (quality !== undefined) {
    const value = integer(quality, 3)
    if (!value || value > 100) return fail('q', 'q expects an integer from 1 to 100.')
    t.quality = value
  }

  const background = values.get('bg')
  if (background !== undefined) {
    if (!/^[0-9a-f]{6}$/i.test(background)) return fail('bg', 'bg expects a colour as rrggbb.')
    t.background = background.toLowerCase()
  }

  return { ok: true, transformation: t, canonical: formatTransformation(t) }
}

/** Forme canonique d'une transformation (chaîne vide si elle ne fait rien de plus que `full`). */
export function formatTransformation(t: Transformation): string {
  const parts: string[] = []
  // Ordre d'exécution : rotation, miroir, zone (exprimée dans l'image tournée), taille, encodage.
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

/** Segment d'URL d'une transformation canonique : la transformation vide s'écrit `full`. */
export function transformationSegment(canonical: string): string {
  return canonical === '' ? 'full' : canonical
}

// ─── Politique et préréglages (C2) ───────────────────────────────────────────

/**
 * Politique des transformations libres d'un espace (projet : `Project.transformPolicy` ;
 * bibliothèque : réglage de l'installation). Les préréglages sont servis dans tous les cas.
 */
export const TRANSFORM_POLICIES = ['OPEN', 'SIGNED', 'PRESETS'] as const
export type TransformPolicy = (typeof TRANSFORM_POLICIES)[number]

/**
 * Droit présenté pour une transformation libre : aucun (URL publique), signature exacte (`t:…`,
 * éventuellement permanente), droit élargi `derived`, lien de l'administration (`admin`),
 * identifiant d'API (`Authorization: Bearer`).
 */
export type TransformGrant = 'none' | 'exact' | 'derived' | 'admin' | 'credential'

/**
 * Une transformation libre est-elle permise ? `OPEN` : toujours (dans les bornes) ; `SIGNED` : avec
 * une signature ou un identifiant d'API ; `PRESETS` : jamais, sauf pour l'administration.
 */
export function freeTransformAllowed(policy: TransformPolicy, grant: TransformGrant): boolean {
  if (grant === 'admin' || policy === 'OPEN') return true
  return policy === 'SIGNED' && grant !== 'none'
}

/** Préréglages au plus par niveau (global, chaque projet). */
export const PRESETS_PER_LEVEL_MAX = 100
export const PRESET_DESCRIPTION_MAX_LENGTH = 200

/** Niveau d'un préréglage : intégré (code), global (installation), propre au projet. */
export const PRESET_LEVELS = ['builtin', 'global', 'project'] as const
export type PresetLevel = (typeof PRESET_LEVELS)[number]

/** Codes d'erreur des préréglages et des transformations (`data.code`), traduits par l'interface. */
export const TRANSFORM_ERROR_CODES = [
  'PRESET_NOT_FOUND', // 404
  'PRESET_NAME_TAKEN', // 409 : nom déjà utilisé à ce niveau
  'PRESET_LIMIT_REACHED', // 409 : PRESETS_PER_LEVEL_MAX atteint
  'INVALID_TRANSFORM', // 400 : définition invalide (`data.param`, `data.detail`)
] as const
export type TransformErrorCode = (typeof TRANSFORM_ERROR_CODES)[number]

export function isReservedPresetName(name: string): boolean {
  return RESERVED_PRESET_NAMES.includes(name)
}

/**
 * Définition d'un préréglage : transformation canonique sans format, qui change quelque chose et
 * ne dépend pas d'une image précise (pas de zone `crop`, exprimée en pixels d'une image donnée).
 */
export function parsePresetDefinition(definition: string, limits: TransformLimits = { maxDimension: TRANSFORM_MAX_DIMENSION }): TransformParseResult {
  const parsed = parseTransformation(definition.trim(), limits)
  if (!parsed.ok) return parsed
  if (parsed.transformation.crop) return { ok: false, param: 'crop', message: 'A preset cannot crop a fixed area (crop depends on each image).' }
  if (parsed.canonical === '') return { ok: false, param: null, message: 'A preset must change something (use the built-in "full" preset to convert only).' }
  return parsed
}

// ─── Point d'intérêt (C3) ────────────────────────────────────────────────────

/**
 * Point d'intérêt d'un média : fractions (0 à 1) de la largeur et de la hauteur de l'image
 * orientée, depuis le coin haut gauche. Ancre le recadrage `fit_cover` (gravité `focal`, par défaut).
 */
export interface FocalPoint {
  x: number
  y: number
}

/** Précision enregistrée : 4 décimales (moins d'un demi-pixel sur 4096 px). */
export const FOCAL_POINT_DECIMALS = 4

export function roundFocalCoordinate(value: number): number {
  const factor = 10 ** FOCAL_POINT_DECIMALS
  return Math.round(Math.min(1, Math.max(0, value)) * factor) / factor
}

/** Deux points d'intérêt (ou leur absence) sont-ils identiques à la précision enregistrée ? */
export function sameFocalPoint(a: FocalPoint | null, b: FocalPoint | null): boolean {
  if (!a || !b) return a === b
  return roundFocalCoordinate(a.x) === roundFocalCoordinate(b.x) && roundFocalCoordinate(a.y) === roundFocalCoordinate(b.y)
}

/**
 * Recadrage `cover` au rapport `ratio` (largeur / hauteur) d'une image `width` × `height` :
 * position CSS (`object-position`, fractions 0 à 1) qui reproduit avec `object-fit: cover` la zone
 * que le serveur conserve autour du point d'intérêt (zone centrée sur le point, bornée à l'image :
 * server/lib/media/transform-plan.ts). Sans point d'intérêt : le centre. Aperçu de l'interface.
 */
export function focalObjectPosition(width: number, height: number, ratio: number, focal: FocalPoint | null): FocalPoint {
  if (!focal) return { x: 0.5, y: 0.5 }
  const wider = width / height > ratio
  const cropWidth = wider ? height * ratio : width
  const cropHeight = wider ? height : width / ratio
  const axis = (point: number, size: number, crop: number) =>
    size - crop <= 0 ? 0.5 : Math.min(Math.max((point * size - crop / 2) / (size - crop), 0), 1)
  return { x: axis(focal.x, width, cropWidth), y: axis(focal.y, height, cropHeight) }
}
