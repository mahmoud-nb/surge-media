import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSurgeClient, normalizeBaseUrl } from '../src/client'
import { decodeDelegatedToken, delegatedCredential } from '../src/credentials'
import { isSurgeApiError, parseRetryAfter, SurgeApiError } from '../src/errors'
import { delegatedToken, imageMedia, project, videoMedia } from './fixtures'

interface Call {
  url: string
  headers: Record<string, string>
}

/** `fetch` simulé : enregistre les appels et rejoue les réponses données dans l'ordre. */
function mockFetch(responses: (Response | (() => Response) | Error)[]) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } })
    const next = responses.shift()
    if (!next) throw new Error('Unexpected request')
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...init.headers } })
const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail: `Detail of ${code}`, instance: '/x', requestId: 'req-1' }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adresse de l\'installation', () => {
  it('accepte l\'URL du site ou celle de l\'API, avec ou sans barre finale', () => {
    expect(normalizeBaseUrl('https://media.example.com/')).toEqual({ baseUrl: 'https://media.example.com', apiBaseUrl: 'https://media.example.com/api/v1' })
    expect(normalizeBaseUrl('https://media.example.com/api/v1/')).toEqual({ baseUrl: 'https://media.example.com', apiBaseUrl: 'https://media.example.com/api/v1' })
  })
})

describe('clé publique et cache ETag', () => {
  it('envoie la clé, revalide par ETag et rend la copie gardée sur 304', async () => {
    const { fetch, calls } = mockFetch([
      json(imageMedia, { headers: { etag: 'W/"m-3"' } }),
      new Response(null, { status: 304 }),
    ])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', publishableKey: 'sm_pk_test', fetch })
    expect(await client.media.get('cmimage0001')).toEqual(imageMedia)
    expect(await client.media.get('cmimage0001')).toEqual(imageMedia)
    expect(calls[0]!.url).toBe('https://media.example.com/api/v1/projects/cmproject01/media/cmimage0001')
    expect(calls[0]!.headers.Authorization).toBe('Bearer sm_pk_test')
    expect(calls[0]!.headers['If-None-Match']).toBeUndefined()
    expect(calls[1]!.headers['If-None-Match']).toBe('W/"m-3"')
  })

  it('sérialise la requête de liste et parcourt toutes les pages', async () => {
    const { fetch, calls } = mockFetch([
      json({ items: [imageMedia], nextCursor: 'c2' }),
      json({ items: [videoMedia], nextCursor: null }),
    ])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', publishableKey: 'sm_pk_test', fetch })
    const ids: string[] = []
    for await (const media of client.media.iterate({ kind: 'image', recursive: true, q: 'plage' })) ids.push(media.id)
    expect(ids).toEqual(['cmimage0001', 'cmvideo0001'])
    expect(calls[0]!.url).toBe('https://media.example.com/api/v1/projects/cmproject01/media?kind=image&recursive=true&q=plage')
    expect(calls[1]!.url).toContain('cursor=c2')
  })

  it('réhydrate par lots de 100 identifiants, dans l\'ordre demandé, sans les introuvables', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `cmmedia${String(index).padStart(4, '0')}`)
    const { fetch, calls } = mockFetch([
      json({ items: [{ ...imageMedia, id: ids[99]! }, { ...imageMedia, id: ids[0]! }], nextCursor: null }),
      json({ items: [{ ...imageMedia, id: ids[149]! }], nextCursor: null }),
    ])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', publishableKey: 'sm_pk_test', fetch })
    const found = await client.media.getMany(ids)
    expect(found.map(media => media.id)).toEqual([ids[0], ids[99], ids[149]])
    expect(new URL(calls[0]!.url).searchParams.get('ids')!.split(',')).toHaveLength(100)
    expect(new URL(calls[1]!.url).searchParams.get('ids')!.split(',')).toHaveLength(50)
  })

  it('garde le projet en cache, sauf demande explicite', async () => {
    const { fetch, calls } = mockFetch([json(project), json({ ...project, transformPolicy: 'presets' })])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', publishableKey: 'sm_pk_test', fetch })
    expect((await client.project()).transformPolicy).toBe('open')
    expect((await client.project()).transformPolicy).toBe('open')
    expect((await client.project({ refresh: true })).transformPolicy).toBe('presets')
    expect(calls).toHaveLength(2)
  })
})

