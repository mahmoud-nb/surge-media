import { z } from 'zod'
import {
  API_DEFAULT_LIMIT,
  API_ERRORS,
  API_MAX_IDS,
  API_MAX_LIMIT,
  API_MEDIA_SORTS,
  API_SIGNED_URL_TARGETS,
  DELEGATED_MAX_FILES,
  DELEGATED_MAX_TYPES,
  DELEGATED_SUBJECT_MAX_LENGTH,
  DELEGATED_TOKEN_TTL,
} from '../utils/api'
import { ORIGIN_MAX_LENGTH } from '../utils/credentials'
import { FOLDER_NAME_MAX_LENGTH } from '../utils/folders'
import { ACCEPTED_MEDIA_TYPES, ENABLED_MEDIA_KINDS, MEDIA_PRESETS, MEDIA_VISIBILITIES, SIGNED_URL_MAX_TTL } from '../utils/media'
import { isWildcardOrigin, normalizeOrigin } from '../utils/origins'
import { TOKEN_SCOPES } from '../utils/permissions'
import { isValidFolderName } from './folders'

/**
 * Contrat de l'API publique v1 : paramètres acceptés (validation stricte, erreurs 400
 * INVALID_REQUEST détaillées) et représentations renvoyées. Les schémas de réponse servent à la
 * spécification OpenAPI (`/api/v1/openapi.json`, via `z.toJSONSchema`) et aux tests.
 * Valeurs en minuscules, dates ISO 8601, URL absolues ; ni e-mails ni chemins physiques.
 */

const ID_PATTERN = /^[a-z0-9]{8,64}$/i
const lower = <T extends readonly string[]>(values: T) => values.map(value => value.toLowerCase()) as [string, ...string[]]

export const API_MEDIA_KINDS = lower(ENABLED_MEDIA_KINDS)
export const API_VISIBILITIES = lower(MEDIA_VISIBILITIES)

// ─── Requêtes ────────────────────────────────────────────────────────────────

export const apiMediaListQuerySchema = z.object({
  q: z.string().trim().min(1).max(191).optional().meta({ description: 'Recherche dans le titre, le nom de fichier et le texte alternatif (insensible à la casse et aux accents).' }),
  kind: z.enum(API_MEDIA_KINDS).optional(),
  visibility: z.enum(API_VISIBILITIES).optional(),
  ids: z
    .string()
    .transform(value => [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))])
    .pipe(z.array(z.string().regex(ID_PATTERN)).min(1).max(API_MAX_IDS))
    .optional()
    .meta({ description: `Identifiants séparés par des virgules (${API_MAX_IDS} au plus) : renvoie ces médias, dans cet ordre, sans pagination.` }),
  folder: z.union([z.literal('root'), z.string().regex(ID_PATTERN)]).optional()
    .meta({ description: 'Dossier : identifiant, ou `root` pour les médias hors dossier. Absent : tous les médias du projet.' }),
  recursive: z.enum(['true', 'false']).transform(value => value === 'true').optional()
    .meta({ description: 'Avec `folder` : inclut les médias des sous-dossiers (`root` + `recursive` = tout le projet).' }),
  sort: z.enum(API_MEDIA_SORTS).default('newest'),
  limit: z.coerce.number().int().min(1).max(API_MAX_LIMIT).default(API_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional().meta({ description: 'Curseur opaque renvoyé par la page précédente (`nextCursor`).' }),
  withTotal: z.enum(['true', 'false']).transform(value => value === 'true').optional()
    .meta({ description: 'Ajoute `total` (nombre de résultats) à la réponse : requête supplémentaire, à ne demander que si nécessaire.' }),
})
export type ApiMediaListQuery = z.output<typeof apiMediaListQuerySchema>

export const apiProjectListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(API_MAX_LIMIT).default(API_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
})
export type ApiProjectListQuery = z.output<typeof apiProjectListQuerySchema>

