import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDelegatedToken, DISPLAY_SCOPES, UPLOAD_SCOPES } from '../src/server'

/**
 * Entrée serveur `@surge-media/client/server` (architecture phase E, ED37) : émission d'un jeton délégué
 * avec la clé secrète, erreurs de l'API, refus de s'exécuter dans un navigateur.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE = 'https://media.example.com'
const issued = { token: 'sm_dt_abc.def', expiresAt: '2026-10-17T10:15:00.000Z', scopes: ['project:read', 'media:read', 'media:upload'] }

function mockFetch(response: Response) {
  const calls: { url: string, init: RequestInit }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

describe('createDelegatedToken', () => {
  it('portées prêtes à l\'emploi', () => {
    expect(DISPLAY_SCOPES).toEqual(['project:read', 'media:read'])
    expect(UPLOAD_SCOPES).toEqual(['project:read', 'media:read', 'media:upload'])
  })

  it('POST …/delegated-tokens avec la clé secrète ; champs absents omis', async () => {
    const { fetch, calls } = mockFetch(new Response(JSON.stringify(issued), { status: 201, headers: { 'content-type': 'application/json' } }))
    const token = await createDelegatedToken({
      baseUrl: `${BASE}/api/v1/`,
      projectId: 'cmproject01',
      secretKey: 'sm_sk_test',
      scopes: UPLOAD_SCOPES,
      subject: 'user-42',
      upload: { maxFiles: 10, visibility: 'private' },
      fetch,
    })
    expect(token).toEqual(issued)
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/projects/cmproject01/delegated-tokens`)
    expect(calls[0]!.init.method).toBe('POST')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sm_sk_test')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      scopes: ['project:read', 'media:read', 'media:upload'],
      subject: 'user-42',
      upload: { maxFiles: 10, visibility: 'private' },
    })
  })

  it('erreur de l\'API rendue en SurgeApiError', async () => {
    const { fetch } = mockFetch(new Response(JSON.stringify({ code: 'INSUFFICIENT_SCOPE', status: 403, detail: 'This credential lacks the media:upload scope.' }), {
      status: 403,
      headers: { 'content-type': 'application/problem+json' },
    }))
    await expect(createDelegatedToken({ baseUrl: BASE, projectId: 'cmproject01', secretKey: 'sm_sk_test', scopes: ['media:upload'], fetch }))
      .rejects.toMatchObject({ name: 'SurgeApiError', status: 403, code: 'INSUFFICIENT_SCOPE' })
  })

  it('refusée dans un navigateur, et sans clé', async () => {
    const { fetch } = mockFetch(new Response('{}'))
    await expect(createDelegatedToken({ baseUrl: BASE, projectId: 'cmproject01', secretKey: '', scopes: DISPLAY_SCOPES, fetch })).rejects.toThrow(TypeError)
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    await expect(createDelegatedToken({ baseUrl: BASE, projectId: 'cmproject01', secretKey: 'sm_sk_test', scopes: DISPLAY_SCOPES, fetch }))
      .rejects.toMatchObject({ code: 'SECRET_IN_BROWSER' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
