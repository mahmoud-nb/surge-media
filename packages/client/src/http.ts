import type { Credential } from './credentials'
import { errorFromResponse, SurgeApiError } from './errors'

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

export interface RequestOptions {
  signal?: AbortSignal
}

export interface HttpClient {
  /** Lecture JSON (GET), revalidée par ETag : une réponse 304 rend la copie gardée. */
  get: <T>(path: string, query?: Query, options?: RequestOptions) => Promise<T>
}

export interface HttpOptions {
  /** Base de l'API (`https://media.example.com/api/v1`). */
  apiBaseUrl: string
  credential: Credential
  fetch: typeof fetch
  /** Nombre de réponses gardées pour la revalidation par ETag (200 par défaut). */
  cacheSize?: number
}

/** Chaîne de requête : valeurs absentes ignorées, booléens en `true` / `false`. */
export function queryString(query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Appels HTTP de l'API v1 : en-tête `Authorization` de l'identifiant, cache ETag des lectures (par accès :
 * deux identifiants ne partagent jamais une réponse), erreurs converties en `SurgeApiError`, un seul
 * nouvel essai après un 401 `TOKEN_EXPIRED` d'un jeton renouvelable. Pas d'autre nouvel essai
 * automatique : `retryAfter` de l'erreur indique quand recommencer.
 */
export function createHttpClient(options: HttpOptions): HttpClient {
  const { apiBaseUrl, credential } = options
  const fetchImpl = options.fetch
  const cacheSize = options.cacheSize ?? 200
  const cache = new Map<string, { etag: string, body: unknown }>()

  function remember(key: string, etag: string, body: unknown): void {
    cache.delete(key)
    cache.set(key, { etag, body })
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
  }

  async function send(url: string, cacheKey: string, signal: AbortSignal | undefined): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const authorization = await credential.authorization()
    if (authorization) headers.Authorization = authorization
    const cached = cache.get(cacheKey)
    if (cached) headers['If-None-Match'] = cached.etag
    try {
      return await fetchImpl(url, { method: 'GET', headers, signal })
    }
    catch (error) {
      if (isAbort(error)) throw error
      throw new SurgeApiError({ status: 0, code: 'NETWORK_ERROR', detail: error instanceof Error ? error.message : null, cause: error })
    }
  }

  return {
    async get<T>(path: string, query?: Query, requestOptions: RequestOptions = {}): Promise<T> {
      const url = `${apiBaseUrl}${path}${queryString(query)}`
      for (let attempt = 0; ; attempt++) {
        const cacheKey = `${credential.identity()} ${url}`
        const response = await send(url, cacheKey, requestOptions.signal)
        if (response.status === 304) {
          const cached = cache.get(cacheKey)
          if (cached) {
            remember(cacheKey, cached.etag, cached.body)
            return cached.body as T
          }
        }
        if (!response.ok) {
          const error = await errorFromResponse(response)
          if (error.code === 'TOKEN_EXPIRED' && credential.kind === 'delegated' && attempt === 0) {
            credential.invalidate()
            continue
          }
          throw error
        }
        const body = await response.json() as T
        const etag = response.headers.get('etag')
        if (etag) remember(cacheKey, etag, body)
        return body
      }
    },
  }
}
