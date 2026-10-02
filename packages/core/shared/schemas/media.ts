import { z } from 'zod'
import { ENABLED_MEDIA_KINDS, MEDIA_VISIBILITIES, SIGNED_URL_MAX_TTL } from '../utils/media'
import { roundFocalCoordinate } from '../utils/transforms'
import { folderIdSchema } from './folders'

/** VARCHAR(191) sous MySQL. */
export const MEDIA_TEXT_MAX_LENGTH = 191
export const MEDIA_PAGE_SIZE = 24
export const MEDIA_SORTS = ['newest', 'oldest', 'name', 'size'] as const
export const MEDIA_STATUSES = ['active', 'trash'] as const

/** Texte facultatif : espaces retirés, chaîne vide → null. */
const optionalText = z
  .string()
  .trim()
  .max(MEDIA_TEXT_MAX_LENGTH, 'validation.tooLong')
  .transform(value => value || null)
  .nullable()

export const visibilitySchema = z.enum(MEDIA_VISIBILITIES, 'validation.required')

/**
 * Point d'intérêt d'une image : fractions (0 à 1) de la largeur et de la hauteur de l'image orientée,
 * depuis le coin haut gauche, arrondies à 4 décimales. Partagé avec l'API v1.
 */
export const focalPointSchema = z
  .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .transform(point => ({ x: roundFocalCoordinate(point.x), y: roundFocalCoordinate(point.y) }))

/**
 * Métadonnées modifiables (PATCH) ; aussi utilisées à l'upload. `folderId` : dossier de l'espace du
 * média (null = racine). `focalPoint` (images, null efface) : sa modification crée une version.
 */
export const mediaMetadataSchema = z.object({
  title: optionalText,
  altText: optionalText,
  visibility: visibilitySchema,
  folderId: folderIdSchema.nullable(),
  focalPoint: focalPointSchema.nullable(),
}).partial()
export type MediaMetadataInput = z.input<typeof mediaMetadataSchema>

/** Identifiant d'un projet dans les paramètres d'URL ; absent = bibliothèque de l'organisation. */
const projectParamSchema = z.string().trim().min(1).max(64).optional().catch(undefined)

/** Espace visé par une requête (liste, envoi) : `?project=<id>`, absent = bibliothèque. */
export const spaceQuerySchema = z.object({ project: projectParamSchema })

/** Filtres de la médiathèque (paramètres d'URL) ; les valeurs invalides sont ignorées. */
export const mediaListQuerySchema = z.object({
  project: projectParamSchema,
  q: z.string().trim().max(MEDIA_TEXT_MAX_LENGTH).optional().catch(undefined),
  kind: z.enum(ENABLED_MEDIA_KINDS as [string, ...string[]]).optional().catch(undefined),
  visibility: visibilitySchema.optional().catch(undefined),
  status: z.enum(MEDIA_STATUSES).catch('active'),
  /** Dossier affiché (absent = racine de l'espace) ; ignoré pour la corbeille. */
  folder: z.string().trim().min(1).max(64).optional().catch(undefined),
  /** Inclure les sous-dossiers (`recursive=1`). */
  recursive: z.enum(['1', 'true']).transform(() => true).optional().catch(undefined),
  sort: z.enum(MEDIA_SORTS).catch('newest'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>

/** Espace cible d'une duplication ou d'un déplacement : un projet, ou null = bibliothèque. */
export const mediaTargetSchema = z.object({
  projectId: z.string('validation.required').trim().min(1).max(64).nullable(),
  /** Dossier de l'espace cible (absent ou null = racine). */
  folderId: folderIdSchema.nullable().optional(),
})

/** Lien temporaire vers un média privé. */
export const signedUrlSchema = z.object({
  expiresIn: z.number().int().min(60).max(SIGNED_URL_MAX_TTL),
})
