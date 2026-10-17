import type { H3Event } from 'h3'
import { API_ERRORS, type ApiErrorCode } from '#shared/utils/api'
import { FOLDER_MAX_DEPTH, FOLDERS_PER_SPACE_MAX } from '#shared/utils/folders'
import { TEXT_TRACKS_MAX } from '#shared/utils/text-tracks'

/**
 * Erreurs de l'API v1 au format RFC 9457 (« Problem Details », `application/problem+json`) :
 *   { type, title, status, code, detail?, instance, requestId, errors?, maxSize?, accepted?, timeout? }
 * `code` est stable (catalogue shared/utils/api.ts, documenté par GET /api/v1/errors) ; `type`
 * pointe vers ce catalogue. Membres d'extension des envois (`maxSize`, `accepted`, `timeout`) : de quoi
 * écrire un message précis sans lire `detail` (anglais). L'administration garde son propre format (`data.code`).
 */

/** Membres d'extension d'un problème d'envoi (RFC 9457 § 3.2). */
export interface ProblemExtensions {
  /** Taille maximale admise, en octets (FILE_TOO_LARGE). */
  maxSize?: number
  /** Types MIME acceptés (UNSUPPORTED_TYPE). */
  accepted?: string[]
  /** Délai d'inactivité, en secondes (UPLOAD_TIMEOUT). */
  timeout?: number
}

export interface ProblemOptions {
  detail?: string
  /** Paramètres invalides (INVALID_REQUEST). */
  errors?: { path: string, message: string }[]
  extensions?: ProblemExtensions
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

/** Détail lisible d'une erreur métier (données jointes par `mediaError` / `folderError`). */
function problemDetail(code: ApiErrorCode, data: Record<string, unknown>): string | undefined {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return typeof data.maxSize === 'number' ? `The file exceeds the maximum size of ${data.maxSize} bytes.` : undefined
    case 'UNSUPPORTED_TYPE': {
      // Précision du gestionnaire (vidéo sans piste vidéo), puis les types acceptés. Liste vide : seul cas,
      // un jeton délégué qui ne cite que des formats convertis (MKV…) pendant que le traitement est inactif.
      const accepted = !Array.isArray(data.accepted)
        ? null
        : data.accepted.length > 0
          ? `Accepted types (detected from the content): ${data.accepted.join(', ')}.`
          : 'None of the types allowed by this credential is accepted right now: converted video formats (MKV, AVI…) require video processing to be active on the server.'
      return [typeof data.detail === 'string' ? data.detail : null, accepted].filter(Boolean).join(' ') || undefined
    }
    case 'DIMENSIONS_TOO_LARGE':
      return typeof data.maxPixels === 'number' ? `The image exceeds ${data.maxPixels} pixels.` : undefined
    case 'UPLOAD_TIMEOUT':
      return typeof data.timeout === 'number' ? `No data received for ${data.timeout} s: the upload was stopped.` : undefined
    case 'KIND_MISMATCH':
      return typeof data.detail === 'string' ? data.detail : 'The new file must be of the same kind as the original.'
    case 'INVALID_TEXT_TRACK':
      return typeof data.detail === 'string' ? data.detail : undefined
    case 'TRACK_LIMIT_REACHED':
      return `A video can have ${TEXT_TRACKS_MAX} text tracks at most.`
    case 'TRACK_NOT_FOUND':
      return 'No such text track for this video.'
    case 'VERSION_CONFLICT':
      return 'The file was replaced by another request in the meantime.'
    case 'FOLDER_NOT_FOUND':
      return 'No such folder in this space.'
    case 'FOLDER_NAME_TAKEN':
      return 'A sibling folder already has this name (case-insensitive).'
    case 'FOLDER_NOT_EMPTY':
      return 'The folder contains media or subfolders: move them first, or delete with ?content=parent.'
    case 'FOLDER_DEPTH_EXCEEDED':
      return `Folders can be nested ${FOLDER_MAX_DEPTH} levels deep at most.`
    case 'FOLDER_CYCLE':
      return 'A folder cannot be moved into itself or one of its subfolders.'
    case 'FOLDER_LIMIT_REACHED':
      return `A space can hold ${FOLDERS_PER_SPACE_MAX} folders at most.`
    case 'PRESET_NOT_FOUND':
      return `${typeof data.detail === 'string' ? data.detail : 'No such preset in this project.'} See GET /projects/{projectId}/presets.`

    default:
      // Détail fourni par l'erreur métier elle-même (transformations : paramètre fautif, politique).
      return typeof data.detail === 'string' ? data.detail : undefined
  }
}

/** Membres d'extension tirés des données d'une erreur métier d'envoi (valeurs inattendues ignorées). */
function problemExtensions(code: ApiErrorCode, data: Record<string, unknown>): ProblemExtensions | undefined {
  if (code === 'FILE_TOO_LARGE' && Number.isInteger(data.maxSize)) return { maxSize: data.maxSize as number }
  if (code === 'UNSUPPORTED_TYPE' && Array.isArray(data.accepted)) return { accepted: data.accepted.filter(type => typeof type === 'string') }
  if (code === 'UPLOAD_TIMEOUT' && Number.isInteger(data.timeout)) return { timeout: data.timeout as number }
  return undefined
}

/** Toute erreur (problème de l'API, erreur métier, erreur h3, exception inattendue) → problème normalisé. */
export function toProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) return error
  // Erreur métier partagée avec l'administration (`data.code`), si son code existe dans le catalogue.
  const data = (error as { data?: unknown } | null)?.data
  const dataCode = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined
  if (typeof dataCode === 'string' && dataCode in API_ERRORS) {
    const code = dataCode as ApiErrorCode
    const details = data as Record<string, unknown>
    const headers: Record<string, string> = typeof details.retryAfter === 'number' ? { 'Retry-After': String(details.retryAfter) } : {}
    return new ApiProblem(code, { detail: problemDetail(code, details), extensions: problemExtensions(code, details), headers })
  }
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
    ...problem.options.extensions,
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
