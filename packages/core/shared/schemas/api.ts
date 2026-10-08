import { z } from 'zod'
import {
  API_DEFAULT_LIMIT,
  API_ERRORS,
  API_MAX_IDS,
  API_MAX_LIMIT,
  API_DEFAULT_TRANSFORM_FORMAT,
  API_MEDIA_SORTS,
  API_SIGNED_URL_TARGETS,
  API_SIGNED_URLS_MAX,
  API_TEXT_TRACK_KINDS,
  DELEGATED_MAX_FILES,
  DELEGATED_MAX_TYPES,
  DELEGATED_SUBJECT_MAX_LENGTH,
  DELEGATED_TOKEN_TTL,
  OPENAPI_DEFAULT_LANG,
  OPENAPI_LANGS,
} from '../utils/api'
import { ORIGIN_MAX_LENGTH } from '../utils/credentials'
import { FOLDER_NAME_MAX_LENGTH } from '../utils/folders'
import { acceptedMimeTypes, CONVERTED_MIME_TYPES, ENABLED_MEDIA_KINDS, MEDIA_VISIBILITIES, SIGNED_URL_MAX_TTL } from '../utils/media'
import { isWildcardOrigin, normalizeOrigin } from '../utils/origins'
import { TOKEN_SCOPES } from '../utils/permissions'
import { TEXT_TRACK_LABEL_MAX_LENGTH } from '../utils/text-tracks'
import { PRESET_NAME_PATTERN, TRANSFORM_FORMATS, TRANSFORM_SEGMENT_MAX_LENGTH } from '../utils/transforms'
import { API_PROCESSING_STATUSES, RENDITION_NAMES, VIDEO_JOB_ERROR_CODES } from '../utils/video-processing'
import { isValidFolderName } from './folders'
import { focalPointSchema } from './media'

/**
 * Contrat de l'API publique v1 : paramètres acceptés (validation stricte, erreurs 400
 * INVALID_REQUEST détaillées) et représentations renvoyées. Les schémas de réponse servent à la
 * spécification OpenAPI (`/api/v1/openapi.json`, via `z.toJSONSchema`) et aux tests.
 * Valeurs en minuscules, dates ISO 8601, URL absolues ; ni e-mails ni chemins physiques.
 */

/**
 * Texte de documentation d'un champ (spécification OpenAPI) : français (référence) et traduction
 * anglaise, appliquée par `GET /api/v1/openapi.json?lang=en` (extension `x-i18n`, retirée du
 * document servi ; server/lib/api/openapi.ts).
 */
function doc(fr: string, en: string) {
  return { description: fr, 'x-i18n': { en: { description: en } } }
}

const ID_PATTERN = /^[a-z0-9]{8,64}$/i
const lower = <T extends readonly string[]>(values: T) => values.map(value => value.toLowerCase()) as [string, ...string[]]

export const API_MEDIA_KINDS = lower(ENABLED_MEDIA_KINDS)
export const API_VISIBILITIES = lower(MEDIA_VISIBILITIES)

// ─── Requêtes ────────────────────────────────────────────────────────────────

export const apiMediaListQuerySchema = z.object({
  q: z.string().trim().min(1).max(191).optional().meta(doc('Recherche dans le titre, le nom de fichier et le texte alternatif (insensible à la casse et aux accents).', 'Searches the title, file name and alternative text (case and accent insensitive).')),
  kind: z.enum(API_MEDIA_KINDS).optional(),
  visibility: z.enum(API_VISIBILITIES).optional(),
  ids: z
    .string()
    .transform(value => [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))])
    .pipe(z.array(z.string().regex(ID_PATTERN)).min(1).max(API_MAX_IDS))
    .optional()
    .meta(doc(`Identifiants séparés par des virgules (${API_MAX_IDS} au plus) : renvoie ces médias, dans cet ordre, sans pagination.`, `Comma-separated ids (${API_MAX_IDS} at most): returns these media, in this order, without pagination.`)),
  folder: z.union([z.literal('root'), z.string().regex(ID_PATTERN)]).optional()
    .meta(doc('Dossier : identifiant, ou `root` pour les médias hors dossier. Absent : tous les médias du projet.', 'Folder: an id, or `root` for media outside any folder. Absent: every media item of the project.')),
  recursive: z.enum(['true', 'false']).transform(value => value === 'true').optional()
    .meta(doc('Avec `folder` : inclut les médias des sous-dossiers (`root` + `recursive` = tout le projet).', 'With `folder`: includes media from subfolders (`root` + `recursive` = the whole project).')),
  sort: z.enum(API_MEDIA_SORTS).default('newest'),
  limit: z.coerce.number().int().min(1).max(API_MAX_LIMIT).default(API_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional().meta(doc('Curseur opaque renvoyé par la page précédente (`nextCursor`).', 'Opaque cursor returned by the previous page (`nextCursor`).')),
  withTotal: z.enum(['true', 'false']).transform(value => value === 'true').optional()
    .meta(doc('Ajoute `total` (nombre de résultats) à la réponse : requête supplémentaire, à ne demander que si nécessaire.', 'Adds `total` (number of results) to the response: an extra query, request it only when needed.')),
})
export type ApiMediaListQuery = z.output<typeof apiMediaListQuerySchema>

