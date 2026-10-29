import { z } from 'zod'
import { MFA_POLICIES } from '../utils/mfa'

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

/**
 * Code de double authentification tel que saisi : la forme (6 chiffres, ou code de secours) est vérifiée
 * par le serveur, qui compte un format invalide comme un essai refusé.
 */
const mfaInputSchema = z.string('validation.required').trim().min(1, 'validation.required').max(32, 'validation.tooLong')

/** Second facteur : un code de l'application **ou** un code de secours. */
const mfaProofSchema = z.object({
  code: mfaInputSchema.optional(),
  recoveryCode: mfaInputSchema.optional(),
}).refine(value => Boolean(value.code) !== Boolean(value.recoveryCode), 'validation.required')

/** POST /api/auth/mfa/verify : second facteur de la connexion, et confiance accordée à ce navigateur. */
export const mfaVerifySchema = z.object({
  code: mfaInputSchema.optional(),
  recoveryCode: mfaInputSchema.optional(),
  trustDevice: z.boolean().optional(),
}).refine(value => Boolean(value.code) !== Boolean(value.recoveryCode), 'validation.required')

/** POST /api/auth/mfa/enable : premier code de l'application qui vient d'être configurée. */
export const mfaEnableSchema = z.object({ code: mfaInputSchema })

/** DELETE /api/auth/mfa : désactivation, prouvée par un code. */
export const mfaDisableSchema = mfaProofSchema

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>

/** PUT /api/admin/security : politique de double authentification. */
export const mfaPolicySchema = z.object({ mfaPolicy: z.enum(MFA_POLICIES, 'validation.required') })
