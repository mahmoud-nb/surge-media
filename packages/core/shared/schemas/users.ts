import { z } from 'zod'
import { ROLES } from '../utils/permissions'
import { EMAIL_LOCALES, USER_STATUSES } from '../utils/users'
import { emailSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth'
import { projectRoleSchema } from './projects'

/** VARCHAR(191) sous MySQL. */
export const NAME_MAX_LENGTH = 191
export const USERS_PAGE_SIZE = 20

export const roleSchema = z.enum(ROLES, 'validation.required')

/** Nom affiché : facultatif, espaces retirés, chaîne vide → null. */
export const userNameSchema = z
  .string()
  .trim()
  .max(NAME_MAX_LENGTH, 'validation.tooLong')
  .transform(value => value || null)
  .nullable()

/** Nombre maximal de projets auxquels rattacher un compte dès son invitation. */
export const INVITATION_PROJECTS_MAX = 50

/**
 * Invitation : rôle de plateforme parmi `invitableRoles(auteur)` et, facultativement pour un
 * administrateur (obligatoirement pour un gestionnaire, contrôlé par le serveur), des projets
 * auxquels rattacher le compte avec un même rôle de projet.
 */
export const createUserSchema = z.object({
  email: emailSchema,
  name: userNameSchema.optional(),
  role: roleSchema,
  projectIds: z.array(z.string().min(1).max(NAME_MAX_LENGTH))
    .max(INVITATION_PROJECTS_MAX)
    .transform(ids => [...new Set(ids)])
    .optional(),
  projectRole: projectRoleSchema.optional(),
}).refine(input => !input.projectIds?.length || input.projectRole !== undefined, {
  path: ['projectRole'],
  message: 'validation.required',
})
export type CreateUserInput = z.input<typeof createUserSchema>

export const updateUserSchema = z.object({
  name: userNameSchema,
  role: roleSchema,
  isActive: z.boolean(),
}).partial()
export type UpdateUserInput = z.input<typeof updateUserSchema>

/** Filtres de la liste (paramètres d'URL). */
export const userListQuerySchema = z.object({
  q: z.string().trim().max(NAME_MAX_LENGTH).optional().catch(undefined),
  role: roleSchema.optional().catch(undefined),
  status: z.enum(USER_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})
export type UserListQuery = z.infer<typeof userListQuerySchema>

/**
 * Envoi par e-mail d'un lien déjà émis (POST /api/admin/users/:id/password-link/email) : le jeton du
 * lien affiché (vérifié par le serveur, jamais stocké en clair), la langue et le fuseau horaire de
 * l'expéditeur (date d'échéance écrite dans l'e-mail).
 */
export const emailPasswordLinkSchema = z.object({
  token: z.string().min(1).max(128).regex(/^[\w-]+$/),
  locale: z.enum(EMAIL_LOCALES),
  timeZone: z.string().max(64).optional(),
})
export type EmailPasswordLinkInput = z.input<typeof emailPasswordLinkSchema>

/** Nouveau mot de passe (invitation ou réinitialisation), saisi deux fois. */
export const newPasswordSchema = z.object({
  password: z
    .string('validation.required')
    .min(1, 'validation.required')
    .min(PASSWORD_MIN_LENGTH, 'validation.tooShort')
    .max(PASSWORD_MAX_LENGTH, 'validation.tooLong'),
  confirmation: z.string('validation.required').min(1, 'validation.required'),
}).refine(data => data.password === data.confirmation, {
  path: ['confirmation'],
  message: 'validation.passwordMismatch',
})
export type NewPasswordInput = z.input<typeof newPasswordSchema>
