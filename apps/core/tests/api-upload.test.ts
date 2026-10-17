import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DelegatedGrant } from '../server/lib/access/delegated'
import type { ApiPrincipal } from '../server/lib/api/context'
import { problemBody, toProblem } from '../server/lib/api/problem'
import { rulesFor, uploadTypeRules } from '../server/lib/media/limits'
import { apiMeSchema, apiProblemSchema } from '../shared/schemas/api'
import { acceptedMimeTypes } from '../shared/utils/media'

/**
 * Évolutions du core pour l'envoi depuis les bibliothèques front (architecture phase E, § 12.2) : règles
 * d'envoi effectives de `GET /me` (ED29), membres d'extension des problèmes d'envoi (ED30), affiche posée
 * avec la seule portée `media:upload` (ED31), portées « l'une d'elles » de `requireApiProject`.
 */

const mocks = vi.hoisted(() => ({ active: false, used: 0 }))
vi.mock('../server/lib/video-processing/status', () => ({ videoProcessingActive: vi.fn(async () => mocks.active) }))
vi.mock('../server/lib/access/delegated', async importOriginal => ({
  ...await importOriginal<object>(),
  remainingDelegatedUploads: vi.fn(async (grant: DelegatedGrant) =>
    grant.upload?.maxFiles === undefined ? null : Math.max(0, grant.upload.maxFiles - mocks.used)),
}))
vi.mock('../server/lib/projects/state', () => ({
  getProjectState: vi.fn(async (id: string) => (id === 'p1' ? { id: 'p1', archived: false } : null)),
}))
vi.mock('../server/lib/access/principal', async importOriginal => ({
  ...await importOriginal<object>(),
  principalProjectScopes: vi.fn(async (principal: ApiPrincipal) => principal.delegated?.scopes ?? principal.credential.scopes),
}))

const { apiUploadRules, canSetOwnPoster, OWN_POSTER_WINDOW_MS } = await import('../server/lib/api/writes')
const { requireApiProject } = await import('../server/lib/api/context')

const MIB = 1024 * 1024