describe('erreurs', () => {
  it('convertit un problème RFC 9457 en SurgeApiError traduisible', async () => {
    const { fetch } = mockFetch([problem(429, 'RATE_LIMITED', { 'retry-after': '12' })])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'p1', publishableKey: 'sm_pk_test', fetch })
    const error = await client.media.list().catch((caught: unknown) => caught)
    expect(isSurgeApiError(error)).toBe(true)
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfter: 12, requestId: 'req-1', detail: 'Detail of RATE_LIMITED' })
    expect((error as SurgeApiError).localizedMessage()).toBe('Trop de demandes : réessayez dans un instant.')
    expect((error as SurgeApiError).localizedMessage('en-GB')).toBe('Too many requests: try again in a moment.')
    expect(client.errorMessage(error, 'de')).toBe('Trop de demandes : réessayez dans un instant.')
  })

  it('lit le code d\'une erreur de diffusion (data.code) et signale un serveur injoignable', async () => {
    const { fetch } = mockFetch([
      new Response(JSON.stringify({ statusCode: 503, data: { code: 'PROCESSING_PENDING' } }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '30' } }),
      new TypeError('Failed to fetch'),
    ])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'p1', fetch })
    await expect(client.media.get('x1234567')).rejects.toMatchObject({ code: 'PROCESSING_PENDING', retryAfter: 30 })
    await expect(client.media.get('x1234567')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('Retry-After en secondes ou en date HTTP', () => {
    expect(parseRetryAfter('5')).toBe(5)
    expect(parseRetryAfter(new Date(Date.UTC(2026, 0, 1, 0, 0, 30)).toUTCString(), Date.UTC(2026, 0, 1))).toBe(30)
    expect(parseRetryAfter('demain')).toBeNull()
  })

  it('refuse une clé secrète dans un navigateur, avant tout envoi', () => {
    vi.stubGlobal('document', {})
    expect(() => createSurgeClient({ baseUrl: 'https://m.example.com', projectId: 'p1', publishableKey: 'sm_sk_oops' })).toThrow(SurgeApiError)
  })
})

describe('jetons délégués', () => {
  it('lit la charge du jeton sans vérifier la signature', () => {
    expect(decodeDelegatedToken(delegatedToken({ exp: 2_000_000_000, sub: 'user-é' }))).toMatchObject({ exp: 2_000_000_000, sub: 'user-é', project: 'cmproject01' })
    expect(decodeDelegatedToken('sm_pk_x')).toBeNull()
    expect(decodeDelegatedToken('sm_dt_%%%.x')).toBeNull()
  })

  it('renouvelle le jeton avant son échéance et partage un renouvellement en cours', async () => {
    let now = 1_000_000_000_000
    let issued = 0
    const getToken = vi.fn(async () => {
      issued++
      return { token: delegatedToken({ exp: now / 1000 + 900 }), expiresAt: new Date(now + 900_000).toISOString() }
    })
    const credential = delegatedCredential(getToken, { now: () => now })
    const [a, b] = await Promise.all([credential.authorization(), credential.authorization()])
    expect(a).toBe(b)
    expect(issued).toBe(1)
    now += 800_000 // encore 100 s : pas de renouvellement
    await credential.authorization()
    expect(issued).toBe(1)
    now += 50_000 // 50 s avant l'échéance : renouvellement
    await credential.authorization()
    expect(issued).toBe(2)
  })

  it('redemande un jeton une seule fois après un 401 TOKEN_EXPIRED', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900
    const tokens = [delegatedToken({ exp, sub: 'a' }), delegatedToken({ exp, sub: 'b' })]
    const { fetch, calls } = mockFetch([problem(401, 'TOKEN_EXPIRED'), json(imageMedia), problem(401, 'TOKEN_EXPIRED'), problem(401, 'TOKEN_EXPIRED')])
    const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', getToken: () => tokens.shift() ?? delegatedToken({ exp }), fetch })
    expect(await client.media.get('cmimage0001')).toEqual(imageMedia)
    expect(calls[0]!.headers.Authorization).not.toBe(calls[1]!.headers.Authorization)
    await expect(client.media.get('cmimage0001')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    expect(calls).toHaveLength(4)
  })

  it('accepte la réponse de POST …/delegated-tokens telle quelle', async () => {
    const token = delegatedToken({ exp: 2_000_000_000 })
    const credential = delegatedCredential(() => ({ token, expiresAt: '2033-05-18T03:33:20.000Z' }))
    expect(await credential.authorization()).toBe(`Bearer ${token}`)
    expect(credential.identity()).toBe('dt:cmissuer001:cmproject01::media:read project:read')
  })
})
