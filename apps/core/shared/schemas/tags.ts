import { z } from 'zod'
import {
  MEDIA_TAG_LIMIT,
  TAG_BULK_MAX,
  TAG_COLORS,
  TAG_NAME_MAX_LENGTH,
  TAG_SLUG_MAX_LENGTH,
  TAG_SLUG_PATTERN,
  tagSlug,
} from '../utils/tags'

/**
 * Étiquettes dans l'administration (messages = clés i18n). Architecture : .claude/architecture-tags.md.
 * L'API v1 aura ses propres schémas (shared/schemas/api.ts, messages en anglais), sans `confidential`.
 */

const CONTROL_CHARACTERS = /\p{Cc}/u

export const tagNameSchema = z
  .string('validation.required')
  .transform(value => value.normalize('NFC').trim().replace(/\s+/g, ' '))
  .pipe(z
    .string()
    .min(1, 'validation.required')
    .max(TAG_NAME_MAX_LENGTH, 'validation.tooLong')
    .refine(value => !CONTROL_CHARACTERS.test(value), 'validation.tagName'))

export const tagSlugSchema = z
  .string('validation.required')
  .transform(value => value.trim().toLowerCase())
  .pipe(z
    .string()
    .min(1, 'validation.required')
    .max(TAG_SLUG_MAX_LENGTH, 'validation.tooLong')
    .regex(TAG_SLUG_PATTERN, 'validation.tagSlug'))

export const tagColorSchema = z.enum(TAG_COLORS, 'validation.required')

/** Identifiant d'étiquette reçu d'un client (existence, niveau et visibilité vérifiés par le serveur). */
export const tagIdSchema = z.string().trim().min(1).max(64)

/**
 * Nouvelle étiquette : `?project=` dans la requête choisit le niveau (absent = globale). Slug
 * absent = proposé d'après le nom ; un nom sans caractère latin ni chiffre exige un slug saisi.
 */
export const createTagSchema = z.object({
  name: tagNameSchema,
  slug: tagSlugSchema.optional(),
  color: tagColorSchema.optional(),
  confidential: z.boolean().optional(),
}).transform((input, ctx) => {
  const slug = input.slug ?? tagSlug(input.name)
  if (!slug) {
    ctx.addIssue({ code: 'custom', path: ['slug'], message: 'validation.tagSlugRequired' })
    return z.NEVER
  }
  return { ...input, slug }
})
export type CreateTagInput = z.output<typeof createTagSchema>

/** Modification : au moins un champ ; le slug ne suit pas un renommage (TG7). */
export const updateTagSchema = z.object({
  name: tagNameSchema.optional(),
  slug: tagSlugSchema.optional(),
  color: tagColorSchema.optional(),
  confidential: z.boolean().optional(),
}).refine(input => Object.values(input).some(value => value !== undefined), 'validation.required')
export type UpdateTagInput = z.output<typeof updateTagSchema>

/** Étiquettes d'un média (ensemble remplacé, doublons retirés). */
export const mediaTagIdsSchema = z
  .array(tagIdSchema)
  .max(MEDIA_TAG_LIMIT, 'validation.tooManyTags')
  .transform(ids => [...new Set(ids)])

/** Affectation en lot : médias de l'espace, étiquettes ajoutées et retirées (jamais les deux à la fois). */
export const mediaTagsBulkSchema = z.object({
  ids: z.array(tagIdSchema).min(1).max(TAG_BULK_MAX).transform(ids => [...new Set(ids)]),
  add: mediaTagIdsSchema.default([]),
  remove: mediaTagIdsSchema.default([]),
}).superRefine((input, ctx) => {
  if (input.add.length === 0 && input.remove.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['add'], message: 'validation.tagChangesRequired' })
  }
  if (input.add.some(id => input.remove.includes(id))) {
    ctx.addIssue({ code: 'custom', path: ['remove'], message: 'validation.tagAddRemoveOverlap' })
  }
})
export type MediaTagsBulkInput = z.output<typeof mediaTagsBulkSchema>