export const apiSignedUrlBodySchema = z.object({
  target: z.enum(API_SIGNED_URL_TARGETS).default('file')
    .meta({ description: '`file` : l\'original ; `preset` : un dérivé nommé (`preset`) ; `derived` : tout dérivé de la version (une signature pour tout un srcset).' }),
  preset: z.enum(MEDIA_PRESETS).optional(),
  expiresIn: z.number().int().min(60).max(SIGNED_URL_MAX_TTL).default(3600).meta({ description: 'Durée de validité en secondes (60 s à 7 jours).' }),
}).superRefine((body, ctx) => {
  if (body.target === 'preset' && !body.preset) ctx.addIssue({ code: 'custom', path: ['preset'], message: 'Required when target is "preset".' })
})

// ─── Écritures ───────────────────────────────────────────────────────────────

/** Texte facultatif (VARCHAR(191) sous MySQL) : espaces retirés, chaîne vide ou null → champ effacé. */
const optionalText = z.string().trim().max(191).transform(value => value || null).nullable()

const writableFields = {
  title: optionalText.optional(),
  altText: optionalText.optional().meta({ description: 'Texte alternatif (accessibilité).' }),
  visibility: z.enum(API_VISIBILITIES).optional(),
  folderId: z.string().regex(ID_PATTERN).nullable().optional()
    .meta({ description: 'Dossier du projet (`null` = hors dossier). Imposé par un jeton délégué qui le fixe.' }),
}

/**
 * Champs texte d'un envoi (multipart/form-data, en plus du fichier `file`). Visibilité `public`
 * par défaut, imposée par un jeton délégué qui la fixe. Champ inconnu → 400.
 */
export const apiMediaUploadFieldsSchema = z.strictObject(writableFields)

/** PATCH d'un média : champs absents inchangés, `null` ou texte vide efface le titre / le texte alternatif. */
export const apiMediaUpdateSchema = z.strictObject(writableFields)
export type ApiMediaUpdate = z.output<typeof apiMediaUpdateSchema>

export const apiDuplicateBodySchema = z.strictObject({
  target: z
    .union([
      z.strictObject({ projectId: z.string().regex(ID_PATTERN) }),
      z.strictObject({ library: z.literal(true) }),
    ])
    .optional()
    .meta({ description: 'Espace de la copie : un projet (`projectId`), ou la bibliothèque de l\'organisation (`library`, jeton personnel qui l\'inclut). Par défaut : le projet du média.' }),
  folderId: z.string().regex(ID_PATTERN).nullable().optional().meta({ description: 'Dossier de l\'espace cible (par défaut : hors dossier).' }),
})

/** Types de fichiers acceptés par l'installation (détectés d'après le contenu). */
const ACCEPTED_TYPES = Object.values(ACCEPTED_MEDIA_TYPES).flatMap(types => Object.keys(types ?? {})) as [string, ...string[]]

/** Contraintes d'envoi d'un jeton délégué (champ `upload`). */
export const apiUploadConstraintsSchema = z.strictObject({
  maxFiles: z.number().int().min(1).max(DELEGATED_MAX_FILES).optional()
    .meta({ description: 'Nombre de fichiers que le jeton peut envoyer (nouveaux médias et remplacements).' }),
  maxSize: z.number().int().min(1).max(2_147_483_647).optional()
    .meta({ description: 'Taille maximale d\'un fichier, en octets (bornée par la limite de l\'installation).' }),
  types: z.array(z.enum(ACCEPTED_TYPES)).min(1).max(DELEGATED_MAX_TYPES).optional()
    .meta({ description: 'Types MIME acceptés, détectés d\'après le contenu du fichier.' }),
  visibility: z.enum(API_VISIBILITIES).optional().meta({ description: 'Visibilité imposée aux médias envoyés.' }),
  folderId: z.string().regex(ID_PATTERN).optional().meta({ description: 'Dossier du projet imposé aux médias envoyés.' }),
})
export type ApiUploadConstraints = z.output<typeof apiUploadConstraintsSchema>