export const apiProjectListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(API_MAX_LIMIT).default(API_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
})
export type ApiProjectListQuery = z.output<typeof apiProjectListQuerySchema>

/** Paramètres de GET /api/v1/openapi.json (langue inconnue : langue par défaut). */
export const apiOpenApiQuerySchema = z.object({
  lang: z.enum(OPENAPI_LANGS).default(OPENAPI_DEFAULT_LANG).catch(OPENAPI_DEFAULT_LANG)
    .meta(doc('Langue des textes de la spécification (français par défaut).', 'Language of the specification texts (French by default).')),
})

/** Fichier visé par un lien signé (unitaire ou par lot). */
const signedUrlTargetShape = {
  target: z.enum(API_SIGNED_URL_TARGETS).default('file').meta(doc(
    '`file` : l\'original ; `preset` : un préréglage utilisable dans le projet ; `transform` : une transformation libre ; `derived` : signature valable pour tout dérivé de la version (une pour tout un srcset), l\'URL renvoyée étant celle de `preset` ou `transform` (l\'aperçu par défaut) ; `track` : une piste de texte d\'une vidéo (`trackId`).',
    '`file`: the original; `preset`: a preset usable in the project; `transform`: a free transformation; `derived`: a signature valid for any derivative of the version (one for a whole srcset), the returned URL being that of `preset` or `transform` (the preview by default); `track`: a text track of a video (`trackId`).',
  )),
  preset: z.string().regex(PRESET_NAME_PATTERN).optional()
    .meta(doc('Nom du préréglage (`GET …/presets`), avec la cible `preset` ou `derived`.', 'Preset name (`GET …/presets`), with target `preset` or `derived`.')),
  transform: z.string().max(TRANSFORM_SEGMENT_MAX_LENGTH).optional().meta(doc(
    'Paramètres `clé_valeur` séparés par des virgules (`w_800,h_450,q_75`), dans n\'importe quel ordre, avec la cible `transform` ou `derived` : l\'URL renvoyée porte leur forme canonique. Transformation invalide : `INVALID_TRANSFORM`.',
    'Comma-separated `key_value` parameters (`w_800,h_450,q_75`), in any order, with target `transform` or `derived`: the returned URL carries their canonical form. Invalid transformation: `INVALID_TRANSFORM`.',
  )),
  format: z.enum(TRANSFORM_FORMATS).optional().meta(doc(
    `Format de sortie d'un dérivé (\`${API_DEFAULT_TRANSFORM_FORMAT}\` par défaut), parmi ceux activés sur le serveur.`,
    `Output format of a derivative (\`${API_DEFAULT_TRANSFORM_FORMAT}\` by default), among those enabled on the server.`,
  )),
  trackId: z.string().regex(ID_PATTERN).optional()
    .meta(doc('Identifiant de la piste de texte (`textTracks[].id`), avec la cible `track`.', 'Id of the text track (`textTracks[].id`), with target `track`.')),
}

/** Combinaisons cohérentes : `preset` et `transform` selon la cible, jamais ensemble ; rien de plus pour l'original. */
function refineSignedUrlTarget(body: { target: string, preset?: string, transform?: string, format?: string, trackId?: string }, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (body.target === 'track') {
    if (body.trackId === undefined) issue('trackId', 'Required when target is "track".')
    for (const key of ['preset', 'transform', 'format'] as const) {
      if (body[key] !== undefined) issue(key, 'Only for derivatives: not allowed when target is "track".')
    }
    return
  }
  if (body.trackId !== undefined) issue('trackId', 'Only with target "track".')
  if (body.target === 'file') {
    for (const key of ['preset', 'transform', 'format'] as const) {
      if (body[key] !== undefined) issue(key, 'Only for derivatives: not allowed when target is "file".')
    }
    return
  }
  if (body.target === 'preset' && body.preset === undefined) issue('preset', 'Required when target is "preset".')
  if (body.target === 'transform' && body.transform === undefined) issue('transform', 'Required when target is "transform".')
  if (body.preset !== undefined && body.transform !== undefined) issue('transform', 'Give either preset or transform, not both.')
  else if (body.target === 'preset' && body.transform !== undefined) issue('transform', 'Not allowed when target is "preset".')
  else if (body.target === 'transform' && body.preset !== undefined) issue('preset', 'Not allowed when target is "transform".')
}

const signedUrlExpiresIn = z.number().int().min(60).max(SIGNED_URL_MAX_TTL).default(3600).meta(doc(
  'Durée de validité en secondes (60 s à 7 jours ; 1 h au plus avec un jeton délégué). Sans effet sur une URL permanente.',
  'Validity in seconds (60 s to 7 days; 1 h at most with a delegated token). No effect on a permanent URL.',
))

export const apiSignedUrlBodySchema = z
  .strictObject({ ...signedUrlTargetShape, expiresIn: signedUrlExpiresIn })
  .superRefine(refineSignedUrlTarget)
export type ApiSignedUrlBody = z.output<typeof apiSignedUrlBodySchema>

