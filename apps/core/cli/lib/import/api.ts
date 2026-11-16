import { openAsBlob } from 'node:fs'

/**
 * Client HTTP minimal de l'API v1 pour `surge-media import` (.claude/architecture-import.md, IM1) : l'outil
 * est un client comme un autre, avec une clé secrète ou un jeton personnel. Il patiente quand le serveur
 * le demande (429, 503 : en-tête `Retry-After`), réessaie quelques fois après une coupure réseau, et laisse
 * remonter le reste tel quel (`ApiError`, code du catalogue `GET /api/v1/errors`).
 *
 * L'identifiant ne quitte ce module que dans l'en-tête `Authorization` : il n'apparaît dans aucun message.
 */

export class ApiError extends Error {
  constructor(
    /** Statut HTTP ; 0 quand aucune réponse n'est arrivée. */
    readonly status: number,
    /** Code du catalogue de l'API, ou `NETWORK` / `INVALID_RESPONSE` pour une erreur du client. */
    readonly code: string,
    readonly detail: string | null = null,
    /** Membres d'extension du problème (`mediaId`, `maxSize`, `accepted`…). */
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ApiError'
  }
}

/**
 * Erreurs qui condamnent tout l'import, pas seulement le fichier en cours : identifiant refusé, projet
 * inaccessible ou archivé, instance de démonstration en lecture seule. Continuer ferait échouer chaque ligne.
 */
const FATAL_CODES = new Set([
  'TOKEN_MISSING',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'INSUFFICIENT_SCOPE',
  'CREDENTIAL_NOT_ALLOWED',
  'SECRET_IN_BROWSER',
  'ORIGIN_NOT_ALLOWED',
  'PROJECT_NOT_FOUND',
  'PROJECT_ARCHIVED',
  'DEMO_READ_ONLY',
  'DEMO_QUOTA',
])

export function isFatalApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && FATAL_CODES.has(error.code)
}

export interface ApiMe {
  credential: { type: string, name: string, scopes: string[] }
  project: { id: string, name: string, slug: string, archived: boolean } | null
  upload: { types: UploadTypeRule[] } | null
}

export interface UploadTypeRule {
  mimeType: string
  extension: string
  kind: string
  maxSize: number
  converted: boolean
}

export interface ApiProject {
  id: string
  name: string
  slug: string
  scopes: string[]
}

export interface ApiFolder {
  id: string
  parentId: string | null
  name: string
}

export interface ApiTag {
  id: string
  slug: string
  name: string
}

export interface ApiMedia {
  id: string
  version: number
  url: string
  kind: string
  sourceRef: string | null
}

export interface UploadFields {
  sourceRef: string
  title?: string | null
  altText?: string | null
  visibility?: 'public' | 'private' | null
  folderId?: string | null
  tags?: readonly string[]
}

export interface UploadFile {
  path: string
  filename: string
  mimeType: string
}

export interface ApiClientOptions {
  /** Adresse du serveur (`https://media.example.com`, ou `http://127.0.0.1:3000`). */
  baseUrl: string
  key: string
  userAgent: string
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  /** Attente (remplaçable dans les tests) ; interrompue par `signal`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Prévenu avant chaque attente demandée par le serveur ou après une coupure. */
  onWait?: (event: WaitEvent) => void
}

export interface WaitEvent {
  seconds: number
  reason: 'rateLimited' | 'serverBusy' | 'network'
  /** Limite atteinte d'après l'en-tête `RateLimit` du refus (`uploads`, `secret`, `personal`), si le serveur la nomme. */
  policy?: string
}

/**
 * Variable du serveur qui règle chaque limite de l'API v1 (`setup.md` § 7.7) : la commande la nomme
 * quand elle freine un import. Un fichier coûte jusqu'à trois requêtes (référence, empreinte, envoi) :
 * relever la seule limite des envois laisse l'import buter sur celle de l'identifiant (essai I-4).
 */
export const RATE_LIMIT_VARIABLES: Readonly<Record<string, string>> = {
  uploads: 'NUXT_API_RATE_LIMIT_UPLOADS',
  secret: 'NUXT_API_RATE_LIMIT_SECRET',
  personal: 'NUXT_API_RATE_LIMIT_PERSONAL',
}

/**
 * Politique épuisée d'après l'en-tête `RateLimit` (brouillon IETF : `"secret";r=0;t=3, "uploads";r=0;t=1`) :
 * la dernière dont il ne reste rien (la limite des envois s'ajoute après celle de l'identifiant) ; null sinon.
 */
export function exhaustedPolicy(header: string | null): string | null {
  if (!header) return null
  let found: string | null = null
  for (const item of header.split(',')) {
    const match = /^\s*"([^"]+)"\s*;(.*)$/.exec(item)
    const remaining = match ? /(?:^|;)\s*r=(\d+)/.exec(match[2]!) : null
    if (match && remaining && Number(remaining[1]) === 0) found = match[1]!
  }
  return found
}

