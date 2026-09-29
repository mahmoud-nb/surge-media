import { z } from 'zod'
import { PROJECT_ROLES } from '../utils/permissions'
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_MEDIA_ON_DELETE,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SLUG_MAX_LENGTH,
  PROJECT_SLUG_PATTERN,
  PROJECT_STATUSES,
} from '../utils/projects'

export const PROJECTS_PAGE_SIZE = 20

const projectNameSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(PROJECT_NAME_MAX_LENGTH, 'validation.tooLong')

const projectSlugSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(PROJECT_SLUG_MAX_LENGTH, 'validation.tooLong')
  .regex(PROJECT_SLUG_PATTERN, 'validation.slug')

/** Description facultative : espaces retirés, chaîne vide → null. */
const projectDescriptionSchema = z
  .string()
  .trim()
  .max(PROJECT_DESCRIPTION_MAX_LENGTH, 'validation.tooLong')
  .transform(value => value || null)
  .nullable()

export const projectRoleSchema = z.enum(PROJECT_ROLES, 'validation.required')

/** Création : l'identifiant lisible est déduit du nom s'il n'est pas fourni. */
export const createProjectSchema = z.object({
  name: projectNameSchema,
  slug: projectSlugSchema.optional(),
  description: projectDescriptionSchema.optional(),
})
export type CreateProjectInput = z.input<typeof createProjectSchema>

export const updateProjectSchema = z.object({
  name: projectNameSchema,
  slug: projectSlugSchema,
  description: projectDescriptionSchema,
  /** true : archive le projet (lecture seule) ; false : le réactive. */
  archived: z.boolean(),
  /** La clé publique peut lister et chercher les médias publics (API v1). */
  publicListing: z.boolean(),
}).partial()
export type UpdateProjectInput = z.input<typeof updateProjectSchema>

/** Suppression d'un projet archivé : sort de ses médias. */
export const deleteProjectSchema = z.object({
  media: z.enum(PROJECT_MEDIA_ON_DELETE, 'validation.required'),
})

/** Filtres de la liste (paramètres d'URL) ; les valeurs invalides sont ignorées. */
export const projectListQuerySchema = z.object({
  q: z.string().trim().max(PROJECT_NAME_MAX_LENGTH).optional().catch(undefined),
  status: z.enum(PROJECT_STATUSES).catch('active'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>

export const addMemberSchema = z.object({
  userId: z.string('validation.required').trim().min(1, 'validation.required').max(64),
  role: projectRoleSchema,
})
export type AddMemberInput = z.input<typeof addMemberSchema>

export const updateMemberSchema = z.object({
  role: projectRoleSchema,
})

/** Recherche des comptes pouvant être ajoutés comme membres. */
export const memberCandidatesQuerySchema = z.object({
  q: z.string().trim().max(191).optional().catch(undefined),
})