export const apiSignedUrlsBodySchema = z.strictObject({
  items: z
    .array(z.strictObject({ mediaId: z.string().regex(ID_PATTERN), ...signedUrlTargetShape }).superRefine(refineSignedUrlTarget))
    .min(1)
    .max(API_SIGNED_URLS_MAX)
    .meta(doc(
      `Liens demandés (${API_SIGNED_URLS_MAX} au plus) ; un même média peut figurer plusieurs fois.`,
      `Requested links (${API_SIGNED_URLS_MAX} at most); the same media item may appear several times.`,
    )),
  expiresIn: signedUrlExpiresIn,
})
export type ApiSignedUrlsBody = z.output<typeof apiSignedUrlsBodySchema>

// ─── Écritures ───────────────────────────────────────────────────────────────

/** Texte facultatif (VARCHAR(191) sous MySQL) : espaces retirés, chaîne vide ou null → champ effacé. */
const optionalText = z.string().trim().max(191).transform(value => value || null).nullable()

const writableFields = {
  title: optionalText.optional(),
  altText: optionalText.optional().meta(doc('Texte alternatif (accessibilité).', 'Alternative text (accessibility).')),
  visibility: z.enum(API_VISIBILITIES).optional(),
  folderId: z.string().regex(ID_PATTERN).nullable().optional()
    .meta(doc('Dossier du projet (`null` = hors dossier). Imposé par un jeton délégué qui le fixe.', 'Project folder (`null` = no folder). Enforced by a delegated token that sets it.')),
}

/**
 * Champs texte d'un envoi (multipart/form-data, en plus du fichier `file`). Visibilité `public`
 * par défaut, imposée par un jeton délégué qui la fixe. Champ inconnu → 400.
 */
export const apiMediaUploadFieldsSchema = z.strictObject(writableFields)

/**
 * PATCH d'un média : champs absents inchangés, `null` ou texte vide efface le titre / le texte
 * alternatif ; `focalPoint` (images) crée une nouvelle version.
 */
export const apiMediaUpdateSchema = z.strictObject({
  ...writableFields,
  focalPoint: focalPointSchema.nullable().optional().meta(doc(
    'Point d\'intérêt d\'une image : `{ x, y }`, fractions (0 à 1) de la largeur et de la hauteur depuis le coin haut gauche, arrondies à 4 décimales ; `null` l\'efface (centre). Le modifier **incrémente la version** : toutes les URL du média changent (les anciennes redirigent vers les nouvelles) et les dérivés sont régénérés à la demande.',
    'Focal point of an image: `{ x, y }`, fractions (0 to 1) of the width and height from the top left corner, rounded to 4 decimals; `null` clears it (center). Changing it **increments the version**: every URL of the media item changes (old ones redirect to the new ones) and derivatives are generated again on demand.',
  )),
})
export type ApiMediaUpdate = z.output<typeof apiMediaUpdateSchema>

export const apiDuplicateBodySchema = z.strictObject({
  target: z
    .union([
      z.strictObject({ projectId: z.string().regex(ID_PATTERN) }),
      z.strictObject({ library: z.literal(true) }),
    ])
    .optional()
    .meta(doc('Espace de la copie : un projet (`projectId`), ou la bibliothèque de l\'organisation (`library`, jeton personnel qui l\'inclut). Par défaut : le projet du média.', 'Where the copy goes: a project (`projectId`), or the organization library (`library`, with a personal token that includes it). Default: the project of the media item.')),
  folderId: z.string().regex(ID_PATTERN).nullable().optional().meta(doc('Dossier de l\'espace cible (par défaut : hors dossier).', 'Folder in the target space (default: no folder).')),
})

/**
 * Types de fichiers que l'installation peut accepter (détectés d'après le contenu), formats vidéo convertis
 * compris (MKV, AVI…, phase D3) : un jeton peut les citer, ils ne sont reçus que pendant que le traitement
 * des vidéos est actif (server/lib/api/writes.ts, intersection avec les types du moment).
 */
const ACCEPTED_TYPES = acceptedMimeTypes(true) as [string, ...string[]]
const CONVERTED_TYPES_LIST = CONVERTED_MIME_TYPES.map(type => `\`${type}\``).join(', ')

/** Contraintes d'envoi d'un jeton délégué (champ `upload`). */
export const apiUploadConstraintsSchema = z.strictObject({
  maxFiles: z.number().int().min(1).max(DELEGATED_MAX_FILES).optional()
    .meta(doc('Nombre de fichiers que le jeton peut envoyer (nouveaux médias et remplacements).', 'Number of files the token can upload (new media and replacements).')),
  maxSize: z.number().int().min(1).max(2_147_483_647).optional()
    .meta(doc('Taille maximale d\'un fichier, en octets (bornée par la limite de l\'installation).', 'Maximum file size in bytes (capped by the installation limit).')),
  types: z.array(z.enum(ACCEPTED_TYPES)).min(1).max(DELEGATED_MAX_TYPES).optional().meta(doc(
    `Types MIME acceptés, détectés d'après le contenu du fichier. Les formats vidéo convertis (${CONVERTED_TYPES_LIST}) ne sont reçus que pendant que le traitement des vidéos est actif sur le serveur : sinon ils sont refusés (\`UNSUPPORTED_TYPE\`) comme tout type que l'installation n'accepte pas, et un jeton qui ne cite qu'eux ne peut rien envoyer.`,
    `Accepted MIME types, detected from the file contents. Converted video formats (${CONVERTED_TYPES_LIST}) are received only while video processing is active on the server: otherwise they are rejected (\`UNSUPPORTED_TYPE\`) like any type the installation does not accept, and a token that lists only them cannot upload anything.`,
  )),
  visibility: z.enum(API_VISIBILITIES).optional().meta(doc('Visibilité imposée aux médias envoyés.', 'Visibility enforced on uploaded media.')),
  folderId: z.string().regex(ID_PATTERN).optional().meta(doc('Dossier du projet imposé aux médias envoyés.', 'Project folder enforced on uploaded media.')),
})
export type ApiUploadConstraints = z.output<typeof apiUploadConstraintsSchema>

