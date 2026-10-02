import { z } from 'zod'
import {
  formatTransformation,
  IDENTITY_TRANSFORMATION,
  isReservedPresetName,
  PRESET_DESCRIPTION_MAX_LENGTH,
  PRESET_NAME_PATTERN,
  TRANSFORM_FITS,
  TRANSFORM_FLIPS,
  TRANSFORM_GRAVITIES,
  TRANSFORM_MAX_DIMENSION,
  TRANSFORM_POLICIES,
  TRANSFORM_ROTATIONS,
  TRANSFORM_SEGMENT_MAX_LENGTH,
  type Transformation,
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

/** Champs du dialogue « Préréglage » ; `presetFieldsToDefinition` en tire la forme canonique. */
export const presetFormSchema = z.object({
  name: presetNameSchema,
  description: z.string().trim().max(PRESET_DESCRIPTION_MAX_LENGTH, 'validation.tooLong'),
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
}).refine(
  fields => fields.width !== null || fields.height !== null || fields.quality !== null || fields.background !== '' || fields.rotate !== '0' || fields.flip !== '',
  { message: 'validation.presetEmpty', path: ['width'] },
)

export type PresetFormValues = z.input<typeof presetFormSchema>
export type PresetFormOutput = z.output<typeof presetFormSchema>

/** Champs validés → transformation canonique (la même fonction que le serveur et la diffusion). */
export function presetFieldsToDefinition(fields: PresetFormOutput): string {
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
