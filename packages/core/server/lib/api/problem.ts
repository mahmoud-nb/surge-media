import type { H3Event } from 'h3'
import { API_ERRORS, type ApiErrorCode } from '#shared/utils/api'

/**
 * Erreurs de l'API v1 au format RFC 9457 (« Problem Details », `application/problem+json`) :
 *   { type, title, status, code, detail?, instance, requestId, errors? }
 * `code` est stable (catalogue shared/utils/api.ts, documenté par GET /api/v1/errors) ; `type`
 * pointe vers ce catalogue. L'administration garde son propre format (`data.code`).
 */

export interface ProblemOptions {
  detail?: string
  /** Paramètres invalides (INVALID_REQUEST). */
  errors?: { path: string, message: string }[]
  /** En-têtes à ajouter (WWW-Authenticate, Retry-After…). */
  headers?: Record<string, string>
}

export class ApiProblem extends Error {
  constructor(readonly code: ApiErrorCode, readonly options: ProblemOptions = {}) {
    super(options.detail ?? API_ERRORS[code].title)
    this.name = 'ApiProblem'
  }

  get status(): number {
    return API_ERRORS[this.code].status
  }
}

export function apiProblem(code: ApiErrorCode, detail?: string, options: Omit<ProblemOptions, 'detail'> = {}): ApiProblem {
  return new ApiProblem(code, { ...options, detail })
}

const H3_STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'INVALID_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'INVALID_REQUEST',
  415: 'INVALID_REQUEST',
}

/** Toute erreur (problème de l'API, erreur h3, exception inattendue) → problème normalisé. */
export function toProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) return error
  const status = (error as { statusCode?: number } | null)?.statusCode
  const code = status ? H3_STATUS_CODES[status] : undefined
  if (code) return new ApiProblem(code, { detail: (error as { statusMessage?: string }).statusMessage })
  console.error('[surge-media] API v1 : erreur inattendue', error)
  return new ApiProblem('INTERNAL_ERROR')
}

/** URL de base de l'API (absolue) : NUXT_SITE_URL, sinon l'origine de la requête. */
export function apiBaseUrl(event: H3Event): string {
  const { siteUrl } = useRuntimeConfig(event)
  return `${(siteUrl || getRequestURL(event).origin).replace(/\/+$/, '')}/api/v1`
}

/** Corps RFC 9457 d'un problème (fonction pure, testée). */
export function problemBody(problem: ApiProblem, context: { base: string, instance: string, requestId: string }) {
  const { title, status } = API_ERRORS[problem.code]
  return {
    type: `${context.base}/errors#${problem.code}`,
    title,
    status,
    code: problem.code,
    ...(problem.options.detail && problem.options.detail !== title ? { detail: problem.options.detail } : {}),
    instance: context.instance,
    requestId: context.requestId,
    ...(problem.options.errors ? { errors: problem.options.errors } : {}),
  }
}

/** Envoie un problème : statut, `application/problem+json`, en-têtes (WWW-Authenticate pour 401). */
export function sendProblem(event: H3Event, error: unknown) {
  const problem = toProblem(error)
  setResponseStatus(event, problem.status)
  setResponseHeader(event, 'Content-Type', 'application/problem+json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (problem.status === 401) {
    // RFC 6750 : pas d'attribut « error » quand aucun identifiant n'a été présenté.
    const invalid = problem.code === 'TOKEN_MISSING' ? '' : ', error="invalid_token"'
    setResponseHeader(event, 'WWW-Authenticate', `Bearer realm="surgeMedia"${invalid}`)
  }
  for (const [name, value] of Object.entries(problem.options.headers ?? {})) setResponseHeader(event, name, value)
  return problemBody(problem, {
    base: apiBaseUrl(event),
    instance: event.path.split('?')[0]!,
    requestId: (event.context.requestId as string | undefined) ?? '',
  })
}

/** Erreurs de validation zod → 400 INVALID_REQUEST avec le détail par paramètre. */
export function invalidRequest(issues: readonly { path: readonly PropertyKey[], message: string }[]): ApiProblem {
  return apiProblem('INVALID_REQUEST', 'One or more parameters are invalid.', {
    errors: issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message })),
  })
}