export const apiDelegatedTokenBodySchema = z.strictObject({
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(TOKEN_SCOPES.length)
    .meta(doc('Portées demandées, toutes détenues par l\'émetteur dans ce projet (aucune lecture d\'office).', 'Requested scopes, all held by the issuer in this project (no implicit read access).')),
  expiresIn: z.number().int().min(DELEGATED_TOKEN_TTL.min).max(DELEGATED_TOKEN_TTL.max).default(DELEGATED_TOKEN_TTL.default)
    .meta(doc('Durée de validité en secondes (1 à 60 minutes, 15 par défaut), bornée par l\'échéance de l\'émetteur.', 'Validity in seconds (1 to 60 minutes, 15 by default), capped by the expiry of the issuer.')),
  subject: z.string().trim().min(1).max(DELEGATED_SUBJECT_MAX_LENGTH).regex(/^\P{Cc}+$/u).optional()
    .meta(doc('Identifiant opaque de l\'utilisateur final côté application cliente (provenance et journal d\'audit).', 'Opaque id of the end user in the client application (provenance and audit log).')),
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
    .meta(doc('Origine exacte du site autorisé à utiliser le jeton (parmi les origines autorisées du projet).', 'Exact origin of the site allowed to use the token (one of the allowed origins of the project).')),
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
  jti: z.string().min(8).max(64).meta(doc('Identifiant unique du jeton.', 'Unique token id.')),
  iss: z.string().regex(ID_PATTERN).meta(doc('Identifiant (clé secrète ou jeton personnel) qui a émis le jeton.', 'Credential (secret key or personal token) that issued the token.')),
  project: z.string().regex(ID_PATTERN),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  sub: z.string().max(DELEGATED_SUBJECT_MAX_LENGTH).optional(),
  origin: z.string().max(ORIGIN_MAX_LENGTH).optional(),
  upload: apiUploadConstraintsSchema.optional(),
  iat: z.number().int(),
  exp: z.number().int().meta(doc('Échéance (secondes Unix).', 'Expiry (Unix seconds).')),
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
  parentId: z.string().regex(ID_PATTERN).nullable().optional().meta(doc('Dossier parent (absent ou `null` : à la racine du projet).', 'Parent folder (absent or `null`: at the project root).')),
})

export const apiFolderUpdateSchema = z.strictObject({
  name: apiFolderNameSchema.optional(),
  parentId: z.string().regex(ID_PATTERN).nullable().optional().meta(doc('Nouveau parent (`null` : racine ; absent : inchangé).', 'New parent (`null`: root; absent: unchanged).')),
})

export const apiFolderDeleteQuerySchema = z.strictObject({
  content: z.enum(['parent']).optional()
    .meta(doc('`parent` : les sous-dossiers et médias remontent dans le dossier parent avant la suppression (sinon : dossier vide exigé).', '`parent`: subfolders and media move up to the parent folder before deletion (otherwise the folder must be empty).')),
})

// ─── Réponses ────────────────────────────────────────────────────────────────

const isoDate = z.iso.datetime({ offset: true })

/** Piste de texte d'une vidéo (phase D2) : élément `<track>`. */
export const apiTextTrackSchema = z.object({
  id: z.string(),
  kind: z.enum(API_TEXT_TRACK_KINDS).meta(doc(
    'Attribut `kind` de `<track>` : `subtitles` (traduction), `captions` (sous-titres pour sourds et malentendants : paroles et sons), `descriptions` (description textuelle des images), `chapters` (titres des chapitres).',
    '`kind` attribute of `<track>`: `subtitles` (translation), `captions` (for deaf and hard-of-hearing viewers: dialogue and sounds), `descriptions` (text description of the images), `chapters` (chapter titles).',
  )),
  language: z.string().meta(doc('Langue (étiquette BCP 47 canonique : `fr`, `en-GB`…), attribut `srclang`.', 'Language (canonical BCP 47 tag: `fr`, `en-GB`…), `srclang` attribute.')),
  label: z.string().meta(doc('Libellé proposé par le lecteur, attribut `label`.', 'Label offered by the player, `label` attribute.')),
  default: z.boolean().meta(doc('Piste choisie par défaut (attribut `default`) : une au plus par groupe (sous-titres, descriptions, chapitres).', 'Track chosen by default (`default` attribute): one at most per group (subtitles, descriptions, chapters).')),
  url: z.url().meta(doc('URL du fichier WebVTT ; signée pour un média privé. Fichier immuable : le remplacer crée une nouvelle piste.', 'URL of the WebVTT file; signed for a private media item. Immutable file: replacing it creates a new track.')),
  size: z.number().int(),
  cueCount: z.number().int().meta(doc('Nombre de répliques.', 'Number of cues.')),
  createdAt: isoDate,
})
export type ApiTextTrack = z.input<typeof apiTextTrackSchema>

