import { z } from 'zod'
import { ENABLED_MEDIA_KINDS, MEDIA_VISIBILITIES, SIGNED_URL_MAX_TTL } from '../utils/media'
import { canonicalLanguage, TEXT_TRACK_KINDS, TEXT_TRACK_LABEL_MAX_LENGTH } from '../utils/text-tracks'
import { TAG_DEFAULT_MATCH, TAG_FILTER_MAX, TAG_MATCHES, TAG_SLUG_PATTERN } from '../utils/tags'
import { roundFocalCoordinate } from '../utils/transforms'
import { folderIdSchema } from './folders'
import { mediaTagIdsSchema } from './tags'

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
  /** Étiquettes du média (identifiants), ensemble remplacé ; les confidentielles cachées au lecteur restent. */
  tagIds: mediaTagIdsSchema,
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
  /**
   * Étiquettes (slugs séparés par des virgules) : absent = aucun filtre ; slugs mal formés ignorés,
   * `TAG_FILTER_MAX` au plus.
   */
  tags: z.string().max(2000).optional().catch(undefined).transform(value => value
    ? [...new Set(value.split(',').map(slug => slug.trim().toLowerCase()).filter(slug => TAG_SLUG_PATTERN.test(slug)))].slice(0, TAG_FILTER_MAX)
    : undefined),
  /** Plusieurs étiquettes : au moins une (`any`, défaut) ou toutes (`all`). */
  match: z.enum(TAG_MATCHES).catch(TAG_DEFAULT_MATCH),
  /** Médias sans étiquette (`untagged=1`) ; ignoré si des étiquettes sont demandées. */
  untagged: z.enum(['1', 'true']).transform(() => true).optional().catch(undefined),
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

// ─── Pistes de texte des vidéos (phase D2) ───────────────────────────────────

const trackLanguageSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(35, 'validation.tooLong')
  .transform((value, ctx) => {
    const canonical = canonicalLanguage(value)
    if (!canonical) ctx.addIssue({ code: 'custom', message: 'media.tracks.errors.language' })
    return canonical ?? value
  })

const trackLabelSchema = z
  .string('validation.required')
  .trim()
  .min(1, 'validation.required')
  .max(TEXT_TRACK_LABEL_MAX_LENGTH, 'validation.tooLong')
  // eslint-disable-next-line no-control-regex
  .refine(value => !/[\u0000-\u001F\u007F]/.test(value), 'media.tracks.errors.label')

/** Booléen d'un champ de formulaire multipart (`true`/`false`) ou JSON. */
const formBoolean = z.union([z.boolean(), z.enum(['true', 'false', '1', '0']).transform(value => value === 'true' || value === '1')])

/** Métadonnées d'une piste de texte (création : champs du formulaire multipart avec le fichier). */
export const textTrackInputSchema = z.object({
  kind: z.enum(TEXT_TRACK_KINDS, 'validation.required'),
  language: trackLanguageSchema,
  label: trackLabelSchema,
  isDefault: formBoolean.default(false),
})
export type TextTrackInput = z.output<typeof textTrackInputSchema>

/** Modification d'une piste (le fichier ne change pas, ni son URL). */
export const textTrackUpdateSchema = z.strictObject({
  kind: z.enum(TEXT_TRACK_KINDS, 'validation.required'),
  language: trackLanguageSchema,
  label: trackLabelSchema,
  isDefault: z.boolean(),
}).partial()
export type TextTrackUpdate = z.output<typeof textTrackUpdateSchema>
