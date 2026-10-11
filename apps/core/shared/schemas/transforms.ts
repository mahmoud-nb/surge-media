import { z } from 'zod'
import { SIGNED_URL_MAX_TTL } from '../utils/media'
import {
  formatTransformation,
  IDENTITY_TRANSFORMATION,
  isReservedPresetName,
  PRESET_DESCRIPTION_MAX_LENGTH,
  PRESET_NAME_PATTERN,
  TRANSFORM_FITS,
  TRANSFORM_FLIPS,
  TRANSFORM_FORMATS,
  TRANSFORM_GRAVITIES,
  TRANSFORM_MAX_DIMENSION,
  TRANSFORM_MAX_DPR,
  TRANSFORM_POLICIES,
  TRANSFORM_ROTATIONS,
  TRANSFORM_SEGMENT_MAX_LENGTH,
  type Transformation,
  type TransformRegion,
} from '../utils/transforms'

/**
 * Politique des transformations et préréglages dans l'administration (messages = clés i18n).
 * La définition d'un préréglage circule sous sa forme canonique (`w_800,h_450,q_70`) : le serveur
 * la vérifie avec les bornes de l'installation (shared/utils/transforms.ts, `parsePresetDefinition`).
 * L'API v1 a ses propres schémas (shared/schemas/api.ts, messages en anglais).
 */

export const transformPolicySchema = z.enum(TRANSFORM_POLICIES)

export const updateTransformPolicySchema = z.object({ policy: transformPolicySchema })

/** Niveau visé : `project` absent = installation (préréglages globaux, politique de la bibliothèque). */
export const transformsQuerySchema = z.object({
  project: z.string().trim().min(1).max(64).optional(),
})

export const presetNameSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(32, 'validation.tooLong')
  .regex(PRESET_NAME_PATTERN, 'validation.presetName')
  .refine(name => !isReservedPresetName(name), 'validation.presetNameReserved')

const descriptionSchema = z
  .string()
  .trim()
  .max(PRESET_DESCRIPTION_MAX_LENGTH, 'validation.tooLong')
  .transform(value => value || null)
  .nullable()

const definitionSchema = z.string('validation.required').trim().min(1, 'validation.required').max(TRANSFORM_SEGMENT_MAX_LENGTH, 'validation.tooLong')

export const createPresetSchema = z.object({
  name: presetNameSchema,
  transformation: definitionSchema,
  description: descriptionSchema.optional(),
})

export const updatePresetSchema = z.object({
  name: presetNameSchema.optional(),
  transformation: definitionSchema.optional(),
  description: descriptionSchema.optional(),
})

// ─── Formulaire d'un préréglage (champs structurés) ──────────────────────────

/** Entier facultatif saisi dans un champ texte ('' = absent). */
function optionalInteger(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine(value => value === '' || (/^\d{1,5}$/.test(value) && Number(value) >= min && Number(value) <= max), { message: 'validation.integerRange', params: { min, max } })
    .transform(value => (value === '' ? null : Number(value)))
}

/**
 * Champs structurés d'une transformation (dialogue « Préréglage », générateur d'adresses de la fiche
 * média) ; `presetFieldsToDefinition` en tire la forme canonique.
 */