export const apiDelegatedTokenBodySchema = z.strictObject({
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(TOKEN_SCOPES.length)
    .meta({ description: 'Portées demandées, toutes détenues par l\'émetteur dans ce projet (aucune lecture d\'office).' }),
  expiresIn: z.number().int().min(DELEGATED_TOKEN_TTL.min).max(DELEGATED_TOKEN_TTL.max).default(DELEGATED_TOKEN_TTL.default)
    .meta({ description: 'Durée de validité en secondes (1 à 60 minutes, 15 par défaut), bornée par l\'échéance de l\'émetteur.' }),
  subject: z.string().trim().min(1).max(DELEGATED_SUBJECT_MAX_LENGTH).regex(/^\P{Cc}+$/u).optional()
    .meta({ description: 'Identifiant opaque de l\'utilisateur final côté application cliente (provenance et journal d\'audit).' }),
  origin: z
    .string()
    .trim()
    .min(1)
    .max(ORIGIN_MAX_LENGTH)
    .transform((value, ctx) => {
      const origin = normalizeOrigin(value)
      if (!origin || isWildcardOrigin(origin)) {
        ctx.addIssue({ code: 'custom', message: 'Expected an exact origin, such as https://app.example.com.' })
        return z.NEVER
      }
      return origin
    })
    .optional()
    .meta({ description: 'Origine exacte du site autorisé à utiliser le jeton (parmi les origines autorisées du projet).' }),
  upload: apiUploadConstraintsSchema.optional(),
}).superRefine((body, ctx) => {
  if (body.upload && !body.scopes.some(scope => scope === 'media:upload' || scope === 'media:write')) {
    ctx.addIssue({ code: 'custom', path: ['upload'], message: 'Upload constraints require the media:upload or media:write scope.' })
  }
})
export type ApiDelegatedTokenBody = z.output<typeof apiDelegatedTokenBodySchema>

/**
 * Charge d'un jeton délégué (`sm_dt_<charge base64url>.<signature>`), lisible par le composant
 * (échéance, portées, contraintes) ; seule la signature du serveur la rend valable.
 */
export const delegatedTokenClaimsSchema = z.strictObject({
  v: z.literal(1),
  jti: z.string().min(8).max(64).meta({ description: 'Identifiant unique du jeton.' }),
  iss: z.string().regex(ID_PATTERN).meta({ description: 'Identifiant (clé secrète ou jeton personnel) qui a émis le jeton.' }),
  project: z.string().regex(ID_PATTERN),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  sub: z.string().max(DELEGATED_SUBJECT_MAX_LENGTH).optional(),
  origin: z.string().max(ORIGIN_MAX_LENGTH).optional(),
  upload: apiUploadConstraintsSchema.optional(),
  iat: z.number().int(),
  exp: z.number().int().meta({ description: 'Échéance (secondes Unix).' }),
  kid: z.string().min(1).max(16),
})
export type DelegatedTokenClaims = z.output<typeof delegatedTokenClaimsSchema>

// ─── Dossiers ────────────────────────────────────────────────────────────────

/** Nom de dossier : 1 à 100 caractères, sans « / », « \\ » ni caractère de contrôle (normalisé NFC, espaces de bord retirés). */
const apiFolderNameSchema = z
  .string()
  .transform(value => value.normalize('NFC').trim())
  .pipe(z.string().min(1).max(FOLDER_NAME_MAX_LENGTH).refine(isValidFolderName, 'Folder names cannot contain "/", "\\" or control characters, nor be "." or "..".'))

export const apiFolderCreateSchema = z.strictObject({
  name: apiFolderNameSchema,
  parentId: z.string().regex(ID_PATTERN).nullable().optional().meta({ description: 'Dossier parent (absent ou `null` : à la racine du projet).' }),
})

export const apiFolderUpdateSchema = z.strictObject({
  name: apiFolderNameSchema.optional(),
  parentId: z.string().regex(ID_PATTERN).nullable().optional().meta({ description: 'Nouveau parent (`null` : racine ; absent : inchangé).' }),
})

export const apiFolderDeleteQuerySchema = z.strictObject({
  content: z.enum(['parent']).optional()
    .meta({ description: '`parent` : les sous-dossiers et médias remontent dans le dossier parent avant la suppression (sinon : dossier vide exigé).' }),
})

// ─── Réponses ────────────────────────────────────────────────────────────────

const isoDate = z.iso.datetime({ offset: true })

