import { z } from 'zod'

/**
 * Schémas de validation partagés entre les formulaires (validation immédiate) et
 * l'API (validation qui fait foi). Les messages sont des clés i18n (`validation.*`),
 * traduites par l'interface.
 */

/** VARCHAR(191) sous MySQL. */
export const EMAIL_MAX_LENGTH = 191
/** Longueur minimale des nouveaux mots de passe (comptes, amorçage). */
export const PASSWORD_MIN_LENGTH = 12
/** Borne haute : limite le coût du hachage argon2 sur des entrées démesurées. */
export const PASSWORD_MAX_LENGTH = 128

export const emailSchema = z
  .string('validation.required')
  .trim()
  .toLowerCase()
  .min(1, 'validation.required')
  .max(EMAIL_MAX_LENGTH, 'validation.tooLong')
  .pipe(z.email('validation.email'))

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string('validation.required')
    .min(1, 'validation.required')
    .max(PASSWORD_MAX_LENGTH, 'validation.tooLong'),
})

export type LoginInput = z.infer<typeof loginSchema>
