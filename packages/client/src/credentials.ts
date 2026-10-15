import { SurgeApiError } from './errors'
import type { TokenScope, UploadConstraints } from './types'

/**
 * Identifiants utilisables par le client : une clé publique (`sm_pk_`, sans échéance, médias publics) ou
 * un jeton délégué (`sm_dt_`) fourni par le back-end de l'application (`getToken`), renouvelé avant son
 * échéance. Une clé secrète ou un jeton personnel ne doivent jamais atteindre un navigateur.
 */

/** Charge lisible d'un jeton délégué (seule la signature du serveur la rend valable). */
export interface DelegatedTokenClaims {
  jti: string
  iss: string
  project: string
  scopes: TokenScope[]
  sub?: string
  origin?: string
  upload?: UploadConstraints
  iat: number
  exp: number
}

/** Ce que renvoie `getToken` : le jeton seul, ou la réponse de `POST …/delegated-tokens` telle quelle. */
export type TokenResult = string | { token: string, expiresAt?: string | null }
export type TokenProvider = () => TokenResult | Promise<TokenResult>

export type CredentialKind = 'publishable' | 'delegated' | 'none'

export interface Credential {
  readonly kind: CredentialKind
  /** Valeur de l'en-tête `Authorization`, ou null sans identifiant. */
  authorization: () => Promise<string | null>
  /** Clé stable d'un même accès (cache des réponses), y compris d'un jeton à l'autre. */
  identity: () => string
  /** Oublie le jeton en cours : le prochain appel en demande un nouveau (après un 401 `TOKEN_EXPIRED`). */
  invalidate: () => void
  /** Charge du jeton délégué en cours, s'il est lisible. */
  claims: () => DelegatedTokenClaims | null
}

const DELEGATED_PREFIX = 'sm_dt_'
const SECRET_PREFIXES = ['sm_sk_', 'sm_pat_']

function base64UrlDecode(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

/** Charge d'un jeton délégué (`sm_dt_<charge>.<signature>`), sans vérifier la signature ; null si illisible. */
export function decodeDelegatedToken(token: string): DelegatedTokenClaims | null {
  if (!token.startsWith(DELEGATED_PREFIX)) return null
  const payload = token.slice(DELEGATED_PREFIX.length).split('.')[0]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(base64UrlDecode(payload))
    if (!claims || typeof claims !== 'object') return null
    const { exp, project, scopes } = claims as Record<string, unknown>
    return typeof exp === 'number' && typeof project === 'string' && Array.isArray(scopes) ? claims as DelegatedTokenClaims : null
  }
  catch {
    return null
  }
}

/** Refuse localement une clé secrète ou un jeton personnel dans un navigateur (avant tout envoi). */
export function assertBrowserSafe(value: string): void {
  const inBrowser = typeof document !== 'undefined'
  if (inBrowser && SECRET_PREFIXES.some(prefix => value.startsWith(prefix))) {
    throw new SurgeApiError({
      status: 0,
      code: 'SECRET_IN_BROWSER',
      detail: 'Secret keys and personal tokens must stay on your server: give the browser a publishable key or delegated tokens.',
    })
  }
}

export function publishableCredential(key: string): Credential {
  assertBrowserSafe(key)
  const authorization = `Bearer ${key}`
  return {
    kind: 'publishable',
    authorization: async () => authorization,
    identity: () => `key:${key}`,
    invalidate: () => {},
    claims: () => null,
  }
}

export interface DelegatedCredentialOptions {
  /** Renouvellement anticipé avant l'échéance (60 s par défaut). */
  renewBeforeMs?: number
  now?: () => number
}

/**
 * Jeton délégué fourni par `getToken` : mis en cache, renouvelé `renewBeforeMs` avant son échéance (lue
 * dans sa charge, sinon dans `expiresAt`) ; des appels simultanés partagent le même renouvellement.
 */
export function delegatedCredential(getToken: TokenProvider, options: DelegatedCredentialOptions = {}): Credential {
  const renewBefore = options.renewBeforeMs ?? 60_000
  const now = options.now ?? Date.now
  let current: { token: string, expiresAt: number | null, claims: DelegatedTokenClaims | null } | null = null
  let pending: Promise<string> | null = null

  async function fetchToken(): Promise<string> {
    const result = await getToken()
    const token = typeof result === 'string' ? result : result.token
    if (typeof token !== 'string' || token === '') throw new TypeError('getToken() must return a delegated token.')
    assertBrowserSafe(token)
    const claims = decodeDelegatedToken(token)
    const declared = typeof result === 'object' && result.expiresAt ? Date.parse(result.expiresAt) : Number.NaN
    current = { token, claims, expiresAt: claims ? claims.exp * 1000 : Number.isNaN(declared) ? null : declared }
    return token
  }

  function fresh(): boolean {
    return current !== null && (current.expiresAt === null || current.expiresAt - now() > renewBefore)
  }

  return {
    kind: 'delegated',
    async authorization() {
      if (fresh()) return `Bearer ${current!.token}`
      pending ??= fetchToken().finally(() => { pending = null })
      return `Bearer ${await pending}`
    },
    identity() {
      const claims = current?.claims
      return claims ? `dt:${claims.iss}:${claims.project}:${claims.sub ?? ''}:${[...claims.scopes].sort().join(' ')}` : 'dt'
    },
    invalidate() {
      current = null
    },
    claims: () => current?.claims ?? null,
  }
}

export const NO_CREDENTIAL: Credential = {
  kind: 'none',
  authorization: async () => null,
  identity: () => 'none',
  invalidate: () => {},
  claims: () => null,
}
