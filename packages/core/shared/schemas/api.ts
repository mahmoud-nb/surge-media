import { z } from 'zod'
import {
  API_DEFAULT_LIMIT,
  API_ERRORS,
  API_MAX_IDS,
  API_MAX_LIMIT,
  API_MEDIA_SORTS,
  API_SIGNED_URL_TARGETS,
} from '../utils/api'
import { ENABLED_MEDIA_KINDS, MEDIA_PRESETS, MEDIA_VISIBILITIES, SIGNED_URL_MAX_TTL } from '../utils/media'
import { TOKEN_SCOPES } from '../utils/permissions'

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

// ─── Réponses ────────────────────────────────────────────────────────────────

const isoDate = z.iso.datetime({ offset: true })

export const apiMediaSchema = z.object({
  id: z.string(),
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
    id: z.string(),
    type: z.enum(['personal', 'secret', 'publishable']),
    name: z.string(),
    prefix: z.string(),
    environment: z.string().nullable(),
    scopes: z.array(z.enum(TOKEN_SCOPES)).meta({ description: 'Portées déclarées (un jeton personnel reste limité aux droits actuels de son propriétaire).' }),
    expiresAt: isoDate.nullable(),
    createdAt: isoDate,
  }),
  user: z.object({ id: z.string(), name: z.string().nullable() }).nullable().meta({ description: 'Propriétaire d\'un jeton personnel.' }),
  project: projectRef.extend({ archived: z.boolean() }).nullable().meta({ description: 'Projet d\'une clé.' }),
  access: z.object({
    allProjects: z.boolean(),
    library: z.boolean(),
    projects: z.array(projectRef),
  }).nullable().meta({ description: 'Sélection d\'un jeton personnel.' }),
})
export type ApiMe = z.input<typeof apiMeSchema>

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
