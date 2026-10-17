import { errorMessage } from './i18n'

/** Paramètre invalide signalé par l'API (`INVALID_REQUEST`). */
export interface ProblemFieldError {
  path: string
  message: string
}

/** Membres d'extension d'une erreur d'envoi (RFC 9457) : de quoi écrire un message précis. */
export interface ProblemExtensions {
  /** Taille maximale admise, en octets (`FILE_TOO_LARGE`). */
  maxSize?: number
  /** Types MIME acceptés (`UNSUPPORTED_TYPE`). */
  accepted?: string[]
  /** Délai sans donnée reçue après lequel le serveur a arrêté l'envoi, en secondes (`UPLOAD_TIMEOUT`). */
  timeout?: number
}

export interface SurgeApiErrorInit {
  status: number
  code: string
  detail?: string | null
  requestId?: string | null
  retryAfter?: number | null
  errors?: ProblemFieldError[]
  extensions?: ProblemExtensions
  cause?: unknown
}

/**
 * Erreur de l'API v1 (RFC 9457) ou du client : `code` stable (catalogue `GET /api/v1/errors`), à traduire
 * par `localizedMessage()` ; `detail` s'adresse aux développeurs (anglais). `status` vaut 0 quand le
 * serveur n'a pas répondu (`NETWORK_ERROR`).
 */
export class SurgeApiError extends Error {
  override readonly name = 'SurgeApiError'
  readonly status: number
  readonly code: string
  readonly detail: string | null
  readonly requestId: string | null
  /** Délai conseillé avant un nouvel essai, en secondes (`Retry-After`) ; null s'il n'est pas indiqué. */
  readonly retryAfter: number | null
  readonly errors: ProblemFieldError[]
  /** Taille maximale, types acceptés, délai : erreurs d'envoi du serveur ou du pré-contrôle du client. */
  readonly extensions: ProblemExtensions

  constructor(init: SurgeApiErrorInit) {
    super(init.detail ? `${init.code}: ${init.detail}` : init.code, { cause: init.cause })
    this.status = init.status
    this.code = init.code
    this.detail = init.detail ?? null
    this.requestId = init.requestId ?? null
    this.retryAfter = init.retryAfter ?? null
    this.errors = init.errors ?? []
    this.extensions = init.extensions ?? {}
  }

  /** Message destiné à l'utilisateur final, dans la langue demandée (français par défaut). */
  localizedMessage(locale?: string | null): string {
    return errorMessage(this.code, locale, this.extensions)
  }
}

export function isSurgeApiError(value: unknown): value is SurgeApiError {
  return value instanceof SurgeApiError
}

/** `Retry-After` en secondes : nombre de secondes ou date HTTP ; null si absent ou illisible. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000))
}

/** Code par défaut d'une réponse sans corps exploitable. */
function codeForStatus(status: number): string {
  if (status === 401) return 'TOKEN_INVALID'
  if (status === 403) return 'MEDIA_FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 503) return 'SERVER_BUSY'
  if (status >= 500) return 'INTERNAL_ERROR'
  return 'UNKNOWN'
}

/** Membres d'extension lisibles d'un corps d'erreur (valeurs d'un autre type ignorées). */
function extensionsOf(body: Record<string, unknown>): ProblemExtensions {
  const extensions: ProblemExtensions = {}
  if (Number.isInteger(body.maxSize)) extensions.maxSize = body.maxSize as number
  if (Array.isArray(body.accepted)) extensions.accepted = body.accepted.filter((type): type is string => typeof type === 'string')
  if (Number.isInteger(body.timeout)) extensions.timeout = body.timeout as number
  return extensions
}

/**
 * Erreur tirée d'une réponse déjà lue (statut, corps JSON ou null, en-têtes) : problème RFC 9457 de l'API
 * v1 (`code`, `detail`, `requestId`, `errors`, membres d'extension) ou erreur de la diffusion `/m/`
 * (`data.code`), sinon un code déduit du statut. Sert aux réponses de `fetch` comme à celles d'un envoi.
 */
export function errorFromBody(status: number, parsed: unknown, header: (name: string) => string | null): SurgeApiError {
  const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const code = typeof body.code === 'string' ? body.code : typeof data.code === 'string' ? data.code : codeForStatus(status)
  const detail = typeof body.detail === 'string' ? body.detail : typeof data.detail === 'string' ? data.detail : null
  return new SurgeApiError({
    status,
    code,
    detail,
    requestId: typeof body.requestId === 'string' ? body.requestId : header('x-request-id'),
    retryAfter: parseRetryAfter(header('retry-after')),
    errors: Array.isArray(body.errors) ? body.errors as ProblemFieldError[] : [],
    extensions: extensionsOf(typeof body.code === 'string' ? body : data),
  })
}

/** Erreur tirée d'une réponse `fetch` en échec (voir `errorFromBody`). */
export async function errorFromResponse(response: Response): Promise<SurgeApiError> {
  let body: unknown = null
  if ((response.headers.get('content-type') ?? '').includes('json')) {
    try {
      body = await response.json()
    }
    catch {}
  }
  return errorFromBody(response.status, body, name => response.headers.get(name))
}
