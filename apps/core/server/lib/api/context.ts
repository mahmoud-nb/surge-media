import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { TokenScope } from '#shared/utils/permissions'
import { touchCredential } from '../access/credentials'
import { browserGuard, type Principal, principalProjectScopes, resolvePrincipal } from '../access/principal'
import { getProjectState, type ProjectState } from '../projects/state'
import { apiProblem, invalidRequest, sendProblem } from './problem'
import { createTokenBucketLimiter, rateLimitHeaders } from './rate-limit'

/**
 * Contexte d'une requête de l'API v1 : identité (Bearer : identifiant opaque ou jeton délégué),
 * garde-fous (secret depuis un navigateur, origine d'une clé publique ou d'un jeton délégué),
 * limitation de débit, accès à un projet et validation des paramètres.
 * L'authentification est faite par server/middleware/api-v1.ts avant la route ; les routes
 * s'écrivent avec `defineApiHandler`, qui transforme toute erreur en problème RFC 9457.
 */

/** Identité de l'appelant (server/lib/access/principal.ts). */
export type ApiPrincipal = Principal

declare module 'h3' {
  interface H3EventContext {
    /** Identifiant de la requête (en-tête X-Request-Id, champ requestId des erreurs). */
    requestId?: string
    /** Identité de l'appelant de l'API v1 (posée par le middleware). */
    apiPrincipal?: ApiPrincipal
  }
}

const limiter = createTokenBucketLimiter()
let authFailures: ReturnType<typeof createRateLimiter> | undefined

interface RateLimits {
  publishable: number
  secret: number
  personal: number
  delegated: number
  uploads: number
  authFailures: number
}

function rateLimits(event: H3Event): RateLimits {
  return useRuntimeConfig(event).api.rateLimit as RateLimits
}

/** Identité de l'appelant, ou problème 400/401/403/429. */
export async function authenticateApiRequest(event: H3Event): Promise<ApiPrincipal> {
  const limits = rateLimits(event)
  const ip = getRequestIP(event) ?? 'unknown'

  if ('access_token' in getQuery(event)) {
    throw apiProblem('INVALID_REQUEST', 'Send credentials in the Authorization header, never in the URL.')
  }
  const header = getRequestHeader(event, 'authorization')
  if (!header) throw apiProblem('TOKEN_MISSING', 'Send a credential in the Authorization header: "Bearer <token>".')

  // Échecs d'authentification comptés par IP (balayage de jetons).
  authFailures ??= createRateLimiter({ max: limits.authFailures, windowMs: 60_000 })
  const blocked = authFailures.retryAfter(ip)
  if (blocked > 0) throw apiProblem('RATE_LIMITED', 'Too many authentication failures.', { headers: { 'Retry-After': String(blocked) } })

  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  const resolution = match ? await resolvePrincipal(match[1]!) : { ok: false as const, code: 'TOKEN_INVALID' as const }
  if (!resolution.ok) {
    authFailures.hit(ip)
    throw apiProblem(resolution.code)
  }
  const { principal } = resolution
  const { credential } = principal

  const refused = await browserGuard(event, principal)
  if (refused === 'SECRET_IN_BROWSER') {
    throw apiProblem('SECRET_IN_BROWSER', 'Secret keys and personal tokens must never be used from a browser: use a publishable key or a delegated token.')
  }
  if (refused === 'ORIGIN_NOT_ALLOWED') {
    throw apiProblem('ORIGIN_NOT_ALLOWED', `The origin ${getRequestHeader(event, 'origin')} is not allowed for this credential.`)
  }

  // Clé publique et jeton délégué (navigateurs) : par IP ; jeton délégué : seau de son émetteur.
  const buckets: Record<Principal['type'], [number, string]> = {
    publishable: [limits.publishable, `pk:${credential.id}:${ip}`],
    secret: [limits.secret, `sk:${credential.id}`],
    personal: [limits.personal, `pat:${credential.id}`],
    delegated: [limits.delegated, `dt:${credential.id}:${ip}`],
  }
  const [limit, key] = buckets[principal.type]
  const result = limiter.take(key, limit)
  setResponseHeaders(event, rateLimitHeaders(principal.type, result))
  if (!result.allowed) throw apiProblem('RATE_LIMITED', undefined, { headers: { 'Retry-After': String(result.retryAfter) } })

  // Dernière utilisation : celle de l'identifiant présenté (pas de l'émetteur d'un jeton délégué).
  if (!principal.delegated) touchCredential(credential, ip)
  return principal
}