const transformFieldShape = {
  width: optionalInteger(1, TRANSFORM_MAX_DIMENSION),
  height: optionalInteger(1, TRANSFORM_MAX_DIMENSION),
  fit: z.enum(TRANSFORM_FITS),
  gravity: z.enum(TRANSFORM_GRAVITIES),
  quality: optionalInteger(1, 100),
  background: z
    .string()
    .trim()
    .transform(value => value.replace(/^#/, '').toLowerCase())
    .refine(value => value === '' || /^[0-9a-f]{6}$/.test(value), 'validation.color'),
  rotate: z.enum(TRANSFORM_ROTATIONS.map(String) as ['0', '90', '180', '270']),
  flip: z.enum(['', ...TRANSFORM_FLIPS]),
}

/** Champs seuls (générateur d'adresses) : tout vide = image entière réencodée (`full`). */
export const transformFieldsSchema = z.object(transformFieldShape)
export type TransformFieldValues = z.input<typeof transformFieldsSchema>
export type TransformFieldsOutput = z.output<typeof transformFieldsSchema>
export type TransformField = keyof TransformFieldValues

/** Champs du dialogue « Préréglage » : nom, description et une transformation qui change quelque chose. */
export const presetFormSchema = z.object({
  name: presetNameSchema,
  description: z.string().trim().max(PRESET_DESCRIPTION_MAX_LENGTH, 'validation.tooLong'),
  ...transformFieldShape,
}).refine(
  fields => fields.width !== null || fields.height !== null || fields.quality !== null || fields.background !== '' || fields.rotate !== '0' || fields.flip !== '',
  { message: 'validation.presetEmpty', path: ['width'] },
)

export type PresetFormValues = z.input<typeof presetFormSchema>
export type PresetFormOutput = z.output<typeof presetFormSchema>

/** Champs validés → transformation canonique (la même fonction que le serveur et la diffusion). */
export function presetFieldsToDefinition(fields: TransformFieldsOutput): string {
  const box = fields.width !== null && fields.height !== null
  const transformation: Transformation = {
    ...IDENTITY_TRANSFORMATION,
    rotate: Number(fields.rotate) as Transformation['rotate'],
    flip: fields.flip || null,
    width: fields.width,
    height: fields.height,
    fit: box ? fields.fit : 'cover',
    gravity: box && fields.fit === 'cover' ? fields.gravity : 'focal',
    quality: fields.quality,
    background: fields.background || null,
  }
  return formatTransformation(transformation)
}

/** Transformation (d'un préréglage enregistré) → champs du formulaire. */
export function presetFormValues(t: Transformation, name = '', description = ''): PresetFormValues {
  return {
    name,
    description,
    width: t.width ? String(t.width) : '',
    height: t.height ? String(t.height) : '',
    fit: t.fit,
    gravity: t.gravity,
    quality: t.quality ? String(t.quality) : '',
    background: t.background ?? '',
    rotate: String(t.rotate) as PresetFormValues['rotate'],
    flip: t.flip ?? '',
  }
}

// ─── Générateur d'adresses de la fiche média (C4) ────────────────────────────

/** Liens demandés en un appel par le générateur : l'adresse et les densités 1x, 2x, 3x du srcset. */
export const TRANSFORM_LINKS_MAX = 4

/** Dérivé visé : un préréglage de l'espace **ou** des paramètres (forme libre, vide = `full`), et le format. */
const derivedTargetShape = {
  preset: z.string().regex(PRESET_NAME_PATTERN, 'validation.presetName').optional(),
  transform: z.string().max(TRANSFORM_SEGMENT_MAX_LENGTH, 'validation.tooLong').optional(),
  format: z.enum(TRANSFORM_FORMATS).default('webp'),
}
const oneTarget = (target: { preset?: string, transform?: string }) => (target.preset === undefined) !== (target.transform === undefined)
const oneTargetIssue = { message: 'validation.required', path: ['transform'] }

/** GET /api/admin/media/:id/transform : aperçu rendu à la volée. */
export const transformPreviewQuerySchema = z.object(derivedTargetShape).refine(oneTarget, oneTargetIssue)
export type TransformPreviewQuery = z.output<typeof transformPreviewQuerySchema>

/** POST /api/admin/media/:id/links : adresses (signées si nécessaire) de quelques dérivés. */
export const transformLinksSchema = z.object({
  items: z.array(z.object(derivedTargetShape).refine(oneTarget, oneTargetIssue)).min(1).max(TRANSFORM_LINKS_MAX),
  /** Échéance des liens à échéance (média privé) ; sans effet sur une adresse permanente. */
  expiresIn: z.number().int().min(60).max(SIGNED_URL_MAX_TTL).default(3600),
})

// ─── Zone de recadrage et densité (générateur d'adresses) ────────────────────

/** Densités de pixels proposées (`dpr` : multiplie largeur et hauteur, replié par la forme canonique). */
export const TRANSFORM_DENSITIES = [1, 1.5, 2, 2.5, 3] as const satisfies readonly number[]
if (Math.max(...TRANSFORM_DENSITIES) > TRANSFORM_MAX_DPR) throw new Error('TRANSFORM_DENSITIES au-delà de TRANSFORM_MAX_DPR')

export const CROP_FIELDS = ['x', 'y', 'width', 'height'] as const
export type CropField = (typeof CROP_FIELDS)[number]
/** Zone saisie : position et taille en pixels de l'image orientée puis tournée ('' = absent). */
export type CropFieldValues = Record<CropField, string>
export const EMPTY_CROP: Readonly<CropFieldValues> = Object.freeze({ x: '', y: '', width: '', height: '' })

/** Erreur d'un champ : clé i18n et paramètres (même forme que `fieldErrors` côté interface). */
export interface CropFieldError {
  key: string
  params: Record<string, number>
}

export interface CropCheck {
  /** Zone valable, ou null (aucune zone, ou saisie à corriger). */
  region: TransformRegion | null
  errors: Partial<Record<CropField, CropFieldError>>
}

/** Dimensions de l'image après une rotation (un quart de tour les échange). */
export function rotatedSize(width: number, height: number, rotate: string | number): { width: number, height: number } {
  const quarter = Number(rotate) === 90 || Number(rotate) === 270
  return quarter ? { width: height, height: width } : { width, height }
}

/**
 * Zone de recadrage saisie, vérifiée dans `bounds` (image orientée puis tournée) : tout vide = aucune
 * zone ; sinon les quatre entiers sont exigés et la zone doit tenir dans l'image (fonction pure, testée).
 */
export function parseCropFields(values: CropFieldValues, bounds: { width: number, height: number }): CropCheck {
  const raw = Object.fromEntries(CROP_FIELDS.map(field => [field, values[field].trim()])) as CropFieldValues
  if (CROP_FIELDS.every(field => raw[field] === '')) return { region: null, errors: {} }

  const limits: Record<CropField, { min: number, max: number }> = {
    x: { min: 0, max: bounds.width - 1 },
    y: { min: 0, max: bounds.height - 1 },
    width: { min: 1, max: bounds.width },
    height: { min: 1, max: bounds.height },
  }
  const errors: CropCheck['errors'] = {}
  const numbers: Partial<Record<CropField, number>> = {}
  for (const field of CROP_FIELDS) {
    const { min, max } = limits[field]
    if (raw[field] === '') errors[field] = { key: 'validation.cropIncomplete', params: {} }
    else if (!/^\d{1,6}$/.test(raw[field]) || Number(raw[field]) < min || Number(raw[field]) > max) {
      errors[field] = { key: 'validation.integerRange', params: { min, max } }
    }
    else numbers[field] = Number(raw[field])
  }
  const { x, y, width, height } = numbers
  if (x !== undefined && width !== undefined && x + width > bounds.width) {
    errors.width = { key: 'validation.cropOutside', params: { max: bounds.width - x } }
  }
  if (y !== undefined && height !== undefined && y + height > bounds.height) {
    errors.height = { key: 'validation.cropOutside', params: { max: bounds.height - y } }
  }
  if (Object.keys(errors).length > 0 || x === undefined || y === undefined || width === undefined || height === undefined) {
    return { region: null, errors }
  }
  return { region: { x, y, width, height }, errors }
}

/** Zone → paramètre `crop_x-y-largeur-hauteur`. */
export function cropParameter(region: TransformRegion): string {
  return `crop_${region.x}-${region.y}-${region.width}-${region.height}`
}

/** Zone → champs du formulaire. */
export function cropFieldValues(region: TransformRegion | null): CropFieldValues {
  return region
    ? { x: String(region.x), y: String(region.y), width: String(region.width), height: String(region.height) }
    : { ...EMPTY_CROP }
}
