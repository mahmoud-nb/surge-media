import { type Credential, delegatedCredential, NO_CREDENTIAL, publishableCredential, type TokenProvider } from './credentials'
import { isSurgeApiError } from './errors'
import { createHttpClient, type HttpClient, type RequestOptions } from './http'
import { errorMessage } from './i18n'
import type { Me, Media, MediaList, MediaListQuery, Preset, Project } from './types'

export interface SurgeClientOptions {
  /**
   * Adresse de l'installation surgeMedia (`NUXT_SITE_URL`), par exemple `https://media.example.com` ;
   * `…/api/v1` est accepté aussi.
   */
  baseUrl: string
  /** Projet dont le client lit les médias. */
  projectId: string
  /** Clé publique (`sm_pk_`) : médias publics, utilisable dans un navigateur. */
  publishableKey?: string
  /**
   * Fournisseur de jetons délégués (`sm_dt_`) émis par le back-end de l'application avec sa clé secrète :
   * appelé au premier besoin, puis avant chaque échéance. Pour les composants, inclure `project:read`.
   */
  getToken?: TokenProvider
  /** Implémentation de `fetch` (par défaut : celle de l'environnement). */
  fetch?: typeof fetch
  /** Langue des messages d'erreur (`fr` par défaut). */
  locale?: string
  /** Durée de mise en cache du projet (politique, formats), en millisecondes : 5 min par défaut. */
  projectTtlMs?: number
}

export interface SurgeClient {
  /** Adresse de l'installation, sans barre finale. */
  readonly baseUrl: string
  readonly apiBaseUrl: string
  readonly projectId: string
  readonly credential: Credential
  /** Identifiant utilisé par l'appel (`GET /me`). */
  me: (options?: RequestOptions) => Promise<Me>
  /** Projet : politique de transformation, formats activés, dimension maximale (mis en cache). */
  project: (options?: RequestOptions & { refresh?: boolean }) => Promise<Project>
  /** Préréglages utilisables dans le projet (intégrés, communs, propres au projet). */
  presets: (options?: RequestOptions) => Promise<Preset[]>
  media: {
    get: (id: string, options?: RequestOptions) => Promise<Media>
    list: (query?: MediaListQuery, options?: RequestOptions) => Promise<MediaList>
    /** Médias par identifiants (par lots de 100), dans l'ordre demandé ; les introuvables sont absents. */
    getMany: (ids: readonly string[], options?: RequestOptions) => Promise<Media[]>
    /** Tous les médias d'une requête, page après page (curseur). */
    iterate: (query?: Omit<MediaListQuery, 'cursor'>, options?: RequestOptions) => AsyncGenerator<Media, void, undefined>
  }
  /** Message lisible d'une erreur (de l'API ou du réseau), dans la langue du client ou celle demandée. */
  errorMessage: (error: unknown, locale?: string) => string
}

const MAX_IDS = 100

/** Adresse de l'installation et de l'API, quelle que soit la forme donnée. */
export function normalizeBaseUrl(value: string): { baseUrl: string, apiBaseUrl: string } {
  const trimmed = value.trim().replace(/\/+$/, '')
  const baseUrl = trimmed.replace(/\/api\/v1$/, '')
  return { baseUrl, apiBaseUrl: `${baseUrl}/api/v1` }
}

/**
 * Client de l'API v1 de surgeMedia pour un projet : lectures avec cache ETag, identifiant (clé publique
 * ou jetons délégués renouvelés), erreurs `SurgeApiError` traduisibles.
 */
export function createSurgeClient(options: SurgeClientOptions): SurgeClient {
  if (!options.projectId) throw new TypeError('createSurgeClient: projectId is required.')
  if (options.publishableKey && options.getToken) throw new TypeError('createSurgeClient: give either publishableKey or getToken, not both.')
  const { baseUrl, apiBaseUrl } = normalizeBaseUrl(options.baseUrl)
  const credential = options.publishableKey
    ? publishableCredential(options.publishableKey)
    : options.getToken ? delegatedCredential(options.getToken) : NO_CREDENTIAL
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const http: HttpClient = createHttpClient({ apiBaseUrl, credential, fetch: fetchImpl })
  const project = `/projects/${encodeURIComponent(options.projectId)}`
  const projectTtl = options.projectTtlMs ?? 300_000
  let projectCache: { value: Promise<Project>, at: number } | null = null

  async function list(query: MediaListQuery = {}, requestOptions?: RequestOptions): Promise<MediaList> {
    return http.get<MediaList>(`${project}/media`, { ...query }, requestOptions)
  }

  return {
    baseUrl,
    apiBaseUrl,
    projectId: options.projectId,
    credential,
    me: requestOptions => http.get<Me>('/me', undefined, requestOptions),
    project(requestOptions = {}) {
      if (!requestOptions.refresh && projectCache && Date.now() - projectCache.at < projectTtl) return projectCache.value
      const value = http.get<Project>(project, undefined, requestOptions)
      const entry = { value, at: Date.now() }
      projectCache = entry
      value.catch(() => {
        if (projectCache === entry) projectCache = null
      })
      return value
    },
    presets: async requestOptions => (await http.get<{ items: Preset[] }>(`${project}/presets`, undefined, requestOptions)).items,
    media: {
      get: (id, requestOptions) => http.get<Media>(`${project}/media/${encodeURIComponent(id)}`, undefined, requestOptions),
      list,
      async getMany(ids, requestOptions) {
        const unique = [...new Set(ids)]
        const found = new Map<string, Media>()
        for (let start = 0; start < unique.length; start += MAX_IDS) {
          const ids = unique.slice(start, start + MAX_IDS).join(',')
          const page = await http.get<MediaList>(`${project}/media`, { ids }, requestOptions)
          for (const media of page.items) found.set(media.id, media)
        }
        return ids.map(id => found.get(id)).filter((media): media is Media => media !== undefined)
      },
      async* iterate(query = {}, requestOptions) {
        let cursor: string | undefined
        do {
          const page = await list({ ...query, cursor }, requestOptions)
          yield* page.items
          cursor = page.nextCursor ?? undefined
        } while (cursor)
      },
    },
    errorMessage(error, locale) {
      return errorMessage(isSurgeApiError(error) ? error.code : 'UNKNOWN', locale ?? options.locale)
    },
  }
}