/** Reprises après une coupure réseau, puis l'erreur remonte (`NETWORK`). */
export const NETWORK_RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const
/** Attentes consécutives acceptées pour une même requête (429, 503) avant d'abandonner le fichier. */
export const MAX_SERVER_WAITS = 30
const DEFAULT_RETRY_AFTER_S = 5
const MAX_RETRY_AFTER_S = 300
/** Après une demande d'attente du serveur, les requêtes de la même voie restent en file pendant… */
export const SLOW_MODE_MS = 30_000

interface Lane {
  /** Jusqu'à cet instant, une requête à la fois. */
  slowUntil: number
  /** Écart entre deux requêtes de la file : le dernier délai demandé par le serveur. */
  spacingMs: number
  nextAt: number
  tail: Promise<unknown>
}

function newLane(): Lane {
  return { slowUntil: 0, spacingMs: 0, nextAt: 0, tail: Promise.resolve() }
}

/** Exécute `task` après les tâches déjà en file sur cette voie (qu'elles réussissent ou non). */
function queued<T>(lane: Lane, task: () => Promise<T>): Promise<T> {
  const result = lane.tail.then(task, task)
  lane.tail = result.catch(() => {})
  return result
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Délai demandé par le serveur, borné : secondes ou date HTTP ; valeur par défaut si absent ou illisible. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header) return DEFAULT_RETRY_AFTER_S
  const seconds = /^\d+$/.test(header.trim()) ? Number(header) : Math.ceil((Date.parse(header) - now) / 1000)
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_S
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_S)
}

/** URL permanente d'un média : sans la signature temporaire d'un média privé. */
export function permanentUrl(url: string): string {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}