beforeEach(() => {
  mocks.active = false
  mocks.used = 0
  vi.stubGlobal('useRuntimeConfig', () => ({ media: { maxUploadSize: 25 * MIB, maxVideoUploadSize: 512 * MIB } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function grant(overrides: Partial<DelegatedGrant> = {}): DelegatedGrant {
  return {
    jti: 'jti-1',
    issuerId: 'cmsecret0001',
    projectId: 'p1',
    scopes: ['project:read', 'media:read', 'media:upload'],
    subject: 'user-42',
    origin: 'https://app.example.com',
    upload: null,
    issuedAt: new Date('2026-10-17T10:00:00Z'),
    expiresAt: new Date('2026-10-17T10:15:00Z'),
    ...overrides,
  }
}

function principal(type: ApiPrincipal['type'], scopes: string[], delegated: DelegatedGrant | null = null): ApiPrincipal {
  return { type, credential: { id: 'cmsecret0001', scopes } as unknown as ApiPrincipal['credential'], delegated }
}

describe('types acceptés avec leur taille (uploadTypeRules)', () => {
  it('ordre de l\'installation, genre en minuscules, extension, taille du genre bornée, formats convertis signalés', () => {
    const sizes = { IMAGE: 100, VIDEO: 1000 }
    const types = uploadTypeRules(rulesFor(sizes, undefined, 500, acceptedMimeTypes(true)))
    expect(types[0]).toEqual({ mimeType: 'image/jpeg', extension: 'jpg', kind: 'image', maxSize: 100, converted: false })
    expect(types.find(type => type.mimeType === 'video/quicktime')).toEqual({ mimeType: 'video/quicktime', extension: 'mov', kind: 'video', maxSize: 500, converted: false })
    expect(types.find(type => type.mimeType === 'video/x-matroska')).toMatchObject({ extension: 'mkv', converted: true, maxSize: 500 })
    expect(types.map(type => type.mimeType)).toEqual(acceptedMimeTypes(true))
  })

  it('intersection avec les types d\'un jeton, jamais élargie', () => {
    const types = uploadTypeRules(rulesFor({ IMAGE: 100, VIDEO: 1000 }, ['video/x-matroska', 'image/png']))
    expect(types.map(type => type.mimeType)).toEqual(['image/png'])
    expect(uploadTypeRules(rulesFor({ IMAGE: 100, VIDEO: 1000 }, ['video/x-matroska']))).toEqual([])
  })
})

describe('règles d\'envoi effectives (GET /me, ED29)', () => {
  it('null sans media:upload (clé publique, jeton délégué de lecture)', async () => {
    expect(await apiUploadRules(principal('publishable', ['project:read', 'media:read']))).toBeNull()
    expect(await apiUploadRules(principal('delegated', ['media:upload'], grant({ scopes: ['project:read', 'media:read'] })))).toBeNull()
  })

  it('clé secrète : tous les types de l\'installation, sans limite de nombre ni choix imposé', async () => {
    const rules = await apiUploadRules(principal('secret', ['media:upload']))
    expect(rules?.types.map(type => type.mimeType)).toEqual(acceptedMimeTypes(false))
    expect(rules?.types.find(type => type.kind === 'video')?.maxSize).toBe(512 * MIB)
    expect([rules?.remaining, rules?.visibility, rules?.folderId]).toEqual([null, null, null])
  })

  it('formats convertis seulement pendant que le traitement des vidéos est actif', async () => {
    mocks.active = true
    const rules = await apiUploadRules(principal('secret', ['media:upload']))
    expect(rules?.types.some(type => type.converted)).toBe(true)
  })

  it('jeton délégué : types et taille restreints, envois restants, visibilité et dossier imposés', async () => {
    mocks.used = 3
    const token = grant({ upload: { maxFiles: 5, maxSize: 10 * MIB, types: ['image/png', 'video/mp4'], visibility: 'private', folderId: 'cmfolder0001' } })
    const rules = await apiUploadRules(principal('delegated', [], token))
    expect(rules).toEqual({
      types: [
        { mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 10 * MIB, converted: false },
        { mimeType: 'video/mp4', extension: 'mp4', kind: 'video', maxSize: 10 * MIB, converted: false },
      ],
      remaining: 2,
      visibility: 'private',
      folderId: 'cmfolder0001',
    })
    mocks.used = 9
    expect((await apiUploadRules(principal('delegated', [], token)))?.remaining).toBe(0)
  })

  it('contrat : réponse de /me valide avec ou sans règles', () => {
    const me = {
      credential: { id: 'jti-1', type: 'delegated', name: 'Delegated token', prefix: 'sm_dt_', environment: 'production', scopes: ['media:upload'], expiresAt: '2026-10-17T10:15:00.000Z', createdAt: '2026-10-17T10:00:00.000Z' },
      delegated: { subject: 'user-42', origin: null, upload: { maxFiles: 5 } },
      user: null,
      project: { id: 'p1', name: 'Site', slug: 'site', archived: false },
      access: null,
      upload: { types: [{ mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 100, converted: false }], remaining: 5, visibility: null, folderId: null },
    }
    expect(apiMeSchema.safeParse(me).success).toBe(true)
    expect(apiMeSchema.safeParse({ ...me, upload: null }).success).toBe(true)
    expect(apiMeSchema.safeParse({ ...me, upload: { ...me.upload, remaining: -1 } }).success).toBe(false)
  })
})

describe('membres d\'extension des problèmes d\'envoi (ED30)', () => {
  const context = { base: 'https://media.example.com/api/v1', instance: '/api/v1/projects/p1/media', requestId: 'req-1' }

  it('413 maxSize, 415 accepted, 408 timeout, à côté du détail anglais', () => {
    const tooLarge = problemBody(toProblem({ statusCode: 413, data: { code: 'FILE_TOO_LARGE', maxSize: 1000 } }), context)
    expect(tooLarge).toMatchObject({ code: 'FILE_TOO_LARGE', maxSize: 1000, detail: 'The file exceeds the maximum size of 1000 bytes.' })
    const unsupported = problemBody(toProblem({ statusCode: 415, data: { code: 'UNSUPPORTED_TYPE', accepted: ['image/png', 42] } }), context)
    expect(unsupported).toMatchObject({ code: 'UNSUPPORTED_TYPE', accepted: ['image/png'] })
    const timeout = problemBody(toProblem({ statusCode: 408, data: { code: 'UPLOAD_TIMEOUT', timeout: 60 } }), context)
    expect(timeout).toMatchObject({ code: 'UPLOAD_TIMEOUT', timeout: 60 })
    for (const body of [tooLarge, unsupported, timeout]) expect(apiProblemSchema.safeParse(body).success).toBe(true)
  })

  it('aucun membre pour une valeur inattendue ou un autre code', () => {
    expect(problemBody(toProblem({ statusCode: 413, data: { code: 'FILE_TOO_LARGE', maxSize: 'big' } }), context)).not.toHaveProperty('maxSize')
    expect(problemBody(toProblem({ statusCode: 409, data: { code: 'VERSION_CONFLICT', maxSize: 5 } }), context)).not.toHaveProperty('maxSize')
  })
})

describe('affiche avec la seule portée media:upload (ED31)', () => {
  const now = Date.parse('2026-10-17T10:30:00Z')
  const video = { uploadedByTokenId: 'cmsecret0001', uploadSubject: 'user-42', createdAt: new Date(now - 60_000), posterKey: null }

  it('vidéo du même émetteur et du même sujet, récente, sans affiche', () => {
    expect(canSetOwnPoster(grant(), video, now)).toBe(true)
    // Jeton renouvelé après l'envoi (nouvel iat) : même émetteur et même sujet, accepté.
    expect(canSetOwnPoster(grant({ jti: 'jti-2', issuedAt: new Date(now) }), video, now)).toBe(true)
    // Sans sujet des deux côtés.
    expect(canSetOwnPoster(grant({ subject: null }), { ...video, uploadSubject: null }, now)).toBe(true)
  })

  it('refusée : autre sujet, autre émetteur, vidéo ancienne ou future, affiche existante, sans jeton délégué', () => {
    expect(canSetOwnPoster(grant({ subject: 'user-7' }), video, now)).toBe(false)
    expect(canSetOwnPoster(grant({ subject: null }), video, now)).toBe(false)
    expect(canSetOwnPoster(grant({ issuerId: 'cmsecret0002' }), video, now)).toBe(false)
    expect(canSetOwnPoster(grant(), { ...video, createdAt: new Date(now - OWN_POSTER_WINDOW_MS) }, now)).toBe(false)
    expect(canSetOwnPoster(grant(), { ...video, createdAt: new Date(now + 60_000) }, now)).toBe(false)
    expect(canSetOwnPoster(grant(), { ...video, posterKey: 'posters/x.jpg' }, now)).toBe(false)
    expect(canSetOwnPoster(null, video, now)).toBe(false)
    expect(OWN_POSTER_WINDOW_MS).toBe(3_600_000)
  })
})

describe('portées « l\'une d\'elles » (requireApiProject)', () => {
  const event = { context: { params: { projectId: 'p1' } } } as never

  it('accepte une portée de la liste, sinon 403 qui les cite', async () => {
    const upload = principal('delegated', [], grant())
    await expect(requireApiProject(event, upload, ['media:write', 'media:upload'], 'p1')).resolves.toMatchObject({ project: { id: 'p1' } })
    await expect(requireApiProject(event, upload, 'media:write', 'p1')).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE', message: 'This credential lacks the media:write scope in this project.' })
    const reader = principal('delegated', [], grant({ scopes: ['media:read'] }))
    await expect(requireApiProject(event, reader, ['media:write', 'media:upload'], 'p1')).rejects.toMatchObject({ message: 'This credential lacks the media:write or media:upload scope in this project.' })
  })
})