const trackKindField = z.enum(API_TEXT_TRACK_KINDS)
const trackLanguageField = z.string().trim().min(1).max(35).meta(doc('Langue, étiquette BCP 47 (`fr`, `en-GB`) ; mise sous forme canonique.', 'Language, BCP 47 tag (`fr`, `en-GB`); canonicalised.'))
const trackLabelField = z.string().trim().min(1).max(TEXT_TRACK_LABEL_MAX_LENGTH)

/** Champs texte d'un envoi de piste (multipart/form-data, avec le fichier `file`). Champ inconnu → 400. */
export const apiTextTrackFieldsSchema = z.strictObject({
  kind: trackKindField,
  language: trackLanguageField,
  label: trackLabelField,
  default: z.enum(['true', 'false']).default('false').meta(doc('`true` : piste choisie par défaut (les autres pistes du groupe perdent cette indication).', '`true`: track chosen by default (the other tracks of the group lose it).')),
})

/** Modification d'une piste (JSON) : le fichier et son URL ne changent pas. */
export const apiTextTrackUpdateSchema = z.strictObject({
  kind: trackKindField.optional(),
  language: trackLanguageField.optional(),
  label: trackLabelField.optional(),
  default: z.boolean().optional(),
})
export type ApiTextTrackUpdate = z.output<typeof apiTextTrackUpdateSchema>

export const apiTextTrackListSchema = z.object({ items: z.array(apiTextTrackSchema) })

/** Image d'affiche d'une vidéo (phase D2). */
export const apiPosterSchema = z.object({
  url: z.url().meta(doc(
    'URL de l\'affiche entière en JPEG (préréglage `full`), pour l\'attribut `poster` de `<video>` ou une balise `og:image` ; signée pour un média privé. Autres tailles et formats : `urlTemplate`.',
    'URL of the whole poster image as JPEG (`full` preset), for the `poster` attribute of `<video>` or an `og:image` tag; signed for a private media item. Other sizes and formats: `urlTemplate`.',
  )),
  width: z.number().int(),
  height: z.number().int(),
  time: z.number().nullable().meta(doc('Instant de la vidéo capturé, en secondes ; null pour une image envoyée.', 'Captured moment of the video, in seconds; null for an uploaded image.')),
})

/**
 * Source de lecture d'une vidéo (phase D3) : élément `<source src type>`, rendu produit par le serveur ou
 * fichier original (server/lib/media/sources.ts).
 */
export const apiMediaSourceSchema = z.object({
  url: z.url().meta(doc(
    'URL absolue du fichier ; pour un média privé, signée comme l\'URL de l\'original qu\'elle accompagne (même signature, même échéance).',
    'Absolute URL of the file; for a private media item, signed like the URL of the original it comes with (same signature, same expiry).',
  )),
  type: z.string().meta(doc(
    'Type MIME avec ses codecs (RFC 6381 : `video/mp4; codecs="avc1.640028, mp4a.40.2"`) pour l\'attribut `type` de `<source>` : le navigateur passe sans la télécharger une source qu\'il ne sait pas lire. Un MOV est annoncé `video/mp4` (même famille de fichiers, lue quand ses codecs le sont).',
    'MIME type with its codecs (RFC 6381: `video/mp4; codecs="avc1.640028, mp4a.40.2"`) for the `type` attribute of `<source>`: the browser skips a source it cannot play without downloading it. A MOV file is announced as `video/mp4` (same file family, played when its codecs are).',
  )),
  width: z.number().int().nullable().meta(doc('Largeur affichée, en pixels ; null si elle est inconnue.', 'Displayed width in pixels; null when unknown.')),
  height: z.number().int().nullable().meta(doc('Hauteur affichée, en pixels ; null si elle est inconnue.', 'Displayed height in pixels; null when unknown.')),
  bitrate: z.number().int().nullable().meta(doc('Débit moyen, en bit/s ; null s\'il est inconnu.', 'Average bitrate in bit/s; null when unknown.')),
  size: z.number().int().meta(doc('Taille du fichier, en octets.', 'File size in bytes.')),
  rendition: z.enum(RENDITION_NAMES).nullable().meta(doc(
    'Rendu produit par le serveur : `av1` (WebM, AV1 et Opus : plus léger, lu par les navigateurs récents) ou `h264` (MP4, H.264 et AAC : lu partout) ; `null` : le fichier original.',
    'Rendition produced by the server: `av1` (WebM, AV1 and Opus: lighter, played by recent browsers) or `h264` (MP4, H.264 and AAC: played everywhere); `null`: the original file.',
  )),
})
export type ApiMediaSource = z.input<typeof apiMediaSourceSchema>

/**
 * Traitement d'une vidéo par le serveur (phase D3) : état résumé de sa dernière tâche. Jamais le détail
 * technique d'un échec (messages de ffmpeg, chemins du serveur), seulement son code.
 */