/**
 * Envois de fichiers (nouveau média, remplacement) : seau supplémentaire par identifiant (jeton
 * délégué : par émetteur et par IP), politique « uploads » ajoutée aux en-têtes RateLimit.
 */
export function requireUploadAllowance(event: H3Event, principal: ApiPrincipal): void {
  const limits = rateLimits(event)
  const key = principal.delegated
    ? `up:dt:${principal.credential.id}:${getRequestIP(event) ?? 'unknown'}`
    : `up:${principal.credential.id}`
  const result = limiter.take(key, limits.uploads)
  for (const [name, value] of Object.entries(rateLimitHeaders('uploads', result))) appendResponseHeader(event, name, value)
  if (!result.allowed) throw apiProblem('RATE_LIMITED', 'Too many uploads.', { headers: { 'Retry-After': String(result.retryAfter) } })
}

/** Route de l'API v1 : identité fournie, réponses privées revalidées, erreurs au format RFC 9457. */
export function defineApiHandler<T>(handler: (event: H3Event, principal: ApiPrincipal) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      const principal = event.context.apiPrincipal
      if (!principal) throw apiProblem('TOKEN_MISSING')
      setResponseHeader(event, 'Cache-Control', 'private, no-cache')
      return await handler(event, principal)
    }
    catch (error) {
      return sendProblem(event, error)
    }
  })
}

export interface ApiProjectAccess {
  project: ProjectState
  scopes: TokenScope[]
  /** Clé publique : uniquement les médias publics. */
  publicOnly: boolean
}

/**
 * Projet d'un identifiant de projet (`:projectId` par défaut) accessible avec la portée demandée (l'une
 * d'elles pour une liste) :
 * 404 s'il n'existe pas ou n'est pas couvert par l'identifiant (son existence n'est pas révélée),
 * 403 s'il est archivé ou si la portée manque.
 */
export async function requireApiProject(
  event: H3Event,
  principal: ApiPrincipal,
  scope: TokenScope | readonly TokenScope[],
  projectId = getRouterParam(event, 'projectId') ?? '',
): Promise<ApiProjectAccess> {
  const project = await getProjectState(projectId)
  const scopes = project ? await principalProjectScopes(principal, project) : []
  if (!project || scopes.length === 0) throw apiProblem('PROJECT_NOT_FOUND')
  if (project.archived) throw apiProblem('PROJECT_ARCHIVED', 'The project is archived: API credentials are refused until it is restored.')
  const wanted: readonly TokenScope[] = typeof scope === 'string' ? [scope] : scope
  if (!wanted.some(item => scopes.includes(item))) throw apiProblem('INSUFFICIENT_SCOPE', `This credential lacks the ${wanted.join(' or ')} scope in this project.`)
  return { project, scopes, publicOnly: principal.type === 'publishable' }
}

/** Paramètres d'URL validés (400 INVALID_REQUEST détaillé sinon). */
export function parseApiQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  const result = schema.safeParse(getQuery(event))
  if (!result.success) throw invalidRequest(result.error.issues)
  return result.data
}

/** Corps JSON validé (400 INVALID_REQUEST si illisible ou invalide). */
export async function readApiBody<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch (error) {
    // Corps refusé par le middleware body-limit (413 BODY_TOO_LARGE, 408 REQUEST_TIMEOUT) : conservé.
    const status = (error as { statusCode?: number } | null)?.statusCode
    if (status === 408 || status === 413) throw error
    throw apiProblem('INVALID_REQUEST', 'The request body is not valid JSON.')
  }
  const result = schema.safeParse(body ?? {})
  if (!result.success) throw invalidRequest(result.error.issues)
  return result.data
}