/** Racine de l'API v1 d'un serveur ; null si l'adresse n'est pas une URL `http(s)`. */
export function apiRoot(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/api/v1`
  }
  catch {
    return null
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export function createApiClient(options: ApiClientOptions) {
  const root = apiRoot(options.baseUrl)
  if (!root) throw new ApiError(0, 'INVALID_URL')
  const request = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? defaultSleep
  const headers = { 'authorization': `Bearer ${options.key}`, 'accept': 'application/json', 'user-agent': options.userAgent }

  /**
   * Une voie par famille de requêtes (les envois ont leur propre débit côté serveur). Tant que le serveur
   * ne freine pas, les requêtes partent en parallèle. Dès qu'il demande d'attendre (429, 503), la voie
   * passe en file pour `SLOW_MODE_MS` : une requête à la fois, espacée du délai demandé. Sans cela, chaque
   * envoi parallèle se heurterait au même refus et renverrait son fichier pour rien.
   */
  const lanes = { upload: newLane(), other: newLane() }

  type Attempt<T> = { ok: true, value: T } | { ok: false, seconds: number, reason: 'rateLimited' | 'serverBusy', policy: string | null, problem: ApiError }

  async function call<T>(method: string, path: string, init: { query?: Record<string, string>, json?: unknown, form?: () => Promise<FormData>, lane?: keyof typeof lanes } = {}): Promise<T> {
    const url = new URL(`${root}${path}`)
    for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value)
    const lane = lanes[init.lane ?? 'other']

    /** Une requête, coupures réseau reprises ; rend le délai demandé par le serveur plutôt que d'attendre ici. */
    async function once(): Promise<Attempt<T>> {
      let networkFailures = 0
      for (;;) {
        let response: Response
        try {
          // Corps reconstruit à chaque essai : un flux déjà consommé ne se renvoie pas.
          const body = init.form ? await init.form() : init.json === undefined ? undefined : JSON.stringify(init.json)
          response = await request(url, {
            method,
            body,
            signal: options.signal,
            headers: init.json === undefined ? headers : { ...headers, 'content-type': 'application/json' },
          })
        }
        catch (error) {
          if (options.signal?.aborted) throw error
          const delay = NETWORK_RETRY_DELAYS_MS[networkFailures++]
          const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).message
          if (delay === undefined) throw new ApiError(0, 'NETWORK', cause)
          options.onWait?.({ seconds: delay / 1000, reason: 'network' })
          await sleep(delay, options.signal)
          continue
        }
        if (response.status === 429 || response.status === 503) {
          return {
            ok: false,
            seconds: retryAfterSeconds(response.headers.get('retry-after')),
            reason: response.status === 429 ? 'rateLimited' : 'serverBusy',
            policy: response.status === 429 ? exhaustedPolicy(response.headers.get('ratelimit')) : null,
            problem: await readProblem(response),
          }
        }
        if (!response.ok) throw await readProblem(response)
        if (response.status === 204) return { ok: true, value: undefined as T }
        try {
          return { ok: true, value: await response.json() as T }
        }
        catch {
          throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server did not answer with JSON: check the server address.')
        }
      }
    }

    let waits = 0
    let refused: Extract<Attempt<T>, { ok: false }> | null = null
    if (Date.now() >= lane.slowUntil) {
      const first = await once()
      if (first.ok) return first.value
      refused = first
    }
    return queued(lane, async () => {
      for (;;) {
        if (refused) {
          if (++waits > MAX_SERVER_WAITS) throw refused.problem
          lane.slowUntil = Date.now() + SLOW_MODE_MS
          lane.spacingMs = refused.seconds * 1000
          options.onWait?.({ seconds: refused.seconds, reason: refused.reason, ...(refused.policy ? { policy: refused.policy } : {}) })
          await sleep(refused.seconds * 1000, options.signal)
        }
        else {
          // File : au rythme que le serveur vient de demander, sans attendre un nouveau refus.
          const spacing = lane.nextAt - Date.now()
          if (spacing > 0) await sleep(spacing, options.signal)
        }
        const attempt = await once()
        lane.nextAt = Date.now() + lane.spacingMs
        if (attempt.ok) return attempt.value
        refused = attempt
      }
    })
  }

  return {
    root,

    me: () => call<ApiMe>('GET', '/me'),

    project: (projectId: string) => call<ApiProject>('GET', `/projects/${encodeURIComponent(projectId)}`),

    /** Projets accessibles (jeton personnel) : toutes les pages. */
    async projects(): Promise<ApiProject[]> {
      const items: ApiProject[] = []
      let cursor: string | null = null
      do {
        const page: { items: ApiProject[], nextCursor: string | null } = await call('GET', '/projects', { query: { limit: '100', ...(cursor ? { cursor } : {}) } })
        items.push(...page.items)
        cursor = page.nextCursor
      } while (cursor)
      return items
    },

    folders: async (projectId: string) => (await call<{ items: ApiFolder[] }>('GET', `/projects/${projectId}/folders`)).items,

    createFolder: (projectId: string, name: string, parentId: string | null) =>
      call<ApiFolder>('POST', `/projects/${projectId}/folders`, { json: { name, parentId } }),

    tags: async (projectId: string) => (await call<{ items: ApiTag[] }>('GET', `/projects/${projectId}/tags`)).items,

    createTag: (projectId: string, slug: string) => call<ApiTag>('POST', `/projects/${projectId}/tags`, { json: { name: slug, slug } }),

    media: (projectId: string, mediaId: string) => call<ApiMedia>('GET', `/projects/${projectId}/media/${encodeURIComponent(mediaId)}`),

    /** Média actif du projet qui porte cette référence d'origine, ou null. */
    async findBySourceRef(projectId: string, sourceRef: string): Promise<ApiMedia | null> {
      const page = await call<{ items: ApiMedia[] }>('GET', `/projects/${projectId}/media`, { query: { sourceRef, limit: '1' } })
      return page.items[0] ?? null
    },

    /** Plus ancien média actif du projet dont le fichier a cette empreinte, ou null. */
    async findByChecksum(projectId: string, checksum: string): Promise<ApiMedia | null> {
      const page = await call<{ items: ApiMedia[] }>('GET', `/projects/${projectId}/media`, { query: { checksum, sort: 'oldest', limit: '1' } })
      return page.items[0] ?? null
    },

    /** Envoie un fichier (lu en flux depuis le disque) ; les champs passent avant lui. */
    upload: (projectId: string, file: UploadFile, fields: UploadFields) =>
      call<ApiMedia>('POST', `/projects/${projectId}/media`, {
        lane: 'upload',
        form: async () => {
          const form = new FormData()
          form.set('sourceRef', fields.sourceRef)
          if (fields.title) form.set('title', fields.title)
          if (fields.altText) form.set('altText', fields.altText)
          if (fields.visibility) form.set('visibility', fields.visibility)
          if (fields.folderId) form.set('folderId', fields.folderId)
          if (fields.tags?.length) form.set('tags', fields.tags.join(','))
          form.set('file', await openAsBlob(file.path, { type: file.mimeType }), file.filename)
          return form
        },
      }),
  }
}

async function readProblem(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> | null = null
  try {
    body = await response.json() as Record<string, unknown>
  }
  catch {
    // Réponse d'un proxy ou d'un autre service : pas un problème de l'API.
  }
  if (!body || typeof body.code !== 'string') {
    return new ApiError(response.status, 'INVALID_RESPONSE', `HTTP ${response.status} without an API error: check the server address.`)
  }
  const extensions = Object.fromEntries(Object.entries(body).filter(([name]) => !PROBLEM_MEMBERS.has(name)))
  return new ApiError(response.status, body.code, typeof body.detail === 'string' ? body.detail : null, extensions)
}

/** Membres standards d'un problème (RFC 9457 et ceux de l'API) : le reste est une extension. */
const PROBLEM_MEMBERS = new Set(['type', 'title', 'status', 'code', 'detail', 'instance', 'requestId', 'errors'])