export const apiMediaProcessingSchema = z.object({
  status: z.enum(API_PROCESSING_STATUSES).meta(doc(
    '`pending` : en attente d\'un processus de traitement (ou d\'un nouvel essai après un échec passager) ; `processing` : en cours ; `ready` : terminé, `sources` et les champs du fichier sont à jour ; `failed` : échec définitif (`error`), la vidéo reste servie avec ce qui a pu être fait (l\'original, éventuellement nettoyé, et les rendus déjà produits).',
    '`pending`: waiting for a processing worker (or for a new attempt after a transient failure); `processing`: in progress; `ready`: done, `sources` and the file fields are up to date; `failed`: final failure (`error`), the video is still served with what could be done (the original, possibly cleaned, and any rendition already produced).',
  )),
  progress: z.number().min(0).max(1).nullable().meta(doc(
    'Avancement du réencodage en cours (0 à 1), mis à jour toutes les 5 s environ ; repart de 0 pour chaque rendu (H.264, puis AV1). null hors du statut `processing`, ou pendant une étape non mesurée (analyse, nettoyage, affiche).',
    'Progress of the current encoding (0 to 1), updated about every 5 s; starts again from 0 for each rendition (H.264, then AV1). null outside the `processing` status, or during a step that is not measured (analysis, clean-up, poster).',
  )),
  error: z.enum(VIDEO_JOB_ERROR_CODES).nullable().meta(doc(
    'Code de l\'échec, seulement au statut `failed` : `NO_VIDEO_TRACK` (aucune piste vidéo), `UNREADABLE` (fichier illisible), `CONVERSION_FAILED` (réencodage impossible), `TOO_LONG` (durée au-delà de la limite du serveur), `TIMEOUT` (délai dépassé), `SOURCE_MISSING` (fichier introuvable dans le stockage), `FFMPEG_UNAVAILABLE` (outil de traitement absent du serveur). D\'autres codes pourront s\'ajouter : traitez un code inconnu comme un échec quelconque.',
    'Failure code, only with the `failed` status: `NO_VIDEO_TRACK` (no video track), `UNREADABLE` (unreadable file), `CONVERSION_FAILED` (encoding impossible), `TOO_LONG` (duration beyond the server limit), `TIMEOUT` (time limit exceeded), `SOURCE_MISSING` (file missing from storage), `FFMPEG_UNAVAILABLE` (processing tool missing on the server). More codes may be added: treat an unknown code as a generic failure.',
  )),
  updatedAt: isoDate.meta(doc('Dernière écriture de la tâche (avancement compris) ; à défaut, dernière modification du média.', 'Last write of the task (progress included); otherwise, last change of the media item.')),
})
export type ApiMediaProcessing = z.input<typeof apiMediaProcessingSchema>

