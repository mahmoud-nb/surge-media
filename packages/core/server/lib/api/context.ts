import type { H3Event } from 'h3'
import type { z } from 'zod'
import { isOriginAllowed } from '#shared/utils/origins'
import type { TokenScope } from '#shared/utils/permissions'
import {
  credentialProjectScopes,
  type CredentialRecord,
  isBrowserRequest,
  isSecretCredential,
  resolveCredential,
  touchCredential,
} from '../access/credentials'
import { getProjectState, type ProjectState } from '../projects/state'
import { apiProblem, invalidRequest, sendProblem } from './problem'
import { createTokenBucketLimiter, rateLimitHeaders } from './rate-limit'

/**
 * Contexte d'une requête de l'API v1 : identité (Bearer), garde-fous (secret depuis un navigateur,
 * origine de la clé publique), limitation de débit, accès à un projet et validation des paramètres.
 * L'authentification est faite par server/middleware/api-v1.ts avant la route ; les routes
 * s'écrivent avec `defineApiHandler`, qui transforme toute erreur en problème RFC 9457.
 */

export interface ApiPrincipal {
  credential: CredentialRecord
}

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

function rateLimits(event: H3Event) {
  return useRuntimeConfig(event).api.rateLimit as { publishable: number, secret: number, personal: number, authFailures: number }
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
  const resolution = match ? await resolveCredential(match[1]!) : { ok: false as const, code: 'TOKEN_INVALID' as const }
  if (!resolution.ok) {
    authFailures.hit(ip)
    throw apiProblem(resolution.code)
  }
  const { credential } = resolution

  if (isSecretCredential(credential) && isBrowserRequest(event)) {
    throw apiProblem('SECRET_IN_BROWSER', 'Secret keys and personal tokens must never be used from a browser: use a publishable key.')
  }
  if (credential.type === 'PUBLISHABLE') {
    // Contrôle anti-abus (un client hors navigateur peut forger Origin) ; sans Origin : serveur, mobile.
    const origin = getRequestHeader(event, 'origin')
    const project = origin && credential.projectId ? await getProjectState(credential.projectId) : null
    if (origin && !(project && isOriginAllowed(origin, project.origins))) {
      throw apiProblem('ORIGIN_NOT_ALLOWED', `The origin ${origin} is not allowed for this project.`)
    }
  }

  const [policy, limit, key] = credential.type === 'PUBLISHABLE'
    ? ['publishable', limits.publishable, `pk:${credential.id}:${ip}`] as const
    : credential.type === 'SECRET'
      ? ['secret', limits.secret, `sk:${credential.id}`] as const
      : ['personal', limits.personal, `pat:${credential.id}`] as const
  const result = limiter.take(key, limit)
  setResponseHeaders(event, rateLimitHeaders(policy, result))
  if (!result.allowed) throw apiProblem('RATE_LIMITED', undefined, { headers: { 'Retry-After': String(result.retryAfter) } })

  touchCredential(credential, ip)
  return { credential }
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
 * Projet de l'URL (`:projectId`) accessible avec la portée demandée : 404 s'il n'existe pas ou n'est
 * pas couvert par l'identifiant (son existence n'est pas révélée), 403 s'il est archivé ou si la
 * portée manque.
 */
export async function requireApiProject(event: H3Event, principal: ApiPrincipal, scope: TokenScope): Promise<ApiProjectAccess> {
  const project = await getProjectState(getRouterParam(event, 'projectId') ?? '')
  const scopes = project ? await credentialProjectScopes(principal.credential, project) : []
  if (!project || scopes.length === 0) throw apiProblem('PROJECT_NOT_FOUND')
  if (project.archived) throw apiProblem('PROJECT_ARCHIVED', 'The project is archived: API credentials are refused until it is restored.')
  if (!scopes.includes(scope)) throw apiProblem('INSUFFICIENT_SCOPE', `This credential lacks the ${scope} scope in this project.`)
  return { project, scopes, publicOnly: principal.credential.type === 'PUBLISHABLE' }
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
  catch {
    throw apiProblem('INVALID_REQUEST', 'The request body is not valid JSON.')
  }
  const result = schema.safeParse(body ?? {})
  if (!result.success) throw invalidRequest(result.error.issues)
  return result.data
}
