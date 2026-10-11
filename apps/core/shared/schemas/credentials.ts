import { z } from 'zod'
import { AUDIT_CATEGORIES } from '../utils/audit'
import { TRUSTED_DEVICE_SCOPES } from '../utils/auth'
import {
  ENVIRONMENT_MAX_LENGTH,
  ENVIRONMENT_PATTERN,
  ORIGIN_MAX_LENGTH,
  PERSONAL_TOKEN_LIFETIMES,
  PROJECT_KEY_TYPES,
  ROTATION_OVERLAPS,
  SECRET_KEY_LIFETIMES,
  TOKEN_NAME_MAX_LENGTH,
} from '../utils/credentials'
import { normalizeOrigin } from '../utils/origins'
import { TOKEN_OPTIONAL_SCOPES } from '../utils/permissions'
import { PASSWORD_MAX_LENGTH } from './auth'

/**
 * Identifiants d'API, origines autorisées, confirmation du mot de passe et journal d'audit.
 * Messages = clés i18n (`validation.*`).
 */

const tokenNameSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(TOKEN_NAME_MAX_LENGTH, 'validation.tooLong')

/** Portées ajoutées aux portées de base (lecture) ; doublons retirés. */
const optionalScopesSchema = z
  .array(z.enum(TOKEN_OPTIONAL_SCOPES))
  .max(TOKEN_OPTIONAL_SCOPES.length)
  .transform(scopes => [...new Set(scopes)])

const idSchema = z.string().trim().min(1).max(64)

/**
 * Jeton personnel : tous les projets du propriétaire, ou une sélection, et/ou la bibliothèque ;
 * au moins un espace.
 */
export const createPersonalTokenSchema = z.object({
  name: tokenNameSchema,
  lifetime: z.enum(PERSONAL_TOKEN_LIFETIMES, 'validation.required'),
  scopes: optionalScopesSchema.default([]),
  allProjects: z.boolean().default(false),
  projectIds: z.array(idSchema).max(500).default([]),
  includeLibrary: z.boolean().default(false),
}).superRefine((input, ctx) => {
  if (!input.allProjects && input.projectIds.length === 0 && !input.includeLibrary) {
    ctx.addIssue({ code: 'custom', path: ['projectIds'], message: 'validation.tokenSpaceRequired' })
  }
})
export type CreatePersonalTokenInput = z.input<typeof createPersonalTokenSchema>
export type CreatePersonalTokenData = z.output<typeof createPersonalTokenSchema>

export const environmentSchema = z
  .string('validation.required')
  .trim()
  .toLowerCase()
  .min(1, 'validation.required')
  .max(ENVIRONMENT_MAX_LENGTH, 'validation.tooLong')
  .regex(ENVIRONMENT_PATTERN, 'validation.environment')

/**
 * Clé de projet. Clé publique : lecture des médias publics, sans échéance (portées et durée
 * ignorées). Clé secrète : portées choisies et durée de validité.
 */
export const createProjectKeySchema = z.object({
  type: z.enum(PROJECT_KEY_TYPES, 'validation.required'),
  name: tokenNameSchema,
  environment: environmentSchema,
  scopes: optionalScopesSchema.default([]),
  lifetime: z.enum(SECRET_KEY_LIFETIMES, 'validation.required').default('365'),
})
export type CreateProjectKeyInput = z.input<typeof createProjectKeySchema>
export type CreateProjectKeyData = z.output<typeof createProjectKeySchema>

export const rotateKeySchema = z.object({
  overlap: z.enum(ROTATION_OVERLAPS, 'validation.required'),
})

/** Origine saisie, normalisée (minuscules, sans « / » final, port par défaut retiré). */
export const addOriginSchema = z.object({
  origin: z
    .string('validation.required')
    .trim()
    .min(1, 'validation.required')
    .max(ORIGIN_MAX_LENGTH, 'validation.tooLong')
    .transform((value, ctx) => {
      const origin = normalizeOrigin(value)
      if (!origin) {
        ctx.addIssue({ code: 'custom', message: 'validation.origin' })
        return z.NEVER
      }
      return origin
    }),
})

/**
 * Confirmation du mot de passe avant une action sensible ; `trustDevice` : ne plus la demander dans ce
 * navigateur pendant la durée des appareils de confiance (ignoré si l'option est désactivée).
 */
export const confirmPasswordSchema = z.object({
  password: z
    .string('validation.required')
    .min(1, 'validation.required')
    .max(PASSWORD_MAX_LENGTH, 'validation.tooLong'),
  trustDevice: z.boolean().optional(),
})

/** Retrait de la confiance accordée à ses appareils (DELETE /api/auth/trusted-devices). */
export const forgetTrustedDevicesSchema = z.object({
  scope: z.enum(TRUSTED_DEVICE_SCOPES),
})

export const AUDIT_PAGE_SIZE = 50

/** Filtres du journal d'audit (paramètres d'URL) ; les valeurs invalides sont ignorées. */
export const auditQuerySchema = z.object({
  category: z.enum(AUDIT_CATEGORIES).optional().catch(undefined),
  project: idSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})
export type AuditQuery = z.infer<typeof auditQuerySchema>
