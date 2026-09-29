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
  NOT_FOUND: { status: 404, title: 'Not found' },
  PROJECT_NOT_FOUND: { status: 404, title: 'Project not found' },
  MEDIA_NOT_FOUND: { status: 404, title: 'Media not found' },
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
} as const satisfies Record<string, { status: number, title: string }>

export type ApiErrorCode = keyof typeof API_ERRORS

/** Type d'identifiant tel qu'exposé par l'API (valeurs en minuscules). */
export const API_CREDENTIAL_TYPES = { PERSONAL: 'personal', SECRET: 'secret', PUBLISHABLE: 'publishable' } as const

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

/** Cibles d'un lien signé demandé à l'API (phase C : `transform`). */
export const API_SIGNED_URL_TARGETS = ['file', 'preset', 'derived'] as const
