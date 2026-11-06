import { z } from 'zod'
import { LICENSE_USAGES } from '../utils/license'

/**
 * Licence commerciale : contenu signé (charge du jeton, vérifié par le serveur après la signature) et
 * installation depuis Réglages › Licence. Architecture : .claude/architecture-licence.md.
 */

/** Borne haute d'un jeton de licence collé (un jeton réel fait moins de 1 Ko). */
export const LICENSE_TOKEN_MAX_LENGTH = 8192

/** Identifiant court : offre, fonction. */
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
/** Date en secondes Unix. */
const secondsSchema = z.number().int().nonnegative()

/**
 * Charge d'une licence, format v1. Les offres et fonctions ne sont pas limitées au catalogue de cette
 * version : une licence émise pour une version plus récente reste lisible ; les champs inconnus sont ignorés.
 */
export const licensePayloadSchema = z.object({
  v: z.literal(1),
  iss: z.literal('surge-up'),
  aud: z.literal('surge-media'),
  jti: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/),
  licensee: z.object({
    name: z.string().trim().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/).optional(),
  }),
  plan: slugSchema,
  features: z.array(slugSchema).max(50),
  instances: z.number().int().positive().nullable(),
  iat: secondsSchema,
  nbf: secondsSchema,
  exp: secondsSchema,
  support: secondsSchema,
}).refine(value => value.exp > value.nbf, { path: ['exp'] })

export type LicensePayload = z.infer<typeof licensePayloadSchema>

/** PUT /api/admin/license : licence collée (ou lue dans un fichier .lic). */
export const licenseInstallSchema = z.object({
  token: z
    .string('validation.required')
    .trim()
    .min(1, 'validation.required')
    .max(LICENSE_TOKEN_MAX_LENGTH, 'validation.tooLong'),
})

export type LicenseInstallInput = z.infer<typeof licenseInstallSchema>

/** PUT /api/admin/license/usage : usage déclaré de l'instance (architecture : .claude/architecture-usage.md). */
export const licenseUsageSchema = z.object({
  usage: z.enum(LICENSE_USAGES, 'validation.required'),
})

export type LicenseUsageInput = z.infer<typeof licenseUsageSchema>
