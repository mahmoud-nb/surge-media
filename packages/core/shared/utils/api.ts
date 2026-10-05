/**
 * API publique v1 (`/api/v1`) : constantes et catalogue des erreurs, partagés avec le serveur, les
 * tests et, plus tard, le client `@surge-media/client`. Architecture : .claude/architecture-phase-b.md § 6.
 *
 * Les erreurs suivent la RFC 9457 (« Problem Details ») ; `code` est stable et permet aux
 * applications de traduire le message, `title`/`detail` s'adressent aux développeurs (en anglais).
 */

export const API_ERRORS = {
  INVALID_REQUEST: { status: 400, title: 'Invalid request' },
  INVALID_CURSOR: { status: 400, title: 'Invalid cursor' },
  INVALID_TRANSFORM: { status: 400, title: 'Invalid transformation' },
  MULTIPART_REQUIRED: { status: 400, title: 'Multipart body required' },
  NO_FILE: { status: 400, title: 'No file' },
  TOKEN_MISSING: { status: 401, title: 'Missing credential' },
  TOKEN_INVALID: { status: 401, title: 'Invalid credential' },
  TOKEN_EXPIRED: { status: 401, title: 'Expired credential' },
  TOKEN_REVOKED: { status: 401, title: 'Revoked credential' },
  INSUFFICIENT_SCOPE: { status: 403, title: 'Insufficient scope' },
  CREDENTIAL_NOT_ALLOWED: { status: 403, title: 'Credential type not allowed' },
  SECRET_IN_BROWSER: { status: 403, title: 'Secret credential used from a browser' },
  ORIGIN_NOT_ALLOWED: { status: 403, title: 'Origin not allowed' },
  PROJECT_ARCHIVED: { status: 403, title: 'Project archived' },
  LISTING_DISABLED: { status: 403, title: 'Public listing disabled' },
  UPLOAD_LIMIT_REACHED: { status: 403, title: 'Upload limit reached' },
  TRANSFORM_NOT_ALLOWED: { status: 403, title: 'Transformation not allowed' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  PROJECT_NOT_FOUND: { status: 404, title: 'Project not found' },
  MEDIA_NOT_FOUND: { status: 404, title: 'Media not found' },
  FOLDER_NOT_FOUND: { status: 404, title: 'Folder not found' },
  PRESET_NOT_FOUND: { status: 404, title: 'Preset not found' },
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed' },
  REQUEST_TIMEOUT: { status: 408, title: 'Request timeout' },
  UPLOAD_TIMEOUT: { status: 408, title: 'Upload timeout' },
  VERSION_CONFLICT: { status: 409, title: 'Version conflict' },
  FOLDER_NAME_TAKEN: { status: 409, title: 'Folder name already used' },
  FOLDER_NOT_EMPTY: { status: 409, title: 'Folder not empty' },
  FOLDER_LIMIT_REACHED: { status: 409, title: 'Folder limit reached' },
  FILE_TOO_LARGE: { status: 413, title: 'File too large' },
  BODY_TOO_LARGE: { status: 413, title: 'Request body too large' },
  UNSUPPORTED_TYPE: { status: 415, title: 'Unsupported media type' },
  UNREADABLE_FILE: { status: 422, title: 'Unreadable file' },
  DIMENSIONS_TOO_LARGE: { status: 422, title: 'Image dimensions too large' },
  KIND_MISMATCH: { status: 422, title: 'Media kind mismatch' },
  FOLDER_DEPTH_EXCEEDED: { status: 422, title: 'Folder depth exceeded' },
  FOLDER_CYCLE: { status: 422, title: 'Folder cycle' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  TRANSFORM_QUOTA: { status: 429, title: 'Transformation quota reached' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
  SERVER_BUSY: { status: 503, title: 'Server busy' },
} as const satisfies Record<string, { status: number, title: string }>

export type ApiErrorCode = keyof typeof API_ERRORS

/** Type d'identifiant tel qu'exposé par l'API (valeurs en minuscules). */
export const API_CREDENTIAL_TYPES = { PERSONAL: 'personal', SECRET: 'secret', PUBLISHABLE: 'publishable', DELEGATED: 'delegated' } as const
export type ApiCredentialType = (typeof API_CREDENTIAL_TYPES)[keyof typeof API_CREDENTIAL_TYPES]

export const API_MEDIA_SORTS = ['newest', 'oldest', 'name', 'size'] as const
export type ApiMediaSort = (typeof API_MEDIA_SORTS)[number]

export const API_DEFAULT_LIMIT = 24
export const API_MAX_LIMIT = 100
/** Nombre maximal d'identifiants dans `?ids=` (réhydratation des sélections d'un MediaPicker). */
export const API_MAX_IDS = 100

/**
 * URL signées incluses dans les réponses (médias privés) : valables environ 1 h, échéance alignée
 * sur le quart d'heure (même URL pendant 15 min : caches navigateur/CDN et ETag de liste stables).
 */
export const API_LINK_TTL = 3600
export const API_LINK_BUCKET = 900

/**
 * Cibles d'un lien signé demandé à l'API : l'original (`file`), un préréglage, une transformation
 * libre, ou tout dérivé de la version (`derived`, une signature pour tout un srcset).
 */
export const API_SIGNED_URL_TARGETS = ['file', 'preset', 'transform', 'derived'] as const
export type ApiSignedUrlTarget = (typeof API_SIGNED_URL_TARGETS)[number]

/** Liens signés demandés en un appel (`POST /projects/{projectId}/signed-urls`) : une page entière de srcset. */
export const API_SIGNED_URLS_MAX = 100

/** Format de sortie par défaut d'un dérivé demandé à l'API (comme l'aperçu). */
export const API_DEFAULT_TRANSFORM_FORMAT = 'webp'

/**
 * Jetons délégués (`sm_dt_<charge>.<signature>`) : émis par une clé secrète ou un jeton personnel
 * (POST /api/v1/projects/:id/delegated-tokens) pour un composant dans le navigateur. Signés (HMAC),
 * sans état, valables quelques minutes ; portées ⊆ celles de l'émetteur, dans son projet.
 */
export const DELEGATED_TOKEN_PREFIX = 'sm_dt_'
/** Durée de validité (secondes) : 1 à 60 minutes, 15 par défaut. */
export const DELEGATED_TOKEN_TTL = { min: 60, max: 3600, default: 900 } as const
/** Longueur maximale d'un jeton délégué présenté (rejet sans calcul au-delà). */
export const DELEGATED_TOKEN_MAX_LENGTH = 4096
/** Sujet final (identifiant opaque de l'utilisateur de l'application cliente, pour l'audit). */
export const DELEGATED_SUBJECT_MAX_LENGTH = 128
/** Contrainte « nombre de fichiers » d'un jeton délégué. */
export const DELEGATED_MAX_FILES = 1000
/** Types de fichiers qu'un jeton délégué peut restreindre. */
export const DELEGATED_MAX_TYPES = 20
/** Liens signés demandés avec un jeton délégué : 1 h au plus (jamais de lien long). */
export const DELEGATED_SIGNED_URL_MAX_TTL = 3600

/**
 * Langues de la spécification OpenAPI (`GET /api/v1/openapi.json?lang=`) : le français est la
 * référence (textes des routes et des schémas), l'anglais une traduction (extension `x-i18n`).
 */
export const OPENAPI_LANGS = ['fr', 'en'] as const
export type OpenApiLang = (typeof OPENAPI_LANGS)[number]
export const OPENAPI_DEFAULT_LANG: OpenApiLang = 'fr'