export const apiMediaSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable().meta(doc('Projet du média ; null = bibliothèque de l\'organisation (copie créée par duplication).', 'Project of the media item; null = organization library (copy created by duplication).')),
  kind: z.enum(API_MEDIA_KINDS),
  visibility: z.enum(API_VISIBILITIES),
  title: z.string().nullable(),
  altText: z.string().nullable(),
  filename: z.string().meta(doc('Nom du fichier envoyé (indicatif).', 'Name of the uploaded file (informative).')),
  mimeType: z.string(),
  extension: z.string().nullable(),
  size: z.number().int().meta(doc('Taille en octets.', 'Size in bytes.')),
  width: z.number().int().nullable().meta(doc('Largeur affichée, en pixels (orientation EXIF d\'une image, rotation d\'une vidéo appliquées) ; null pour une vidéo d\'un format converti tant que le traitement ne l\'a pas analysée.', 'Displayed width in pixels (EXIF orientation of an image, rotation of a video applied); null for a video in a converted format until processing has analysed it.')),
  height: z.number().int().nullable().meta(doc('Hauteur affichée, en pixels.', 'Displayed height in pixels.')),
  duration: z.number().nullable().meta(doc('Durée d\'une vidéo en secondes (3 décimales) ; null pour une image, si le fichier ne l\'indique pas, ou pour un format converti tant que le traitement ne l\'a pas analysé.', 'Duration of a video in seconds (3 decimals); null for an image, when the file does not say, or for a converted format until processing has analysed it.')),
  version: z.number().int().meta(doc('Incrémentée à chaque remplacement du fichier, de l\'image d\'affiche ou d\'un rendu vidéo, à chaque réécriture du fichier par le traitement des vidéos, ou changement du point d\'intérêt ; fait partie des URL.', 'Incremented each time the file, the poster image or a video rendition is replaced, each time video processing rewrites the file, or when the focal point changes; part of the URLs.')),
  folderId: z.string().nullable(),
  url: z.url().meta(doc('URL absolue du fichier original ; signée (temporaire) pour un média privé. Vidéo : pour la lecture, préférez `sources` ; l\'original d\'un format converti (MKV, AVI…) est servi en téléchargement (`Content-Disposition: attachment`). Requêtes partielles acceptées.', 'Absolute URL of the original file; signed (temporary) for a private media item. Video: for playback, prefer `sources`; the original of a converted format (MKV, AVI…) is served as a download (`Content-Disposition: attachment`). Partial requests accepted.')),
  sources: z.array(apiMediaSourceSchema).meta(doc(
    'Sources de lecture d\'une vidéo, par ordre de préférence, à reprendre dans cet ordre en éléments `<source src type>` (le navigateur prend la première qu\'il sait lire) : les rendus produits par le serveur quand ils existent (AV1, puis H.264), sinon le fichier original s\'il est lisible par `<video>`. Vide pour une image, et pour un format converti (MKV, AVI…) tant que son rendu H.264 n\'existe pas.',
    'Playback sources of a video, in order of preference, to use in this order as `<source src type>` elements (the browser takes the first one it can play): the renditions produced by the server when they exist (AV1, then H.264), otherwise the original file when `<video>` can play it. Empty for an image, and for a converted format (MKV, AVI…) until its H.264 rendition exists.',
  )),
  previewUrl: z.url().nullable().meta(doc('URL de l\'aperçu (WebP, 480 px) ; signée pour un média privé. Vidéo : tiré de son image d\'affiche, null sans affiche.', 'Preview URL (WebP, 480 px); signed for a private media item. Video: taken from its poster image, null without a poster.')),
  urlTemplate: z.string().nullable().meta(doc(
    'Gabarit des URL de dérivés d\'une image : remplacer `{transform}` par un préréglage (`preview`, `full`, ceux de `GET …/presets`) ou des paramètres (`w_800,h_450`), et `{format}` par `jpg`, `png`, `webp` ou `avif`. Média privé : porte une signature valable pour tout dérivé jusqu\'à `urlExpiresAt`. Média public d\'un projet en politique `signed` : paramètres libres seulement par un lien signé (`POST …/signed-url`). Vidéo : dérivés de son image d\'affiche ; `null` sans affiche.',
    'Template of the derivative URLs of an image: replace `{transform}` with a preset (`preview`, `full`, those of `GET …/presets`) or parameters (`w_800,h_450`), and `{format}` with `jpg`, `png`, `webp` or `avif`. Private media item: carries a signature valid for any derivative until `urlExpiresAt`. Public media item of a project with the `signed` policy: free parameters through a signed link only (`POST …/signed-url`). Video: derivatives of its poster image; `null` without a poster.',
  )),
  poster: apiPosterSchema.nullable().meta(doc('Image d\'affiche d\'une vidéo ; null pour une image ou une vidéo sans affiche.', 'Poster image of a video; null for an image or a video without a poster.')),
  textTracks: z.array(apiTextTrackSchema).meta(doc('Pistes de texte d\'une vidéo (sous-titres, chapitres…), dans leur ordre d\'ajout ; vide pour une image.', 'Text tracks of a video (subtitles, chapters…), in the order they were added; empty for an image.')),
  processing: apiMediaProcessingSchema.nullable().meta(doc(
    'Traitement de la vidéo par le serveur (ffmpeg) : état de sa dernière tâche. null pour une image, ou pour une vidéo jamais traitée (traitement désactivé sur le serveur, ou vidéo envoyée avant son activation).',
    'Processing of the video by the server (ffmpeg): state of its latest task. null for an image, or for a video never processed (processing disabled on the server, or video uploaded before it was enabled).',
  )),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullable().meta(doc(
    'Point d\'intérêt (fractions 0 à 1 de la largeur et de la hauteur, depuis le coin haut gauche ; image d\'affiche pour une vidéo) : centre des recadrages `fit_cover` ; `null` = centre de l\'image.',
    'Focal point (fractions 0 to 1 of the width and height, from the top left corner; poster image for a video): center of `fit_cover` crops; `null` = center of the image.',
  )),
  urlExpiresAt: isoDate.nullable().meta(doc('Échéance des URL signées ; null pour un média public (URL permanentes).', 'Expiry of the signed URLs; null for a public media item (permanent URLs).')),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiMedia = z.input<typeof apiMediaSchema>

export const apiFolderSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().meta(doc('Dossier parent ; `null` à la racine du projet.', 'Parent folder; `null` at the project root.')),
  name: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiFolder = z.input<typeof apiFolderSchema>

