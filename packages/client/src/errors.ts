import { errorMessage } from './i18n'

/** Paramètre invalide signalé par l'API (`INVALID_REQUEST`). */
export interface ProblemFieldError {
  path: string
  message: string
}

export interface SurgeApiErrorInit {
  status: number
  code: string
  detail?: string | null
  requestId?: string | null
  retryAfter?: number | null
  errors?: ProblemFieldError[]
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

  constructor(init: SurgeApiErrorInit) {
    super(init.detail ? `${init.code}: ${init.detail}` : init.code, { cause: init.cause })
    this.status = init.status
    this.code = init.code
    this.detail = init.detail ?? null
    this.requestId = init.requestId ?? null
    this.retryAfter = init.retryAfter ?? null
    this.errors = init.errors ?? []
  }

  /** Message destiné à l'utilisateur final, dans la langue demandée (français par défaut). */
  localizedMessage(locale?: string | null): string {
    return errorMessage(this.code, locale)
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

/**
 * Erreur tirée d'une réponse en échec : problème RFC 9457 de l'API v1 (`code`, `detail`, `requestId`,
 * `errors`) ou erreur de la diffusion `/m/` (`data.code`), sinon un code déduit du statut.
 */
export async function errorFromResponse(response: Response): Promise<SurgeApiError> {
  let body: Record<string, unknown> = {}
  if ((response.headers.get('content-type') ?? '').includes('json')) {
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    }
    catch {}
  }
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const code = typeof body.code === 'string' ? body.code : typeof data.code === 'string' ? data.code : codeForStatus(response.status)
  const detail = typeof body.detail === 'string' ? body.detail : typeof data.detail === 'string' ? data.detail : null
  return new SurgeApiError({
    status: response.status,
    code,
    detail,
    requestId: typeof body.requestId === 'string' ? body.requestId : response.headers.get('x-request-id'),
    retryAfter: parseRetryAfter(response.headers.get('retry-after')),
    errors: Array.isArray(body.errors) ? body.errors as ProblemFieldError[] : [],
  })
}