export const apiMediaSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable().meta({ description: 'Projet du média ; null = bibliothèque de l\'organisation (copie créée par duplication).' }),
  kind: z.enum(API_MEDIA_KINDS),
  visibility: z.enum(API_VISIBILITIES),
  title: z.string().nullable(),
  altText: z.string().nullable(),
  filename: z.string().meta({ description: 'Nom du fichier envoyé (indicatif).' }),
  mimeType: z.string(),
  extension: z.string().nullable(),
  size: z.number().int().meta({ description: 'Taille en octets.' }),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  duration: z.number().nullable(),
  version: z.number().int().meta({ description: 'Incrémentée à chaque remplacement du fichier ; fait partie des URL.' }),
  folderId: z.string().nullable(),
  url: z.url().meta({ description: 'URL absolue du fichier original ; signée (temporaire) pour un média privé.' }),
  previewUrl: z.url().nullable().meta({ description: 'URL de l\'aperçu (WebP, 480 px) ; signée pour un média privé.' }),
  urlExpiresAt: isoDate.nullable().meta({ description: 'Échéance des URL signées ; null pour un média public (URL permanentes).' }),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiMedia = z.input<typeof apiMediaSchema>

export const apiFolderSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().meta({ description: 'Dossier parent ; `null` à la racine du projet.' }),
  name: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiFolder = z.input<typeof apiFolderSchema>

export const apiFolderListSchema = z.object({
  items: z.array(apiFolderSchema).meta({ description: 'Tous les dossiers du projet, à plat (arbre par `parentId`), triés par nom.' }),
})

export const apiMediaListSchema = z.object({
  items: z.array(apiMediaSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().optional(),
})

export const apiProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  publicListing: z.boolean().meta({ description: 'La clé publique peut lister et chercher les médias publics.' }),
  scopes: z.array(z.enum(TOKEN_SCOPES)).meta({ description: 'Portées effectives de l\'identifiant utilisé dans ce projet.' }),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiProject = z.input<typeof apiProjectSchema>

export const apiProjectListSchema = z.object({
  items: z.array(apiProjectSchema),
  nextCursor: z.string().nullable(),
})

const projectRef = z.object({ id: z.string(), name: z.string(), slug: z.string() })

export const apiMeSchema = z.object({
  credential: z.object({
    id: z.string().meta({ description: 'Identifiant de l\'identifiant ; `jti` pour un jeton délégué.' }),
    type: z.enum(['personal', 'secret', 'publishable', 'delegated']),
    name: z.string(),
    prefix: z.string(),
    environment: z.string().nullable(),
    scopes: z.array(z.enum(TOKEN_SCOPES)).meta({ description: 'Portées déclarées (un jeton personnel reste limité aux droits actuels de son propriétaire, un jeton délégué à ceux de son émetteur).' }),
    expiresAt: isoDate.nullable(),
    createdAt: isoDate,
  }),
  delegated: z.object({
    subject: z.string().nullable(),
    origin: z.string().nullable(),
    upload: apiUploadConstraintsSchema.nullable(),
  }).nullable().meta({ description: 'Jeton délégué : sujet final, origine et contraintes d\'envoi.' }),
  user: z.object({ id: z.string(), name: z.string().nullable() }).nullable().meta({ description: 'Propriétaire d\'un jeton personnel.' }),
  project: projectRef.extend({ archived: z.boolean() }).nullable().meta({ description: 'Projet d\'une clé.' }),
  access: z.object({
    allProjects: z.boolean(),
    library: z.boolean(),
    projects: z.array(projectRef),
  }).nullable().meta({ description: 'Sélection d\'un jeton personnel.' }),
})
export type ApiMe = z.input<typeof apiMeSchema>

export const apiDelegatedTokenSchema = z.object({
  token: z.string().meta({ description: 'Jeton à transmettre au navigateur, qui l\'envoie en `Authorization: Bearer <token>`.' }),
  expiresAt: isoDate,
  scopes: z.array(z.enum(TOKEN_SCOPES)),
})

export const apiSignedUrlSchema = z.object({
  url: z.url(),
  query: z.string().meta({ description: 'Paramètres de signature seuls (`exp`, `kid`, `scope`, `sig`), à ajouter aux URL des dérivés pour `derived` ; vide pour un média public.' }),
  expiresAt: isoDate.nullable(),
})

export const apiProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(Object.keys(API_ERRORS) as [string, ...string[]]),
  detail: z.string().optional(),
  instance: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional().meta({ description: 'Détail des paramètres invalides (INVALID_REQUEST).' }),
})