export const apiFolderListSchema = z.object({
  items: z.array(apiFolderSchema).meta(doc('Tous les dossiers du projet, à plat (arbre par `parentId`), triés par nom.', 'Every folder of the project, flat (tree via `parentId`), sorted by name.')),
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
  publicListing: z.boolean().meta(doc('La clé publique peut lister et chercher les médias publics.', 'The publishable key can list and search public media.')),
  transformPolicy: z.enum(['open', 'signed', 'presets']).meta(doc(
    'Transformations libres par URL (`/m/<id>/v<n>/w_800,h_450/<nom>.webp`) : `open` acceptées dans les bornes du serveur, `signed` seulement signées, `presets` interdites (préréglages seulement). Les préréglages sont toujours servis.',
    'Free transformations by URL (`/m/<id>/v<n>/w_800,h_450/<name>.webp`): `open` accepted within the server bounds, `signed` signed only, `presets` refused (presets only). Presets are always served.',
  )),
  scopes: z.array(z.enum(TOKEN_SCOPES)).meta(doc('Portées effectives de l\'identifiant utilisé dans ce projet.', 'Effective scopes of the credential used in this project.')),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type ApiProject = z.input<typeof apiProjectSchema>

export const apiPresetSchema = z.object({
  name: z.string().meta(doc('Nom à placer dans l\'URL : `/m/<id>/v<n>/<nom>/<fichier>.<format>`.', 'Name to put in the URL: `/m/<id>/v<n>/<name>/<file>.<format>`.')),
  transformation: z.string().meta(doc('Paramètres appliqués, forme canonique sans format (vide pour `full`).', 'Applied parameters, canonical form without format (empty for `full`).')),
  description: z.string().nullable(),
  level: z.enum(['builtin', 'global', 'project']).meta(doc('Intégré au serveur, commun à l\'installation, ou propre au projet (qui masque un global du même nom).', 'Built into the server, shared by the installation, or specific to the project (which hides a global one with the same name).')),
})
export type ApiPreset = z.input<typeof apiPresetSchema>

export const apiPresetListSchema = z.object({ items: z.array(apiPresetSchema) })

export const apiProjectListSchema = z.object({
  items: z.array(apiProjectSchema),
  nextCursor: z.string().nullable(),
})

const projectRef = z.object({ id: z.string(), name: z.string(), slug: z.string() })

export const apiMeSchema = z.object({
  credential: z.object({
    id: z.string().meta(doc('Identifiant de l\'identifiant ; `jti` pour un jeton délégué.', 'Credential id; `jti` for a delegated token.')),
    type: z.enum(['personal', 'secret', 'publishable', 'delegated']),
    name: z.string(),
    prefix: z.string(),
    environment: z.string().nullable(),
    scopes: z.array(z.enum(TOKEN_SCOPES)).meta(doc('Portées déclarées (un jeton personnel reste limité aux droits actuels de son propriétaire, un jeton délégué à ceux de son émetteur).', 'Declared scopes (a personal token stays limited to the current rights of its owner, a delegated token to those of its issuer).')),
    expiresAt: isoDate.nullable(),
    createdAt: isoDate,
  }),
  delegated: z.object({
    subject: z.string().nullable(),
    origin: z.string().nullable(),
    upload: apiUploadConstraintsSchema.nullable(),
  }).nullable().meta(doc('Jeton délégué : sujet final, origine et contraintes d\'envoi.', 'Delegated token: end subject, origin and upload constraints.')),
  user: z.object({ id: z.string(), name: z.string().nullable() }).nullable().meta(doc('Propriétaire d\'un jeton personnel.', 'Owner of a personal token.')),
  project: projectRef.extend({ archived: z.boolean() }).nullable().meta(doc('Projet d\'une clé.', 'Project of a key.')),
  access: z.object({
    allProjects: z.boolean(),
    library: z.boolean(),
    projects: z.array(projectRef),
  }).nullable().meta(doc('Sélection d\'un jeton personnel.', 'Project selection of a personal token.')),
})
export type ApiMe = z.input<typeof apiMeSchema>

export const apiDelegatedTokenSchema = z.object({
  token: z.string().meta(doc('Jeton à transmettre au navigateur, qui l\'envoie en `Authorization: Bearer <token>`.', 'Token to hand over to the browser, which sends it as `Authorization: Bearer <token>`.')),
  expiresAt: isoDate,
  scopes: z.array(z.enum(TOKEN_SCOPES)),
})

export const apiSignedUrlSchema = z.object({
  url: z.url(),
  query: z.string().meta(doc(
    'Paramètres de signature seuls (`exp`, `kid`, `scope`, `sig`), à ajouter aux URL des dérivés pour `derived` ; vide quand l\'URL n\'a pas besoin de signature.',
    'Signature parameters only (`exp`, `kid`, `scope`, `sig`), to append to derivative URLs with `derived`; empty when the URL needs no signature.',
  )),
  expiresAt: isoDate.nullable().meta(doc('Échéance du lien ; `null` : URL permanente.', 'Expiry of the link; `null`: permanent URL.')),
  sources: z.array(apiMediaSourceSchema).optional().meta(doc(
    'Cible `file` d\'une vidéo seulement : ses sources de lecture (`Media.sources`), signées comme `url` jusqu\'à la même échéance (URL permanentes pour un média public) — le droit sur le fichier couvre ses rendus.',
    'Target `file` of a video only: its playback sources (`Media.sources`), signed like `url` until the same expiry (permanent URLs for a public media item) — the right to the file covers its renditions.',
  )),
})

/** Codes d'erreur possibles pour un lien d'un lot (les autres liens du lot restent délivrés). */
export const API_SIGNED_URL_ITEM_ERRORS = ['INVALID_REQUEST', 'MEDIA_NOT_FOUND', 'PRESET_NOT_FOUND', 'INVALID_TRANSFORM', 'TRANSFORM_NOT_ALLOWED'] as const

export const apiSignedUrlErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_SIGNED_URL_ITEM_ERRORS),
    detail: z.string().optional(),
  }),
})

export const apiSignedUrlListSchema = z.object({
  items: z.array(z.union([apiSignedUrlSchema, apiSignedUrlErrorSchema])).meta(doc(
    'Un résultat par lien demandé, dans le même ordre : le lien, ou `error` (code du catalogue et détail) sans faire échouer les autres.',
    'One result per requested link, in the same order: the link, or `error` (catalog code and detail) without failing the others.',
  )),
})

/** Catalogue des codes d'erreur (GET /api/v1/errors). */
export const apiErrorCatalogSchema = z.object({
  errors: z.array(z.object({
    code: z.enum(Object.keys(API_ERRORS) as [string, ...string[]]),
    status: z.number().int(),
    title: z.string(),
  })),
})

export const apiProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(Object.keys(API_ERRORS) as [string, ...string[]]),
  detail: z.string().optional(),
  instance: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional().meta(doc('Détail des paramètres invalides (INVALID_REQUEST).', 'Details of the invalid parameters (INVALID_REQUEST).')),
})
